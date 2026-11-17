import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createStripeGateway } from "../registration/server/phase3-integrations.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { createPhase3State } from "../registration/server/phase3-domain.mjs";
const Stripe = createRequire(new URL("../api/package.json", import.meta.url))(
  "stripe",
);
test("real Stripe SDK signature verification accepts exact raw payload and rejects tampering", async () => {
  const stripe = new Stripe("sk_test_synthetic"),
    secret = "whsec_synthetic";
  const gateway = createStripeGateway({
    stripe,
    environment: "development",
    secretKey: "sk_test_synthetic",
    webhookSecret: secret,
  });
  const state = createPhase3State({
    environment: "development",
    registrationState: "OPEN",
  });
  state.processedPaymentEvents = [];
  state.registrations = [
    {
      id: "reg",
      runnerId: "runner",
      entryStatus: "accepted",
      placeStatus: "confirmed",
    },
  ];
  state.runners = [{ id: "runner" }];
  state.payments = [
    {
      id: "payment",
      registrationId: "reg",
      checkoutSessionId: "cs_signature",
      paymentIntentId: "pi_signature",
      status: "paid",
      expectedAmountPence: 600,
      currency: "gbp",
    },
  ];
  const repository = createMemoryRepository(state);
  const service = new Phase3IntegrationService({
    repository,
    stripeGateway: gateway,
  });
  const payload = JSON.stringify({
    id: "evt_signature",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_signature",
        payment_intent: "pi_signature",
        payment_status: "paid",
        amount_total: 600,
        currency: "gbp",
        metadata: { paymentId: "payment", registrationId: "reg" },
      },
    },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  assert.equal(
    (await service.webhook(payload + " ", signature)).code,
    "INVALID_WEBHOOK_SIGNATURE",
  );
  assert.deepEqual(await repository.read(), state);
  assert.equal((await service.webhook(payload, signature)).duplicate, true);
  assert.equal((await service.webhook(payload, signature)).duplicate, true);
  assert.equal((await repository.read()).processedPaymentEvents.length, 1);
});
