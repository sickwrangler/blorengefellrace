import crypto from "node:crypto";
import { ageOnRaceDate, capacitySummary, createNextWaitingListOffer, expireWaitingListOffers } from "./phase3-domain.mjs";

export const CHECKOUT_RESERVATION_MINUTES = 30;
export const PAYMENT_CURRENCY = "gbp";
export const STRIPE_WEBHOOK_EVENTS = Object.freeze([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "refund.failed"
]);

const iso = (value = new Date()) => new Date(value).toISOString();
const activeRegistration = (entry) => entry && !entry.deletedAt && !["cancelled", "place_released"].includes(entry.entryStatus);
const eventId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function audit(state, action, registrationId, detail = {}, at = new Date(), actorType = "system") {
  state.auditEvents.push({ id: eventId("audit"), occurredAt: iso(at), actorType, actorId: null, action, subjectId: registrationId, before: null, after: detail, environment: state.environment });
}

export function assertStripeDevelopmentConfiguration({ environment, secretKey, webhookSecret }) {
  if (environment !== "development") throw new Error("Stripe integration is restricted to the isolated development environment.");
  if (/^(?:sk|rk)_live_/i.test(String(secretKey ?? ""))) throw new Error("Stripe live credentials are forbidden in development.");
  if (!/^(?:sk|rk)_test_/i.test(String(secretKey ?? ""))) throw new Error("A Stripe test secret or restricted key is required.");
  if (!/^whsec_[A-Za-z0-9_]+$/.test(String(webhookSecret ?? ""))) throw new Error("A Stripe webhook signing secret is required.");
  return { mode: "test" };
}

export function createStripeGateway({ stripe, environment = "development", secretKey, webhookSecret, reservationMinutes = CHECKOUT_RESERVATION_MINUTES }) {
  assertStripeDevelopmentConfiguration({ environment, secretKey, webhookSecret });
  if (!stripe?.checkout?.sessions?.create || !stripe?.webhooks?.constructEvent || !stripe?.refunds?.create) throw new Error("Stripe SDK client is incomplete.");
  if (reservationMinutes !== CHECKOUT_RESERVATION_MINUTES) throw new Error("Development Checkout reservations must be 30 minutes.");
  return Object.freeze({
    kind: "stripe-test",
    reservationMinutes,
    async createCheckoutSession({ registrationId, paymentId, amountPence, currency = PAYMENT_CURRENCY, successUrl, cancelUrl, at = new Date() }) {
      if (!Number.isInteger(amountPence) || amountPence < 1 || currency !== PAYMENT_CURRENCY) throw new Error("Invalid server-calculated Checkout price.");
      const expiresAt = Math.floor(new Date(at).getTime() / 1000) + reservationMinutes * 60;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ quantity: 1, price_data: { currency, unit_amount: amountPence, product_data: { name: "Blorenge Fell Race entry" } } }],
        expires_at: expiresAt,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { registrationId, paymentId }
      }, { idempotencyKey: `checkout-${paymentId}` });
      return { id: session.id, url: session.url, expiresAt: new Date(expiresAt * 1000).toISOString() };
    },
    async createOrderCheckoutSession({ orderId, paymentId, checkoutAttemptId, runnerPricesPence, successUrl, cancelUrl, at = new Date() }) {
      if (!Array.isArray(runnerPricesPence) || runnerPricesPence.length < 1 || runnerPricesPence.some((amount) => !Number.isInteger(amount) || amount < 1)) throw new Error("Invalid server-calculated order price.");
      if (!checkoutAttemptId) throw new Error("A Checkout attempt identifier is required.");
      const expiresAt = Math.floor(new Date(at).getTime() / 1000) + reservationMinutes * 60;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: runnerPricesPence.map((unit_amount) => ({ quantity: 1, price_data: { currency: PAYMENT_CURRENCY, unit_amount, product_data: { name: "Blorenge Fell Race entry" } } })),
        expires_at: expiresAt,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { orderId, paymentId, runnerCount: String(runnerPricesPence.length) }
      }, { idempotencyKey: `checkout-order-${paymentId}-${checkoutAttemptId}` });
      return { id: session.id, url: session.url, expiresAt: new Date(expiresAt * 1000).toISOString() };
    },
    verifyWebhook(rawBody, signature) {
      if (!(typeof rawBody === "string" || Buffer.isBuffer(rawBody)) || !signature) throw new Error("Stripe webhook signature verification failed.");
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },
    async createFullRefund({ paymentIntentId, paymentId }) {
      if (!paymentIntentId) throw new Error("A reconciled Stripe payment is required for refund.");
      return stripe.refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey: `refund-${paymentId}` });
    },
    async createPartialRefund({ paymentIntentId, paymentId, registrationId, amountPence }) {
      if (!paymentIntentId || !Number.isInteger(amountPence) || amountPence < 1) throw new Error("A valid reconciled payment and refund amount are required.");
      return stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountPence, metadata: { registrationId } }, { idempotencyKey: `refund-${paymentId}-${registrationId}` });
    }
  });
}

function paymentFor(state, registrationId) {
  return state.payments.find((item) => item.registrationId === registrationId || item.registrationIds?.includes(registrationId));
}

export async function beginStripeCheckout(state, registrationId, gateway, { successUrl, cancelUrl, at = new Date() } = {}) {
  const registration = state.registrations.find((item) => item.id === registrationId && activeRegistration(item));
  const runner = state.runners.find((item) => item.id === registration?.runnerId);
  const payment = paymentFor(state, registrationId);
  if (!registration || !runner || !payment) return { ok: false, code: "NOT_FOUND" };
  if (ageOnRaceDate(runner.dateOfBirth, state.event.raceDate) < 18) return { ok: false, code: "PARENTAL_CONSENT_REQUIREMENTS_PENDING" };
  if (payment.status === "paid") return { ok: false, code: "ALREADY_PAID" };
  if (payment.status === "checkout_pending" && new Date(payment.checkoutExpiresAt) > new Date(at)) return { ok: true, duplicate: true, checkoutUrl: payment.checkoutUrl, expiresAt: payment.checkoutExpiresAt };
  if (registration.placeStatus === "none") {
    if (capacitySummary(state).remaining < 1) return { ok: false, code: "CAPACITY_FULL" };
    registration.placeStatus = "payment_reserved";
  }
  const created = await gateway.createCheckoutSession({ registrationId, paymentId: payment.id, amountPence: payment.priceActuallyChargedPence, currency: PAYMENT_CURRENCY, successUrl, cancelUrl, at });
  if (!created?.id || !created?.url || !created?.expiresAt) return { ok: false, code: "CHECKOUT_CREATE_FAILED" };
  Object.assign(payment, {
    provider: "stripe", providerMode: "test", status: "checkout_pending", checkoutSessionId: created.id,
    checkoutUrl: created.url, checkoutExpiresAt: created.expiresAt, expectedAmountPence: payment.priceActuallyChargedPence,
    actualPaidAmountPence: null, currency: PAYMENT_CURRENCY, paymentIntentId: null, completedAt: null,
    refundState: "not_requested", webhookReconciliationState: "awaiting_event", updatedAt: iso(at), externalCall: true
  });
  registration.updatedAt = iso(at);
  audit(state, "stripe_checkout_created", registrationId, { expiresAt: created.expiresAt, expectedAmountPence: payment.expectedAmountPence, currency: PAYMENT_CURRENCY }, at);
  return { ok: true, checkoutUrl: created.url, expiresAt: created.expiresAt };
}

function stripeObject(event) { return event?.data?.object ?? {}; }
function findPaymentForStripeEvent(state, object) {
  return state.payments.find((item) => item.checkoutSessionId === object.id || (object.payment_intent && item.paymentIntentId === object.payment_intent) || (object.payment_intent && item.paymentIntentId === object.payment_intent?.id));
}

export function reconcileStripeEvent(state, event, { at = new Date() } = {}) {
  if (!event?.id || !STRIPE_WEBHOOK_EVENTS.includes(event.type)) return { ok: false, code: "UNSUPPORTED_EVENT" };
  state.processedPaymentEvents ??= [];
  if (state.processedPaymentEvents.some((item) => item.id === event.id)) return { ok: true, duplicate: true };
  const object = stripeObject(event);
  const payment = findPaymentForStripeEvent(state, object);
  if (!payment) return { ok: false, code: "PAYMENT_NOT_FOUND" };
  const registration = state.registrations.find((item) => item.id === payment.registrationId);
  if (!registration) return { ok: false, code: "NOT_FOUND" };
  const success = ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type);
  if (success) {
    const paid = object.amount_total ?? object.amount_received;
    const currency = String(object.currency ?? "").toLowerCase();
    if (paid !== payment.expectedAmountPence || currency !== payment.currency) {
      payment.webhookReconciliationState = "amount_or_currency_mismatch";
      audit(state, "stripe_payment_reconciliation_failed", registration.id, { reason: "amount_or_currency_mismatch" }, at);
      return { ok: false, code: "PAYMENT_MISMATCH" };
    }
    if (event.type === "checkout.session.completed" && object.payment_status && object.payment_status !== "paid") {
      payment.status = "processing"; payment.webhookReconciliationState = "awaiting_async_payment"; payment.updatedAt = iso(at);
      state.processedPaymentEvents.push({ id: event.id, type: event.type, processedAt: iso(at) });
      audit(state, "stripe_payment_processing", registration.id, {}, at);
      return { ok: true, paymentStatus: payment.status, placeStatus: registration.placeStatus };
    }
    if (registration.placeStatus === "none" && capacitySummary(state).remaining < 1) {
      payment.status = "paid_capacity_conflict"; payment.webhookReconciliationState = "manual_review";
      audit(state, "stripe_payment_capacity_conflict", registration.id, {}, at);
      state.processedPaymentEvents.push({ id: event.id, type: event.type, processedAt: iso(at) });
      return { ok: false, code: "PAID_CAPACITY_CONFLICT" };
    }
    registration.placeStatus = "confirmed";
    payment.status = "paid"; payment.actualPaidAmountPence = paid; payment.paymentIntentId = typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id ?? payment.paymentIntentId;
    payment.completedAt = iso(at); payment.webhookReconciliationState = "reconciled";
    audit(state, "stripe_payment_confirmed", registration.id, { actualPaidAmountPence: paid, currency }, at);
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    if (payment.status !== "paid") {
      payment.status = event.type === "checkout.session.expired" ? "expired" : "failed";
      payment.webhookReconciliationState = "reconciled"; registration.placeStatus = "none";
      audit(state, event.type === "checkout.session.expired" ? "stripe_checkout_expired" : "stripe_payment_failed", registration.id, {}, at);
    }
  } else if (event.type === "charge.refunded") {
    payment.status = "refunded"; payment.refundState = "refunded"; payment.refundedAt = iso(at);
    registration.entryStatus = "place_released"; registration.placeStatus = "none";
    audit(state, "stripe_refund_reconciled", registration.id, {}, at);
  } else if (event.type === "refund.failed") {
    payment.refundState = "failed";
    audit(state, "stripe_refund_failed", registration.id, {}, at);
  }
  payment.updatedAt = iso(at); registration.updatedAt = iso(at);
  state.processedPaymentEvents.push({ id: event.id, type: event.type, processedAt: iso(at) });
  return { ok: true, paymentStatus: payment.status, placeStatus: registration.placeStatus };
}

export function runnerPaymentState(state, registrationId) {
  const payment = paymentFor(state, registrationId);
  if (!payment) return { ok: false, code: "NOT_FOUND" };
  const labels = { created: "Continue to payment", not_configured: "Continue to payment", checkout_pending: "Awaiting payment", processing: "Payment processing", paid: "Entry confirmed", failed: "Payment unsuccessful", abandoned: "Payment session expired", expired: "Payment session expired", refunded: "Refund completed" };
  return { ok: true, state: payment.status, label: labels[payment.status] ?? "Payment processing", canRetry: ["failed", "expired"].includes(payment.status) };
}

export function expireStalePaymentReservations(state, at = new Date()) {
  let expired = 0;
  for (const payment of state.payments.filter((item) => item.status === "checkout_pending" && new Date(item.checkoutExpiresAt) <= new Date(at))) {
    const registration = state.registrations.find((item) => item.id === payment.registrationId);
    payment.status = "expired"; payment.webhookReconciliationState = "locally_expired_awaiting_webhook"; payment.updatedAt = iso(at);
    if (registration && registration.placeStatus !== "confirmed") { registration.placeStatus = "none"; registration.updatedAt = iso(at); }
    audit(state, "payment_reservation_expired", payment.registrationId, {}, at); expired += 1;
  }
  return { ok: true, expired };
}

export function prepareApprovedStripeRefund(state, refundRequestId, actor, at = new Date()) {
  const request = state.refundRequests.find((item) => item.id === refundRequestId && item.status === "approved");
  const payment = paymentFor(state, request?.registrationId);
  const registration = state.registrations.find((item) => item.id === request?.registrationId && activeRegistration(item));
  if (!request || !payment || !registration || payment.status !== "paid" || payment.refundedRegistrationIds?.includes(registration.id)) return { ok: false, code: "REFUND_NOT_READY" };
  const partial = Boolean(payment.orderId);
  const refundAmountPence = partial ? registration.priceActuallyChargedPence : payment.expectedAmountPence;
  const alreadyRefunded = payment.refundedAmountPence ?? 0;
  if (!Number.isInteger(refundAmountPence) || alreadyRefunded + refundAmountPence > payment.expectedAmountPence) return { ok: false, code: "REFUND_CAP_EXCEEDED" };
  payment.refundState = "processing"; payment.updatedAt = iso(at);
  return { ok: true, partial, refundAmountPence, alreadyRefunded, paymentId: payment.id, paymentIntentId: payment.paymentIntentId, registrationId: registration.id, actorType: actor?.actorType ?? "organiser" };
}

export function completeApprovedStripeRefund(state, prepared, refund, at = new Date()) {
  const request = state.refundRequests.find((item) => item.id === prepared.refundRequestId && item.status === "approved");
  const payment = state.payments.find((item) => item.id === prepared.paymentId);
  const registration = state.registrations.find((item) => item.id === prepared.registrationId && activeRegistration(item));
  if (!request || !payment || !registration || payment.status !== "paid" || payment.refundedRegistrationIds?.includes(registration.id)) return { ok: false, code: "REFUND_NOT_READY" };
  if (!refund?.id || !["succeeded", "pending"].includes(refund.status)) return failApprovedStripeRefund(state, prepared, at);
  payment.refundId = refund.id; payment.refundState = refund.status === "succeeded" ? "refunded" : "pending"; payment.updatedAt = iso(at);
  request.status = refund.status === "succeeded" ? "refunded" : "approved";
  if (refund.status === "succeeded") {
    payment.refundedAmountPence = prepared.alreadyRefunded + prepared.refundAmountPence;
    payment.refundedRegistrationIds ??= []; payment.refundedRegistrationIds.push(registration.id);
    payment.status = payment.refundedAmountPence === payment.expectedAmountPence ? "refunded" : "paid";
    payment.refundedAt = iso(at); request.refundedAt = iso(at); request.placeReleasedAt = iso(at);
    const order = state.orders?.find((item) => item.id === payment.orderId); if (order) order.status = payment.status === "refunded" ? "refunded" : "partially_refunded";
    registration.entryStatus = "place_released"; registration.placeStatus = "none"; registration.updatedAt = iso(at);
    audit(state, "stripe_refund_completed", registration.id, { amountPence: prepared.refundAmountPence, orderStatus: order?.status ?? null }, at, prepared.actorType);
  }
  return { ok: true, refundState: payment.refundState, placeReleased: registration.placeStatus === "none", registrationId: registration.id };
}

export function failApprovedStripeRefund(state, prepared, at = new Date()) {
  const payment = state.payments.find((item) => item.id === prepared.paymentId);
  if (payment) { payment.refundState = "failed"; payment.updatedAt = iso(at); }
  audit(state, "stripe_refund_failed", prepared.registrationId, {}, at, prepared.actorType);
  return { ok: false, code: "REFUND_FAILED", placeReleased: false };
}

export async function executeApprovedStripeRefund(state, refundRequestId, gateway, actor, at = new Date()) {
  const prepared = prepareApprovedStripeRefund(state, refundRequestId, actor, at);
  if (!prepared.ok) return prepared;
  prepared.refundRequestId = refundRequestId;
  try {
    const refund = prepared.partial
      ? await gateway.createPartialRefund({ paymentIntentId: prepared.paymentIntentId, paymentId: prepared.paymentId, registrationId: prepared.registrationId, amountPence: prepared.refundAmountPence })
      : await gateway.createFullRefund({ paymentIntentId: prepared.paymentIntentId, paymentId: prepared.paymentId });
    return completeApprovedStripeRefund(state, prepared, refund, at);
  } catch {
    return failApprovedStripeRefund(state, prepared, at);
  }
}

export function dueWaitingListReminders(state, at = new Date()) {
  return state.waitingListOffers.filter((offer) => offer.status === "offered" && !offer.reminderSentAt && new Date(offer.reminderAt) <= new Date(at) && new Date(offer.expiresAt) > new Date(at));
}

export async function processScheduledRegistrationWork(state, { email, at = new Date(), actor = { authenticated: true, role: "administrator", actorType: "system" }, offerUrl = (token) => token } = {}) {
  const reminders = dueWaitingListReminders(state, at);
  for (const offer of reminders) {
    const waiting = state.waitingList.find((item) => item.id === offer.waitingListId);
    await email.send({ template: "waiting_list_reminder", intendedRecipientAddress: waiting.email, data: { firstName: waiting.firstName, expiresAt: offer.expiresAt } });
    offer.reminderSentAt = iso(at); audit(state, "waiting_list_reminder_sent", offer.id, {}, at);
  }
  const offers = expireWaitingListOffers(state, actor, at);
  if (offers.nextOffer) {
    const waiting = state.waitingList.find((item) => item.id === offers.nextOffer.offer.waitingListId);
    await email.send({ template: "waiting_list_offer", intendedRecipientAddress: waiting.email, data: { firstName: waiting.firstName, expiresAt: offers.nextOffer.offer.expiresAt, secureUrl: offerUrl(offers.nextOffer.token) } });
  }
  const payments = expireStalePaymentReservations(state, at);
  return { ok: true, reminders: reminders.length, expiredOffers: offers.expired, expiredPayments: payments.expired, nextOfferCreated: Boolean(offers.nextOffer) };
}
