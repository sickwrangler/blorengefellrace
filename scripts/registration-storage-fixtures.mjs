import { createHash } from "node:crypto";
import { createProductionBootstrap } from "../registration/server/production-bootstrap.mjs";

const token = (kind, index, extra = "") => createHash("sha256").update(`${kind}:${index}:${extra}:blorenge-2026-storage-fixture`).digest("hex");
const iso = (index, minutes = 0) => new Date(Date.UTC(2026, 8, 27, 8, minutes + index)).toISOString();

export function createStorageForecastState(runnerCount, { lifecycleHistory = false } = {}) {
  const state = createProductionBootstrap({ under18EntriesEnabled: true });
  state.registrationState = "OPEN";
  state.phase3RegistrationState = "OPEN";
  const orders = Math.ceil(runnerCount / 3);

  for (let index = 0; index < runnerCount; index += 1) {
    const runnerId = `synthetic-runner-${index + 1}`;
    const registrationId = `synthetic-registration-${index + 1}`;
    const orderId = `synthetic-order-${Math.floor(index / 3) + 1}`;
    state.runners.push({ id: runnerId, firstName: `Synthetic${index + 1}`, lastName: `Runner${token("name", index).slice(0, 10)}`, email: `synthetic.${index + 1}.${token("email", index).slice(0, 8)}@example.invalid`, phone: `07000${String(index).padStart(6, "0")}`, addressLine1: `${index + 1} Example Mountain View Terrace`, addressLine2: "Synthetic development fixture", city: "Abergavenny", postcode: `NP7 ${String(index % 10)}ZZ`, raceCategory: index % 2 ? "Male" : "Female", dateOfBirth: `${1980 + (index % 20)}-06-15`, club: `Example Fell Running Club ${index % 12}`, wfraMember: index % 3 === 0, wfraMembershipNumber: index % 3 === 0 ? `SYN-${token("wfra", index).slice(0, 12)}` : "", createdAt: iso(index) });
    state.emergencyContacts.push({ id: `synthetic-contact-${index + 1}`, runnerId, name: `Synthetic Contact ${index + 1}`, phone: `07111${String(index).padStart(6, "0")}` });
    state.registrations.push({ id: registrationId, runnerId, orderId, status: "confirmed", declarationStatus: index % 4 === 0 ? "pending" : "complete", raceNumber: index + 1, createdAt: iso(index), confirmedAt: iso(index, 10), managementTokenId: `management-${token("management", index).slice(0, 20)}` });
    state.payments.push({ id: `synthetic-payment-${index + 1}`, orderId, provider: "stripe-test-fixture", providerPaymentId: `pi_fixture_${token("payment", index)}`, amountPence: index % 3 === 0 ? 400 : 600, currency: "gbp", status: "paid", createdAt: iso(index, 5), reconciledAt: iso(index, 10) });
    state.declarations.push({ id: `synthetic-declaration-${index + 1}`, registrationId, version: "2026-09", status: index % 4 === 0 ? "pending" : "signed", signedAt: index % 4 === 0 ? null : iso(index, 8), signatoryRole: "runner", contentHash: token("declaration", index) });
    state.managementTokens.push({ id: `synthetic-management-${index + 1}`, registrationId, tokenHash: token("management-token", index), issuedAt: iso(index), invalidatedAt: null });
    state.communications.push({ id: `synthetic-confirmation-${index + 1}`, template: "registration-confirmation", recipientReference: runnerId, intendedRecipientAddress: `synthetic.${index + 1}@example.invalid`, status: "sent", providerReference: `acs-fixture-${token("email-provider", index).slice(0, 24)}`, createdAt: iso(index, 11), sentAt: iso(index, 12), retryCount: 0 });
    state.auditEvents.push({ id: `synthetic-audit-${index + 1}`, action: "registration_confirmed", subjectId: registrationId, actorType: "system", at: iso(index, 10), detail: `Synthetic capacity forecast event ${token("audit", index)}` });
  }

  for (let index = 0; index < orders; index += 1) {
    const first = index * 3;
    const registrationIds = Array.from({ length: Math.min(3, runnerCount - first) }, (_, offset) => `synthetic-registration-${first + offset + 1}`);
    state.orders.push({ id: `synthetic-order-${index + 1}`, purchaserEmail: `purchaser.${index + 1}.${token("purchaser", index).slice(0, 8)}@example.invalid`, status: "paid", registrationIds, totalPence: registrationIds.reduce((sum, _, offset) => sum + ((first + offset) % 3 === 0 ? 400 : 600), 0), currency: "gbp", checkoutSessionId: `cs_fixture_${token("checkout", index)}`, createdAt: iso(index), paidAt: iso(index, 10) });
    state.orderTokens.push({ id: `synthetic-order-token-${index + 1}`, orderId: `synthetic-order-${index + 1}`, tokenHash: token("order-token", index), createdAt: iso(index), revokedAt: null });
    state.processedPaymentEvents.push({ id: `evt_fixture_${token("event", index)}`, orderId: `synthetic-order-${index + 1}`, type: "checkout.session.completed", processedAt: iso(index, 10) });
  }

  if (lifecycleHistory) {
    for (let index = 0; index < 120; index += 1) {
      const marker = token("history", index);
      state.auditEvents.push({ id: `synthetic-history-${index}`, action: ["runner_amended", "declaration_reminder_sent", "race_number_assigned", "entry_transferred"][index % 4], subjectId: `synthetic-registration-${(index % Math.max(1, runnerCount)) + 1}`, actorType: index % 5 ? "system" : "organiser", at: iso(index, 500), detail: `Synthetic retained operational history ${marker} ${marker.slice(0, 32)}` });
      state.communications.push({ id: `synthetic-history-message-${index}`, template: ["management-link", "declaration-reminder", "transfer-confirmation"][index % 3], recipientReference: `synthetic-runner-${(index % Math.max(1, runnerCount)) + 1}`, intendedRecipientAddress: `history.${index}.${marker.slice(0, 8)}@example.invalid`, status: index % 11 === 0 ? "failed" : "sent", providerReference: `acs-history-${marker.slice(0, 24)}`, createdAt: iso(index, 501), sentAt: index % 11 === 0 ? null : iso(index, 502), retryCount: index % 11 === 0 ? 3 : 0, failure: index % 11 === 0 ? "synthetic_provider_failure" : null });
      if (index < 36) state.amendmentRequests.push({ id: `synthetic-amendment-${index}`, registrationId: `synthetic-registration-${(index % Math.max(1, runnerCount)) + 1}`, status: index % 3 === 0 ? "rejected" : "completed", requestedAt: iso(index, 600), completedAt: iso(index, 620), changes: { club: `Historical Synthetic Club ${marker.slice(0, 24)}` } });
      if (index < 24) state.waitingList.push({ id: `synthetic-waiting-${index}`, runnerId: `synthetic-historical-runner-${index}`, sequence: index + 1, status: "expired", joinedAt: iso(index, 700), email: `waiting.${index}.${marker.slice(0, 8)}@example.invalid` });
      if (index < 24) state.waitingListOffers.push({ id: `synthetic-offer-${index}`, waitingListId: `synthetic-waiting-${index}`, status: "expired", tokenHash: token("offer", index), offeredAt: iso(index, 710), expiresAt: iso(index, 720), expiredAt: iso(index, 730) });
      if (index < 18) state.refundRequests.push({ id: `synthetic-refund-${index}`, registrationId: `synthetic-registration-${(index % Math.max(1, runnerCount)) + 1}`, status: "executed", amountPence: index % 2 ? 600 : 400, providerRefundId: `re_fixture_${token("refund", index)}`, requestedAt: iso(index, 800), executedAt: iso(index, 820) });
      if (index < 30) state.reservations.push({ id: `synthetic-expired-reservation-${index}`, orderId: `synthetic-expired-order-${index}`, status: "expired", places: 1, createdAt: iso(index, 900), expiresAt: iso(index, 910), releasedAt: iso(index, 920) });
    }
    for (let index = 0; index < 40; index += 1) {
      const marker = token("abandoned", index);
      state.orders.push({ id: `synthetic-abandoned-order-${index}`, purchaserEmail: `abandoned.${index}.${marker.slice(0, 8)}@example.invalid`, status: "abandoned", registrationIds: [], totalPence: 0, currency: "gbp", checkoutSessionId: `cs_expired_${marker}`, createdAt: iso(index, 1000), abandonedAt: iso(index, 1100) });
      state.orderTokens.push({ id: `synthetic-revoked-order-token-${index}`, orderId: `synthetic-abandoned-order-${index}`, tokenHash: token("revoked-order-token", index), createdAt: iso(index, 1000), revokedAt: iso(index, 1100) });
    }
  }
  return state;
}
