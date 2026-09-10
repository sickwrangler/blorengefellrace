import crypto from "node:crypto";
import { authorize } from "./auth.mjs";
import { authorizePrivateInvitation, calculateEntryPrice, expirePrivateInvitation, issuePrivateInvitation, revokePrivateInvitation } from "./phase3-domain.mjs";
import { deliverRegistrationCommunication } from "./communications.mjs";

const now = () => new Date().toISOString();
const active = (registration) => registration.entryStatus !== "cancelled" && registration.entryStatus !== "place_released" && !registration.deletedAt;
const normalizeName = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const formulaSafe = (value) => /^[\s]*[=+\-@]/.test(String(value ?? "")) ? `'${value}` : String(value ?? "");
const quote = (value) => `"${formulaSafe(value).replaceAll('"', '""')}"`;
const csv = (headers, rows) => [headers, ...rows].map((row) => row.map(quote).join(",")).join("\n");

function entities(state, registration) {
  return {
    runner: state.runners.find((item) => item.id === registration.runnerId),
    emergency: state.emergencyContacts.find((item) => item.registrationId === registration.id),
    payment: state.payments.find((item) => item.registrationId === registration.id || item.registrationIds?.includes(registration.id)),
    consent: [...state.consents].reverse().find((item) => item.registrationId === registration.id)
  };
}

function registrationView(state, registration) {
  const { runner, emergency, payment, consent } = entities(state, registration);
  const declaration = [...state.declarations].reverse().find((item) => item.registrationId === registration.id && !item.revokedAt);
  const declarationStatus = declaration ? "complete" : registration.declarationStatus ?? "pending";
  const refunded = payment?.refundedRegistrationIds?.includes(registration.id);
  return {
    ...registration,
    paymentStatus: refunded ? "refunded" : payment?.status === "paid" ? "successful" : payment?.status === "failed" ? "declined" : payment?.status === "expired" ? "abandoned" : payment?.status ?? "created",
    pricing: registration.pricing ?? (payment ? { standardPricePence: state.event.entryFeePence, wfraMemberPricePence: state.event.wfraMemberPricePence, priceActuallyChargedPence: registration.priceActuallyChargedPence, adjustmentReason: registration.pricing?.adjustmentReason, wfraDiscountApplied: registration.pricing?.wfraDiscountApplied } : null),
    payment: payment ? { expectedAmountPence: registration.priceActuallyChargedPence ?? payment.expectedAmountPence, actualPaidAmountPence: payment.status === "paid" ? registration.priceActuallyChargedPence ?? payment.actualPaidAmountPence : payment.actualPaidAmountPence, currency: payment.currency, refundState: refunded ? "refunded" : payment.refundState, webhookReconciliationState: payment.webhookReconciliationState } : undefined,
    runner: { ...runner, emergencyName: emergency?.name, emergencyPhone: emergency?.phone },
    termsVersion: consent?.termsVersion, privacyVersion: consent?.privacyVersion, consentRecordedAt: consent?.recordedAt,
    declaration, declarationStatus, declarationCompletionMethod: declaration?.completionMethod ?? registration.declarationCompletionMethod ?? null,
    clearedToStart: declarationStatus === "complete" && registration.placeStatus === "confirmed" && registration.entryStatus !== "place_released"
  };
}

function totals(state) {
  const accepted = state.registrations.filter((item) => item.entryStatus === "accepted" && active(item)).length;
  return { state: state.registrationState, operationalState: state.registrationState, environment: "production", capacity: state.event.capacity, accepted, remaining: Math.max(0, state.event.capacity - accepted), waiting: state.registrations.filter((item) => item.entryStatus === "waiting_list" && active(item)).length, intendedOpeningDate: state.event.intendedOpeningDate ?? null, pricing: calculateEntryPrice(state.event) };
}

function audit(state, actor, action, registrationId, before = null, after = null) {
  state.auditEvents.push({ id: `audit_${crypto.randomUUID()}`, occurredAt: now(), actorType: actor.actorType, actorId: actor.id ?? null, action, subjectId: registrationId, before, after, environment: "production" });
}

function refreshWaiting(state) {
  state.registrations.filter((item) => item.entryStatus === "waiting_list" && active(item)).sort((a, b) => a.waitingSequence - b.waitingSequence).forEach((item, index) => { item.waitingListPosition = index + 1; });
}

export class ProductionRegistrationService {
  constructor({ repository, emailAdapter }) { this.repository = repository; this.emailAdapter = emailAdapter; }
  async status() { return totals(await this.repository.read()); }
  async inspectPrivateAccess(token, purpose, at = new Date()) {
    const state = await this.repository.read(); const result = authorizePrivateInvitation(state, token, { kind: purpose, at });
    return result.ok ? { ok: true, purpose, invitation: result.invitation } : { ok: false, code: "LINK_UNAVAILABLE" };
  }
  async snapshot(actor, filters = {}) {
    if (!authorize(actor, "read")) return { ok: false, code: "FORBIDDEN" };
    const state = await this.repository.read(); let registrations = state.registrations.filter((item) => !item.deletedAt).map((item) => registrationView(state, item));
    const search = String(filters.search ?? "").toLowerCase(); if (search) registrations = registrations.filter((item) => [item.testReference, item.runner.firstName, item.runner.lastName, item.runner.email].some((value) => String(value).toLowerCase().includes(search)));
    if (filters.entry) registrations = registrations.filter((item) => item.entryStatus === filters.entry); if (filters.payment) registrations = registrations.filter((item) => item.paymentStatus === filters.payment); if (filters.declaration) registrations = registrations.filter((item) => item.declarationStatus === filters.declaration);
    return { ok: true, state: { version: state.schemaVersion, event: state.event, environment: "production", registrationState: state.registrationState, phase3RegistrationState: state.registrationState, registrations, communications: state.communications, refundRequests: state.refundRequests.map(({ id, registrationId, status, requestedAt, decidedAt, refundedAt, placeReleasedAt }) => ({ id, registrationId, status, requestedAt, decidedAt, refundedAt, placeReleasedAt })), auditEvents: [] }, totals: totals(state) };
  }
  async entry(actor, id) { if (!authorize(actor, "read")) return { ok: false, code: "FORBIDDEN" }; const state = await this.repository.read(); const registration = state.registrations.find((item) => item.id === id && !item.deletedAt); return registration ? { ok: true, registration: registrationView(state, registration) } : { ok: false, code: "NOT_FOUND" }; }
  manage(actor, id, action, payload = {}) {
    if (!authorize(actor, action.includes("race_number") ? "race_number" : "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction(async (state) => {
      const registration = state.registrations.find((item) => item.id === id && !item.deletedAt); if (!registration) return { ok: false, code: "NOT_FOUND" };
      const payment = entities(state, registration).payment; const before = { entryStatus: registration.entryStatus, raceNumber: registration.raceNumber, paymentStatus: payment?.status }; const metadata = {};
      if (action === "race_number") { const number = Number(payload.raceNumber); if (!Number.isInteger(number) || number < 1 || number > 999) return { ok: false, code: "INVALID_RACE_NUMBER" }; if (state.registrations.some((item) => item.id !== id && item.raceNumber === number && !item.deletedAt)) return { ok: false, code: "DUPLICATE_RACE_NUMBER" }; registration.raceNumber = number; audit(state, actor, before.raceNumber ? "race_number_changed" : "race_number_assigned", id, { raceNumber: before.raceNumber }, { raceNumber: number }); }
      else if (action === "remove_race_number") { if (!registration.raceNumber) return { ok: false, code: "NO_RACE_NUMBER" }; metadata.releasedRaceNumber = registration.raceNumber; registration.raceNumber = null; audit(state, actor, "race_number_removed", id, { raceNumber: before.raceNumber }, { raceNumber: null }); }
      else if (action === "cancel") { if (payload.releaseRaceNumber && registration.raceNumber) { metadata.releasedRaceNumber = registration.raceNumber; registration.raceNumber = null; } registration.entryStatus = "cancelled"; registration.placeStatus = "none"; registration.waitingListPosition = null; refreshWaiting(state); audit(state, actor, "entry_cancelled", id, { entryStatus: before.entryStatus }, { entryStatus: "cancelled" }); const runner = entities(state, registration).runner; await deliverRegistrationCommunication(state, this.emailAdapter, { registrationId: id, template: "registration_cancelled", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}` } }, { idempotencyKey: `registration:${id}:cancelled:v1` }); }
      else if (action === "promote" || action === "entry_status") { const requested = action === "promote" ? "accepted" : payload.entryStatus; if (requested === "accepted" && registration.entryStatus === "waiting_list" && totals(state).remaining > 0) { registration.entryStatus = "accepted"; registration.waitingListPosition = null; refreshWaiting(state); audit(state, actor, "entry_promoted", id, { entryStatus: before.entryStatus }, { entryStatus: "accepted" }); } else if (requested === "waiting_list" && registration.entryStatus === "accepted") { registration.entryStatus = "waiting_list"; registration.waitingSequence = ++state.counters.waitingSequence; refreshWaiting(state); audit(state, actor, "entry_status_changed", id, { entryStatus: before.entryStatus }, { entryStatus: "waiting_list" }); } else if (requested !== registration.entryStatus) return { ok: false, code: "INVALID_ENTRY_TRANSITION" }; }
      else if (action === "correct") { const runner = entities(state, registration).runner; const fields = []; for (const field of ["firstName", "lastName", "phone", "club"]) if (payload[field] !== undefined) { runner[field] = normalizeName(payload[field]); fields.push(field); } audit(state, actor, "data_corrected", id, null, { fields }); }
      else return { ok: false, code: "INVALID_ACTION" };
      registration.updatedAt = now(); return { ok: true, registration: registrationView(state, registration), ...metadata };
    });
  }
  async privateInvitations(actor) { if (!authorize(actor, "manage")) return { ok: false, code: "FORBIDDEN" }; const state = await this.repository.read(); return { ok: true, invitations: state.privateInvitations.map(({ tokenHash: _tokenHash, ...item }) => ({ ...item, status: item.revokedAt ? "Revoked" : new Date(item.expiresAt) <= new Date() ? "Expired" : item.uses >= item.maximumUses ? "Used" : "Active" })) }; }
  createPrivateInvitation(actor, input) { if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" }); return this.repository.transaction((state) => issuePrivateInvitation(state, input, actor)); }
  revokePrivateInvitation(actor, id) { if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" }); return this.repository.transaction((state) => revokePrivateInvitation(state, id, actor)); }
  expirePrivateInvitation(actor, id) { if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" }); return this.repository.transaction((state) => expirePrivateInvitation(state, id, actor)); }
  async auditHistory(actor, id) { if (!authorize(actor, "audit")) return { ok: false, code: "FORBIDDEN" }; const state = await this.repository.read(); return { ok: true, events: state.auditEvents.filter((item) => item.subjectId === id).map((item) => ({ ...item, timestamp: item.occurredAt })) }; }
  async exportPublic(actor) { if (!authorize(actor, "read")) return { ok: false, code: "FORBIDDEN" }; const state = await this.repository.read(); const rows = state.registrations.filter((item) => !item.deletedAt).map((item) => { const entry = registrationView(state, item); return [entry.testReference, entry.raceNumber, entry.runner.firstName, entry.runner.lastName, entry.runner.club, entry.runner.genderCategory, entry.entryStatus, entry.paymentStatus]; }); return { ok: true, filename: "registration-race-management.csv", csv: csv(["entry_reference", "race_number", "first_name", "last_name", "club", "category", "entry_status", "payment_status"], rows) }; }
  async exportPrivate(actor) { if (!authorize(actor, "export_private")) return { ok: false, code: "FORBIDDEN" }; const state = await this.repository.read(); const rows = state.registrations.filter((item) => !item.deletedAt).map((item) => { const entry = registrationView(state, item); return [entry.id, entry.runner.firstName, entry.runner.lastName, entry.runner.email, entry.runner.phone, entry.entryStatus, entry.paymentStatus]; }); return { ok: true, warning: "PRIVATE OPERATIONAL EXPORT — store outside the public website", filename: `private-registration-${new Date().toISOString().slice(0, 10)}.csv`, csv: csv(["registration_id", "first_name", "last_name", "email", "phone", "entry_status", "payment_status"], rows) }; }
  erase(actor, id, mode = "anonymise") { if (!authorize(actor, "erase")) return Promise.resolve({ ok: false, code: "FORBIDDEN" }); if (mode !== "anonymise") return Promise.resolve({ ok: false, code: "ANONYMISE_ONLY" }); return this.repository.transaction((state) => { const registration = state.registrations.find((item) => item.id === id && !item.deletedAt); if (!registration) return { ok: false, code: "NOT_FOUND" }; const runner = entities(state, registration).runner; Object.assign(runner, { firstName: "Anonymised", lastName: "Runner", email: `${registration.id}@deleted.invalid`, phone: "deleted", addressLine1: null, addressLine2: null, city: null, postcode: null, dateOfBirth: null, wfraMembershipNumber: null, anonymisedAt: now() }); state.emergencyContacts = state.emergencyContacts.filter((item) => item.registrationId !== id); audit(state, actor, "record_anonymised", id); return { ok: true }; }); }
}
