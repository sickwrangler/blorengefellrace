import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  createPhase3State, beginProductionRegistration, addPlaceRegistration, capacitySummary,
  joinWaitingList, createNextWaitingListOffer, requestRefund, decideRefund
} from "../registration/server/phase3-domain.mjs";
import {
  CHECKOUT_RESERVATION_MINUTES, assertStripeDevelopmentConfiguration, createStripeGateway,
  beginStripeCheckout, reconcileStripeEvent, runnerPaymentState, expireStalePaymentReservations,
  executeApprovedStripeRefund, dueWaitingListReminders, processScheduledRegistrationWork
} from "../registration/server/phase3-integrations.mjs";
import { createControlledDevelopmentEmail } from "../registration/server/development-email.mjs";
import { REGISTRATION_EMAIL_TEMPLATE_NAMES, renderRegistrationEmail } from "../registration/server/email-templates.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { createApi } from "../registration/server/api.mjs";

const at = new Date("2026-10-01T12:00:00.000Z");
const admin = { authenticated: true, role: "Organiser", actorType: "organiser", id: "organiser-test" };
const runner = (number = 1, overrides = {}) => ({ email: `runner-${number}@example.com`, firstName: `Runner ${number}`, lastName: "Example", phone: "07700 900123", addressLine1: "1 Example Street", addressLine2: "", city: "Abergavenny", postcode: "NP7 5AA", raceCategory: "Female", dateOfBirth: "1990-06-15", club: "Example Harriers", wfraMember: false, wfraMembershipNumber: "", emergencyContactName: "Contact Example", emergencyContactPhone: "07700 900456", ...overrides });
const declaration = (number = 1) => ({ declarationIdentifier: "WFRA_SENIOR_ENTRY", declarationVersion: "21/02/23", accepted: true, typedFullName: `Runner ${number} Example`, signatoryRole: "Competitor" });

function fakeStripe({ refundStatus = "succeeded" } = {}) {
  const calls = { checkout: [], refund: [] };
  return {
    calls,
    checkout: { sessions: { async create(input, options) { calls.checkout.push({ input, options }); return { id: `cs_test_${calls.checkout.length}`, url: `https://checkout.stripe.test/${calls.checkout.length}` }; } } },
    webhooks: { constructEvent(raw, signature, secret) { const expected = crypto.createHmac("sha256", secret).update(String(raw)).digest("hex"); if (signature !== expected) throw new Error("bad signature"); return JSON.parse(String(raw)); } },
    refunds: { async create(input, options) { calls.refund.push({ input, options }); if (refundStatus === "throw") throw new Error("provider failed"); return { id: "re_test_1", status: refundStatus }; } }
  };
}

function gateway(options = {}) {
  const stripe = fakeStripe(options);
  return { stripe, gateway: createStripeGateway({ stripe, environment: "development", secretKey: "sk_test_example_only", webhookSecret: "whsec_example_only" }) };
}

function registeredState({ capacity = 120, wfraMemberPricePence = null, person = runner() } = {}) {
  const state = createPhase3State({ registrationState: "OPEN", wfraMemberPricePence }); state.event.capacity = capacity;
  const created = beginProductionRegistration(state, { runner: person, declaration: declaration() }, { at });
  assert.equal(created.ok, true);
  return { state, registration: created.registration, payment: state.payments[0] };
}

async function checkedOut(options = {}) {
  const current = registeredState(options); const provider = gateway();
  const checkout = await beginStripeCheckout(current.state, current.registration.id, provider.gateway, { successUrl: "https://development.example/success", cancelUrl: "https://development.example/cancel", at });
  assert.equal(checkout.ok, true);
  return { ...current, ...provider, checkout };
}

function stripeEvent(type, payment, overrides = {}, id = `evt_${type.replaceAll(".", "_")}`) {
  return { id, type, data: { object: { id: payment.checkoutSessionId, amount_total: payment.expectedAmountPence, currency: "gbp", payment_status: "paid", payment_intent: "pi_test_1", ...overrides } } };
}

test("development accepts only Stripe test credentials and has no browser mode switch", () => {
  assert.deepEqual(assertStripeDevelopmentConfiguration({ environment: "development", secretKey: "sk_test_example", webhookSecret: "whsec_example" }), { mode: "test" });
  for (const secretKey of ["sk_live_forbidden", "rk_live_forbidden", "pk_test_not_server_secret", ""]) assert.throws(() => assertStripeDevelopmentConfiguration({ environment: "development", secretKey, webhookSecret: "whsec_example" }));
  assert.throws(() => assertStripeDevelopmentConfiguration({ environment: "production", secretKey: "sk_test_example", webhookSecret: "whsec_example" }));
  const browserSource = fs.readFileSync("registration/prototype-client.mjs", "utf8");
  assert.equal(/stripe.*(?:mode|live|test).*searchParams/i.test(browserSource), false);
});

test("Checkout uses the authoritative £6 GBP price and deliberate 30-minute expiry", async () => {
  const { payment, stripe, checkout } = await checkedOut();
  const call = stripe.calls.checkout[0];
  assert.equal(call.input.line_items[0].price_data.unit_amount, 600); assert.equal(call.input.line_items[0].price_data.currency, "gbp");
  assert.equal(call.input.expires_at, Math.floor(at.getTime() / 1000) + CHECKOUT_RESERVATION_MINUTES * 60);
  assert.equal(payment.expectedAmountPence, 600); assert.equal(payment.currency, "gbp"); assert.equal(checkout.expiresAt, "2026-10-01T12:30:00.000Z");
});

test("configured WFRA price is server-authoritative and browser amount fields are ignored", async () => {
  const person = runner(1, { wfraMember: true, wfraMembershipNumber: "WFRA A-12", amount: 1, priceActuallyChargedPence: 1 });
  const { stripe, payment } = await checkedOut({ wfraMemberPricePence: 500, person });
  assert.equal(stripe.calls.checkout[0].input.line_items[0].price_data.unit_amount, 500);
  assert.equal(payment.wfraDiscountApplied, true); assert.equal(payment.adjustmentReason, "WFRA_MEMBER_SELF_DECLARED");
});

test("duplicate Checkout attempts reuse one active reservation and one provider session", async () => {
  const { state, registration, gateway: stripeGateway, stripe, checkout } = await checkedOut();
  const duplicate = await beginStripeCheckout(state, registration.id, stripeGateway, { successUrl: "https://development.example/success", cancelUrl: "https://development.example/cancel", at: new Date("2026-10-01T12:05:00Z") });
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.checkoutUrl, checkout.checkoutUrl); assert.equal(stripe.calls.checkout.length, 1); assert.equal(capacitySummary(state).reserved, 1);
});

test("under-18 entrants cannot reach Checkout", async () => {
  const state = createPhase3State({ registrationState: "OPEN" });
  state.runners.push({ id: "runner_under18", ...runner(2, { dateOfBirth: "2009-12-01" }) });
  const registration = addPlaceRegistration(state, { runnerId: "runner_under18" }, admin, at).registration;
  state.payments.push({ id: "payment_under18", registrationId: registration.id, status: "not_configured", priceActuallyChargedPence: 600 });
  assert.equal((await beginStripeCheckout(state, registration.id, gateway().gateway, { successUrl: "https://development.example/s", cancelUrl: "https://development.example/c", at })).code, "PARENTAL_CONSENT_REQUIREMENTS_PENDING");
});

test("verified successful webhooks confirm payment; browser return only reads server state", async () => {
  const { state, payment, registration, gateway: stripeGateway } = await checkedOut();
  assert.equal(runnerPaymentState(state, registration.id).label, "Awaiting payment");
  const event = stripeEvent("checkout.session.completed", payment);
  const raw = JSON.stringify(event); const signature = crypto.createHmac("sha256", "whsec_example_only").update(raw).digest("hex");
  const verified = stripeGateway.verifyWebhook(raw, signature);
  assert.equal(reconcileStripeEvent(state, verified, { at }).ok, true);
  assert.equal(payment.status, "paid"); assert.equal(payment.actualPaidAmountPence, 600); assert.equal(registration.placeStatus, "confirmed"); assert.equal(runnerPaymentState(state, registration.id).label, "Entry confirmed");
});

test("invalid signatures and tampered webhook bodies fail closed", async () => {
  const { payment, gateway: stripeGateway } = await checkedOut(); const event = stripeEvent("checkout.session.completed", payment); const raw = JSON.stringify(event);
  assert.throws(() => stripeGateway.verifyWebhook(raw, "incorrect"));
  const signature = crypto.createHmac("sha256", "whsec_example_only").update(raw).digest("hex");
  assert.throws(() => stripeGateway.verifyWebhook(`${raw} `, signature));
});

test("duplicate webhooks are idempotent and do not duplicate audit effects", async () => {
  const { state, payment } = await checkedOut(); const event = stripeEvent("checkout.session.completed", payment);
  assert.equal(reconcileStripeEvent(state, event, { at }).ok, true); const count = state.auditEvents.length;
  assert.equal(reconcileStripeEvent(state, event, { at }).duplicate, true); assert.equal(state.auditEvents.length, count);
});

test("asynchronous payment events reconcile safely after Checkout completion", async () => {
  const { state, payment, registration } = await checkedOut();
  const processing = stripeEvent("checkout.session.completed", payment, { payment_status: "unpaid" }, "evt_processing");
  assert.equal(reconcileStripeEvent(state, processing, { at }).paymentStatus, "processing"); assert.equal(registration.placeStatus, "payment_reserved");
  const succeeded = stripeEvent("checkout.session.async_payment_succeeded", payment, { payment_status: "paid" }, "evt_async_success");
  assert.equal(reconcileStripeEvent(state, succeeded, { at }).paymentStatus, "paid"); assert.equal(registration.placeStatus, "confirmed");
});

test("Checkout expiry and asynchronous failure release reservations for safe retry", async () => {
  for (const type of ["checkout.session.expired", "checkout.session.async_payment_failed"]) {
    const { state, payment, registration, gateway: stripeGateway } = await checkedOut();
    assert.equal(reconcileStripeEvent(state, stripeEvent(type, payment), { at }).ok, true);
    assert.equal(registration.placeStatus, "none"); assert.equal(runnerPaymentState(state, registration.id).canRetry, true);
    const retried = await beginStripeCheckout(state, registration.id, stripeGateway, { successUrl: "https://development.example/s", cancelUrl: "https://development.example/c", at: new Date("2026-10-01T12:31:00Z") });
    assert.equal(retried.ok, true); assert.equal(registration.placeStatus, "payment_reserved");
  }
});

test("local stale-reservation processing releases capacity without relying on a browser", async () => {
  const { state, registration } = await checkedOut();
  assert.equal(expireStalePaymentReservations(state, new Date("2026-10-01T12:31:00Z")).expired, 1);
  assert.equal(registration.placeStatus, "none"); assert.equal(capacitySummary(state).remaining, 120);
});

test("successful full refund releases a place while failed refund retains it", async () => {
  for (const refundStatus of ["succeeded", "throw"]) {
    const { state, payment, registration } = await checkedOut(); reconcileStripeEvent(state, stripeEvent("checkout.session.completed", payment), { at });
    const requested = requestRefund(state, registration.id, { actorType: "runner" }, at); decideRefund(state, requested.request.id, "approved", admin, at);
    const result = await executeApprovedStripeRefund(state, requested.request.id, gateway({ refundStatus }).gateway, admin, at);
    assert.equal(result.ok, refundStatus === "succeeded"); assert.equal(registration.placeStatus, refundStatus === "succeeded" ? "none" : "confirmed");
  }
});

test("amount mismatch cannot confirm an entry", async () => {
  const { state, payment, registration } = await checkedOut();
  assert.equal(reconcileStripeEvent(state, stripeEvent("checkout.session.completed", payment, { amount_total: 1 }), { at }).code, "PAYMENT_MISMATCH");
  assert.notEqual(registration.placeStatus, "confirmed"); assert.notEqual(payment.status, "paid");
});

test("all production-quality email templates render without duplicated Welsh content", () => {
  assert.equal(REGISTRATION_EMAIL_TEMPLATE_NAMES.length, 16);
  for (const name of REGISTRATION_EMAIL_TEMPLATE_NAMES) {
    const rendered = renderRegistrationEmail(name, { intendedRecipientAddress: "runner@example.com", secureUrl: "https://example.test/secure", expiresAt: "2026-10-03T12:00:00Z" });
    assert.ok(rendered.subject && rendered.text && rendered.html); assert.equal(/Cymraeg|Cyfeiriad|Cofrestru/.test(rendered.text), false);
  }
});

test("ACS development adapter redirects only to configured safe recipients", async () => {
  const sent = []; const email = createControlledDevelopmentEmail({ senderAddress: "sender@example.test", safeRecipients: ["safe@example.test"], transport: { async send(message) { sent.push(message); return { id: "acs_test_1" }; } } });
  const result = await email.send({ template: "entry_confirmed", intendedRecipientAddress: "arbitrary.runner@example.com", data: {} });
  assert.deepEqual(sent[0].recipients, ["safe@example.test"]); assert.ok(sent[0].text.includes("arbitrary.runner@example.com"));
  assert.deepEqual(result.actualRecipients, ["configured-safe-recipient"]); assert.equal(JSON.stringify(result).includes("safe@example.test"), false);
});

test("missing ACS delivery configuration fails closed to captured-only", async () => {
  const email = createControlledDevelopmentEmail(); const result = await email.send({ template: "entry_confirmed", intendedRecipientAddress: "runner@example.com", data: {} });
  assert.equal(email.kind, "captured-only"); assert.equal(result.externalCall, false); assert.deepEqual(result.actualRecipients, []);
});

test("waiting-list reminders and expiry are scheduled cheaply in domain logic", async () => {
  const state = createPhase3State({ registrationState: "OPEN" });
  joinWaitingList(state, { firstName: "Alys", lastName: "Example", email: "alys@example.com" }, { at });
  joinWaitingList(state, { firstName: "Bryn", lastName: "Example", email: "bryn@example.com" }, { at });
  createNextWaitingListOffer(state, admin, at);
  const reminderTime = new Date("2026-10-02T12:01:00Z"); assert.equal(dueWaitingListReminders(state, reminderTime).length, 1);
  const messages = []; const email = { async send(message) { messages.push(message); return { externalCall: false }; } };
  const reminded = await processScheduledRegistrationWork(state, { email, at: reminderTime, actor: admin });
  assert.equal(reminded.reminders, 1); assert.equal(messages[0].template, "waiting_list_reminder");
  const expired = await processScheduledRegistrationWork(state, { email, at: new Date("2026-10-03T12:01:00Z"), actor: admin });
  assert.equal(expired.expiredOffers, 1); assert.equal(expired.nextOfferCreated, true); assert.equal(state.waitingListOffers[1].status, "offered");
  assert.deepEqual(messages.slice(-2).map((message) => message.template), ["waiting_list_expired", "waiting_list_offer"]);
});

test("capacity counts payment and offer reservations and never exceeds the final place", async () => {
  const state = createPhase3State({ registrationState: "OPEN" }); state.event.capacity = 1;
  const first = beginProductionRegistration(state, { runner: runner(1), declaration: declaration(1) }, { at }); assert.equal(first.ok, true);
  joinWaitingList(state, { firstName: "Waiting", lastName: "Runner", email: "waiting@example.com" }, { at });
  assert.equal(createNextWaitingListOffer(state, admin, at).code, "CAPACITY_FULL");
  assert.equal(beginProductionRegistration(state, { runner: runner(2), declaration: declaration(2) }, { at }).code, "CAPACITY_FULL");
  assert.equal(capacitySummary(state).reserved, 1);
});

test("source and audit structures do not log credentials or secure URLs", () => {
  const sources = ["registration/server/phase3-integrations.mjs", "registration/server/development-email.mjs", "api/src/providers.mjs"].map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.equal(/console\.(?:log|info|warn|error)\s*\(/.test(sources), false);
  assert.equal(/sk_(?:test|live)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}/.test(sources), false);
  assert.equal(sources.includes("checkoutUrl"), true);
});

test("v3 API keeps integrations unavailable until explicitly configured", async () => {
  const api = createApi({ service: {}, phase3Integrations: null, environment: "development" });
  const result = await api({ method: "POST", pathname: "/api/v3/payments/checkout", headers: { "x-management-token": "not-a-token" } });
  assert.equal(result.status, 503); assert.deepEqual(result.body, { ok: false, code: "INTEGRATION_NOT_CONFIGURED" });
});

test("configured Phase 3 routes report disabled providers and cannot make external calls", async () => {
  const state = createPhase3State({ environment: "development", registrationState: "OPEN" });
  const created = beginProductionRegistration(state, { runner: runner(), declaration: declaration() }, { at });
  const phase3 = new Phase3IntegrationService({ repository: createMemoryRepository(state), emailAdapter: createControlledDevelopmentEmail() });
  const api = createApi({ service: {}, phase3Integrations: phase3, environment: "development" });
  const integrationStatus = await api({ method: "GET", pathname: "/api/v3/registration/status" });
  assert.deepEqual(integrationStatus.body, { ok: true, environment: "development", stripe: "disabled", paymentsAvailable: false, email: "captured-only", externalEmailAvailable: false });
  const checkout = await api({ method: "POST", pathname: "/api/v3/payments/checkout", headers: { "x-management-token": created.managementToken } });
  assert.equal(checkout.status, 503); assert.deepEqual(checkout.body, { ok: false, code: "PAYMENTS_UNAVAILABLE" });
  const webhook = await api({ method: "POST", pathname: "/api/v3/stripe/webhook", headers: { "stripe-signature": "untrusted" }, body: { rawBody: "{}" } });
  assert.equal(webhook.status, 503); assert.deepEqual(webhook.body, { ok: false, code: "INTEGRATION_NOT_CONFIGURED" });
});

test("v3 Checkout/status and raw signed webhook routes use the Phase 3 integration service", async () => {
  const state = createPhase3State({ environment: "development", registrationState: "OPEN" });
  const created = beginProductionRegistration(state, { runner: runner(), declaration: declaration() }, { at });
  const provider = gateway();
  const phase3 = new Phase3IntegrationService({ repository: createMemoryRepository(state), stripeGateway: provider.gateway, emailAdapter: createControlledDevelopmentEmail(), publicBaseUrl: "https://development.example" });
  const api = createApi({ service: {}, phase3Integrations: phase3, environment: "development" });
  const checkout = await api({ method: "POST", pathname: "/api/v3/payments/checkout", headers: { "x-management-token": created.managementToken } });
  assert.equal(checkout.status, 200); assert.equal(provider.stripe.calls.checkout.length, 1);
  const storedPayment = (await phase3.repository.read()).payments[0]; const event = stripeEvent("checkout.session.completed", storedPayment);
  const rawBody = JSON.stringify(event); const signature = crypto.createHmac("sha256", "whsec_example_only").update(rawBody).digest("hex");
  const webhook = await api({ method: "POST", pathname: "/api/v3/stripe/webhook", headers: { "stripe-signature": signature }, body: { rawBody } });
  assert.equal(webhook.status, 200);
  const status = await api({ method: "GET", pathname: "/api/v3/payments/status", headers: { "x-management-token": created.managementToken } });
  assert.equal(status.body.label, "Entry confirmed"); assert.equal(JSON.stringify(status.body).includes("cs_test_"), false);
});

test("secure runner refund request requires organiser approval before one full Stripe refund", async () => {
  const fresh = createPhase3State({ environment: "development", registrationState: "OPEN" });
  const created = beginProductionRegistration(fresh, { runner: runner(7), declaration: declaration(7) }, { at });
  const provider = gateway();
  const phase3 = new Phase3IntegrationService({ repository: createMemoryRepository(fresh), stripeGateway: provider.gateway, emailAdapter: createControlledDevelopmentEmail(), publicBaseUrl: "https://development.example" });
  await phase3.checkout(created.managementToken, at);
  const storedPayment = (await phase3.repository.read()).payments[0];
  const event = stripeEvent("checkout.session.completed", storedPayment); const raw = JSON.stringify(event);
  await phase3.webhook(raw, crypto.createHmac("sha256", "whsec_example_only").update(raw).digest("hex"), at);
  const requested = await phase3.requestRefund(created.managementToken, at);
  const duplicate = await phase3.requestRefund(created.managementToken, at);
  assert.equal(requested.ok, true); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.request.id, requested.request.id);
  assert.equal((await phase3.refund(admin, requested.request.id, at)).code, "REFUND_NOT_READY");
  assert.equal((await phase3.decideRefund(admin, requested.request.id, "approved", at)).ok, true);
  const refunded = await phase3.refund(admin, requested.request.id, at);
  const finalState = await phase3.repository.read();
  assert.equal(refunded.ok, true); assert.equal(provider.stripe.calls.refund.length, 1);
  assert.equal(finalState.payments[0].expectedAmountPence, 600); assert.equal(finalState.payments[0].status, "refunded");
  assert.equal(finalState.registrations[0].placeStatus, "none"); assert.equal(capacitySummary(finalState).remaining, 120);
  assert.ok(finalState.auditEvents.some((event) => event.action === "refund_requested"));
  assert.ok(finalState.auditEvents.some((event) => event.action === "refund_approved"));
  assert.ok(finalState.auditEvents.some((event) => event.action === "stripe_refund_completed"));
});

test("v3 refund request and organiser decision routes preserve the authentication boundary", async () => {
  const state = createPhase3State({ environment: "development", registrationState: "OPEN" });
  const created = beginProductionRegistration(state, { runner: runner(8), declaration: declaration(8) }, { at });
  const provider = gateway();
  const phase3 = new Phase3IntegrationService({ repository: createMemoryRepository(state), stripeGateway: provider.gateway, emailAdapter: createControlledDevelopmentEmail() });
  await phase3.checkout(created.managementToken, at);
  const payment = (await phase3.repository.read()).payments[0]; const event = stripeEvent("checkout.session.completed", payment); const raw = JSON.stringify(event);
  await phase3.webhook(raw, crypto.createHmac("sha256", "whsec_example_only").update(raw).digest("hex"), at);
  const api = createApi({ service: {}, phase3Integrations: phase3, environment: "local" });
  const requested = await api({ method: "POST", pathname: "/api/v3/refunds/request", hostname: "127.0.0.1", headers: { "x-management-token": created.managementToken } });
  assert.equal(requested.status, 201);
  const anonymous = await api({ method: "POST", pathname: `/api/v3/organiser/refunds/${requested.body.request.id}/approve`, hostname: "127.0.0.1" });
  assert.equal(anonymous.status, 403);
  const approved = await api({ method: "POST", pathname: `/api/v3/organiser/refunds/${requested.body.request.id}/approve`, hostname: "127.0.0.1", headers: { "x-development-organiser": "enabled" } });
  assert.equal(approved.status, 200); assert.equal(approved.body.request.status, "approved");
});

test("v3 public Checkout is rate limited and invalid webhook signatures return a client error", async () => {
  const phase3Integrations = {
    async checkout() { return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" }; },
    async webhook() { return { ok: false, code: "INVALID_WEBHOOK_SIGNATURE" }; }
  };
  const api = createApi({ service: {}, phase3Integrations, environment: "development" });
  const webhook = await api({ method: "POST", pathname: "/api/v3/stripe/webhook", headers: { "stripe-signature": "invalid" }, body: { rawBody: "{}" } });
  assert.equal(webhook.status, 400);
  let checkout;
  for (let attempt = 0; attempt < 31; attempt += 1) checkout = await api({ method: "POST", pathname: "/api/v3/payments/checkout", hostname: "example.test", headers: { "x-management-token": "invalid" } });
  assert.equal(checkout.status, 429); assert.equal(checkout.body.code, "RATE_LIMITED");
});
