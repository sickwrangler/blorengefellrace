import crypto from "node:crypto";
import { EmailClient } from "@azure/communication-email";
import { DefaultAzureCredential } from "@azure/identity";
import { renderRegistrationEmail } from "./shared/server/email-templates.mjs";

export function createProductionSchedulerEmailAdapter(environment = process.env, credential = new DefaultAzureCredential()) {
  if (String(environment.REGISTRATION_EMAIL_SAFE_RECIPIENTS ?? "").trim()) throw new Error("Development email redirection is forbidden in production.");
  if (environment.ACS_EMAIL_ENABLED !== "true") return Object.freeze({ kind: "disabled", externalDelivery: false, async send() { return { delivery: "disabled", providerReference: null, externalCall: false }; } });
  const endpoint = String(environment.ACS_EMAIL_ENDPOINT ?? "").trim(); const senderAddress = String(environment.REGISTRATION_EMAIL_SENDER ?? "").trim();
  if (!endpoint || !senderAddress) throw new Error("Production scheduler email settings are incomplete.");
  const client = new EmailClient(endpoint, credential);
  return Object.freeze({
    kind: "acs-production", externalDelivery: true,
    async send(message) {
      const rendered = renderRegistrationEmail(message.template, { ...message.data, intendedRecipientAddress: message.intendedRecipientAddress });
      const key = crypto.createHash("sha256").update(String(message.deliveryIdempotencyKey)).digest("hex");
      const operationId = `${key.slice(0, 8)}-${key.slice(8, 12)}-4${key.slice(13, 16)}-a${key.slice(17, 20)}-${key.slice(20, 32)}`;
      try {
        const poller = await client.beginSend({ senderAddress, recipients: { to: [{ address: message.intendedRecipientAddress }] }, content: { subject: rendered.subject, plainText: rendered.text, html: rendered.html } }, { operationId });
        const result = await poller.pollUntilDone();
        return { delivery: result.status === "Succeeded" ? "sent" : "failed", providerReference: result.id ?? null, externalCall: true };
      } catch { return { delivery: "failed", providerReference: null, externalCall: true }; }
    }
  });
}
