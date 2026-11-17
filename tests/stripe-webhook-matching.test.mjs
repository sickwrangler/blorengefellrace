import test from "node:test";
import assert from "node:assert/strict";
import {
  createPhase3State,
  capacitySummary,
} from "../registration/server/phase3-domain.mjs";
import {
  reconcileStripeEvent,
  findPaymentForStripeEvent,
} from "../registration/server/phase3-integrations.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";
const at = new Date("2026-11-17T12:00:00Z");
function fixture() {
  const state = createPhase3State({
    environment: "development",
    registrationState: "OPEN",
  });
  state.registrations = [
    {
      id: "reg",
      runnerId: "runner",
      entryStatus: "accepted",
      placeStatus: "payment_reserved",
    },
  ];
  state.runners = [
    {
      id: "runner",
      firstName: "Synthetic",
      lastName: "Runner",
      email: "runner@example.com",
    },
  ];
  state.payments = [
    { id: "old", orderId: "old-order", status: "expired" },
    {
      id: "payment",
      registrationId: "reg",
      checkoutSessionId: "cs",
      status: "checkout_pending",
      expectedAmountPence: 400,
      currency: "gbp",
    },
  ];
  state.processedPaymentEvents = [];
  state.emailOutbox = [];
  state.communications = [];
  const event = {
    id: "evt_original",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs",
        payment_intent: "pi",
        amount_total: 400,
        currency: "gbp",
        payment_status: "paid",
        metadata: { paymentId: "payment", registrationId: "reg" },
      },
    },
  };
  return { state, event };
}
test("string and expanded intents ignore earlier order payment with absent intent", () => {
  for (const intent of ["pi", { id: "pi" }]) {
    const { state, event } = fixture();
    event.data.object.payment_intent = intent;
    assert.equal(reconcileStripeEvent(state, event, { at }).ok, true);
    assert.equal(state.payments[0].status, "expired");
    assert.equal(state.payments[1].status, "paid");
    assert.equal(capacitySummary(state).confirmed, 1);
  }
});
test("ambiguous provider references and conflicting metadata fail without mutation", () => {
  for (const kind of ["duplicate", "metadata", "intent"]) {
    const { state, event } = fixture();
    if (kind === "duplicate")
      state.payments.push({ ...state.payments[1], id: "duplicate" });
    if (kind === "metadata") event.data.object.metadata.paymentId = "other";
    if (kind === "intent") state.payments[1].paymentIntentId = "pi_other";
    const before = structuredClone(state);
    assert.equal(reconcileStripeEvent(state, event, { at }).ok, false);
    assert.deepEqual(state, before);
  }
});
test("missing registration is a genuine failure; missing identifiers never match undefined", () => {
  const { state, event } = fixture();
  state.registrations = [];
  assert.equal(reconcileStripeEvent(state, event, { at }).code, "NOT_FOUND");
  assert.equal(findPaymentForStripeEvent(state, {}).code, "PAYMENT_NOT_FOUND");
});
test("manual expanded reconciliation followed by original string event and duplicate keeps one confirmation", async () => {
  const { state, event } = fixture();
  const repository = createMemoryRepository(state);
  let sent = 0;
  const service = new Phase3IntegrationService({
    repository,
    emailAdapter: {
      async send() {
        sent++;
        return { delivery: "sent", externalCall: false };
      },
    },
    stripeGateway: {
      verifyWebhook(raw, sig) {
        if (sig !== "valid") throw Error();
        return JSON.parse(raw);
      },
    },
    publicBaseUrl: "https://example.com",
  });
  assert.equal(
    (await service.webhook(JSON.stringify(event), "bad", at)).code,
    "INVALID_WEBHOOK_SIGNATURE",
  );
  const manual = structuredClone(event);
  manual.id = "stripe-checkout-review:cs";
  manual.data.object.payment_intent = { id: "pi" };
  assert.equal((await service.reconcileSinglePayment(manual, at)).ok, true);
  assert.equal(
    (await service.webhook(JSON.stringify(event), "valid", at)).duplicate,
    true,
  );
  assert.equal(
    (await service.webhook(JSON.stringify(event), "valid", at)).duplicate,
    true,
  );
  const final = await repository.read();
  assert.equal(sent, 1);
  assert.equal(final.processedPaymentEvents.length, 2);
  assert.equal(final.registrations.length, 1);
  assert.equal(capacitySummary(final).confirmed, 1);
});
test("concurrent synthetic and original reconciliation serialize to one email and place", async () => {
  const { state, event } = fixture();
  const repository = createMemoryRepository(state);
  let sent = 0;
  const service = new Phase3IntegrationService({
    repository,
    emailAdapter: {
      async send() {
        sent++;
        return { delivery: "sent", externalCall: false };
      },
    },
    stripeGateway: {},
    publicBaseUrl: "https://example.com",
  });
  const manual = structuredClone(event);
  manual.id = "stripe-checkout-review:cs";
  manual.data.object.payment_intent = { id: "pi" };
  const results = await Promise.all([
    service.reconcileSinglePayment(manual, at),
    service.reconcileSinglePayment(event, at),
  ]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(sent, 1);
  assert.equal(capacitySummary(await repository.read()).confirmed, 1);
});
test("expired checkout may succeed with capacity; late expiry cannot release paid place", () => {
  const { state, event } = fixture();
  state.payments[1].status = "expired";
  state.registrations[0].placeStatus = "none";
  assert.equal(reconcileStripeEvent(state, event, { at }).ok, true);
  event.id = "evt_expired";
  event.type = "checkout.session.expired";
  assert.equal(reconcileStripeEvent(state, event, { at }).ok, true);
  assert.equal(state.payments[1].status, "paid");
  assert.equal(state.registrations[0].placeStatus, "confirmed");
});
test("late paid event cannot consume capacity reserved by other entries or offers", () => {
  const { state, event } = fixture();
  state.event.capacity = 1;
  state.registrations[0].placeStatus = "none";
  state.registrations.push({
    id: "other",
    entryStatus: "accepted",
    placeStatus: "confirmed",
  });
  const before = structuredClone(state);
  assert.equal(
    reconcileStripeEvent(state, event, { at }).code,
    "PAID_CAPACITY_CONFLICT",
  );
  assert.deepEqual(state, before);
});
test("order matcher with no PaymentIntent uses the session and rejects duplicate session references", () => {
  const { state } = fixture();
  state.payments[0].checkoutSessionId = "cs_order";
  assert.equal(
    findPaymentForStripeEvent(state, {
      id: "cs_order",
      metadata: { orderId: "old-order", paymentId: "old" },
    }).payment.id,
    "old",
  );
  state.payments.push({ ...state.payments[0], id: "other-order-payment" });
  assert.equal(
    findPaymentForStripeEvent(state, { id: "cs_order" }).code,
    "PAYMENT_MATCH_AMBIGUOUS",
  );
});
test("order refund registration metadata must belong to the matched order payment", () => {
  const { state } = fixture();
  const payment = {
    id: "order-payment",
    orderId: "order",
    registrationIds: ["order-reg"],
    paymentIntentId: "pi_order",
  };
  state.payments.push(payment);
  assert.equal(
    findPaymentForStripeEvent(state, {
      id: "re_refund",
      payment_intent: "pi_order",
      metadata: { registrationId: "order-reg" },
    }).payment.id,
    payment.id,
  );
  assert.equal(
    findPaymentForStripeEvent(state, {
      id: "re_refund",
      payment_intent: "pi_order",
      metadata: { registrationId: "unrelated" },
    }).code,
    "PAYMENT_MISMATCH",
  );
});
test("distinct success events for a reconciled order cannot resend confirmation or resurrect a withdrawn entry", async () => {
  const { createProductionBootstrap } =
    await import("../registration/server/production-bootstrap.mjs");
  const state = createProductionBootstrap();
  state.orders = [
    { id: "order", registrationIds: ["reg"], status: "partially_refunded" },
  ];
  state.registrations = [
    {
      id: "reg",
      runnerId: "runner",
      entryStatus: "withdrawn",
      placeStatus: "none",
    },
  ];
  state.runners = [{ id: "runner", email: "synthetic@example.com" }];
  state.payments = [
    {
      id: "order-payment",
      orderId: "order",
      registrationIds: ["reg"],
      checkoutSessionId: "cs_order",
      paymentIntentId: "pi_order",
      status: "paid",
      expectedAmountPence: 600,
      currency: "gbp",
    },
  ];
  const repository = createMemoryRepository(state);
  let sent = 0;
  const service = new Phase3IntegrationService({
    repository,
    emailAdapter: {
      async send() {
        sent++;
        return { delivery: "sent" };
      },
    },
    stripeGateway: { verifyWebhook: JSON.parse },
  });
  for (const [id, type] of [
    ["evt_order_completed", "checkout.session.completed"],
    ["evt_order_async", "checkout.session.async_payment_succeeded"],
  ]) {
    const event = {
      id,
      type,
      data: {
        object: {
          id: "cs_order",
          payment_intent: "pi_order",
          amount_total: 600,
          currency: "gbp",
          payment_status: "paid",
          metadata: { orderId: "order", paymentId: "order-payment" },
        },
      },
    };
    assert.equal(
      (await service.webhook(JSON.stringify(event), "synthetic")).duplicate,
      true,
    );
  }
  const final = await repository.read();
  assert.deepEqual(final.registrations, state.registrations);
  assert.deepEqual(final.payments, state.payments);
  assert.deepEqual(final.orders, state.orders);
  assert.equal(sent, 0);
  assert.equal(final.processedPaymentEvents.length, 2);
});
