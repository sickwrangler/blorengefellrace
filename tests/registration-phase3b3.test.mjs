import test from "node:test";
import assert from "node:assert/strict";
import { createAzureTableRepository, createMemoryRepository } from "../registration/server/repositories.mjs";
import { createDatabase } from "../registration/server/service.mjs";
import { OrderRegistrationService, DEFAULT_MAX_RUNNERS_PER_ORDER } from "../registration/server/order-service.mjs";
import { capacitySummary, decideRefund, requestRefund } from "../registration/server/phase3-domain.mjs";
import { createStripeGateway, executeApprovedStripeRefund } from "../registration/server/phase3-integrations.mjs";
import { createApi } from "../registration/server/api.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";

const start = new Date("2026-09-01T12:00:00Z");
const admin = { authenticated: true, role: "administrator", actorType: "organiser", id: "synthetic-organiser" };
const runner = (number, overrides = {}) => ({ email: `runner-${number}@example.com`, firstName: `Runner ${number}`, lastName: "Example", phone: "07700 900123", addressLine1: "1 Example Street", addressLine2: "", city: "Abergavenny", postcode: "NP7 5AA", raceCategory: number % 2 ? "Female" : "Male / Open", dateOfBirth: "1990-06-15", club: "Example Harriers", wfraMember: false, wfraMembershipNumber: "", emergencyContactName: "Contact Example", emergencyContactPhone: "07700 900456", acceptTerms: true, acceptPrivacy: true, ...overrides });
const declaration = (number) => ({ declarationIdentifier: "WFRA_SENIOR_ENTRY", declarationVersion: "21/02/23", accepted: true, typedFullName: `Runner ${number} Example`, signatoryRole: "Competitor", completedByNamedRunner: true });

function setup({ capacity = 120, memberPrice = null, draftRetentionHours = null } = {}) {
  const state = createDatabase({ environment: "development", registrationState: "test", capacity }); state.event.capacity = capacity; state.event.wfraMemberPricePence = memberPrice;
  const sent = []; const stripeCalls = { checkout: [], refund: [] };
  const stripeGateway = {
    async createOrderCheckoutSession(input) { stripeCalls.checkout.push(input); return { id: `cs_test_order_${stripeCalls.checkout.length}`, url: `https://checkout.stripe.test/group-${stripeCalls.checkout.length}`, expiresAt: new Date(new Date(input.at).getTime() + 30 * 60_000).toISOString() }; },
    async createPartialRefund(input) { stripeCalls.refund.push(input); return { id: `re_test_${stripeCalls.refund.length}`, status: "succeeded" }; }
  };
  const emailAdapter = { kind: "test", async send(message) { sent.push(message); return { delivery: "test", externalCall: false }; } };
  const repository = createMemoryRepository(state); const orders = new OrderRegistrationService({ repository, stripeGateway, emailAdapter, publicBaseUrl: "https://development.example", draftRetentionHours });
  return { repository, orders, sent, stripeCalls, stripeGateway };
}

async function createOrder(orders, purchaserEmail = "purchaser@example.com") { const created = await orders.createOrder({ purchaserEmail }, start); assert.equal(created.ok, true); return created; }
async function add(orders, token, number, mode = "later", overrides = {}) { return orders.addRunner(token, { runner: runner(number, overrides), declarationMode: mode, declaration: mode === "now" ? declaration(number) : null }, start); }
async function paidTwo() {
  const setupResult = setup(); const created = await createOrder(setupResult.orders); await add(setupResult.orders, created.orderToken, 1, "now"); await add(setupResult.orders, created.orderToken, 2, "later"); const checkout = await setupResult.orders.checkout(created.orderToken, start); assert.equal(checkout.ok, true);
  const event = { id: "evt_group_paid", type: "checkout.session.completed", data: { object: { id: "cs_test_order_1", amount_total: 1200, currency: "gbp", payment_status: "paid", payment_intent: "pi_test_group", metadata: { orderId: created.order.id } } } };
  assert.equal((await setupResult.orders.webhook(event, start)).ok, true); return { ...setupResult, created, checkout };
}

test("orders accept one to five runners and reject a sixth", async () => {
  const { orders } = setup(); const created = await createOrder(orders);
  for (let number = 1; number <= DEFAULT_MAX_RUNNERS_PER_ORDER; number += 1) assert.equal((await add(orders, created.orderToken, number)).ok, true);
  assert.equal((await add(orders, created.orderToken, 6)).code, "ORDER_RUNNER_LIMIT");
});

test("draft runners can be removed and recovered without reserving capacity", async () => {
  const { orders, repository } = setup(); const created = await createOrder(orders); const added = await add(orders, created.orderToken, 1, "now");
  assert.equal(capacitySummary(await repository.read()).remaining, 120);
  assert.equal((await orders.getOrder(created.orderToken)).order.runnerCount, 1);
  const removed = await orders.removeRunner(created.orderToken, added.order.registrations[0].id, start); assert.equal(removed.order.runnerCount, 0); assert.equal(capacitySummary(await repository.read()).remaining, 120);
});

test("draft runner details can be edited before payment", async () => {
  const { orders } = setup(); const created = await createOrder(orders); const added = await add(orders, created.orderToken, 1, "later"); const registrationId = added.order.registrations[0].id;
  const updated = await orders.updateRunner(created.orderToken, registrationId, { runner: runner(1, { club: "Updated Example Club" }), declarationMode: "later", declaration: null }, start);
  assert.equal(updated.ok, true); assert.equal(updated.order.registrations[0].runner.club, "Updated Example Club"); assert.equal(updated.order.registrations[0].id, registrationId);
});

test("adult emails are unique within an order and across active entries after normalisation", async () => {
  const { orders } = setup(); const first = await createOrder(orders); await add(orders, first.orderToken, 1);
  assert.equal((await add(orders, first.orderToken, 2, "later", { email: "RUNNER-1@EXAMPLE.COM" })).code, "DUPLICATE_ORDER_EMAIL");
  await orders.checkout(first.orderToken, start);
  const second = await createOrder(orders, "another-purchaser@example.com");
  assert.equal((await add(orders, second.orderToken, 3, "later", { email: "runner-1@example.com" })).code, "DUPLICATE_ACTIVE_ENTRY");
  assert.equal((await add(orders, second.orderToken, 4, "later", { email: "another-purchaser@example.com" })).ok, true);
});

test("under-18 runners remain blocked pending an approved guardian policy", async () => {
  const { orders } = setup(); const created = await createOrder(orders);
  const result = await add(orders, created.orderToken, 1, "later", { dateOfBirth: "2009-12-01" }); assert.equal(result.code, "VALIDATION_ERROR"); assert.ok(result.errors.dateOfBirth);
});

test("declaration may be completed now only by the named runner or deferred without blocking Checkout", async () => {
  const { orders, stripeCalls, repository } = setup(); const created = await createOrder(orders);
  const forged = await orders.addRunner(created.orderToken, { runner: runner(1), declarationMode: "now", declaration: { ...declaration(1), completedByNamedRunner: false } }, start); assert.equal(forged.code, "RUNNER_MUST_COMPLETE_DECLARATION");
  assert.equal((await add(orders, created.orderToken, 1, "now")).ok, true); assert.equal((await add(orders, created.orderToken, 2, "later")).ok, true);
  const checkout = await orders.checkout(created.orderToken, start); assert.equal(checkout.ok, true); assert.equal(checkout.totalPence, 1200); assert.deepEqual(stripeCalls.checkout[0].runnerPricesPence, [600, 600]); assert.equal(capacitySummary(await repository.read()).remaining, 118);
});

test("group pricing is server authoritative and supports a configured mixed price", async () => {
  const { orders } = setup({ memberPrice: 500 }); const created = await createOrder(orders);
  await add(orders, created.orderToken, 1, "later", { wfraMember: true, wfraMembershipNumber: "SYNTHETIC-1", priceActuallyChargedPence: 1 }); await add(orders, created.orderToken, 2);
  const checkout = await orders.checkout(created.orderToken, start); assert.equal(checkout.totalPence, 1100);
});

test("Stripe group Checkout contains server prices and minimal non-personal metadata", async () => {
  const calls = [];
  const stripe = {
    checkout: { sessions: { async create(input, options) { calls.push({ input, options }); return { id: "cs_test_group", url: "https://checkout.stripe.test/group" }; } } },
    webhooks: { constructEvent() {} },
    refunds: { async create() {} }
  };
  const gateway = createStripeGateway({ stripe, environment: "development", secretKey: "sk_test_example_only", webhookSecret: "whsec_example_only" });
  await gateway.createOrderCheckoutSession({ orderId: "order_test", paymentId: "payment_test", checkoutAttemptId: "attempt_test", runnerPricesPence: [600, 500], successUrl: "https://development.example/success", cancelUrl: "https://development.example/cancel", at: start });
  assert.deepEqual(calls[0].input.line_items.map((item) => item.price_data.unit_amount), [600, 500]);
  assert.deepEqual(calls[0].input.metadata, { orderId: "order_test", paymentId: "payment_test", runnerCount: "2" });
  assert.match(calls[0].options.idempotencyKey, /attempt_test$/);
  assert.equal(JSON.stringify(calls[0]).includes("runner-"), false);
  assert.equal(JSON.stringify(calls[0]).includes("emergency"), false);
});

test("v4 API exposes order routes and protects organiser declaration actions", async () => {
  const calls = [];
  const orders = {
    async createOrder(body) { calls.push(["create", body]); return { ok: true, order: { id: "order_test" }, orderToken: "opaque" }; },
    async getOrder(token) { calls.push(["get", token]); return { ok: true, order: { id: "order_test" } }; },
    async recordPaperDeclaration(actor, id) { calls.push(["paper", actor, id]); return actor.authenticated ? { ok: true } : { ok: false, code: "FORBIDDEN" }; }
  };
  const phase3Integrations = { orders, async organiserTransfer(actor, id) { calls.push(["transfer", actor, id]); return actor.authenticated ? { ok: true } : { ok: false, code: "FORBIDDEN" }; } };
  const api = createApi({ service: {}, phase3Integrations, environment: "development" });
  const created = await api({ method: "POST", pathname: "/api/v4/orders", body: { purchaserEmail: "synthetic@example.com" }, hostname: "development.example" });
  assert.equal(created.status, 201);
  const current = await api({ method: "GET", pathname: "/api/v4/orders/current", headers: { "x-order-token": "opaque" }, hostname: "development.example" });
  assert.equal(current.status, 200);
  const forbidden = await api({ method: "POST", pathname: "/api/v4/organiser/registrations/reg_test/declaration/paper", hostname: "development.example" });
  assert.equal(forbidden.status, 403);
  const transferForbidden = await api({ method: "POST", pathname: "/api/v4/organiser/registrations/reg_test/transfer", hostname: "development.example", body: { runner: runner(9) } }); assert.equal(transferForbidden.status, 403);
  assert.deepEqual(calls.map((item) => item[0]), ["create", "get", "paper", "transfer"]);
});

test("capacity reservation is all-or-nothing at the boundary", async () => {
  const two = setup({ capacity: 2 }); const orderTwo = await createOrder(two.orders); await add(two.orders, orderTwo.orderToken, 1); await add(two.orders, orderTwo.orderToken, 2); assert.equal((await two.orders.checkout(orderTwo.orderToken, start)).ok, true); assert.equal(capacitySummary(await two.repository.read()).remaining, 0);
  const three = setup({ capacity: 2 }); const orderThree = await createOrder(three.orders); await add(three.orders, orderThree.orderToken, 1); await add(three.orders, orderThree.orderToken, 2); await add(three.orders, orderThree.orderToken, 3); const failed = await three.orders.checkout(orderThree.orderToken, start); assert.equal(failed.code, "GROUP_CAPACITY_UNAVAILABLE"); assert.equal(capacitySummary(await three.repository.read()).remaining, 2);
});

test("concurrent group Checkouts cannot oversubscribe capacity", async () => {
  const { orders, repository } = setup({ capacity: 3 }); const first = await createOrder(orders); const second = await createOrder(orders, "second@example.com");
  await add(orders, first.orderToken, 1); await add(orders, first.orderToken, 2); await add(orders, second.orderToken, 3); await add(orders, second.orderToken, 4);
  const outcomes = await Promise.all([orders.checkout(first.orderToken, start), orders.checkout(second.orderToken, start)]); assert.equal(outcomes.filter((item) => item.ok).length, 1); assert.equal(capacitySummary(await repository.read()).reserved, 2);
});

test("one webhook confirms both entries exactly once while preserving declaration states", async () => {
  const { orders, repository, sent, created } = await paidTwo(); const state = await repository.read(); const registrations = state.registrations;
  assert.deepEqual(registrations.map((item) => item.placeStatus), ["confirmed", "confirmed"]); assert.deepEqual(registrations.map((item) => item.declarationStatus), ["complete", "pending"]); assert.equal(capacitySummary(state).remaining, 118);
  assert.equal(sent.filter((item) => item.template === "order_payment_confirmed").length, 1); assert.equal(sent.filter((item) => item.template === "entry_confirmed_declaration_required").length, 1);
  const replay = { id: "evt_group_paid", type: "checkout.session.completed", data: { object: { id: "cs_test_order_1", amount_total: 1200, currency: "gbp", payment_status: "paid", payment_intent: "pi_test_group", metadata: { orderId: created.order.id } } } }; assert.equal((await orders.webhook(replay, start)).duplicate, true);
});

test("secure declaration is registration-specific, idempotent and does not change payment or capacity", async () => {
  const { orders, repository, sent } = await paidTwo(); const message = sent.find((item) => item.template === "entry_confirmed_declaration_required"); const token = new URL(message.data.secureUrl).hash.split("token=")[1];
  const before = await repository.read(); const inspected = await orders.inspectDeclaration(token); assert.equal(inspected.registration.runner.firstName, "Runner 2");
  assert.equal((await orders.completeDeclaration(token, { accepted: true, typedFullName: "Runner 2 Example", completedByNamedRunner: true }, start)).ok, true);
  assert.equal((await orders.completeDeclaration(token, { accepted: true, typedFullName: "Runner 2 Example", completedByNamedRunner: true }, start)).duplicate, true);
  const after = await repository.read(); assert.equal(after.payments[0].status, before.payments[0].status); assert.equal(capacitySummary(after).remaining, capacitySummary(before).remaining); assert.equal(after.registrations[1].declarationCompletionMethod, "digital_remote");
});

test("order, management and declaration credentials remain isolated and hashed at rest", async () => {
  const { orders, repository, sent, created } = await paidTwo(); const state = await repository.read();
  assert.equal(JSON.stringify(state).includes(created.orderToken), false);
  const runnerMessages = sent.filter((item) => ["entry_confirmed", "entry_confirmed_declaration_required"].includes(item.template)); assert.equal(runnerMessages.length, 2);
  const managementUrls = runnerMessages.map((item) => item.data.managementUrl ?? item.data.secureUrl); assert.equal(new Set(managementUrls).size, 2);
  assert.equal(runnerMessages.some((item) => JSON.stringify(item).includes(created.orderToken)), false);
  const pendingMessage = runnerMessages.find((item) => item.template === "entry_confirmed_declaration_required"); const oldToken = new URL(pendingMessage.data.secureUrl).hash.split("token=")[1];
  const pending = state.registrations.find((item) => item.declarationStatus === "pending"); await orders.resendDeclaration(admin, pending.id, start); assert.equal((await orders.inspectDeclaration(oldToken)).code, "LINK_UNAVAILABLE");
});

test("declaration recovery is non-enumerating, rate-limited and rotates the secure link", async () => {
  const { orders, sent } = await paidTwo(); const before = sent.length;
  const matching = await orders.recoverDeclarationLink("runner-2@example.com", start); const missing = await orders.recoverDeclarationLink("missing@example.com", start);
  assert.deepEqual(matching, missing); assert.equal(sent.length, before + 1);
  await orders.recoverDeclarationLink("runner-2@example.com", start); await orders.recoverDeclarationLink("runner-2@example.com", start); await orders.recoverDeclarationLink("runner-2@example.com", start);
  assert.equal(sent.filter((item) => item.template === "declaration_reminder").length, 3);
});

test("organiser can record a paper declaration with an explicit audited action", async () => {
  const { orders, repository } = await paidTwo(); const state = await repository.read(); const pending = state.registrations.find((item) => item.declarationStatus === "pending");
  assert.equal((await orders.recordPaperDeclaration({ authenticated: false }, pending.id, start)).code, "FORBIDDEN"); assert.equal((await orders.recordPaperDeclaration(admin, pending.id, start)).ok, true);
  const after = await repository.read(); assert.equal(after.registrations.find((item) => item.id === pending.id).declarationCompletionMethod, "paper_in_person"); assert.ok(after.auditEvents.find((item) => item.action === "paper_declaration_received"));
});

test("individual partial refund releases one place and cannot exceed the order payment", async () => {
  const { repository, stripeGateway, stripeCalls } = await paidTwo(); const state = await repository.read(); const target = state.registrations[0]; const requested = requestRefund(state, target.id, { actorType: "runner" }, start); decideRefund(state, requested.request.id, "approved", admin, start);
  const result = await executeApprovedStripeRefund(state, requested.request.id, stripeGateway, admin, start); assert.equal(result.ok, true); assert.equal(stripeCalls.refund[0].amountPence, 600); assert.equal(target.placeStatus, "none"); assert.equal(state.registrations[1].placeStatus, "confirmed"); assert.equal(state.payments[0].status, "paid"); assert.equal(state.orders[0].status, "partially_refunded");
  assert.equal((await executeApprovedStripeRefund(state, requested.request.id, stripeGateway, admin, start)).code, "REFUND_NOT_READY");
});

test("Stripe refund and notification side effects are not repeated by Azure ETag retries", async () => {
  const paid = await paidTwo(); let stored = await paid.repository.read(); const target = stored.registrations[1];
  const requested = requestRefund(stored, target.id, { actorType: "runner" }, start); decideRefund(stored, requested.request.id, "approved", admin, start);
  let writes = 0; let etag = 1;
  const repository = createAzureTableRepository({
    async loadPartition() { return { state: structuredClone(stored), etag: String(etag) }; },
    async submitTransaction({ after }) {
      writes += 1;
      if (writes % 2 === 1) { const error = new Error("synthetic conflict"); error.statusCode = 412; throw error; }
      stored = structuredClone(after); etag += 1;
    }
  });
  const delivered = [];
  const phase3 = new Phase3IntegrationService({ repository, stripeGateway: paid.stripeGateway, emailAdapter: { kind: "test", async send(message) { delivered.push(message); return { delivery: "test", externalCall: false }; } }, publicBaseUrl: "https://development.example" });
  const result = await phase3.refund(admin, requested.request.id, start); const final = await repository.read();
  assert.equal(result.ok, true); assert.equal(paid.stripeCalls.refund.length, 1); assert.equal(delivered.filter((item) => item.template === "refund_completed").length, 1);
  assert.equal(final.registrations.find((item) => item.id === target.id).placeStatus, "none"); assert.equal(final.payments[0].refundedAmountPence, 600); assert.equal(capacitySummary(final).remaining, 119);
  assert.equal(final.communications.filter((item) => item.template === "refund_completed").length, 1); assert.equal(writes, 6);
});

test("Checkout expiry releases every runner and scheduler reminders stop after completion", async () => {
  const { orders, repository } = setup(); const created = await createOrder(orders); const added = await add(orders, created.orderToken, 1); await orders.checkout(created.orderToken, start);
  const expired = await orders.runScheduledWork(new Date("2026-09-01T12:31:00Z")); assert.equal(expired.abandonedOrders, 1); assert.equal(capacitySummary(await repository.read()).remaining, 120);
  const registrationId = added.order.registrations[0].id;
  assert.equal((await orders.updateRunner(created.orderToken, registrationId, { runner: runner(1, { club: "Edited after expiry" }), declarationMode: "later" }, new Date("2026-09-01T12:32:00Z"))).ok, true);
  assert.equal((await orders.removeRunner(created.orderToken, registrationId, new Date("2026-09-01T12:33:00Z"))).ok, true);
  const paid = await paidTwo(); const weekLater = await paid.orders.runScheduledWork(new Date("2026-09-08T12:01:00Z")); assert.equal(weekLater.declarationReminders, 1); assert.equal(paid.sent.filter((item) => item.template === "declaration_reminder").length, 1);
  const reminder = paid.sent.find((item) => item.template === "declaration_reminder"); const declarationToken = new URL(reminder.data.secureUrl).hash.split("token=")[1]; await paid.orders.completeDeclaration(declarationToken, { accepted: true, typedFullName: "Runner 2 Example", completedByNamedRunner: true }, new Date("2026-09-08T12:02:00Z"));
  assert.equal((await paid.orders.runScheduledWork(new Date("2026-11-26T12:00:00Z"))).declarationReminders, 0);
});

test("draft cleanup is available only with an explicitly configured retention period", async () => {
  const disabled = setup(); const first = await createOrder(disabled.orders); await add(disabled.orders, first.orderToken, 1); assert.equal((await disabled.orders.runScheduledWork(new Date("2026-09-03T12:00:00Z"))).abandonedOrders, 0);
  const enabled = setup({ draftRetentionHours: 24 }); const second = await createOrder(enabled.orders); await add(enabled.orders, second.orderToken, 2); assert.equal((await enabled.orders.runScheduledWork(new Date("2026-09-03T12:00:00Z"))).abandonedOrders, 1); assert.equal((await enabled.orders.getOrder(second.orderToken)).code, "ORDER_TOKEN_INVALID");
});

test("secure order recovery reuses a valid Checkout and safely replaces an expired one", async () => {
  const { orders, repository, stripeCalls } = setup({ capacity: 4 }); const created = await createOrder(orders); await add(orders, created.orderToken, 1); await add(orders, created.orderToken, 2);
  const first = await orders.checkout(created.orderToken, start); assert.equal(first.ok, true); assert.equal(capacitySummary(await repository.read()).remaining, 2);
  const freshBrowser = await orders.getOrder(created.orderToken); assert.equal(freshBrowser.order.paymentRequired, true); assert.equal(freshBrowser.order.canContinuePayment, true);
  const resumed = await orders.checkout(created.orderToken, new Date("2026-09-01T12:10:00Z")); assert.equal(resumed.duplicate, true); assert.equal(resumed.checkoutUrl, first.checkoutUrl); assert.equal(stripeCalls.checkout.length, 1);
  const replacement = await orders.checkout(created.orderToken, new Date("2026-09-01T12:31:00Z")); assert.equal(replacement.ok, true); assert.notEqual(replacement.checkoutUrl, first.checkoutUrl); assert.equal(stripeCalls.checkout.length, 2);
  const state = await repository.read(); assert.equal(state.payments.length, 1); assert.deepEqual(state.payments[0].checkoutAttempts.map((attempt) => attempt.status), ["expired", "active"]); assert.equal(capacitySummary(state).remaining, 2);
  assert.notEqual(stripeCalls.checkout[0].checkoutAttemptId, stripeCalls.checkout[1].checkoutAttemptId);
});

test("expired order retry recalculates price and revalidates all-or-nothing capacity", async () => {
  const setupResult = setup({ capacity: 3 }); const created = await createOrder(setupResult.orders); await add(setupResult.orders, created.orderToken, 1); await add(setupResult.orders, created.orderToken, 2); await setupResult.orders.checkout(created.orderToken, start);
  await setupResult.repository.transaction((state) => { state.event.capacity = 1; return { ok: true }; });
  const rejected = await setupResult.orders.checkout(created.orderToken, new Date("2026-09-01T12:31:00Z")); assert.equal(rejected.code, "GROUP_CAPACITY_UNAVAILABLE"); assert.equal(rejected.availablePlaces, 1); assert.equal(setupResult.stripeCalls.checkout.length, 1); assert.equal(capacitySummary(await setupResult.repository.read()).reserved, 0);
});

test("organiser transfer preserves payment/place, revokes old links and resets declaration", async () => {
  const paid = await paidTwo(); const before = await paid.repository.read(); const target = before.registrations[1]; const oldRunnerId = target.runnerId; const paymentId = before.payments[0].id;
  const priorMessage = paid.sent.find((item) => item.template === "entry_confirmed_declaration_required"); const oldManagementToken = new URL(priorMessage.data.managementUrl).hash.split("token=")[1]; const oldDeclarationToken = new URL(priorMessage.data.secureUrl).hash.split("token=")[1];
  const phase3 = new Phase3IntegrationService({ repository: paid.repository, stripeGateway: paid.stripeGateway, emailAdapter: { kind: "test", async send(message) { paid.sent.push(message); return { delivery: "test", externalCall: false }; } }, publicBaseUrl: "https://development.example" });
  const amended = await phase3.amend(oldManagementToken, { phone: "07700 900999", club: "Corrected Club" }, start); assert.equal(amended.ok, true); assert.equal((await paid.repository.read()).registrations[1].runnerId, oldRunnerId);
  const transferred = await phase3.organiserTransfer(admin, target.id, { runner: runner(3) }, start); assert.equal(transferred.ok, true); assert.equal("replacementManagementToken" in transferred, false);
  assert.equal((await phase3.managementEntry(oldManagementToken, start)).code, "MANAGEMENT_TOKEN_INVALID"); assert.equal((await paid.orders.inspectDeclaration(oldDeclarationToken)).code, "LINK_UNAVAILABLE");
  const after = await paid.repository.read(); const registration = after.registrations.find((item) => item.id === target.id);
  assert.notEqual(registration.runnerId, oldRunnerId); assert.equal(registration.placeStatus, "confirmed"); assert.equal(registration.declarationStatus, "pending"); assert.equal(after.payments[0].id, paymentId); assert.equal(after.payments[0].status, "paid");
  assert.ok(after.auditEvents.find((item) => item.action === "runner_details_amended")); assert.ok(after.auditEvents.find((item) => item.action === "organiser_entry_transferred" && item.after.cutoffOverride === false));
  const newDeclaration = [...paid.sent].reverse().find((item) => item.template === "declaration_reminder" && item.registrationId === target.id); const newDeclarationToken = new URL(newDeclaration.data.secureUrl).hash.split("token=")[1];
  assert.equal((await paid.orders.completeDeclaration(newDeclarationToken, { accepted: true, typedFullName: "Runner 3 Example", completedByNamedRunner: true }, start)).ok, true);
  const complete = await paid.repository.read(); assert.equal(complete.registrations.find((item) => item.id === target.id).declarationStatus, "complete"); assert.equal(complete.payments[0].status, "paid");
});

test("organiser transfer after cutoff requires an explicit audited override", async () => {
  const paid = await paidTwo(); const state = await paid.repository.read(); const target = state.registrations[0];
  const phase3 = new Phase3IntegrationService({ repository: paid.repository, stripeGateway: paid.stripeGateway, emailAdapter: { kind: "test", async send(message) { paid.sent.push(message); return { delivery: "test", externalCall: false }; } }, publicBaseUrl: "https://development.example" });
  const afterCutoff = new Date("2026-12-01T12:00:00Z"); assert.equal((await phase3.organiserTransfer(admin, target.id, { runner: runner(4) }, afterCutoff)).code, "ORGANISER_OVERRIDE_REQUIRED");
  assert.equal((await phase3.organiserTransfer(admin, target.id, { runner: runner(4), overrideCutoff: true }, afterCutoff)).ok, true);
  const final = await paid.repository.read(); assert.ok(final.auditEvents.find((item) => item.action === "organiser_entry_transferred" && item.after.cutoffOverride === true));
});
