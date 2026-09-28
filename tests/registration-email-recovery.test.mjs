import test from "node:test";
import assert from "node:assert/strict";
import { sendAcsEmailWithRetry } from "../registration/server/acs-email-delivery.mjs";
import { confirmationRecoveryPlan, reconcileEmailHealth } from "../registration/server/email-health.mjs";
import { OrderRegistrationService } from "../registration/server/order-service.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { createDatabase } from "../registration/server/service.mjs";

const at = new Date("2026-09-28T08:00:00Z");
const organiser = { authenticated: true, role: "administrator", actorType: "organiser", id: "synthetic-organiser" };

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
  state.managementTokens.push({ id: "old-management", registrationId: "registration-pending", tokenHash: "old", issuedAt: at.toISOString(), invalidatedAt: null });
  state.declarationTokens.push({ id: "old-declaration", registrationId: "registration-pending", tokenHash: "old", issuedAt: at.toISOString(), revokedAt: null });
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
