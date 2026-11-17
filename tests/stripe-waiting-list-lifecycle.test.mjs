import test from "node:test";
import assert from "node:assert/strict";
import {
  createPhase3State,
  joinWaitingList,
  createNextWaitingListOffer,
  acceptWaitingListOffer,
  capacitySummary,
} from "../registration/server/phase3-domain.mjs";
import {
  beginStripeCheckout,
  expireStalePaymentReservations,
  reconcileStripeEvent,
  runnerPaymentState,
} from "../registration/server/phase3-integrations.mjs";
// Reproduction of the baseline release decision, intentionally independent of
// the corrected matcher. This models the historical scheduler mutation only.
function oldExpiry(state, at) {
  let expired = 0;
  for (const payment of state.payments.filter(
    (p) =>
      p.status === "checkout_pending" && new Date(p.checkoutExpiresAt) <= at,
  )) {
    const registration = state.registrations.find(
      (r) => r.id === payment.registrationId,
    );
    payment.status = "expired";
    payment.webhookReconciliationState = "locally_expired_awaiting_webhook";
    if (registration && registration.placeStatus !== "confirmed")
      registration.placeStatus = "none";
    expired++;
  }
  return { expired };
}
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";
const at = new Date("2026-11-16T11:53:36Z"),
  late = new Date("2026-11-16T12:30:00Z");
const actor = {
  authenticated: true,
  role: "organiser",
  actorType: "organiser",
  id: "synthetic",
};
const runner = {
  email: "first@example.com",
  firstName: "Synthetic",
  lastName: "Runner",
  phone: "07700 900123",
  addressLine1: "1 Example Street",
  addressLine2: "",
  city: "Abergavenny",
  postcode: "NP7 5AA",
  raceCategory: "Female",
  dateOfBirth: "1990-06-15",
  club: "Example",
  wfraMember: false,
  wfraMembershipNumber: "",
  emergencyContactName: "Synthetic Contact",
  emergencyContactPhone: "07700 900456",
};
async function fixture() {
  const state = createPhase3State({
    environment: "development",
    registrationState: "OPEN",
  });
  state.event.capacity = 1;
  state.processedPaymentEvents = [];
  state.consents = [];
  for (const email of [
    "first@example.com",
    "second@example.com",
    "third@example.com",
  ])
    joinWaitingList(
      state,
      { email, firstName: "Synthetic", lastName: "Runner" },
      { at },
    );
  const offer = createNextWaitingListOffer(state, actor, at);
  assert.equal(capacitySummary(state).offerReserved, 1);
  const accepted = acceptWaitingListOffer(
    state,
    offer.token,
    {
      runner,
      declaration: {
        declarationIdentifier: "WFRA_SENIOR_ENTRY",
        declarationVersion: "21/02/23",
        accepted: true,
        typedFullName: "Synthetic Runner",
        signatoryRole: "Competitor",
      },
    },
    at,
  );
  assert.equal(accepted.ok, true);
  const registration = accepted.registration,
    payment = state.payments[0];
  await beginStripeCheckout(
    state,
    registration.id,
    {
      mode: "test",
      async createCheckoutSession() {
        return {
          id: "cs_lifecycle",
          url: "https://example.com/checkout",
          expiresAt: "2026-11-16T12:23:36Z",
        };
      },
    },
    { successUrl: "https://example.com", cancelUrl: "https://example.com", at },
  );
  const session = {
    id: payment.checkoutSessionId,
    mode: "payment",
    livemode: false,
    status: "complete",
    payment_status: "paid",
    amount_total: payment.expectedAmountPence,
    currency: "gbp",
    metadata: { registrationId: registration.id, paymentId: payment.id },
    payment_intent: {
      id: "pi_lifecycle",
      status: "succeeded",
      amount_received: payment.expectedAmountPence,
      currency: "gbp",
      latest_charge: {
        id: "ch_lifecycle",
        status: "succeeded",
        captured: true,
        disputed: false,
        amount_refunded: 0,
        amount_captured: payment.expectedAmountPence,
        currency: "gbp",
      },
    },
  };
  const event = {
    id: "evt_lifecycle",
    type: "checkout.session.completed",
    created: Math.floor(at.getTime() / 1000) + 18,
    data: { object: { ...session, payment_intent: "pi_lifecycle" } },
  };
  return {
    state,
    registration,
    payment,
    session,
    event,
    token: accepted.managementToken,
  };
}
function serviceFor(f) {
  const repository = createMemoryRepository(f.state);
  let sent = [];
  const service = new Phase3IntegrationService({
    repository,
    stripeGateway: {
      mode: "test",
      verifyWebhook(raw, sig) {
        if (sig !== "valid") throw Error();
        return JSON.parse(raw);
      },
      async retrieveCheckoutSession() {
        return structuredClone(f.session);
      },
    },
    emailAdapter: {
      async send(message) {
        sent.push(message);
        return { delivery: "sent", externalCall: false };
      },
    },
    publicBaseUrl: "https://example.com",
  });
  return { repository, service, sent };
}
test("offer acceptance atomically transfers one offer reservation to a Checkout reservation", async () => {
  const f = await fixture();
  assert.equal(f.state.waitingListOffers[0].status, "accepted");
  assert.equal(capacitySummary(f.state).paymentReserved, 1);
  assert.equal(capacitySummary(f.state).reserved, 1);
  assert.equal(
    createNextWaitingListOffer(f.state, actor, at).code,
    "CAPACITY_FULL",
  );
});
test("failed webhook and repeated scheduler ticks retain the uncertain paid reservation", async () => {
  const f = await fixture();
  const { repository, service } = serviceFor(f);
  assert.equal(
    (await service.webhook(JSON.stringify(f.event), "invalid", at)).code,
    "INVALID_WEBHOOK_SIGNATURE",
  );
  await service.runScheduledWork(actor, late);
  await service.runScheduledWork(actor, new Date(late.getTime() + 1800000));
  const s = await repository.read();
  assert.equal(s.payments[0].status, "processing");
  assert.equal(
    s.payments[0].webhookReconciliationState,
    "reservation_review_required",
  );
  assert.equal(
    runnerPaymentState(s, f.registration.id, late).state,
    "payment_review",
  );
  assert.equal(capacitySummary(s).paymentReserved, 1);
  assert.equal(
    s.auditEvents.filter(
      (e) => e.action === "payment_reservation_review_required",
    ).length,
    1,
  );
  assert.equal(
    (await service.offerNextWaitingPlace(actor, late)).code,
    "CAPACITY_FULL",
  );
});
test("delayed successful webhook confirms the retained place once after scheduler expiry", async () => {
  const f = await fixture();
  const { repository, service, sent } = serviceFor(f);
  await service.runScheduledWork(actor, late);
  assert.equal(
    (await service.webhook(JSON.stringify(f.event), "valid", late)).ok,
    true,
  );
  assert.equal(
    (await service.webhook(JSON.stringify(f.event), "valid", late)).duplicate,
    true,
  );
  await service.runScheduledWork(actor, late);
  const s = await repository.read();
  assert.equal(capacitySummary(s).confirmed, 1);
  assert.equal(capacitySummary(s).reserved, 1);
  assert.equal(sent.length, 1);
  assert.equal(s.registrations.length, 1);
});
test("provider-verified manual check after deadline and original webhook do not duplicate confirmation", async () => {
  const f = await fixture();
  const { repository, service, sent } = serviceFor(f);
  await service.runScheduledWork(actor, late);
  assert.equal(
    (await service.checkWaitingListPayment(actor, f.registration.id, late)).ok,
    true,
  );
  assert.equal(
    (await service.webhook(JSON.stringify(f.event), "valid", late)).duplicate,
    true,
  );
  const s = await repository.read();
  assert.equal(s.processedPaymentEvents.length, 2);
  assert.equal(sent.length, 1);
  assert.equal(capacitySummary(s).confirmed, 1);
});
test("concurrent scheduler, webhook and offer requests cannot reallocate the retained place", async () => {
  for (const reverse of [false, true]) {
    const f = await fixture();
    const { repository, service } = serviceFor(f);
    const jobs = [
      () => service.runScheduledWork(actor, late),
      () => service.webhook(JSON.stringify(f.event), "valid", late),
      () => service.offerNextWaitingPlace(actor, late),
    ];
    if (reverse) jobs.reverse();
    await Promise.all(jobs.map((j) => j()));
    const s = await repository.read();
    assert.equal(capacitySummary(s).confirmed, 1);
    assert.equal(capacitySummary(s).reserved, 1);
    assert.equal(
      s.waitingListOffers.filter((o) => o.status === "offered").length,
      0,
    );
  }
});
test("definitive expired session releases a hold, with only one winner among concurrent offers", async () => {
  const f = await fixture();
  const { repository, service } = serviceFor(f);
  await service.runScheduledWork(actor, late);
  const expired = structuredClone(f.event);
  expired.id = "evt_expired";
  expired.type = "checkout.session.expired";
  expired.data.object.payment_intent = null;
  expired.data.object.payment_status = "unpaid";
  expired.data.object.status = "expired";
  assert.equal(
    (await service.webhook(JSON.stringify(expired), "valid", late)).ok,
    true,
  );
  const results = await Promise.all([
    service.offerNextWaitingPlace(actor, late),
    service.offerNextWaitingPlace(actor, late),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(capacitySummary(await repository.read()).offerReserved, 1);
});
test("historical released reservation remains a capacity conflict and is never retroactively reclaimed", async () => {
  const f = await fixture();
  f.registration.placeStatus = "none";
  f.payment.status = "expired";
  f.payment.webhookReconciliationState = "locally_expired_awaiting_webhook";
  assert.equal(createNextWaitingListOffer(f.state, actor, late).ok, true);
  const before = structuredClone(f.state);
  assert.equal(
    reconcileStripeEvent(f.state, f.event, { at: late }).code,
    "PAID_CAPACITY_CONFLICT",
  );
  assert.deepEqual(f.state, before);
});
test("baseline expiry independently reproduces paid-place reuse even with corrected matching", async () => {
  const f = await fixture();
  assert.equal(oldExpiry(f.state, late).expired, 1);
  assert.equal(capacitySummary(f.state).remaining, 1);
  assert.equal(createNextWaitingListOffer(f.state, actor, late).ok, true);
  assert.equal(
    reconcileStripeEvent(f.state, f.event, { at: late }).code,
    "PAID_CAPACITY_CONFLICT",
  );
});
test("async processing keeps the reservation until a delayed success is reconciled", async () => {
  const f = await fixture();
  f.event.data.object.payment_status = "unpaid";
  assert.equal(
    reconcileStripeEvent(f.state, f.event, { at }).paymentStatus,
    "processing",
  );
  expireStalePaymentReservations(f.state, late);
  assert.equal(f.payment.reservationReview.status, "open");
  assert.equal(capacitySummary(f.state).paymentReserved, 1);
  f.event.id = "evt_async";
  f.event.type = "checkout.session.async_payment_succeeded";
  f.event.data.object.payment_status = "paid";
  assert.equal(reconcileStripeEvent(f.state, f.event, { at: late }).ok, true);
  assert.equal(capacitySummary(f.state).confirmed, 1);
});
test("concurrent real manual check, scheduler and automatic webhook produce one entry and confirmation", async () => {
  const f = await fixture();
  const { repository, service, sent } = serviceFor(f);
  const results = await Promise.all([
    service.checkWaitingListPayment(actor, f.registration.id, late),
    service.runScheduledWork(actor, late),
    service.webhook(JSON.stringify(f.event), "valid", late),
  ]);
  assert.ok(results.every((r) => r.ok));
  const s = await repository.read();
  assert.equal(s.registrations.length, 1);
  assert.equal(capacitySummary(s).confirmed, 1);
  assert.equal(capacitySummary(s).reserved, 1);
  assert.equal(sent.length, 1);
});
test("unavailable Stripe during an overdue review is audited and retains capacity", async () => {
  const f = await fixture();
  const { repository, service } = serviceFor(f);
  service.stripeGateway.retrieveCheckoutSession = async () => {
    throw Error("synthetic provider outage");
  };
  await service.runScheduledWork(actor, late);
  const overdue = new Date(late.getTime() + 3 * 3600000);
  const checked = await service.checkWaitingListPayment(
    actor,
    f.registration.id,
    overdue,
  );
  assert.equal(checked.code, "PAYMENTS_UNAVAILABLE");
  const run = await service.runScheduledWork(actor, overdue);
  assert.deepEqual(run.paymentReviews, { open: 1, overdue: 1 });
  const s = await repository.read();
  assert.equal(capacitySummary(s).paymentReserved, 1);
  assert.equal(s.payments[0].reservationReview.ownerRole, "organiser");
  assert.equal(
    s.payments[0].reservationReview.lastCheckCode,
    "PAYMENTS_UNAVAILABLE",
  );
  assert.equal(s.payments[0].reservationReview.status, "open");
  assert.equal(
    s.auditEvents.filter(
      (e) => e.action === "waiting_list_payment_review_checked",
    ).length,
    1,
  );
  const { ProductionRegistrationService } =
    await import("../registration/server/production-service.mjs");
  const organiserService = new ProductionRegistrationService({ repository });
  const view = await organiserService.entry(actor, f.registration.id);
  assert.equal(view.registration.payment.reservationReview.status, "open");
  assert.equal(view.registration.canCheckWaitingListPayment, true);
});
test("successful manual review closes the hold audit and preserves one counted place", async () => {
  const f = await fixture();
  const { repository, service } = serviceFor(f);
  await service.runScheduledWork(actor, late);
  await service.checkWaitingListPayment(actor, f.registration.id, late);
  const s = await repository.read();
  assert.equal(s.payments[0].reservationReview.status, "resolved");
  assert.equal(s.payments[0].reservationReview.outcome, "payment_confirmed");
  assert.equal(
    s.auditEvents.filter(
      (e) => e.action === "payment_reservation_review_resolved",
    ).length,
    1,
  );
  assert.equal(capacitySummary(s).reserved, 1);
});
