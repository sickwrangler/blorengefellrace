#!/usr/bin/env node
// Exercise staged production modules locally using memory state and signed synthetic events.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { createProductionApi } from "../.deployment/production-registration/api/src/shared/server/production-api.mjs";
import { Phase3IntegrationService } from "../.deployment/production-registration/api/src/shared/server/phase3-service.mjs";
import { ProductionRegistrationService } from "../.deployment/production-registration/api/src/shared/server/production-service.mjs";
import { createProductionBootstrap } from "../.deployment/production-registration/api/src/shared/server/production-bootstrap.mjs";
import { createMemoryRepository } from "../.deployment/production-registration/api/src/shared/server/repositories.mjs";
import { createStripeGateway } from "../.deployment/production-registration/api/src/shared/server/phase3-integrations.mjs";
import { Phase3IntegrationService as SchedulerService } from "../.deployment/production-registration-scheduler/src/shared/server/phase3-service.mjs";
import { createProductionSchedulerHandler } from "../.deployment/production-registration-scheduler/src/production-scheduler.mjs";
const Stripe = createRequire(new URL("../api/package.json", import.meta.url))(
  "stripe",
);
const stripe = new Stripe("sk_test_synthetic");
const webhookSecret = "whsec_synthetic";
const at = new Date("2026-11-17T12:00:00Z");
const state = createProductionBootstrap();
state.registrationState = state.phase3RegistrationState = "PRIVATE_LIVE";
state.runners = [
  {
    id: "runner",
    firstName: "Synthetic",
    lastName: "Runner",
    email: "runner@example.com",
  },
];
state.registrations = [
  {
    id: "reg",
    runnerId: "runner",
    entryStatus: "accepted",
    placeStatus: "confirmed",
    createdAt: at.toISOString(),
  },
];
state.payments = [
  { id: "old-order-payment", orderId: "old-order", status: "expired" },
  {
    id: "payment",
    registrationId: "reg",
    checkoutSessionId: "cs_synthetic",
    paymentIntentId: "pi_synthetic",
    expectedAmountPence: 600,
    currency: "gbp",
    status: "paid",
    webhookReconciliationState: "reconciled",
  },
];
state.processedPaymentEvents = [];
const repository = createMemoryRepository(state);
let emails = 0;
const emailAdapter = {
  async send() {
    emails++;
    return { delivery: "sent", externalCall: false };
  },
};
const gateway = createStripeGateway({
  stripe,
  environment: "development",
  secretKey: "sk_test_synthetic",
  webhookSecret,
});
const service = new Phase3IntegrationService({
  repository,
  stripeGateway: gateway,
  emailAdapter,
});
const api = createProductionApi({
  service: new ProductionRegistrationService({ repository, emailAdapter }),
  phase3Integrations: service,
  repository,
});
const before = await repository.read();
assert.deepEqual(before, state);
const server = http.createServer(async (req, res) => {
  try {
    const parts = [];
    for await (const part of req) parts.push(part);
    const raw = Buffer.concat(parts).toString();
    const result = await api({
      method: req.method,
      pathname: new URL(req.url, "http://localhost").pathname,
      headers: req.headers,
      body: { rawBody: raw },
      hostname: "localhost",
    });
    res.writeHead(result.status, result.headers);
    res.end(JSON.stringify(result.body));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  assert.equal((await fetch(base + "/api/v2/organiser/snapshot")).status, 403);
  const event = {
    id: "evt_synthetic",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_synthetic",
        payment_intent: "pi_synthetic",
        payment_status: "paid",
        amount_total: 600,
        currency: "gbp",
        metadata: { paymentId: "payment", registrationId: "reg" },
      },
    },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  assert.equal(
    (
      await fetch(base + "/api/v3/stripe/webhook", {
        method: "POST",
        body: payload,
        headers: { "stripe-signature": "invalid" },
      })
    ).status,
    400,
  );
  assert.deepEqual(await repository.read(), before);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(base + "/api/v3/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signature },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).duplicate, true);
  }
  const after = await repository.read();
  assert.deepEqual(after.registrations, before.registrations);
  assert.deepEqual(after.payments, before.payments);
  assert.equal(emails, 0);
  assert.equal(after.processedPaymentEvents.length, 1);
  // The external scheduler package must use the same hold logic as the API package.
  const pending = structuredClone(state);
  pending.registrations[0].placeStatus = "payment_reserved";
  pending.payments[1].status = "checkout_pending";
  pending.payments[1].checkoutExpiresAt = "2026-11-17T11:30:00Z";
  pending.auditEvents.push({
    id: "audit_synthetic",
    action: "waiting_list_offer_accepted",
    after: { registrationId: "reg" },
  });
  const schedulerRepository = createMemoryRepository(pending);
  const schedulerService = new SchedulerService({
    repository: schedulerRepository,
    emailAdapter,
  });
  let reviewWarning = false;
  const handler = createProductionSchedulerHandler({
    service: schedulerService,
    environment: {
      REGISTRATION_ENVIRONMENT: "production",
      REGISTRATION_STORAGE_ACCOUNT: "syntheticprod",
      REGISTRATION_TABLE: "RegistrationProduction",
      REGISTRATION_EVENT_PARTITION: "blorenge-2026-live",
      REGISTRATION_PUBLIC_BASE_URL: "https://example.com",
    },
    clock: () => at,
    logger: {
      log() {},
      error(name) {
        if (name === "stripe_payment_reconciliation_failed")
          reviewWarning = true;
      },
    },
  });
  await handler();
  const held = await schedulerRepository.read();
  assert.equal(held.registrations[0].placeStatus, "payment_reserved");
  assert.equal(held.payments[1].reservationReview.status, "open");
  assert.equal(reviewWarning, true);
  // Confirm the new API can resolve a hold written by the narrowly patched,
  // older deployed scheduler, without fetching any real provider data.
  const reviewGateway = {
    ...gateway,
    async retrieveCheckoutSession() {
      return { id: "cs_synthetic", mode: "payment", livemode: true,
        status: "complete", payment_status: "paid", amount_total: 600, currency: "gbp",
        metadata: { registrationId: "reg", paymentId: "payment" },
        payment_intent: { id: "pi_synthetic", status: "succeeded", amount_received: 600, currency: "gbp",
          latest_charge: { id: "ch_synthetic", status: "succeeded", captured: true,
            disputed: false, amount_refunded: 0, amount_captured: 600, currency: "gbp" } } };
    },
  };
  const reviewService = new Phase3IntegrationService({ repository: schedulerRepository,
    stripeGateway: reviewGateway, emailAdapter });
  const manual = await reviewService.checkWaitingListPayment(
    { authenticated: true, role: "organiser", actorType: "synthetic_organiser" }, "reg", at);
  assert.equal(manual.ok, true);
  assert.equal((await reviewService.webhook(payload, signature, at)).duplicate, true);
  const resolved = await schedulerRepository.read();
  assert.equal(resolved.payments[1].reservationReview.status, "resolved");
  assert.equal(resolved.registrations[0].placeStatus, "confirmed");
  assert.equal(emails, 1);
  console.log(
    JSON.stringify({
      ok: true,
      scope: "local staged production artifacts; isolated memory only",
      signedWebhookStatus: 200,
      invalidSignatureStatus: 400,
      organiserUnauthenticatedStatus: 403,
      duplicateEntries: 0,
      duplicateConfirmationEmails: 0,
      isolatedManualConfirmationEmails: emails,
      apiResolvesDeployedSchedulerHold: true,
      capacityChangesOnDuplicate: 0,
      schedulerReviewHold: true,
      monitoringWarning: true,
      externalProviderCalls: 0,
    }),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
