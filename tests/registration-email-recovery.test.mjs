import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sendAcsEmailWithRetry } from "../registration/server/acs-email-delivery.mjs";
import { confirmationRecoveryPlan, reconcileEmailHealth } from "../registration/server/email-health.mjs";
import { OrderRegistrationService } from "../registration/server/order-service.mjs";
import { createAzureTableRepository, createMemoryRepository } from "../registration/server/repositories.mjs";
import { createDatabase } from "../registration/server/service.mjs";
import { capacitySummary } from "../registration/server/phase3-domain.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";

const at = new Date("2026-09-28T08:00:00Z");
const organiser = { authenticated: true, role: "administrator", actorType: "organiser", id: "synthetic-organiser" };
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function etagConflictRepository(initialState, conflictSubmitCalls = []) {
  let stored = structuredClone(initialState); let etag = 1; let submits = 0;
  const conflicts = new Set(conflictSubmitCalls);
  const repository = createAzureTableRepository({
    async loadPartition() { return { state: structuredClone(stored), etag: String(etag) }; },
    async submitTransaction({ after }) {
      submits += 1;
      if (conflicts.has(submits)) {
        stored.auditEvents.push({ id: `concurrent-${submits}`, action: "unrelated_concurrent_write", occurredAt: at.toISOString(), environment: stored.environment }); etag += 1;
        const error = new Error("synthetic ETag conflict"); error.statusCode = 412; throw error;
      }
      stored = structuredClone(after); etag += 1;
    },
    retryDelay: async () => {}
  });
  return { repository, submits: () => submits };
}

function providerError(statusCode, retryAfter = null) {
  const error = new Error(`provider ${statusCode}`); error.statusCode = statusCode;
  error.response = { status: statusCode, headers: { get(name) { return name.toLowerCase() === "retry-after" ? retryAfter : null; } } };
  return error;
}

test("ACS 429 retry respects Retry-After and reuses one operation id", async () => {
  const calls = []; const delays = []; let attempt = 0;
  const client = { async beginSend(_request, options) { calls.push(options.operationId); attempt += 1; if (attempt < 3) throw providerError(429, "2"); return { async pollUntilDone() { return { status: "Succeeded", id: "provider-test" }; } }; } };
  const result = await sendAcsEmailWithRetry({ client, request: {}, operationId: "stable-operation", maxAttempts: 4, baseDelayMs: 100, maximumDelayMs: 5_000, random: () => 0, sleep: async (delay) => delays.push(delay), telemetry: {} });
  assert.equal(result.delivery, "sent"); assert.equal(result.retryCount, 2); assert.deepEqual(delays, [2_000, 2_000]); assert.deepEqual(new Set(calls), new Set(["stable-operation"]));
});

test("ACS transport defers rather than retrying before a long Retry-After", async () => {
  let calls = 0; const delays = [];
  const client = { async beginSend() { calls += 1; throw providerError(429, "120"); } };
  const result = await sendAcsEmailWithRetry({ client, request: {}, operationId: "stable-operation", maximumDelayMs: 64_000, sleep: async (delay) => delays.push(delay), telemetry: {} });
  assert.equal(result.delivery, "failed"); assert.equal(result.failureCategory, "throttled"); assert.equal(result.retryAfterMs, 120_000);
  assert.equal(calls, 1); assert.deepEqual(delays, []);
});

test("ACS transient 5xx retries with bounded exponential delay", async () => {
  const delays = []; let attempt = 0;
  const client = { async beginSend() { attempt += 1; if (attempt < 3) throw providerError(503); return { async pollUntilDone() { return { status: "Succeeded", id: "provider-test" }; } }; } };
  const result = await sendAcsEmailWithRetry({ client, request: {}, operationId: "stable", maxAttempts: 4, baseDelayMs: 100, maximumDelayMs: 150, random: () => 0, sleep: async (delay) => delays.push(delay), telemetry: {} });
  assert.equal(result.delivery, "sent"); assert.deepEqual(delays, [100, 150]);
});

test("permanent ACS rejection and final failed delivery are not endlessly retried", async () => {
  let rejectedCalls = 0; const rejected = { async beginSend() { rejectedCalls += 1; throw providerError(400); } };
  const first = await sendAcsEmailWithRetry({ client: rejected, request: {}, operationId: "one", sleep: async () => {}, telemetry: {} });
  assert.equal(first.delivery, "failed"); assert.equal(first.failureCategory, "permanent_provider_rejection"); assert.equal(rejectedCalls, 1);
  let finalCalls = 0; const finalFailure = { async beginSend() { finalCalls += 1; return { async pollUntilDone() { return { status: "Failed", id: "provider-failed" }; } }; } };
  const second = await sendAcsEmailWithRetry({ client: finalFailure, request: {}, operationId: "two", sleep: async () => {}, telemetry: {} });
  assert.equal(second.delivery, "failed"); assert.equal(second.providerReference, "provider-failed"); assert.equal(finalCalls, 1);
});

function recoveryState() {
  const state = createDatabase({ environment: "development", registrationState: "test", capacity: 120 });
  state.runners.push(
    { id: "runner-complete", firstName: "Complete", lastName: "Example", email: "complete@example.com" },
    { id: "runner-pending", firstName: "Pending", lastName: "Example", email: "pending@example.com" },
    { id: "runner-unpaid", firstName: "Unpaid", lastName: "Example", email: "unpaid@example.com" }
  );
  state.registrations.push(
    { id: "registration-complete", runnerId: "runner-complete", entryStatus: "accepted", placeStatus: "confirmed", declarationStatus: "complete" },
    { id: "registration-pending", runnerId: "runner-pending", entryStatus: "accepted", placeStatus: "confirmed", declarationStatus: "pending" },
    { id: "registration-unpaid", runnerId: "runner-unpaid", entryStatus: "accepted", placeStatus: "payment_reserved", declarationStatus: "pending" }
  );
  state.payments.push(
    { id: "payment-complete", registrationIds: ["registration-complete"], status: "paid", refundedRegistrationIds: [] },
    { id: "payment-pending", registrationIds: ["registration-pending"], status: "paid", refundedRegistrationIds: [] },
    { id: "payment-unpaid", registrationIds: ["registration-unpaid"], status: "checkout_pending", refundedRegistrationIds: [] }
  );
  state.communications.push({ id: "communication-complete", idempotencyKey: "initial-complete", registrationId: "registration-complete", template: "entry_confirmed", delivery: "sent", providerReference: "provider-complete", externalCall: true, createdAt: at.toISOString(), sentAt: at.toISOString() });
  state.managementTokens.push({ id: "old-management", registrationId: "registration-pending", tokenHash: sha256("old-management-token"), issuedAt: at.toISOString(), invalidatedAt: null });
  state.declarationTokens.push({ id: "old-declaration", registrationId: "registration-pending", purpose: "runner_declaration", tokenHash: sha256("old-declaration-token"), issuedAt: at.toISOString(), revokedAt: null });
  return state;
}

test("email health counts only paid confirmed registrations and does not resend success", () => {
  const state = recoveryState(); state.communications.push({ id: "other", idempotencyKey: "other", registrationId: "registration-complete", template: "refund_completed", delivery: "failed", createdAt: at.toISOString() });
  const health = reconcileEmailHealth(state, at); const plan = confirmationRecoveryPlan(state);
  assert.equal(health.expectedConfirmations, 2); assert.deepEqual(health.initialConfirmations, { sent: 1, failed: 0, missing: 1, withProviderReference: 1 });
  assert.equal(health.otherCommunications.refund_completed.failed, 1); assert.deepEqual(plan.map((item) => item.registrationId), ["registration-pending"]);
});

test("guarded recovery dry run sends only one missing confirmation with fresh secure links", async () => {
  const state = recoveryState(); const repository = createMemoryRepository(state); const sent = [];
  const orders = new OrderRegistrationService({ repository, publicBaseUrl: "https://development.example", emailAdapter: { async send(message) { sent.push(message); return { delivery: "sent", providerReference: "provider-recovery", externalCall: true }; } } });
  const preview = await orders.previewConfirmationRecovery(organiser, at); assert.equal(preview.dryRun, true); assert.equal(preview.recovery.required, 1); assert.equal(sent.length, 0);
  assert.equal((await orders.recoverOneConfirmation(organiser, { previewFingerprint: "wrong", confirmation: "SEND 1 RECOVERY EMAIL" }, at)).code, "CONFIRMATION_REQUIRED"); assert.equal(sent.length, 0);
  const executed = await orders.recoverOneConfirmation(organiser, { previewFingerprint: preview.previewFingerprint, confirmation: "SEND 1 RECOVERY EMAIL" }, at);
  assert.equal(executed.ok, true); assert.equal(executed.sent, 1); assert.equal(executed.remaining, 0); assert.equal(sent[0].template, "entry_confirmed_declaration_required");
  assert.match(sent[0].data.managementUrl, /#token=/); assert.match(sent[0].data.secureUrl, /#manage=.*&token=/); assert.equal(sent[0].intendedRecipientAddress, "pending@example.com");
  const final = await repository.read(); assert.ok(final.managementTokens.find((item) => item.id === "old-management").invalidatedAt); assert.ok(final.declarationTokens.find((item) => item.id === "old-declaration").revokedAt);
  assert.equal(final.communications.filter((item) => item.providerReference === "provider-recovery").length, 1); assert.ok(final.auditEvents.some((item) => item.action === "confirmation_email_recovery_attempted"));
  const duplicate = await orders.recoverOneConfirmation(organiser, { previewFingerprint: preview.previewFingerprint, confirmation: "SEND 1 RECOVERY EMAIL" }, at); assert.equal(duplicate.duplicate, true); assert.equal(sent.length, 1);
});

test("failed recovery records failure without undoing paid registration", async () => {
  const state = recoveryState(); state.communications.push({ id: "failed-initial", idempotencyKey: "failed-initial", registrationId: "registration-pending", template: "entry_confirmed_declaration_required", delivery: "failed", createdAt: at.toISOString() });
  const repository = createMemoryRepository(state); const orders = new OrderRegistrationService({ repository, publicBaseUrl: "https://development.example", emailAdapter: { async send() { return { delivery: "failed", failureCategory: "throttled", externalCall: true }; } } });
  const preview = await orders.previewConfirmationRecovery(organiser, at); const result = await orders.recoverOneConfirmation(organiser, { previewFingerprint: preview.previewFingerprint, confirmation: "SEND 1 RECOVERY EMAIL" }, at);
  assert.equal(result.code, "EMAIL_DELIVERY_FAILED"); const final = await repository.read();
  assert.equal(final.payments.find((item) => item.id === "payment-pending").status, "paid"); assert.equal(final.registrations.find((item) => item.id === "registration-pending").placeStatus, "confirmed");
  assert.equal(final.communications.filter((item) => item.registrationId === "registration-pending" && item.delivery === "failed").length, 2);
  assert.equal(final.managementTokens.find((item) => item.id === "old-management").invalidatedAt, null);
  assert.equal(final.declarationTokens.find((item) => item.id === "old-declaration").revokedAt, null);
  const phase3 = new Phase3IntegrationService({ repository, emailAdapter: { async send() {} }, publicBaseUrl: "https://development.example" });
  assert.equal((await phase3.managementEntry("old-management-token")).ok, true);
  assert.equal((await orders.inspectDeclaration("old-declaration-token")).ok, true);
});

test("recovery honours the configured hourly external-attempt budget", async () => {
  const state = recoveryState();
  state.communications.push({ id: "recent-external", idempotencyKey: "recent-external", template: "management_link_recovery", delivery: "sent", externalCall: true, attemptedAt: at.toISOString(), createdAt: at.toISOString() });
  const repository = createMemoryRepository(state); let sends = 0;
  const orders = new OrderRegistrationService({ repository, publicBaseUrl: "https://development.example", emailRecoveryMaxPerHour: 1, emailAdapter: { async send() { sends += 1; return { delivery: "sent", externalCall: true }; } } });
  const preview = await orders.previewConfirmationRecovery(organiser, at);
  const result = await orders.recoverOneConfirmation(organiser, { previewFingerprint: preview.previewFingerprint, confirmation: "SEND 1 RECOVERY EMAIL" }, at);
  assert.equal(result.ok, false); assert.equal(result.code, "EMAIL_RATE_BUDGET_EXHAUSTED"); assert.equal(sends, 0);
});

test("recovery ACS success followed by finalisation ETag conflict keeps one valid emailed token set", async () => {
  const prepared = etagConflictRepository(recoveryState(), [3]); const sent = [];
  const emailAdapter = { async send(message) { sent.push(message); return { delivery: "sent", externalCall: true, providerReference: "provider-once" }; } };
  const orders = new OrderRegistrationService({ repository: prepared.repository, publicBaseUrl: "https://development.example", emailAdapter });
  const preview = await orders.previewConfirmationRecovery(organiser, at);
  const result = await orders.recoverOneConfirmation(organiser, { previewFingerprint: preview.previewFingerprint, confirmation: "SEND 1 RECOVERY EMAIL" }, at);
  assert.equal(result.ok, true); assert.equal(sent.length, 1); assert.ok(prepared.submits() >= 4);
  const secure = new URL(sent[0].data.secureUrl); const declarationToken = new URLSearchParams(secure.hash.slice(1)).get("token"); const managementToken = new URLSearchParams(secure.hash.slice(1)).get("manage");
  assert.equal((await orders.inspectDeclaration(declarationToken)).ok, true);
  const phase3 = new Phase3IntegrationService({ repository: prepared.repository, emailAdapter, publicBaseUrl: "https://development.example" });
  assert.equal((await phase3.managementEntry(managementToken)).ok, true);
  const final = await prepared.repository.read();
  assert.equal(final.communications.filter((item) => item.registrationId === "registration-pending" && item.delivery === "sent").length, 1);
  assert.equal(final.emailOutbox.filter((item) => item.status === "sent").length, 1);
  assert.equal((await orders.previewConfirmationRecovery(organiser, at)).recovery.required, 0);
});

test("normal Stripe confirmation commits credentials before send and survives prepare and finalisation conflicts", async () => {
  const state = createDatabase({ environment: "development", registrationState: "test", capacity: 120 });
  state.runners.push({ id: "runner-stripe", firstName: "Stripe", lastName: "Runner", email: "stripe-runner@example.com", dateOfBirth: "1990-01-01", raceCategory: "Female" });
  state.registrations.push({ id: "registration-stripe", runnerId: "runner-stripe", entryStatus: "accepted", placeStatus: "payment_reserved", declarationStatus: "pending", createdAt: at.toISOString(), updatedAt: at.toISOString() });
  state.orders.push({ id: "order-stripe", purchaserEmail: "purchaser@example.com", registrationIds: ["registration-stripe"], status: "checkout_pending", totalPence: 600, createdAt: at.toISOString(), updatedAt: at.toISOString() });
  state.payments.push({ id: "payment-stripe", orderId: "order-stripe", registrationIds: ["registration-stripe"], status: "checkout_pending", expectedAmountPence: 600, actualPaidAmountPence: null, currency: "gbp", checkoutSessionId: "cs_conflict", checkoutAttempts: [{ sessionId: "cs_conflict", status: "active" }], refundedRegistrationIds: [] });
  const prepared = etagConflictRepository(state, [1, 4]); const sent = [];
  const emailAdapter = { async send(message) { sent.push(message); return { delivery: "sent", externalCall: true, providerReference: "provider-stripe-once" }; } };
  const orders = new OrderRegistrationService({ repository: prepared.repository, emailAdapter, publicBaseUrl: "https://development.example" });
  const event = { id: "evt-conflict", type: "checkout.session.completed", data: { object: { id: "cs_conflict", amount_total: 600, currency: "gbp", payment_status: "paid", payment_intent: "pi_conflict" } } };
  const result = await orders.webhook(event, at); assert.equal(result.ok, true); assert.equal(sent.length, 1);
  const secure = new URL(sent[0].data.secureUrl); const parameters = new URLSearchParams(secure.hash.slice(1)); const declarationToken = parameters.get("token"); const managementToken = parameters.get("manage");
  assert.equal((await orders.inspectDeclaration(declarationToken)).ok, true);
  const phase3 = new Phase3IntegrationService({ repository: prepared.repository, emailAdapter, publicBaseUrl: "https://development.example" });
  assert.equal((await phase3.managementEntry(managementToken)).ok, true);
  const final = await prepared.repository.read();
  assert.equal(final.payments.length, 1); assert.equal(final.payments[0].status, "paid"); assert.equal(capacitySummary(final).confirmed, 1);
  assert.equal(final.processedPaymentEvents.filter((item) => item.id === event.id).length, 1);
  assert.equal(final.communications.filter((item) => item.registrationId === "registration-stripe").length, 1);
  assert.equal((await orders.webhook(event, at)).duplicate, true); assert.equal(sent.length, 1);
});
