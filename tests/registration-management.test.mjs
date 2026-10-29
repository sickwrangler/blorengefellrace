import assert from "node:assert/strict";
import test from "node:test";

import { beginProductionRegistration, capacitySummary, createPhase3State } from "../registration/server/phase3-domain.mjs";
import { createApi } from "../registration/server/api.mjs";
import { Phase3IntegrationService, managementActionEligibility } from "../registration/server/phase3-service.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";

const beforeCutoff = new Date("2026-10-28T22:00:00.000Z");
const afterCutoff = new Date("2026-10-29T12:00:00.000Z");
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

  actions = managementActionEligibility(state, created.registration, { at: afterCutoff, paymentsAvailable: true });
  assert.equal(actions.amend.available, true, "safe contact/race-detail amendments remain available after the cutoff");
  assert.equal(actions.transfer.code, "TRANSFER_CUTOFF_PASSED");
  assert.equal(actions.requestRefund.code, "REFUND_CUTOFF_PASSED");
  assert.equal(actions.transfer.deadline, "2026-10-28T23:59:00.000Z");

  state.registrations[0].declarationStatus = "pending"; state.declarations = [];
  actions = managementActionEligibility(state, created.registration, { at: beforeCutoff, paymentsAvailable: true });
  assert.equal(actions.signDeclaration.available, true);

  state.payments[0].status = "expired"; state.registrations[0].placeStatus = "none";
  actions = managementActionEligibility(state, created.registration, { at: beforeCutoff, paymentsAvailable: true });
  assert.equal(actions.continuePayment.available, true);
  assert.equal(actions.signDeclaration.code, "DECLARATION_AFTER_PAYMENT");
  assert.equal(actions.requestRefund.code, "REFUND_NOT_READY");

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

test("post-cutoff runner may amend safe details but may not transfer or request a refund", async () => {
  const { state, created } = paidEntry();
  const { service } = serviceFor(state);
  const amended = await service.amend(created.managementToken, { phone: "07700 900999", club: "Updated Club" }, afterCutoff);
  assert.equal(amended.ok, true);
  assert.equal(amended.registration.runner.phone, "07700 900999");
  assert.equal(amended.registration.actions.amend.available, true);
  assert.equal((await service.transfer(created.managementToken, { runner: runner(2) }, afterCutoff)).code, "TRANSFER_CUTOFF_PASSED");
  assert.equal((await service.requestRefund(created.managementToken, afterCutoff)).code, "REFUND_CUTOFF_PASSED");
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
