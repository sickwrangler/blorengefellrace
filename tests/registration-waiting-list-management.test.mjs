import assert from "node:assert/strict";
import test from "node:test";

import {
  beginProductionRegistration,
  acceptWaitingListOffer,
  cancelWaitingListOffer,
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

test("bypassing FIFO requires an audited reason", () => {
  const state = baseState();
  joinWaitingList(state, waitingRunner(1), { at });
  const second = joinWaitingList(state, waitingRunner(2), { at }).waitingListEntry;
  assert.equal(createWaitingListOffer(state, second.id, organiser, {}, at).code, "WAITING_LIST_BYPASS_REASON_REQUIRED");
  assert.equal(state.waitingListOffers.length, 0);
  assert.equal(capacitySummary(state).remaining, 1);
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

test("concurrent targeted offers cannot overbook the final available place", async () => {
  const state = baseState();
  const first = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  const second = joinWaitingList(state, waitingRunner(2), { at }).waitingListEntry;
  const { repository, service } = serviceFor(state);
  const results = await Promise.all([
    service.offerWaitingPlace(organiser, first.id, {}, at),
    service.offerWaitingPlace(organiser, second.id, { reason: "Manual exception" }, at)
  ]);
  assert.equal(results.filter((item) => item.ok).length, 1);
  assert.equal(results.filter((item) => item.code === "CAPACITY_FULL").length, 1);
  const final = await repository.read();
  assert.equal(final.waitingListOffers.filter((item) => item.status === "offered").length, 1);
  assert.equal(capacitySummary(final).reserved, 1);
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
  const retry = await api({ method: "POST", pathname: `/api/v3/organiser/waiting-list/${encodeURIComponent(waiting.id)}/retry-email`, hostname: "www.blorengefellrace.cymru", headers: { "x-ms-client-principal": principal }, body: {} });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  const cancelled = await api({ method: "POST", pathname: `/api/v3/organiser/waiting-list/${encodeURIComponent(waiting.id)}/cancel-offer`, hostname: "www.blorengefellrace.cymru", headers: { "x-ms-client-principal": principal }, body: { reason: "Synthetic cancellation" } });
  assert.equal(cancelled.status, 200);
  const afterCancellation = await repository.read();
  assert.equal(afterCancellation.registrations.length, 0);
  assert.equal(afterCancellation.payments.length, 0);
  assert.equal(afterCancellation.emailOutbox.find((item) => item.waitingListId === waiting.id).status, "sent");
  const withdrawn = await api({ method: "POST", pathname: `/api/v3/organiser/waiting-list/${encodeURIComponent(waiting.id)}/withdraw`, hostname: "www.blorengefellrace.cymru", headers: { "x-ms-client-principal": principal }, body: { reason: "Requested by email" } });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.activeOfferCancelled, false);
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

test("cancelling an active offer releases capacity, restores original eligibility and invalidates its link", () => {
  const state = baseState();
  const first = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  const second = joinWaitingList(state, waitingRunner(2), { at }).waitingListEntry;
  const offered = createWaitingListOffer(state, first.id, organiser, {}, at);
  const cancelled = cancelWaitingListOffer(state, first.id, organiser, { reason: "Offer sent in error" }, at);
  assert.equal(cancelled.ok, true);
  assert.equal(state.waitingListOffers[0].status, "cancelled");
  assert.equal(state.waitingList.find((item) => item.id === first.id).status, "waiting");
  assert.deepEqual(buildWaitingListView(state).filter((item) => item.status === "waiting").map((item) => [item.waitingListId, item.currentPosition]), [[first.id, 1], [second.id, 2]]);
  assert.equal(capacitySummary(state).remaining, 1);
  const acceptance = acceptWaitingListOffer(state, offered.token, { runner: { ...runner, email: first.email }, declaration }, new Date(at.getTime() + 60_000));
  assert.equal(acceptance.ok, false);
  assert.equal(state.registrations.length, 0);
  const audit = state.auditEvents.find((item) => item.action === "waiting_list_offer_cancelled");
  assert.equal(audit.after.returnedToWaiting, true);
  assert.equal(audit.after.reason, "Offer sent in error");
});

test("cancelling an offer supersedes a failed email retry without creating payment state", async () => {
  const state = baseState();
  const waiting = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  const emailAdapter = { kind: "test", async send() { return { delivery: "failed", externalCall: true, failureCategory: "network" }; } };
  const repository = createMemoryRepository(state);
  const service = new Phase3IntegrationService({ repository, stripeGateway: { mode: "test" }, emailAdapter, publicBaseUrl: "https://development.example", organiserEmail: "organiser@example.com" });
  assert.equal((await service.offerWaitingPlace(organiser, waiting.id, {}, at)).emailDeliveryFailed, true);
  assert.equal((await service.cancelWaitingPlaceOffer(organiser, waiting.id, { reason: "Runner contacted organiser" }, new Date(at.getTime() + 60_000))).ok, true);
  assert.equal((await service.retryWaitingPlaceOfferEmail(organiser, waiting.id, new Date(at.getTime() + 120_000))).code, "OFFER_NOT_ACTIVE");
  const final = await repository.read();
  const attempt = final.emailOutbox.find((item) => item.waitingListId === waiting.id);
  assert.equal(attempt.status, "superseded");
  assert.equal(attempt.message, null);
  assert.equal(final.orders.length, 0);
  assert.equal(final.payments.length, 0);
  assert.equal((final.reservations ?? []).length, 0);
});

test("failed offer email can be retried without duplicating the offer, reservation or successful email", async () => {
  const state = baseState();
  const waiting = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  let attempts = 0;
  const emailAdapter = { kind: "test", async send() { attempts += 1; return attempts === 1 ? { delivery: "failed", externalCall: true, failureCategory: "network" } : { delivery: "sent", externalCall: true, providerReference: "synthetic-message" }; } };
  const repository = createMemoryRepository(state);
  const service = new Phase3IntegrationService({ repository, stripeGateway: { mode: "test" }, emailAdapter, publicBaseUrl: "https://development.example", organiserEmail: "organiser@example.com" });
  const offered = await service.offerWaitingPlace(organiser, waiting.id, {}, at);
  assert.equal(offered.ok, true);
  assert.equal(offered.emailDeliveryFailed, true);
  const failedState = await repository.read();
  const failedView = buildWaitingListView(failedState)[0];
  assert.equal(failedView.offerEmailDelivery, "failed");
  assert.equal(failedView.offerEmailRetryAvailable, true);
  assert.equal(failedView.offerExpiresAt, new Date(at.getTime() + 48 * 60 * 60_000).toISOString());
  const retries = await Promise.all([
    service.retryWaitingPlaceOfferEmail(organiser, waiting.id, new Date(at.getTime() + 60_000)),
    service.retryWaitingPlaceOfferEmail(organiser, waiting.id, new Date(at.getTime() + 60_000))
  ]);
  assert.equal(retries.every((item) => item.ok), true);
  const final = await repository.read();
  assert.equal(attempts, 2);
  assert.equal(final.waitingListOffers.length, 1);
  assert.equal(final.waitingListOffers[0].status, "offered");
  assert.equal(capacitySummary(final).offerReserved, 1);
  assert.equal(final.communications.filter((item) => item.idempotencyKey === `waiting-list:${final.waitingListOffers[0].id}:offered`).length, 1);
  assert.equal(final.communications.find((item) => item.waitingListId === waiting.id).delivery, "sent");
  assert.equal(final.emailOutbox.filter((item) => item.waitingListOfferId === final.waitingListOffers[0].id).length, 1);
});

test("persistent offer-email failure cannot reserve capacity beyond the original 48-hour expiry", async () => {
  const state = baseState();
  const first = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  const second = joinWaitingList(state, waitingRunner(2), { at }).waitingListEntry;
  const emailAdapter = { kind: "test", async send() { return { delivery: "failed", externalCall: true, failureCategory: "provider_5xx" }; } };
  const repository = createMemoryRepository(state);
  const service = new Phase3IntegrationService({ repository, stripeGateway: { mode: "test" }, emailAdapter, publicBaseUrl: "https://development.example", organiserEmail: "organiser@example.com" });
  assert.equal((await service.offerWaitingPlace(organiser, first.id, {}, at)).emailDeliveryFailed, true);
  const result = await service.runScheduledWork(organiser, new Date(at.getTime() + 48 * 60 * 60_000 + 1));
  const final = await repository.read();
  assert.equal(result.expiredOffers, 1);
  assert.equal(result.availablePlaceReleased, true);
  assert.equal(final.waitingListOffers.length, 1);
  assert.equal(final.waitingListOffers[0].status, "expired");
  assert.equal(final.waitingList.find((item) => item.id === second.id).status, "waiting");
  assert.equal(capacitySummary(final).remaining, 1);
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
