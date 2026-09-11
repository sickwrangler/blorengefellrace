import Stripe from "stripe";
import crypto from "node:crypto";
import { EmailClient } from "@azure/communication-email";
import { DefaultAzureCredential } from "@azure/identity";
import { createStripeGateway } from "./shared/server/phase3-integrations.mjs";
import { renderRegistrationEmail } from "./shared/server/email-templates.mjs";

export function createProductionStripeGateway(configuration) {
  if (!configuration.stripeEnabled) return null;
  const stripe = new Stripe(configuration.stripeSecretKey, { apiVersion: "2026-08-26.dahlia", appInfo: { name: "Blorenge Fell Race registration" } });
  return createStripeGateway({ stripe, environment: "production", secretKey: configuration.stripeSecretKey, webhookSecret: configuration.stripeWebhookSecret });
}

export function createDisabledProductionEmailAdapter() {
  return Object.freeze({
    kind: "disabled",
    externalDelivery: false,
    async send() { return { delivery: "disabled", providerReference: null, externalCall: false }; }
  });
}

export function createProductionEmailAdapter(configuration, credential = new DefaultAzureCredential()) {
  if (!configuration.emailEnabled) return createDisabledProductionEmailAdapter();
  const client = configuration.emailConnectionString
    ? new EmailClient(configuration.emailConnectionString)
    : new EmailClient(configuration.emailEndpoint, credential);
  return Object.freeze({
    kind: "acs-production",
    externalDelivery: true,
    async send(message) {
      const rendered = renderRegistrationEmail(message.template, { ...message.data, intendedRecipientAddress: message.intendedRecipientAddress });
      const digest = crypto.createHash("sha256").update(String(message.deliveryIdempotencyKey)).digest("hex");
      const operationId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      try {
        const poller = await client.beginSend({
          senderAddress: configuration.emailSender,
          recipients: { to: [{ address: message.intendedRecipientAddress }] },
          content: { subject: rendered.subject, plainText: rendered.text, html: rendered.html }
        }, { operationId });
        const result = await poller.pollUntilDone();
        if (result.status !== "Succeeded") return { delivery: "failed", providerReference: result.id ?? null, externalCall: true };
        return { delivery: "sent", providerReference: result.id, externalCall: true };
      } catch {
        return { delivery: "failed", providerReference: null, externalCall: true };
      }
    }
  });
}
