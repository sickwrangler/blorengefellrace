import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { createProductionBootstrap } from "../registration/server/production-bootstrap.mjs";
import { capacitySummary } from "../registration/server/phase3-domain.mjs";
import { createProductionApi } from "../registration/server/production-api.mjs";
import { ProductionRegistrationService } from "../registration/server/production-service.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";

const firstRunner = {
  email: "replacement@example.com", firstName: "Replacement", lastName: "Runner",
  dateOfBirth: "1990-01-01", raceCategory: "Female", phone: "07700 900231",
  addressLine1: "1 Example Road", city: "Abergavenny", postcode: "NP7 5AA",
  emergencyContactName: "Example Contact", emergencyContactPhone: "07700 900233"
};
const restoreInput = {
  restoreReference: "BFR-ORIGINAL", expectedEmail: firstRunner.email,
  reason: "Refund after transfer", confirmFeeWaiver: true
};
const directEntries = "/api/v4/organiser/direct-entries";

function setup({ existingStartList = 0, signed = false } = {}) {
  const state = createProductionBootstrap();
  const [runnerId, registrationId] = ["runner_replacement", "registration_released"];
  state.runners.push({ ...firstRunner, id: runnerId });
  state.registrations.push({
    id: registrationId, runnerId, testReference: restoreInput.restoreReference,
    entryStatus: "place_released", placeStatus: "none", declarationStatus: signed ? "complete" : "pending"
  });
  state.payments.push({
    id: "payment_refunded", orderId: "order_group", registrationIds: [registrationId],
    status: "paid", refundedRegistrationIds: [registrationId], refundedAmountPence: 600
  });
  state.refundRequests.push({ id: "refund_original", registrationId, status: "refunded" });
  state.waitingList.push({ id: "waiting_old", email: firstRunner.email, status: "expired", sequence: 1 });
  if (signed) state.declarations.push({
    id: "declaration_current", runnerId, registrationId, accepted: true, completionMethod: "digital_remote",
    declarationIdentifier: state.event.declarationIdentifier, declarationVersion: state.event.declarationVersion
  });
  for (let index = 0; index < existingStartList; index += 1) {
    state.registrations.push({
      id: `existing_${index}`, entryStatus: "active", placeStatus: "confirmed"
    });
  }
  const repository = createMemoryRepository(state);
  const sent = [];
  const emailAdapter = { async send(message) { sent.push(message); return { delivery: "sent", externalCall: false }; } };
  const service = new ProductionRegistrationService({ repository, emailAdapter });
  const phase3Integrations = new Phase3IntegrationService({ repository, emailAdapter, publicBaseUrl: "https://example.com" });
  const api = createProductionApi({ service, phase3Integrations, repository });
  const principal = (userRoles) => ({ "x-ms-client-principal": Buffer.from(JSON.stringify({
    userRoles, userId: "test-organiser"
  })).toString("base64") });
  const call = (method, pathname, body, headers = principal(["authenticated", "organiser"])) =>
    api({ method, pathname, body, headers });
  return { state, repository, call, principal, sent, phase3Integrations };
}

test("restoring a refunded transfer creates one quiet confirmed place and retains the refund and signature", async () => {
  const { state, repository, call, sent, phase3Integrations } = setup({ signed: true });
  const response = await call("POST", directEntries, restoreInput);
  assert.equal(response.status, 201);
  assert.equal(response.body.paymentStatus, "fee_waived");
  assert.equal(response.body.declarationStatus, "complete");
  assert.notEqual(response.body.reference, restoreInput.restoreReference);
  const retry = await call("POST", directEntries, restoreInput);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.reference, response.body.reference);

  const after = await repository.read();
  assert.deepEqual(after.payments, state.payments);
  assert.deepEqual(after.refundRequests, state.refundRequests);
  assert.deepEqual(after.registrations[0], state.registrations[0]);
  assert.deepEqual(after.waitingList, state.waitingList);
  assert.equal(after.declarations[1].restoredFromDeclarationId, state.declarations[0].id);
  assert.equal(after.auditEvents.filter((event) => event.action === "entry_fee_waived").length, 1);
  assert.equal(capacitySummary(after).confirmed, 1);
  const startList = await call("GET", "/api/v4/start-list");
  assert.deepEqual(startList.body.entries.map((item) => item.runnerName), ["Replacement Runner"]);
  const snapshot = await call("GET", "/api/v2/organiser/snapshot");
  assert.equal(snapshot.body.state.registrations[1].clearedToStart, true);
  await phase3Integrations.orders.runScheduledWork(new Date("2026-11-26T12:00:00Z"));
  assert.deepEqual(sent, []);
});

test("authorised direct admission and withdrawal check identity and capacity at write time", async () => {
  const { repository, call, principal, sent } = setup({ existingStartList: 119 });
  const add = { runner: firstRunner, reason: "Organiser decision", confirmFeeWaiver: true };
  assert.equal((await call("POST", directEntries, add, principal(["authenticated"]))).status, 403);
  assert.equal((await call("POST", directEntries, { ...add, confirmFeeWaiver: false })).body.code, "FEE_WAIVER_CONFIRMATION_REQUIRED");
  assert.equal((await call("POST", directEntries, { ...restoreInput, expectedEmail: "different@example.com" })).body.code, "RESTORE_ENTRY_MISMATCH");

  const results = await Promise.all([
    call("POST", directEntries, add),
    call("POST", directEntries, { ...add, runner: { ...firstRunner, email: "other@example.com" } })
  ]);
  assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]);
  assert.equal(results.find((item) => item.status === 409).body.code, "CAPACITY_FULL");
  assert.deepEqual(sent, []);
  const state = await repository.read();
  const registration = state.registrations.at(-1);
  const email = state.runners.find((runner) => runner.id === registration.runnerId).email;
  const withdraw = `/api/v3/organiser/registrations/${registration.id}/withdraw`;
  const incorrect = await call("POST", withdraw, { expectedEmail: "different@example.com", reason: "Test" });
  assert.equal(incorrect.body.code, "WITHDRAWAL_ENTRY_MISMATCH");
  const withdrawn = await call("POST", withdraw, { expectedEmail: email, reason: "Test" });
  assert.equal(withdrawn.body.registration.entryStatus, "withdrawn");
  const after = await repository.read();
  assert.deepEqual(after.payments, state.payments);
  assert.equal(capacitySummary(after).remaining, 1);
  assert.equal(sent.length, 1);
});

test("editing a confirmed place validates the entire change and rejects stale details", async () => {
  const { repository, call } = setup();
  assert.equal((await call("POST", directEntries, restoreInput)).status, 201);
  const state = await repository.read();
  const registration = state.registrations.at(-1);
  const runner = state.runners.find((item) => item.id === registration.runnerId);
  const correct = `/api/v2/organiser/registrations/${registration.id}/correct`;
  const expected = { runnerId: runner.id, phone: runner.phone, club: runner.club };
  assert.equal((await call("POST", correct, { expected, club: "New club", phone: " " })).body.code, "INVALID_CORRECTION");
  assert.equal((await repository.read()).runners.at(-1).club, runner.club);
  assert.equal((await call("POST", correct, { expected, club: "New club", phone: runner.phone })).body.ok, true);
  assert.equal((await call("POST", correct, { expected, club: "Stale club" })).body.code, "ENTRY_CHANGED");
  assert.equal((await repository.read()).runners.at(-1).club, "New club");
});
