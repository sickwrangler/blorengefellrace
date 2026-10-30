import assert from "node:assert/strict";
import test from "node:test";

import { beginProductionRegistration, capacitySummary, createPhase3State, assignPhase3RaceNumber } from "../registration/server/phase3-domain.mjs";
import { renderRegistrationEmail } from "../registration/server/email-templates.mjs";
import { buildPrivateWorkbookModel } from "../registration/server/private-export.mjs";
import { ProductionRegistrationService } from "../registration/server/production-service.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";

const beforeRefundCutoff = new Date("2026-10-28T22:00:00.000Z");
const afterRefundCutoff = new Date("2026-10-29T12:00:00.000Z");
const organiser = { authenticated: true, role: "organiser", actorType: "organiser", id: "synthetic-organiser" };

const runner = (number = 1) => ({
  email: `withdrawal-${number}@example.com`, firstName: `Withdrawal ${number}`, lastName: "Runner",
  phone: "07700 900123", addressLine1: "1 Example Street", addressLine2: "", city: "Abergavenny", postcode: "NP7 5AA",
  raceCategory: "Female", dateOfBirth: "1990-06-15", club: "Example Harriers", wfraMember: false, wfraMembershipNumber: "",
  emergencyContactName: "Synthetic Contact", emergencyContactPhone: "07700 900456"
});
const declaration = (number = 1) => ({ declarationIdentifier: "WFRA_SENIOR_ENTRY", declarationVersion: "21/02/23", accepted: true, typedFullName: `Withdrawal ${number} Runner`, signatoryRole: "Competitor" });

function setup({ at = beforeRefundCutoff, emailAdapter = null, organiserEmail = "organiser@example.com" } = {}) {
  const state = createPhase3State({ environment: "development", registrationState: "OPEN" });
  Object.assign(state, { consents: [], communications: [], emergencyContacts: [], declarationTokens: [], orders: [], orderTokens: [], declarationRecoveryAttempts: [], processedPaymentEvents: [], emailOutbox: [] });
  const created = beginProductionRegistration(state, { runner: runner(), declaration: declaration() }, { at });
  created.registration.testReference = "TEST-WITHDRAWAL";
  created.registration.placeStatus = "confirmed";
  created.registration.raceNumber = 81;
  state.payments[0].status = "paid";
  state.payments[0].expectedAmountPence = 600;
  state.payments[0].actualPaidAmountPence = 600;
  state.payments[0].currency = "gbp";
  state.emergencyContacts.push({ id: "emergency-withdrawal", registrationId: created.registration.id, name: "Synthetic Contact", phone: "07700 900456" });
  const sent = [];
  const adapter = emailAdapter ?? { kind: "test", async send(message) { sent.push(message); return { delivery: "sent", externalCall: false }; } };
  const repository = createMemoryRepository(state);
  const service = new Phase3IntegrationService({ repository, stripeGateway: { mode: "test" }, emailAdapter: adapter, publicBaseUrl: "https://development.example", organiserEmail });
  return { state, created, repository, service, sent };
}

test("a paid confirmed runner withdraws once, releases one place and retains historical payment and race number", async () => {
  const { created, repository, service, sent } = setup();
  const before = capacitySummary(await repository.read());
  const result = await service.withdraw(created.managementToken, beforeRefundCutoff);
  assert.equal(result.ok, true);
  assert.equal(result.registration.entryStatus, "withdrawn");
  assert.equal(result.registration.placeStatus, "none");
  assert.equal(result.registration.raceNumber, 81);
  assert.equal(result.registration.actions.requestRefund.available, true);
  assert.equal(result.registration.actions.transfer.available, false);
  assert.equal(result.registration.actions.amend.available, false);
  assert.equal(result.registration.actions.signDeclaration.available, false);

  const state = await repository.read();
  const registration = state.registrations[0];
  assert.equal(capacitySummary(state).confirmed, before.confirmed - 1);
  assert.equal(capacitySummary(state).remaining, before.remaining + 1);
  assert.equal(state.payments[0].status, "paid");
  assert.equal(registration.raceNumber, 81);
  assert.equal(state.auditEvents.filter((item) => item.action === "entry_withdrawn").length, 1);
  assert.deepEqual(sent.map((item) => item.template).sort(), ["organiser_runner_withdrawn", "runner_withdrawn"]);
  assert.equal(sent.find((item) => item.template === "organiser_runner_withdrawn").intendedRecipientAddress, "organiser@example.com");
  assert.equal(sent.every((item) => !JSON.stringify(item).includes(created.managementToken)), true);

  const runnerEmail = renderRegistrationEmail("runner_withdrawn", sent.find((item) => item.template === "runner_withdrawn").data);
  const organiserEmail = renderRegistrationEmail("organiser_runner_withdrawn", sent.find((item) => item.template === "organiser_runner_withdrawn").data);
  assert.match(runnerEmail.text, /No automatic refund has been issued/);
  assert.equal(organiserEmail.subject, "Blorenge Fell Race — Runner withdrawn, place available");
  assert.match(organiserEmail.text, /Confirmed entries: 0/);
  assert.match(organiserEmail.text, /Available capacity: 120/);
});

test("duplicate and concurrent withdrawal requests are idempotent and do not duplicate email", async () => {
  const { created, repository, service, sent } = setup();
  const results = await Promise.all([
    service.withdraw(created.managementToken, beforeRefundCutoff),
    service.withdraw(created.managementToken, beforeRefundCutoff)
  ]);
  assert.equal(results.every((item) => item.ok), true);
  const state = await repository.read();
  assert.equal(capacitySummary(state).remaining, 120);
  assert.equal(state.auditEvents.filter((item) => item.action === "entry_withdrawn").length, 1);
  assert.equal(state.emailOutbox.length, 2);
  assert.equal(sent.length, 2);
});

test("invalid, expired and revoked management tokens cannot withdraw an entry", async () => {
  const invalid = setup();
  assert.equal((await invalid.service.withdraw("not-a-token", beforeRefundCutoff)).code, "MANAGEMENT_TOKEN_INVALID");

  const expired = setup({ at: new Date("2026-10-27T12:00:00.000Z") });
  assert.equal((await expired.service.withdraw(expired.created.managementToken, new Date("2026-10-28T12:00:00.000Z"))).code, "MANAGEMENT_TOKEN_EXPIRED");

  const revoked = setup();
  await revoked.repository.transaction((state) => { state.managementTokens[0].invalidatedAt = beforeRefundCutoff.toISOString(); return { ok: true }; });
  assert.equal((await revoked.service.withdraw(revoked.created.managementToken, beforeRefundCutoff)).code, "MANAGEMENT_TOKEN_EXPIRED");
  assert.equal(capacitySummary(await revoked.repository.read()).confirmed, 1);
});

test("withdrawal preserves refund policy before and after the configured deadline", async () => {
  const eligible = setup();
  const withdrawn = await eligible.service.withdraw(eligible.created.managementToken, beforeRefundCutoff);
  assert.equal(withdrawn.registration.actions.requestRefund.available, true);
  assert.equal((await eligible.service.requestRefund(eligible.created.managementToken, beforeRefundCutoff)).ok, true);

  const late = setup({ at: afterRefundCutoff });
  const lateWithdrawal = await late.service.withdraw(late.created.managementToken, afterRefundCutoff);
  assert.equal(lateWithdrawal.ok, true);
  assert.equal(lateWithdrawal.registration.actions.requestRefund.code, "REFUND_CUTOFF_PASSED");
  assert.equal((await late.service.requestRefund(late.created.managementToken, afterRefundCutoff)).code, "REFUND_CUTOFF_PASSED");
});

test("withdrawal succeeds with an existing refund request and retains it for organiser review", async () => {
  const current = setup();
  const requested = await current.service.requestRefund(current.created.managementToken, beforeRefundCutoff);
  assert.equal(requested.ok, true);
  const withdrawn = await current.service.withdraw(current.created.managementToken, beforeRefundCutoff);
  assert.equal(withdrawn.ok, true);
  assert.equal(withdrawn.registration.payment.state, "refund_requested");
  assert.equal(withdrawn.registration.actions.requestRefund.code, "REFUND_ALREADY_IN_PROGRESS");
  assert.equal((await current.repository.read()).refundRequests.length, 1);
});

test("unpaid, reserved and processing entries cannot be withdrawn", async () => {
  for (const { paymentStatus, placeStatus } of [
    { paymentStatus: "not_configured", placeStatus: "payment_reserved" },
    { paymentStatus: "checkout_pending", placeStatus: "payment_reserved" },
    { paymentStatus: "processing", placeStatus: "payment_reserved" },
    { paymentStatus: "expired", placeStatus: "none" }
  ]) {
    const current = setup();
    await current.repository.transaction((state) => { state.payments[0].status = paymentStatus; state.registrations[0].placeStatus = placeStatus; return { ok: true }; });
    const before = await current.repository.read();
    assert.equal((await current.service.withdraw(current.created.managementToken, beforeRefundCutoff)).code, "WITHDRAWAL_CONFIRMED_ENTRY_REQUIRED");
    assert.deepEqual(await current.repository.read(), before);
  }
});

test("withdrawing one runner from a group releases only that runner and preserves shared payment", async () => {
  const current = setup();
  await current.repository.transaction((state) => {
    const secondRunner = { ...runner(2), id: "runner-group-2" };
    const secondRegistration = { ...state.registrations[0], id: "registration-group-2", runnerId: secondRunner.id, testReference: "TEST-GROUP-2", raceNumber: 82 };
    state.runners.push(secondRunner); state.registrations.push(secondRegistration);
    Object.assign(state.payments[0], { registrationId: null, registrationIds: [state.registrations[0].id, secondRegistration.id], orderId: "order-group", expectedAmountPence: 1200, actualPaidAmountPence: 1200 });
    state.orders.push({ id: "order-group", registrationIds: state.payments[0].registrationIds, status: "paid" });
    return { ok: true };
  });
  const before = capacitySummary(await current.repository.read());
  assert.equal(before.confirmed, 2);
  assert.equal((await current.service.withdraw(current.created.managementToken, beforeRefundCutoff)).ok, true);
  const state = await current.repository.read();
  assert.equal(state.registrations[0].entryStatus, "withdrawn");
  assert.equal(state.registrations[1].entryStatus, "active");
  assert.equal(state.registrations[1].placeStatus, "confirmed");
  assert.equal(state.payments[0].status, "paid");
  assert.equal(state.orders[0].status, "paid");
  assert.equal(capacitySummary(state).confirmed, 1);
});

test("withdrawal preserves waiting-list order and outstanding offers without automatic promotion", async () => {
  const current = setup();
  await current.repository.transaction((state) => {
    state.event.capacity = 2;
    state.waitingList.push(
      { id: "waiting-offered", firstName: "Offered", lastName: "Runner", email: "offered@example.com", sequence: 1, status: "offered", joinedAt: beforeRefundCutoff.toISOString() },
      { id: "waiting-next", firstName: "Next", lastName: "Runner", email: "next@example.com", sequence: 2, status: "waiting", joinedAt: beforeRefundCutoff.toISOString() }
    );
    state.waitingListOffers.push({ id: "offer-active", waitingListId: "waiting-offered", invitationId: "invite-active", status: "offered", createdAt: beforeRefundCutoff.toISOString(), reminderAt: "2026-10-29T10:00:00.000Z", expiresAt: "2026-10-30T10:00:00.000Z" });
    return { ok: true };
  });
  assert.deepEqual(capacitySummary(await current.repository.read()), { capacity: 2, confirmed: 1, paymentReserved: 0, offerReserved: 1, reserved: 2, remaining: 0, waiting: 1 });
  await current.service.withdraw(current.created.managementToken, beforeRefundCutoff);
  const state = await current.repository.read();
  assert.equal(state.waitingListOffers.length, 1);
  assert.equal(state.waitingListOffers[0].status, "offered");
  assert.deepEqual(state.waitingList.map((item) => item.status), ["offered", "waiting"]);
  assert.equal(capacitySummary(state).remaining, 1);
});

test("email failure leaves withdrawal committed with durable retryable failure records", async () => {
  const current = setup({ emailAdapter: { kind: "acs-test", async send() { return { delivery: "failed", externalCall: true, failureCategory: "throttled", retryAfterMs: 60_000 }; } } });
  const result = await current.service.withdraw(current.created.managementToken, beforeRefundCutoff);
  assert.equal(result.ok, true);
  assert.equal(result.notificationDeliveryFailed, true);
  const state = await current.repository.read();
  assert.equal(state.registrations[0].entryStatus, "withdrawn");
  assert.equal(state.emailOutbox.length, 2);
  assert.equal(state.emailOutbox.every((item) => item.status === "failed" && item.retryAfterAt), true);
  assert.equal(state.communications.every((item) => item.delivery === "failed"), true);
});

test("editing and transfer are rejected after withdrawal while read-only access remains", async () => {
  const current = setup();
  await current.service.withdraw(current.created.managementToken, beforeRefundCutoff);
  assert.equal((await current.service.managementEntry(current.created.managementToken, beforeRefundCutoff)).registration.entryStatus, "withdrawn");
  assert.equal((await current.service.amend(current.created.managementToken, { phone: "07700 999999" }, beforeRefundCutoff)).code, "ENTRY_INACTIVE");
  assert.equal((await current.service.transfer(current.created.managementToken, { runner: runner(2) }, beforeRefundCutoff)).code, "ENTRY_INACTIVE");
});

test("withdrawn race numbers remain historical, cannot be reassigned, and exports mark the runner not cleared to start", async () => {
  const current = setup();
  await current.service.withdraw(current.created.managementToken, beforeRefundCutoff);
  await current.repository.transaction((state) => {
    const created = beginProductionRegistration(state, { runner: runner(2), declaration: declaration(2) }, { at: beforeRefundCutoff });
    assert.equal(created.ok, true); created.registration.testReference = "TEST-SECOND"; return { ok: true, registrationId: created.registration.id };
  });
  const assignment = await current.repository.transaction((state) => assignPhase3RaceNumber(state, state.registrations[1].id, 81, organiser, beforeRefundCutoff));
  assert.equal(assignment.code, "DUPLICATE_RACE_NUMBER");

  const state = await current.repository.read();
  const workbook = buildPrivateWorkbookModel(state, beforeRefundCutoff);
  const row = workbook.currentEntries.find((item) => item.entryReference === "TEST-WITHDRAWAL");
  assert.equal(row.entryStatus, "withdrawn");
  assert.equal(row.raceNumber, 81);
  assert.equal(row.clearedToStart, "No");

  const productionService = new ProductionRegistrationService({ repository: current.repository, emailAdapter: { async send() { return { delivery: "sent" }; } } });
  const csv = await productionService.exportPublic(organiser);
  assert.equal(csv.ok, true);
  assert.match(csv.csv, /"TEST-WITHDRAWAL","81"/);
  assert.match(csv.csv, /"withdrawn","successful"/);
});
