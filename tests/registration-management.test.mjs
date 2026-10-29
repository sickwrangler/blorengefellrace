import assert from "node:assert/strict";
import test from "node:test";

import { beginProductionRegistration, capacitySummary, createPhase3State, issueManagementToken } from "../registration/server/phase3-domain.mjs";
import { createApi } from "../registration/server/api.mjs";
import { renderRegistrationEmail } from "../registration/server/email-templates.mjs";
import { Phase3IntegrationService, managementActionEligibility } from "../registration/server/phase3-service.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";

const beforeCutoff = new Date("2026-10-28T22:00:00.000Z");
const afterRefundCutoff = new Date("2026-10-29T12:00:00.000Z");
const afterTransferCutoff = new Date("2026-11-28T00:00:00.000Z");
const runner = (number = 1, overrides = {}) => ({
  email: `runner-${number}@example.com`, firstName: `Runner ${number}`, lastName: "Example",
  phone: "07700 900123", addressLine1: "1 Example Street", addressLine2: "", city: "Abergavenny", postcode: "NP7 5AA",
  raceCategory: "Female", dateOfBirth: "1990-06-15", club: "Example Harriers", wfraMember: false, wfraMembershipNumber: "",
  emergencyContactName: "Contact Example", emergencyContactPhone: "07700 900456", ...overrides
});
const declaration = (number = 1) => ({ declarationIdentifier: "WFRA_SENIOR_ENTRY", declarationVersion: "21/02/23", accepted: true, typedFullName: `Runner ${number} Example`, signatoryRole: "Competitor" });

function paidEntry({ declarationComplete = true } = {}) {
  const state = createPhase3State({ environment: "development", registrationState: "OPEN" });
  Object.assign(state, { consents: [], communications: [], emergencyContacts: [], declarationTokens: [], orders: [], orderTokens: [], declarationRecoveryAttempts: [], processedPaymentEvents: [], emailOutbox: [] });
  const created = beginProductionRegistration(state, { runner: runner(), declaration: declaration() }, { at: beforeCutoff });
  assert.equal(created.ok, true);
  created.registration.testReference = "TEST-MANAGEMENT";
  created.registration.placeStatus = "confirmed";
  created.registration.declarationStatus = declarationComplete ? "complete" : "pending";
  if (!declarationComplete) state.declarations = [];
  state.payments[0].status = "paid";
  state.emergencyContacts.push({ id: "emergency_test", registrationId: created.registration.id, name: "Contact Example", phone: "07700 900456" });
  return { state, created };
}

function serviceFor(state, { emailAdapter, sent = [] } = {}) {
  const email = emailAdapter ?? { kind: "test", async send(message) { sent.push(message); return { delivery: "sent", externalCall: false }; } };
  const repository = createMemoryRepository(state);
  const service = new Phase3IntegrationService({ repository, stripeGateway: { mode: "test" }, emailAdapter: email, publicBaseUrl: "https://development.example" });
  return { service, repository, sent };
}

test("management eligibility matrix follows existing entry, payment, declaration, refund and cutoff rules", async () => {
  const { state, created } = paidEntry();
  let actions = managementActionEligibility(state, created.registration, { at: beforeCutoff, paymentsAvailable: true });
  assert.deepEqual(Object.fromEntries(Object.entries(actions).map(([name, action]) => [name, action.available])), {
    continuePayment: false, signDeclaration: false, amend: true, transfer: true, requestRefund: true
  });
  assert.equal(actions.continuePayment.code, "PAYMENT_ALREADY_COMPLETE");
  assert.equal(actions.signDeclaration.code, "DECLARATION_COMPLETE");

  actions = managementActionEligibility(state, created.registration, { at: afterRefundCutoff, paymentsAvailable: true });
  assert.equal(actions.amend.available, true, "safe contact/race-detail amendments remain available after the cutoff");
  assert.equal(actions.transfer.available, true, "the later transfer deadline remains open after the refund deadline");
  assert.equal(actions.requestRefund.code, "REFUND_CUTOFF_PASSED");
  actions = managementActionEligibility(state, created.registration, { at: afterTransferCutoff, paymentsAvailable: true });
  assert.equal(actions.transfer.code, "TRANSFER_CUTOFF_PASSED");
  assert.equal(actions.transfer.deadline, "2026-11-27T23:59:00.000Z");

  state.registrations[0].declarationStatus = "pending"; state.declarations = [];
  actions = managementActionEligibility(state, created.registration, { at: beforeCutoff, paymentsAvailable: true });
  assert.equal(actions.signDeclaration.available, true);

  state.payments[0].status = "expired"; state.registrations[0].placeStatus = "none";
  actions = managementActionEligibility(state, created.registration, { at: beforeCutoff, paymentsAvailable: true });
  assert.equal(actions.continuePayment.available, true);
  assert.equal(actions.signDeclaration.code, "DECLARATION_AFTER_PAYMENT");
  assert.equal(actions.requestRefund.code, "REFUND_NOT_READY");
  assert.equal(actions.transfer.code, "TRANSFER_PAYMENT_REQUIRED");

  state.payments[0].status = "paid"; state.registrations[0].placeStatus = "confirmed";
  state.refundRequests.push({ id: "refund_rejected", registrationId: created.registration.id, status: "rejected" });
  actions = managementActionEligibility(state, created.registration, { at: beforeCutoff, paymentsAvailable: true });
  assert.equal(actions.requestRefund.available, true, "a rejected request does not permanently suppress the server-supported action");
  state.refundRequests.push({ id: "refund_requested", registrationId: created.registration.id, status: "requested" });
  actions = managementActionEligibility(state, created.registration, { at: beforeCutoff, paymentsAvailable: true });
  assert.equal(actions.requestRefund.code, "REFUND_ALREADY_IN_PROGRESS");

  state.registrations[0].entryStatus = "place_released";
  actions = managementActionEligibility(state, created.registration, { at: beforeCutoff, paymentsAvailable: true });
  assert.ok(Object.values(actions).every((action) => action.available === false));
  assert.equal(actions.amend.code, "ENTRY_INACTIVE");
});

test("deadline policies retain safe amendments, close refunds first and close transfers on 27 November", async () => {
  const { state, created } = paidEntry();
  const { service } = serviceFor(state);
  const amended = await service.amend(created.managementToken, { phone: "07700 900999", club: "Updated Club" }, afterRefundCutoff);
  assert.equal(amended.ok, true);
  assert.equal(amended.registration.runner.phone, "07700 900999");
  assert.equal(amended.registration.actions.amend.available, true);
  assert.equal((await service.requestRefund(created.managementToken, afterRefundCutoff)).code, "REFUND_CUTOFF_PASSED");
  const replacement = await repositoryWithFreshToken(service, afterTransferCutoff);
  assert.equal((await service.transfer(replacement, { runner: runner(2) }, afterTransferCutoff)).code, "TRANSFER_CUTOFF_PASSED");
});

async function repositoryWithFreshToken(service, at) {
  let value;
  await service.repository.transaction((state) => { value = issueManagementToken(state, state.registrations[0].id, { actorType: "system", id: "test-recovery" }, at).token; return { ok: true }; });
  return value;
}

test("management access expires after 24 hours with a legacy issuedAt fallback", async () => {
  const { state, created } = paidEntry();
  const { service, repository } = serviceFor(state);
  const issuedAt = new Date(state.managementTokens[0].issuedAt);
  assert.equal((await service.managementEntry(created.managementToken, new Date(issuedAt.getTime() + 24 * 3_600_000 - 1))).ok, true);
  assert.equal((await service.managementEntry(created.managementToken, new Date(issuedAt.getTime() + 24 * 3_600_000))).code, "MANAGEMENT_TOKEN_EXPIRED");
  await repository.transaction((working) => { delete working.managementTokens[0].expiresAt; return { ok: true }; });
  assert.equal((await service.managementEntry(created.managementToken, new Date(issuedAt.getTime() + 24 * 3_600_000))).code, "MANAGEMENT_TOKEN_EXPIRED");
});

test("website recovery replaces an expired link and sends it only to the registered address", async () => {
  const { state, created } = paidEntry();
  const sent = []; const { service, repository } = serviceFor(state, { sent });
  const recoveryAt = new Date(new Date(state.managementTokens[0].issuedAt).getTime() + 25 * 3_600_000);
  assert.equal((await service.managementEntry(created.managementToken, recoveryAt)).code, "MANAGEMENT_TOKEN_EXPIRED");
  const result = await service.recoverManagementLink("RUNNER-1@EXAMPLE.COM", recoveryAt);
  assert.equal(result.ok, true); assert.equal(sent.length, 1);
  assert.equal(sent[0].intendedRecipientAddress, "runner-1@example.com");
  const replacement = decodeURIComponent(new URL(sent[0].data.secureUrl).hash.slice(1).split("token=")[1]);
  assert.equal((await service.managementEntry(replacement, recoveryAt)).ok, true);
  assert.equal((await service.managementEntry(created.managementToken, recoveryAt)).code, "MANAGEMENT_TOKEN_EXPIRED");
  const stored = await repository.read();
  assert.equal(stored.managementTokens.filter((item) => !item.invalidatedAt).length, 1);
  assert.equal(stored.managementTokens.at(-1).expiresAt, new Date(recoveryAt.getTime() + 24 * 3_600_000).toISOString());
});

test("failed recovery delivery does not revoke the previous usable management link", async () => {
  const { state, created } = paidEntry();
  const { service, repository } = serviceFor(state, { emailAdapter: { kind: "test", async send() { return { delivery: "failed", externalCall: true, failureCategory: "synthetic_failure" }; } } });
  const before = await repository.read();
  assert.equal((await service.recoverManagementLink("runner-1@example.com", beforeCutoff)).ok, true, "the public response remains non-enumerating");
  assert.deepEqual(await repository.read(), before);
  assert.equal((await service.managementEntry(created.managementToken, beforeCutoff)).ok, true);
});

test("unpaid and payment-reserved entries cannot be transferred", async () => {
  for (const { paymentStatus, placeStatus } of [
    { paymentStatus: "created", placeStatus: "payment_reserved" },
    { paymentStatus: "checkout_pending", placeStatus: "payment_reserved" },
    { paymentStatus: "expired", placeStatus: "none" }
  ]) {
    const { state, created } = paidEntry();
    state.payments[0].status = paymentStatus;
    state.registrations[0].placeStatus = placeStatus;
    const { service, repository } = serviceFor(state);
    const before = await repository.read();
    const result = await service.transfer(created.managementToken, { runner: runner(2) }, beforeCutoff);
    assert.equal(result.code, "TRANSFER_PAYMENT_REQUIRED", `${paymentStatus}/${placeStatus}`);
    assert.deepEqual(await repository.read(), before);
  }
});

test("a rejected refund request may be followed by another refund request", async () => {
  const { state, created } = paidEntry();
  const { service, repository } = serviceFor(state);
  const first = await service.requestRefund(created.managementToken, beforeCutoff);
  assert.equal(first.ok, true);
  assert.equal((await service.decideRefund({ authenticated: true, role: "organiser", actorType: "organiser", id: "organiser_test" }, first.request.id, "rejected", beforeCutoff)).ok, true);
  const second = await service.requestRefund(created.managementToken, beforeCutoff);
  assert.equal(second.ok, true);
  assert.notEqual(second.request.id, first.request.id);
  const stored = await repository.read();
  assert.deepEqual(stored.refundRequests.map((item) => item.status), ["rejected", "requested"]);
});

test("runner transfer preserves the paid place, rotates access, resets declaration and keeps capacity consistent", async () => {
  const { state, created } = paidEntry();
  const originalRunnerId = created.registration.runnerId;
  const originalPaymentId = state.payments[0].id;
  const originalCapacity = capacitySummary(state);
  const { service, repository, sent } = serviceFor(state);

  const transferred = await service.transfer(created.managementToken, { runner: runner(2) }, beforeCutoff);
  assert.equal(transferred.ok, true);
  assert.equal(transferred.registration.runner.firstName, "Runner 2");
  assert.equal(transferred.registration.declaration.status, "pending");
  assert.equal((await service.managementEntry(created.managementToken, beforeCutoff)).code, "MANAGEMENT_TOKEN_EXPIRED");

  const newRunnerMessage = sent.find((message) => message.template === "entry_transferred");
  const previousRunnerMessage = sent.find((message) => message.template === "entry_transferred_previous_runner");
  assert.ok(newRunnerMessage); assert.ok(previousRunnerMessage);
  const managementToken = new URL(newRunnerMessage.data.managementUrl).hash.slice(1).split("token=")[1];
  const declarationToken = new URLSearchParams(new URL(newRunnerMessage.data.secureUrl).hash.slice(1)).get("token");
  assert.equal((await service.managementEntry(managementToken, beforeCutoff)).registration.runner.email, "runner-2@example.com");

  const after = await repository.read();
  const registration = after.registrations[0];
  assert.notEqual(registration.runnerId, originalRunnerId);
  assert.equal(registration.placeStatus, "confirmed");
  assert.equal(after.payments[0].id, originalPaymentId);
  assert.equal(after.payments[0].status, "paid");
  assert.deepEqual(capacitySummary(after), originalCapacity);
  assert.ok(after.auditEvents.some((event) => event.action === "entry_transferred" && event.before.runnerId === originalRunnerId && event.after.runnerId === registration.runnerId));

  const signed = await service.orders.completeDeclaration(declarationToken, { accepted: true, typedFullName: "Runner 2 Example", completedByNamedRunner: true }, beforeCutoff);
  assert.equal(signed.ok, true);
  const final = await repository.read();
  assert.equal(final.registrations[0].declarationStatus, "complete");
  assert.equal(final.registrations[0].placeStatus, "confirmed");
  assert.equal(final.payments[0].status, "paid");
});

test("transfer validation and replacement-link delivery failures do not partially change entry ownership or payment", async () => {
  const invalid = paidEntry();
  const invalidService = serviceFor(invalid.state);
  const beforeInvalid = await invalidService.repository.read();
  const rejected = await invalidService.service.transfer(invalid.created.managementToken, { runner: runner(2, { email: "not-an-email" }) }, beforeCutoff);
  assert.equal(rejected.code, "VALIDATION_ERROR");
  assert.deepEqual(await invalidService.repository.read(), beforeInvalid);

  const failing = paidEntry();
  const failureService = serviceFor(failing.state, { emailAdapter: { kind: "test", async send() { return { delivery: "failed", externalCall: true, failureCategory: "synthetic_failure" }; } } });
  const beforeFailure = await failureService.repository.read();
  const failed = await failureService.service.transfer(failing.created.managementToken, { runner: runner(3) }, beforeCutoff);
  assert.equal(failed.code, "TRANSFER_DELIVERY_FAILED");
  assert.deepEqual(await failureService.repository.read(), beforeFailure);

  const throwing = paidEntry();
  const throwingService = serviceFor(throwing.state, { emailAdapter: { kind: "test", async send() { throw new Error("synthetic delivery exception"); } } });
  const beforeThrow = await throwingService.repository.read();
  await assert.rejects(() => throwingService.service.transfer(throwing.created.managementToken, { runner: runner(4) }, beforeCutoff), /synthetic delivery exception/);
  assert.deepEqual(await throwingService.repository.read(), beforeThrow);
});

test("failure to notify the previous runner does not revoke the replacement runner's delivered access", async () => {
  const { state, created } = paidEntry(); let sends = 0; const delivered = [];
  const { service, repository } = serviceFor(state, { emailAdapter: { kind: "test", async send(message) { sends += 1; if (sends === 2) throw new Error("synthetic previous-runner delivery exception"); delivered.push(message); return { delivery: "sent", externalCall: false }; } } });
  const transferred = await service.transfer(created.managementToken, { runner: runner(5) }, beforeCutoff);
  assert.equal(transferred.ok, true);
  const managementToken = new URL(delivered[0].data.managementUrl).hash.slice(1).split("token=")[1];
  assert.equal((await service.managementEntry(managementToken, beforeCutoff)).registration.runner.email, "runner-5@example.com");
  const final = await repository.read();
  assert.equal(final.communications.find((item) => item.template === "entry_transferred_previous_runner").delivery, "failed");
});

test("management access distinguishes unknown, superseded and unavailable entry links", async () => {
  const { state, created } = paidEntry();
  const { service, repository, sent } = serviceFor(state);
  assert.equal((await service.managementEntry("unknown-token", beforeCutoff)).code, "MANAGEMENT_TOKEN_INVALID");
  await service.recoverManagementLink("runner-1@example.com", beforeCutoff);
  assert.equal((await service.managementEntry(created.managementToken, beforeCutoff)).code, "MANAGEMENT_TOKEN_EXPIRED");
  const replacement = new URL(sent.at(-1).data.secureUrl).hash.slice(1).split("token=")[1];
  await repository.transaction((working) => { working.registrations[0].deletedAt = beforeCutoff.toISOString(); return { ok: true }; });
  assert.equal((await service.managementEntry(replacement, beforeCutoff)).code, "MANAGEMENT_ENTRY_UNAVAILABLE");
});

test("management API returns distinct HTTP responses for invalid and superseded credentials", async () => {
  const { state, created } = paidEntry();
  const { service } = serviceFor(state);
  const api = createApi({ service: {}, phase3Integrations: service, environment: "development" });
  const invalid = await api({ method: "GET", pathname: "/api/v3/management/entry", hostname: "development.example", headers: { "x-management-token": "unknown-token" } });
  assert.equal(invalid.status, 401); assert.equal(invalid.body.code, "MANAGEMENT_TOKEN_INVALID");
  await service.recoverManagementLink("runner-1@example.com", beforeCutoff);
  const expired = await api({ method: "GET", pathname: "/api/v3/management/entry", hostname: "development.example", headers: { "x-management-token": created.managementToken } });
  assert.equal(expired.status, 410); assert.equal(expired.body.code, "MANAGEMENT_TOKEN_EXPIRED");
});

test("confirmation and transfer emails explain self-service transfer and keep management links distinct", () => {
  const data = {
    runnerName: "Runner Example",
    raceDate: "2026-11-28",
    transferDeadline: "2026-11-27T23:59:00.000Z",
    managementExpiresAt: "2026-10-30T12:00:00.000Z",
    managementUrl: "https://development.example/registration/manage.html#token=management-token",
    managementRecoveryUrl: "https://development.example/registration/manage.html",
    secureUrl: "https://development.example/registration/declaration.html#token=declaration-token"
  };
  const confirmation = renderRegistrationEmail("entry_confirmed", data);
  assert.match(confirmation.text, /transfer the paid place/i);
  assert.match(confirmation.text, /Transfer deadline:/);
  assert.match(confirmation.text, /This management link expires:/);
  assert.match(confirmation.text, /Expired link\? Request a replacement:/);
  const transfer = renderRegistrationEmail("entry_transferred", data);
  assert.match(transfer.html, /href="https:\/\/development\.example\/registration\/declaration\.html#token=declaration-token">Sign your race declaration/);
  assert.match(transfer.html, /href="https:\/\/development\.example\/registration\/manage\.html#token=management-token">Manage your entry/);
  assert.doesNotMatch(transfer.html, /declaration-token">Manage your entry/);
});
