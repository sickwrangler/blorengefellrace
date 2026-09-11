import { EmailClient } from "@azure/communication-email";
import { DefaultAzureCredential } from "@azure/identity";
import { createControlledDevelopmentEmail } from "./shared/server/development-email.mjs";
import { emailOperationId } from "./scheduler.mjs";

const recipients = (value) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

export function createSchedulerEmailAdapter(environment = process.env, credential = new DefaultAzureCredential()) {
  const safeRecipients = recipients(environment.REGISTRATION_EMAIL_SAFE_RECIPIENTS);
  const senderAddress = environment.REGISTRATION_EMAIL_SENDER;
  const endpoint = environment.ACS_EMAIL_ENDPOINT;
  if (!safeRecipients.length || !senderAddress || !endpoint) return createControlledDevelopmentEmail();
  const client = new EmailClient(endpoint, credential);
  return createControlledDevelopmentEmail({
    senderAddress,
    safeRecipients,
    transport: {
      async send(message) {
        const poller = await client.beginSend({
          senderAddress: message.senderAddress,
          recipients: { to: message.recipients.map((address) => ({ address })) },
          content: { subject: message.subject, plainText: message.text, html: message.html }
        }, { operationId: emailOperationId(message.deliveryIdempotencyKey) });
        const result = await poller.pollUntilDone();
        if (result.status !== "Succeeded") throw new Error("Controlled development email delivery failed.");
        return { id: result.id };
      }
    }
  });
}
