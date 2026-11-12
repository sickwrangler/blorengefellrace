import assert from "node:assert/strict";
import test from "node:test";

import {
  beginProductionRegistration,
  capacitySummary,
  createNextWaitingListOffer,
  createPhase3State,
  createWaitingListOffer,
  joinWaitingList,
  withdrawWaitingListEntry
} from "../registration/server/phase3-domain.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";
import { buildWaitingListView } from "../registration/server/private-export.mjs";
import { createProductionApi } from "../registration/server/production-api.mjs";

const at = new Date("2026-11-12T12:00:00.000Z");
const organiser = { authenticated: true, role: "organiser", actorType: "organiser", id: "synthetic-organiser" };
const waitingRunner = (number) => ({ firstName: `Waiting ${number}`, lastName: "Runner", email: `waiting-${number}@example.com` });
const runner = {
  email: "entered-runner@example.com", firstName: "Entered", lastName: "Runner", phone: "07700 900123",
  addressLine1: "1 Example Street", addressLine2: "", city: "Abergavenny", postcode: "NP7 5AA",
  raceCategory: "Female", dateOfBirth: "1990-06-15", club: "Example Harriers", wfraMember: false,
  wfraMembershipNumber: "", emergencyContactName: "Synthetic Contact", emergencyContactPhone: "07700 900456"
};
const declaration = { declarationIdentifier: "WFRA_SENIOR_ENTRY", declarationVersion: "21/02/23", accepted: true, typedFullName: "Entered Runner", signatoryRole: "Competitor" };

function baseState({ capacity = 1 } = {}) {
  const state = createPhase3State({ environment: "development", registrationState: "OPEN" });
  state.event.capacity = capacity;
  Object.assign(state, { communications: [], consents: [], emergencyContacts: [], orders: [], orderTokens: [], declarationTokens: [], declarationRecoveryAttempts: [], processedPaymentEvents: [], emailOutbox: [] });
  return state;
}

function serviceFor(state) {
  const sent = [];
  const repository = createMemoryRepository(state);
  const emailAdapter = { kind: "test", async send(message) { sent.push(message); return { delivery: "sent", externalCall: false }; } };
  const service = new Phase3IntegrationService({ repository, stripeGateway: { mode: "test" }, emailAdapter, publicBaseUrl: "https://development.example", organiserEmail: "organiser@example.com" });
  return { repository, service, sent };
}

const principal = Buffer.from(JSON.stringify({ identityProvider: "aad", userId: "synthetic-organiser", userDetails: "organiser@example.com", userRoles: ["authenticated", "organiser"] })).toString("base64");

test("specific waiting-list selection preserves queue order and reserves exactly one place", async () => {
  const state = baseState();
  const first = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  const second = joinWaitingList(state, waitingRunner(2), { at }).waitingListEntry;
  const { repository, service, sent } = serviceFor(state);

  const offered = await service.offerWaitingPlace(organiser, second.id, { reason: "Runner contacted organiser" }, at);
  assert.equal(offered.ok, true);
  const final = await repository.read();
  assert.equal(final.waitingList.find((item) => item.id === first.id).status, "waiting");
  assert.equal(final.waitingList.find((item) => item.id === second.id).status, "offered");
  assert.deepEqual(capacitySummary(final), { capacity: 1, confirmed: 0, paymentReserved: 0, offerReserved: 1, reserved: 1, remaining: 0, waiting: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].intendedRecipientAddress, second.email);
  const audit = final.auditEvents.find((item) => item.action === "waiting_list_offer_created");
  assert.equal(audit.after.selection, "specific");
  assert.equal(audit.after.reason, "Runner contacted organiser");
  assert.equal((await service.offerWaitingPlace(organiser, second.id, {}, at)).code, "CAPACITY_FULL");
});

test("default offer remains first-in-first-out and repeated requests cannot over-reserve", () => {
  const state = baseState();
  const first = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  joinWaitingList(state, waitingRunner(2), { at });
  const offered = createNextWaitingListOffer(state, organiser, at);
  assert.equal(offered.ok, true);
  assert.equal(offered.offer.waitingListId, first.id);
  assert.equal(createNextWaitingListOffer(state, organiser, at).code, "CAPACITY_FULL");
  assert.equal(state.waitingListOffers.length, 1);
});

test("production API protects targeted offer and waiting-list withdrawal routes", async () => {
  const state = baseState();
  const waiting = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  const { repository, service } = serviceFor(state);
  const api = createProductionApi({ service: {}, phase3Integrations: service, repository });
  const path = `/api/v3/organiser/waiting-list/${encodeURIComponent(waiting.id)}/offer`;
  const anonymous = await api({ method: "POST", pathname: path, hostname: "www.blorengefellrace.cymru", body: {} });
  assert.equal(anonymous.status, 403);
  const offered = await api({ method: "POST", pathname: path, hostname: "www.blorengefellrace.cymru", headers: { "x-ms-client-principal": principal }, body: { reason: "Manual selection" } });
  assert.equal(offered.status, 200);
  const withdrawn = await api({ method: "POST", pathname: `/api/v3/organiser/waiting-list/${encodeURIComponent(waiting.id)}/withdraw`, hostname: "www.blorengefellrace.cymru", headers: { "x-ms-client-principal": principal }, body: { reason: "Requested by email" } });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.activeOfferCancelled, true);
});

test("withdrawing a waiting person is audited, retained and updates active positions", () => {
  const state = baseState();
  const first = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  const second = joinWaitingList(state, waitingRunner(2), { at }).waitingListEntry;
  const result = withdrawWaitingListEntry(state, first.id, organiser, { reason: "Requested by email" }, at);
  assert.equal(result.ok, true);
  assert.equal(result.waitingListEntry.status, "withdrawn");
  assert.equal(state.waitingList.find((item) => item.id === second.id).status, "waiting");
  assert.equal(capacitySummary(state).waiting, 1);
  assert.equal(buildWaitingListView(state).find((item) => item.waitingListId === second.id).currentPosition, 1);
  const audit = state.auditEvents.find((item) => item.action === "waiting_list_withdrawn");
  assert.equal(audit.after.reason, "Requested by email");
  assert.equal(withdrawWaitingListEntry(state, first.id, organiser, {}, at).duplicate, true);
});

test("withdrawing somebody with an active offer revokes access and releases capacity without auto-offering", () => {
  const state = baseState();
  const first = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  const second = joinWaitingList(state, waitingRunner(2), { at }).waitingListEntry;
  const offered = createWaitingListOffer(state, first.id, organiser, {}, at);
  const result = withdrawWaitingListEntry(state, first.id, organiser, { reason: "No longer wishes to race" }, at);
  assert.equal(result.ok, true);
  assert.equal(result.activeOfferCancelled, true);
  assert.equal(state.waitingListOffers[0].status, "cancelled");
  assert.ok(state.privateInvitations.find((item) => item.id === offered.offer.invitationId).revokedAt);
  assert.equal(state.waitingList.find((item) => item.id === first.id).status, "withdrawn");
  assert.equal(state.waitingList.find((item) => item.id === second.id).status, "waiting");
  assert.equal(state.waitingListOffers.length, 1);
  assert.deepEqual(capacitySummary(state), { capacity: 1, confirmed: 0, paymentReserved: 0, offerReserved: 0, reserved: 0, remaining: 1, waiting: 1 });
});

test("accepted, declined and expired waiting-list history cannot be withdrawn or re-offered", () => {
  for (const status of ["accepted", "declined", "expired"]) {
    const state = baseState();
    const item = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
    item.status = status;
    assert.equal(withdrawWaitingListEntry(state, item.id, organiser, {}, at).code, "WAITING_LIST_ENTRY_INACTIVE");
    assert.equal(createWaitingListOffer(state, item.id, organiser, {}, at).code, "WAITING_LIST_ENTRY_NOT_ELIGIBLE");
  }
});

test("organiser withdrawal reuses withdrawal rules, preserves finances and does not create an offer", async () => {
  const state = baseState({ capacity: 1 });
  const created = beginProductionRegistration(state, { runner, declaration }, { at });
  created.registration.testReference = "TEST-ORGANISER-WITHDRAWAL";
  created.registration.placeStatus = "confirmed";
  created.registration.raceNumber = 120;
  state.payments[0].status = "paid";
  state.payments[0].expectedAmountPence = 600;
  state.payments[0].actualPaidAmountPence = 600;
  state.payments[0].currency = "gbp";
  state.emergencyContacts.push({ id: "emergency-1", registrationId: created.registration.id, name: "Synthetic Contact", phone: "07700 900456" });
  joinWaitingList(state, waitingRunner(1), { at });
  const { repository, service, sent } = serviceFor(state);

  const result = await service.organiserWithdraw(organiser, created.registration.id, { reason: "Requested by email" }, at);
  assert.equal(result.ok, true);
  const final = await repository.read();
  assert.equal(final.registrations[0].entryStatus, "withdrawn");
  assert.equal(final.registrations[0].raceNumber, 120);
  assert.equal(final.payments[0].status, "paid");
  assert.equal(final.refundRequests.length, 0);
  assert.equal(final.waitingListOffers.length, 0);
  assert.equal(capacitySummary(final).remaining, 1);
  assert.equal(final.auditEvents.find((item) => item.action === "entry_withdrawn").after.reason, "Requested by email");
  assert.deepEqual(sent.map((item) => item.template).sort(), ["organiser_runner_withdrawn", "runner_withdrawn"]);

  const duplicate = await service.organiserWithdraw(organiser, created.registration.id, { reason: "Repeated request" }, at);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(sent.length, 2);
});
