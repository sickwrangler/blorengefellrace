import { renderRegistrationEmail } from "./email-templates.mjs";

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());

export function createControlledDevelopmentEmail({ transport = null, senderAddress = "", safeRecipients = [] } = {}) {
  const recipients = [...new Set(safeRecipients.map((value) => String(value).trim().toLowerCase()).filter(validEmail))];
  const configured = Boolean(transport?.send && validEmail(senderAddress) && recipients.length);
  return Object.freeze({
    kind: configured ? "acs-controlled-development" : "captured-only",
    actualRecipients: configured ? recipients.length : 0,
    async send(message) {
      const rendered = renderRegistrationEmail(message.template, { ...message.data, intendedRecipientAddress: message.intendedRecipientAddress });
      if (!configured) return { ...rendered, template: message.template, intendedRecipientAddress: message.intendedRecipientAddress, delivery: "captured_only", actualRecipients: [], externalCall: false };
      const result = await transport.send({ senderAddress, recipients, subject: rendered.subject, text: rendered.text, html: rendered.html });
      return { template: message.template, intendedRecipientAddress: message.intendedRecipientAddress, delivery: "redirected_safe_recipient", actualRecipients: recipients.map(() => "configured-safe-recipient"), providerReference: result?.id ?? null, externalCall: true };
    }
  });
}
