import Stripe from "stripe";
import { EmailClient } from "@azure/communication-email";
import { DefaultAzureCredential } from "@azure/identity";
import { assertStripeDevelopmentConfiguration, createStripeGateway } from "./shared/server/phase3-integrations.mjs";
import { createControlledDevelopmentEmail } from "./shared/server/development-email.mjs";

const splitRecipients = (value) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

export function createDevelopmentStripeGateway(environment = process.env) {
  const secretKey = environment.STRIPE_SECRET_KEY;
  const webhookSecret = environment.STRIPE_WEBHOOK_SIGNING_SECRET;
  assertStripeDevelopmentConfiguration({ environment: environment.REGISTRATION_ENVIRONMENT, secretKey, webhookSecret });
  const stripe = new Stripe(secretKey, { apiVersion: "2026-08-26.dahlia", appInfo: { name: "Blorenge Fell Race registration" } });
  return createStripeGateway({ stripe, environment: environment.REGISTRATION_ENVIRONMENT, secretKey, webhookSecret });
}

export function createDevelopmentEmailAdapter(environment = process.env) {
  const safeRecipients = splitRecipients(environment.REGISTRATION_EMAIL_SAFE_RECIPIENTS);
  const senderAddress = environment.REGISTRATION_EMAIL_SENDER;
  const endpoint = environment.ACS_EMAIL_ENDPOINT;
  const acsCredential = environment.ACS_EMAIL_CONNECTION_STRING;
  if (!safeRecipients.length || !senderAddress || (!endpoint && !acsCredential)) return createControlledDevelopmentEmail();
  const client = acsCredential ? new EmailClient(acsCredential) : new EmailClient(endpoint, new DefaultAzureCredential());
  const transport = {
    async send(message) {
      const poller = await client.beginSend({ senderAddress: message.senderAddress, recipients: { to: message.recipients.map((address) => ({ address })) }, content: { subject: message.subject, plainText: message.text, html: message.html } });
      const result = await poller.pollUntilDone();
      if (result.status !== "Succeeded") throw new Error("Controlled development email delivery failed.");
      return { id: result.id };
    }
  };
  return createControlledDevelopmentEmail({ transport, senderAddress, safeRecipients });
}
