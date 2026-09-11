import crypto from "node:crypto";

const iso = (value = new Date()) => new Date(value).toISOString();

/**
 * Deliver one lifecycle communication at most once for a persisted business key.
 * Secure URLs are passed directly to the transport and are deliberately omitted
 * from the stored communication receipt.
 */
export async function deliverRegistrationCommunication(state, email, message, { idempotencyKey, at = new Date() } = {}) {
  state.communications ??= [];
  const existing = state.communications.find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) return { ok: true, duplicate: true, receipt: existing };
  const delivered = await email.send({ ...message, deliveryIdempotencyKey: idempotencyKey });
  const receipt = {
    id: `communication_${crypto.randomUUID()}`,
    idempotencyKey,
    registrationId: message.registrationId ?? null,
    orderId: message.orderId ?? null,
    waitingListId: message.waitingListId ?? null,
    template: message.template,
    intendedRecipientAddress: String(message.intendedRecipientAddress ?? "").trim().toLowerCase(),
    delivery: delivered.delivery,
    providerReference: delivered.providerReference ?? null,
    externalCall: delivered.externalCall === true,
    createdAt: iso(at),
    sentAt: delivered.externalCall ? iso(at) : null
  };
  state.communications.push(receipt);
  return { ok: true, duplicate: false, receipt };
}
