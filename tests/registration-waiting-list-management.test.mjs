import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addPlaceRegistration,
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
import { expireStalePaymentReservations, reconcileStripeEvent } from "../registration/server/phase3-integrations.mjs";
import { createJsonFileRepository, createMemoryRepository } from "../registration/server/repositories.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";
import { ProductionRegistrationService } from "../registration/server/production-service.mjs";
import { buildPrivateWorkbookModel, buildWaitingListView } from "../registration/server/private-export.mjs";
import { createProductionBootstrap } from "../registration/server/production-bootstrap.mjs";
import { createProductionApi } from "../registration/server/production-api.mjs";
import { createDatabase, migrateDevelopmentDatabase } from "../registration/server/service.mjs";

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

test("119 confirmed plus one valid offer converts the existing reservation through Checkout and payment without exceeding 120", async () => {
  const state = baseState({ capacity: 120 });
  assert.equal(state.environment, "development");
  for (let number = 1; number <= 119; number += 1) {
    state.runners.push({ id: `confirmed-runner-${number}`, ...runner, email: `confirmed-${number}@example.com` });
    assert.equal(addPlaceRegistration(state, { runnerId: `confirmed-runner-${number}`, placeStatus: "confirmed" }, organiser, at).ok, true);
  }
  const first = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  joinWaitingList(state, waitingRunner(2), { at });
  const offered = createNextWaitingListOffer(state, organiser, at);
  assert.deepEqual(capacitySummary(state), { capacity: 120, confirmed: 119, paymentReserved: 0, offerReserved: 1, reserved: 120, remaining: 0, waiting: 1 });
  // The deployed development store uses this legacy state label. Existing offers
  // created during test setup must remain usable without relaxing production.
  state.registrationState = "test";
  const stripeCalls = [];
  const repository = createMemoryRepository(state);
  const service = new Phase3IntegrationService({
    repository,
    stripeGateway: {
      mode: "test",
      async createCheckoutSession(input) {
        stripeCalls.push(input);
        return { id: "cs_test_waiting_offer", url: "https://checkout.stripe.test/waiting-offer", expiresAt: new Date(new Date(input.at).getTime() + 30 * 60_000).toISOString() };
      }
    },
    emailAdapter: { kind: "test", async send() { return { delivery: "test", externalCall: false }; } },
    publicBaseUrl: "https://development.example"
  });
  const accepted = await service.acceptWaitingPlace(offered.token, { runner: { ...runner, email: first.email }, declaration }, new Date(at.getTime() + 60_000));
  assert.equal(accepted.ok, true);
  const checkout = await service.checkout(accepted.managementToken, new Date(at.getTime() + 120_000));
  assert.equal(checkout.ok, true);
  assert.equal(stripeCalls.length, 1);
  await repository.transaction((current) => {
    assert.deepEqual(capacitySummary(current), { capacity: 120, confirmed: 119, paymentReserved: 1, offerReserved: 0, reserved: 120, remaining: 0, waiting: 1 });
    const payment = current.payments.find((item) => item.registrationId === accepted.registrationId);
    const reconciled = reconcileStripeEvent(current, { id: "evt_waiting_offer_paid", type: "checkout.session.completed", data: { object: { id: payment.checkoutSessionId, amount_total: payment.expectedAmountPence, currency: payment.currency, payment_status: "paid", payment_intent: "pi_waiting_offer" } } }, { at: new Date(at.getTime() + 180_000) });
    assert.equal(reconciled.ok, true);
    return { ok: true };
  });
  const final = await repository.read();
  assert.deepEqual(capacitySummary(final), { capacity: 120, confirmed: 120, paymentReserved: 0, offerReserved: 0, reserved: 120, remaining: 0, waiting: 1 });
  assert.equal(final.waitingListOffers[0].status, "accepted");
  assert.equal(final.payments.find((item) => item.registrationId === accepted.registrationId).status, "paid");
  const entry = final.registrations.find((item) => item.id === accepted.registrationId);
  const contact = final.emergencyContacts.find((item) => item.registrationId === entry.id);
  const workbook = buildPrivateWorkbookModel(final);
  const row = workbook.currentEntries.find((item) => item.registrationId === entry.id);
  assert.match(entry.testReference, /^TEST-[A-F0-9]{32}$/);
  assert.equal(entry.entryStatus, "accepted");
  assert.deepEqual([contact.name, contact.phone], [runner.emergencyContactName, runner.emergencyContactPhone]);
  assert.equal(final.runners.find((item) => item.id === entry.runnerId).emergencyContactName, undefined);
  assert.deepEqual([row.entryReference, row.emergencyContactName, row.paymentStatus, row.clearedToStart], [entry.testReference, runner.emergencyContactName, "successful", "Yes"]);
  assert.equal(workbook.waitingList.find((item) => item.waitingListId === first.id).entryReference, entry.testReference);
  assert.equal(workbook.waitingList.find((item) => item.status === "waiting").entryReference, null);
  assert.equal(final.waitingListOffers.length, 1);
});

test("organiser reconciles a legacy waiting-list payment from Stripe without exceeding capacity or requiring a second payment", async () => {
  const state = createProductionBootstrap();
  state.registrationState = state.phase3RegistrationState = "OPEN";
  const waiting = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  state.registrationState = state.phase3RegistrationState = "PRIVATE_LIVE";
  const offered = createNextWaitingListOffer(state, organiser, at);
  const accepted = acceptWaitingListOffer(state, offered.token, { runner: { ...runner, email: waiting.email }, declaration }, at);
  const registration = accepted.registration;
  const storedRunner = state.runners.find((item) => item.id === registration.runnerId);
  Object.assign(storedRunner, { emergencyContactName: runner.emergencyContactName, emergencyContactPhone: runner.emergencyContactPhone });
  state.emergencyContacts = [];
  delete registration.testReference;
  const payment = state.payments[0];
  Object.assign(payment, { provider: "stripe", providerMode: "live", status: "checkout_pending", checkoutSessionId: "cs_live_synthetic", checkoutExpiresAt: new Date(at.getTime() + 30 * 60_000).toISOString(), expectedAmountPence: 600, currency: "gbp" });
  const checkedAt = new Date(at.getTime() + 31 * 60_000);
  expireStalePaymentReservations(state, checkedAt);
  for (let number = 0; number < state.event.capacity; number++) {
    assert.equal(addPlaceRegistration(state, { runnerId: `other-${number}`, placeStatus: "confirmed" }, organiser, checkedAt).ok, true);
  }
  const session = {
    id: payment.checkoutSessionId, livemode: true, mode: "payment", status: "complete", payment_status: "paid", amount_total: 600, currency: "gbp",
    metadata: { registrationId: registration.id, paymentId: payment.id },
    payment_intent: {
      id: "pi_synthetic", status: "succeeded", amount_received: 600, currency: "gbp",
      latest_charge: { id: "ch_synthetic", status: "succeeded", amount_captured: 600, currency: "gbp", captured: true, disputed: false, amount_refunded: 0 }
    }
  };
  const sent = [];
  const repository = createMemoryRepository(state);
  const emailAdapter = { async send(message) {
    sent.push(message);
    assert.equal((await repository.read()).payments[0].status, "paid");
    return { delivery: "sent", externalCall: false };
  } };
  const service = new Phase3IntegrationService({
    repository, environment: "production", emailAdapter, publicBaseUrl: "https://race.example",
    stripeGateway: { mode: "live", async retrieveCheckoutSession(id) {
      assert.equal(id, session.id);
      return structuredClone(session);
    } }
  });
  const organiserService = new ProductionRegistrationService({ repository, emailAdapter });
  const api = createProductionApi({ service: organiserService, repository, phase3Integrations: service });
  const pathname = `/api/v3/organiser/registrations/${registration.id}/check-waiting-list-payment`;
  assert.equal((await api({ method: "POST", pathname })).status, 403);
  assert.equal((await service.paymentStatus(accepted.managementToken, checkedAt)).state, "payment_review");
  assert.equal((await service.checkout(accepted.managementToken, checkedAt)).code, "PAYMENT_REVIEW_REQUIRED");

  const before = (await organiserService.entry(organiser, registration.id)).registration;
  const workbookBefore = buildPrivateWorkbookModel(await repository.read());
  const legacyRow = workbookBefore.currentEntries.find((item) => item.registrationId === registration.id);
  assert.match(before.testReference, /^BFR-[A-F0-9]{32}$/);
  assert.equal(before.canCheckWaitingListPayment, true);
  assert.deepEqual([legacyRow.entryReference, legacyRow.emergencyContactName, legacyRow.emergencyContactPhone, legacyRow.paymentStatus, legacyRow.placeStatus, legacyRow.clearedToStart],
    [before.testReference, runner.emergencyContactName, runner.emergencyContactPhone, "abandoned", "none", "No"]);
  assert.equal(workbookBefore.waitingList[0].entryReference, before.testReference);
  const review = () => api({ method: "POST", pathname, headers: { "x-ms-client-principal": principal } });

  session.metadata.paymentId = "wrong-payment";
  assert.equal((await review()).body.code, "PAYMENT_MISMATCH");
  session.metadata.paymentId = payment.id;
  session.payment_intent.latest_charge.amount_refunded = 100;
  assert.equal((await review()).body.code, "PAYMENT_REVIEW_REQUIRED");
  session.payment_intent.latest_charge.amount_refunded = 0;
  assert.equal((await review()).body.code, "PAID_CAPACITY_CONFLICT");
  assert.equal(sent.length, 0);

  await repository.transaction((current) => { current.registrations.at(-1).placeStatus = "none"; });
  const results = await Promise.all([review(), review()]);
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  const final = await repository.read();
  const after = (await organiserService.entry(organiser, registration.id)).registration;
  const finalRow = buildPrivateWorkbookModel(final).currentEntries.find((item) => item.registrationId === registration.id);
  assert.equal(capacitySummary(final).confirmed, state.event.capacity);
  assert.deepEqual([after.testReference, finalRow.paymentStatus, finalRow.placeStatus, finalRow.clearedToStart], [before.testReference, "successful", "confirmed", "Yes"]);
  assert.equal(after.canCheckWaitingListPayment, false);
  assert.equal((await service.orders.publicStartList()).confirmedCount, 1);
  assert.equal(final.auditEvents.filter((event) => event.action === "stripe_payment_checked_by_organiser").length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].template, "entry_confirmed");
  assert.match(sent[0].data.managementUrl, /^https:\/\/race\.example\/registration\/manage\.html#token=/);
});

test("runner payment check confirms the original waiting-list checkout without its webhook", async () => {
  const now = new Date();
  const state = createProductionBootstrap();
  state.registrationState = state.phase3RegistrationState = "OPEN";
  const first = joinWaitingList(state, waitingRunner(1), { at: now }).waitingListEntry;
  const next = joinWaitingList(state, waitingRunner(2), { at: now }).waitingListEntry;
  state.registrationState = state.phase3RegistrationState = "PRIVATE_LIVE";
  const acceptOffer = (waiting) => {
    const offer = createNextWaitingListOffer(state, organiser, now);
    return acceptWaitingListOffer(state, offer.token, { runner: { ...runner, email: waiting.email }, declaration }, now);
  };
  const accepted = acceptOffer(first);
  const unrelated = acceptOffer(next);
  assert.equal(accepted.ok, true);
  assert.equal(unrelated.ok, true);
  const payment = state.payments.find((item) => item.registrationId === accepted.registration.id);
  const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
  Object.assign(payment, { provider: "stripe", providerMode: "live", status: "checkout_pending", checkoutSessionId: "cs_live_original", checkoutExpiresAt: expiresAt, expectedAmountPence: 600, currency: "gbp" });
  const session = {
    id: payment.checkoutSessionId, livemode: true, mode: "payment", status: "open", payment_status: "unpaid", amount_total: 600, currency: "gbp",
    metadata: { registrationId: accepted.registration.id, paymentId: payment.id },
    payment_intent: {
      id: "pi_original", status: "succeeded", amount_received: 600, currency: "gbp",
      latest_charge: { id: "ch_original", status: "succeeded", amount_captured: 600, currency: "gbp", captured: true, disputed: false, amount_refunded: 0 }
    }
  };
  const sent = [];
  const repository = createMemoryRepository(state);
  const emailAdapter = { async send(message) { sent.push(message); return { delivery: "sent", externalCall: false }; } };
  let stripeReads = 0;
  const service = new Phase3IntegrationService({
    repository, environment: "production", emailAdapter, publicBaseUrl: "https://race.example",
    stripeGateway: {
      mode: "live",
      async retrieveCheckoutSession(id) { assert.equal(id, session.id); stripeReads++; return structuredClone(session); },
      verifyWebhook(rawBody) { return JSON.parse(rawBody); }
    }
  });
  const api = createProductionApi({ service: new ProductionRegistrationService({ repository, emailAdapter }), repository, phase3Integrations: service });
  const read = () => api({ method: "GET", pathname: "/api/v3/payments/status", headers: { "x-management-token": accepted.managementToken } });
  const check = (token) => api({ method: "POST", pathname: "/api/v3/payments/check", headers: token ? { "x-management-token": token } : {}, body: { registrationId: accepted.registration.id } });

  const before = (await read()).body;
  assert.equal(before.state, "checkout_pending");
  assert.equal(before.canCheckWaitingListPayment, true);
  assert.equal((await check()).status, 401);
  assert.equal((await check(unrelated.managementToken)).body.code, "PAYMENT_REVIEW_UNAVAILABLE");
  assert.equal(stripeReads, 0);
  assert.equal((await check(accepted.managementToken)).body.code, "PAYMENT_NOT_CONFIRMED");
  assert.equal((await read()).body.state, "checkout_pending");
  assert.equal(sent.length, 0);

  Object.assign(session, { status: "complete", payment_status: "paid" });
  assert.equal((await check(accepted.managementToken)).body.paymentStatus, "paid");
  const after = (await read()).body;
  assert.equal(after.state, "paid");
  assert.equal(after.canCheckWaitingListPayment, false);

  const webhook = { id: "evt_delayed", type: "checkout.session.completed", data: { object: session } };
  assert.equal((await service.webhook(JSON.stringify(webhook), "test-signature", now)).duplicate, true);
  assert.equal((await check(accepted.managementToken)).body.duplicate, true);
  assert.equal(stripeReads, 2);
  const final = await repository.read();
  assert.equal(capacitySummary(final).confirmed, 1);
  assert.equal(final.registrations.find((item) => item.id === unrelated.registration.id).placeStatus, "payment_reserved");
  assert.equal(final.auditEvents.filter((event) => event.action === "stripe_payment_checked_by_runner").length, 1);
  assert.deepEqual(sent.map((item) => item.template), ["entry_confirmed"]);
});

test("development test-state allowance does not relax production waiting-offer authorisation", () => {
  const state = baseState();
  const waiting = joinWaitingList(state, waitingRunner(1), { at }).waitingListEntry;
  const offered = createWaitingListOffer(state, waiting.id, organiser, {}, at);
  state.environment = "production";
  state.registrationState = "CLOSED";

  const acceptance = acceptWaitingListOffer(
    state,
    offered.token,
    { runner: { ...runner, email: waiting.email }, declaration },
    new Date(at.getTime() + 60_000)
  );

  assert.equal(acceptance.code, "REGISTRATION_NOT_ACCEPTING");
  assert.equal(state.registrations.length, 0);
  assert.equal(state.waitingListOffers[0].status, "offered");
  assert.equal(state.privateInvitations[0].uses, 0);
});

test("persisted development state migrates declaration metadata before atomically accepting an offer", async () => {
  const legacy = createDatabase({ environment: "development", registrationState: "test", capacity: 1 });
  assert.equal(legacy.event.declaration, undefined);
  legacy.registrationState = "OPEN";
  const waiting = joinWaitingList(legacy, waitingRunner(1), { at }).waitingListEntry;
  const offered = createWaitingListOffer(legacy, waiting.id, organiser, {}, at);
  legacy.registrationState = "test";

  const safelyRejected = acceptWaitingListOffer(
    legacy,
    offered.token,
    { runner: { ...runner, email: waiting.email }, declaration },
    new Date(at.getTime() + 30_000)
  );
  assert.equal(safelyRejected.code, "DECLARATION_VERSION_UNAVAILABLE");
  assert.equal(legacy.privateInvitations[0].uses, 0);
  assert.equal(legacy.waitingListOffers[0].status, "offered");
  assert.equal(legacy.registrations.length, 0);
  assert.equal(legacy.payments.length, 0);

  const migrated = migrateDevelopmentDatabase(legacy);
  assert.deepEqual(migrated.event.declaration, {
    identifier: "WFRA_SENIOR_ENTRY",
    version: "21/02/23",
    contentStatus: "organiser-supplied-versioned-content"
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blorenge-waiting-persistence-"));
  const repository = createJsonFileRepository(path.join(directory, "state.json"), migrated);
  const service = new Phase3IntegrationService({
    repository,
    stripeGateway: { mode: "test" },
    emailAdapter: { kind: "test", async send() { return { delivery: "test", externalCall: false }; } },
    publicBaseUrl: "https://development.example"
  });

  const accepted = await service.acceptWaitingPlace(
    offered.token,
    { runner: { ...runner, email: waiting.email }, declaration },
    new Date(at.getTime() + 60_000)
  );
  assert.equal(accepted.ok, true);

  const persisted = await createJsonFileRepository(repository.filePath, await repository.read()).read();
  assert.deepEqual(capacitySummary(persisted), { capacity: 120, confirmed: 0, paymentReserved: 1, offerReserved: 0, reserved: 1, remaining: 119, waiting: 0 });
  assert.equal(persisted.waitingListOffers[0].status, "accepted");
  assert.equal(persisted.privateInvitations[0].uses, 1);
  assert.equal(persisted.registrations.length, 1);
  assert.equal(persisted.payments.length, 1);
  assert.equal(persisted.declarations.length, 1);
});

test("public status suppresses ordinary registration while an eligible waiting list exists", async () => {
  const state = createPhase3State({ environment: "production", registrationState: "OPEN" });
  state.registrationState = "OPEN";
  state.event.capacity = 2;
  joinWaitingList(state, waitingRunner(1), { at });
  const service = new ProductionRegistrationService({ repository: createMemoryRepository(state), emailAdapter: { kind: "disabled" } });
  const status = await service.status();
  assert.equal(status.remaining, 2);
  assert.equal(status.waitingListPriorityActive, true);
  assert.equal(status.publicRegistrationAvailable, false);
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
