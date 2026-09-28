import crypto from "node:crypto";

export const INITIAL_CONFIRMATION_TEMPLATES = Object.freeze([
  "entry_confirmed",
  "entry_confirmed_declaration_required"
]);

const active = (registration) => registration.entryStatus !== "cancelled" && registration.entryStatus !== "place_released" && !registration.deletedAt;
const sent = (receipt) => receipt.delivery === "sent";

function paymentFor(state, registration) {
  return (state.payments ?? []).find((payment) => payment.registrationId === registration.id || payment.registrationIds?.includes(registration.id));
}

function declarationComplete(state, registration) {
  return registration.declarationStatus === "complete" || (state.declarations ?? []).some((item) => item.registrationId === registration.id && !item.revokedAt);
}

export function expectedConfirmationTemplate(state, registration) {
  return declarationComplete(state, registration) ? "entry_confirmed" : "entry_confirmed_declaration_required";
}

export function expectedConfirmationRegistrations(state) {
  return (state.registrations ?? []).filter((registration) => {
    const payment = paymentFor(state, registration);
    return active(registration) && registration.entryStatus === "accepted" && registration.placeStatus === "confirmed" && payment?.status === "paid" && !payment.refundedRegistrationIds?.includes(registration.id);
  });
}

function confirmationReceipts(state, registration) {
  return (state.communications ?? []).filter((receipt) => receipt.registrationId === registration.id && INITIAL_CONFIRMATION_TEMPLATES.includes(receipt.template));
}

export function confirmationRecoveryPlan(state) {
  return expectedConfirmationRegistrations(state).flatMap((registration) => {
    const receipts = confirmationReceipts(state, registration);
    if (receipts.some(sent)) return [];
    return [{
      registrationId: registration.id,
      expectedTemplate: expectedConfirmationTemplate(state, registration),
      reason: receipts.length ? "failed" : "missing",
      receiptCount: receipts.length
    }];
  });
}

export function recoveryFingerprint(plan) {
  const canonical = plan.map(({ registrationId, expectedTemplate, reason, receiptCount }) => `${registrationId}:${expectedTemplate}:${reason}:${receiptCount}`).sort().join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function reconcileEmailHealth(state, at = new Date()) {
  const expected = expectedConfirmationRegistrations(state);
  let sentCount = 0; let failed = 0; let missing = 0; let withProviderReference = 0;
  for (const registration of expected) {
    const receipts = confirmationReceipts(state, registration);
    const successful = receipts.find(sent);
    if (successful) sentCount += 1;
    else if (receipts.length) failed += 1;
    else missing += 1;
    if (receipts.some((receipt) => receipt.providerReference)) withProviderReference += 1;
  }
  const initial = new Set(INITIAL_CONFIRMATION_TEMPLATES);
  const otherReceipts = (state.communications ?? []).filter((receipt) => !initial.has(receipt.template));
  const other = otherReceipts.reduce((summary, receipt) => {
    const key = receipt.template ?? "unknown";
    summary[key] ??= { sent: 0, failed: 0, pending: 0 };
    const status = sent(receipt) ? "sent" : receipt.delivery === "failed" ? "failed" : "pending";
    summary[key][status] += 1;
    return summary;
  }, {});
  const failedReceipts = (state.communications ?? []).filter((receipt) => receipt.delivery === "failed");
  const oldestFailedAt = failedReceipts.map((receipt) => new Date(receipt.createdAt).valueOf()).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const recovery = confirmationRecoveryPlan(state);
  return {
    asAt: new Date(at).toISOString(),
    expectedConfirmations: expected.length,
    initialConfirmations: { sent: sentCount, failed, missing, withProviderReference },
    otherCommunications: other,
    failedCommunicationBacklog: failedReceipts.length,
    oldestFailedCommunicationAgeMinutes: oldestFailedAt === undefined ? null : Math.max(0, Math.floor((new Date(at).valueOf() - oldestFailedAt) / 60_000)),
    recovery: { required: recovery.length, failed: recovery.filter((item) => item.reason === "failed").length, missing: recovery.filter((item) => item.reason === "missing").length, fingerprint: recoveryFingerprint(recovery) }
  };
}
