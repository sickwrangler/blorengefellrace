import Stripe from "stripe";
import crypto from "node:crypto";
import { EmailClient } from "@azure/communication-email";
import { DefaultAzureCredential } from "@azure/identity";
import { createStripeGateway } from "./shared/server/phase3-integrations.mjs";
import { renderRegistrationEmail } from "./shared/server/email-templates.mjs";
import { sendAcsEmailWithRetry } from "./shared/server/acs-email-delivery.mjs";

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

export function createProductionEmailAdapter(configuration, credential = new DefaultAzureCredential(), { client: suppliedClient = null, telemetry = console, retry = {} } = {}) {
  if (!configuration.emailEnabled) return createDisabledProductionEmailAdapter();
  const sdkOptions = { retryOptions: { maxRetries: 0 } };
  const client = suppliedClient ?? (configuration.emailConnectionString
    ? new EmailClient(configuration.emailConnectionString, sdkOptions)
    : new EmailClient(configuration.emailEndpoint, credential, sdkOptions));
  return Object.freeze({
    kind: "acs-production",
    externalDelivery: true,
    async send(message) {
      const rendered = renderRegistrationEmail(message.template, { ...message.data, intendedRecipientAddress: message.intendedRecipientAddress });
      const digest = crypto.createHash("sha256").update(String(message.deliveryIdempotencyKey)).digest("hex");
      const operationId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      return sendAcsEmailWithRetry({
        client,
        request: {
          senderAddress: configuration.emailSender,
          recipients: { to: [{ address: message.intendedRecipientAddress }] },
          content: { subject: rendered.subject, plainText: rendered.text, html: rendered.html }
        },
        operationId,
        telemetry,
        ...retry
      });
    }
  });
}
