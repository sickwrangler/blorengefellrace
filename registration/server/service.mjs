import crypto from "node:crypto";
import { EVENT, safeRegistrationState, validateRunner } from "../registration-core.mjs";
import { authorize } from "./auth.mjs";

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const replayableToken = (idempotencyKey, registrationId) => crypto.createHash("sha512").update(`${idempotencyKey}:${registrationId}`).digest("base64url");
const tokenHash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalizeName = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const active = (registration) => registration.entryStatus !== "cancelled" && !registration.deletedAt;
export const PHASE2_PAYMENT_STATES = Object.freeze(["created", "pending", "paid", "failed", "abandoned", "refunded"]);

export function createDatabase({ environment = "local", registrationState = "test", capacity = EVENT.capacity } = {}) {
  return {
    schemaVersion: 2,
    environment,
    event: { ...EVENT, capacity, intendedOpeningDate: null },
    registrationState: safeRegistrationState(registrationState, environment),
    counters: { waitingSequence: 0 },
    runners: [], emergencyContacts: [], registrations: [], payments: [], consents: [], communications: [], auditEvents: [],
    idempotency: [], amendmentRequests: [], testProgress: { submittedReference: null, organiserViewed: false, resetCompleted: false }
  };
}

function audit(db, actor, action, registrationId, before = null, after = null) {
  db.auditEvents.push({ id: id("audit"), timestamp: now(), actorType: actor?.actorType ?? "runner", actorId: actor?.id ?? null, action, registrationId, before, after, environment: db.environment });
}

function entities(db, registration) {
  return {
    runner: db.runners.find((item) => item.id === registration.runnerId),
    emergency: db.emergencyContacts.find((item) => item.registrationId === registration.id),
    payment: db.payments.find((item) => item.registrationId === registration.id),
    consent: db.consents.find((item) => item.registrationId === registration.id)
  };
}

function view(db, registration, { runnerSafe = false } = {}) {
  const { runner, emergency, payment, consent } = entities(db, registration);
  const result = {
    ...registration,
    paymentStatus: payment?.status === "paid" ? "successful" : payment?.status === "failed" ? "declined" : payment?.status ?? "created",
    runner: { ...runner, emergencyName: emergency?.name, emergencyPhone: emergency?.phone },
    termsVersion: consent?.termsVersion, privacyVersion: consent?.privacyVersion, consentRecordedAt: consent?.recordedAt
  };
  delete result.confirmationTokenHash;
  if (runnerSafe) {
    delete result.runner.phone; delete result.runner.dateOfBirth; delete result.runner.membershipNumber;
    delete result.runner.emergencyName; delete result.runner.emergencyPhone;
  }
  return result;
}

function refreshWaiting(db, actor = null) {
  const waiting = db.registrations.filter((item) => item.entryStatus === "waiting_list" && active(item)).sort((a, b) => a.waitingSequence - b.waitingSequence);
  waiting.forEach((item, index) => {
    const next = index + 1;
    if (item.waitingListPosition !== next) audit(db, actor, "waiting_list_position_assigned", item.id, { position: item.waitingListPosition }, { position: next });
    item.waitingListPosition = next;
  });
}

function status(db) {
  const accepted = db.registrations.filter((item) => item.entryStatus === "accepted" && active(item)).length;
  return { state: db.registrationState, environment: db.environment, capacity: db.event.capacity, accepted, remaining: Math.max(0, db.event.capacity - accepted), waiting: db.registrations.filter((item) => item.entryStatus === "waiting_list" && active(item)).length, intendedOpeningDate: db.event.intendedOpeningDate };
}

function formulaSafe(value) {
  const text = String(value ?? "");
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}
const quote = (value) => `"${formulaSafe(value).replaceAll('"', '""')}"`;
const csv = (headers, rows) => [headers, ...rows].map((row) => row.map(quote).join(",")).join("\n");

export function parseSyntheticCsv(text) {
  const records = []; let row = []; let cell = ""; let quoted = false;
  for (let index = 0; index < String(text).length; index += 1) { const character = text[index]; const next = text[index + 1]; if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; } else if (character === '"') quoted = !quoted; else if (character === "," && !quoted) { row.push(cell); cell = ""; } else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && next === "\n") index += 1; row.push(cell); if (row.some((value) => value !== "")) records.push(row); row = []; cell = ""; } else cell += character; }
  row.push(cell); if (row.some((value) => value !== "")) records.push(row); if (records.length < 2) return [];
  const headers = records[0].map((value) => value.trim());
  return records.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, ["affiliated", "acceptTerms", "acceptPrivacy"].includes(header) ? /^(true|yes|1)$/i.test(values[index] ?? "") : values[index] ?? ""])));
}

export class RegistrationService {
  constructor({ repository, paymentAdapter, emailAdapter }) { this.repository = repository; this.paymentAdapter = paymentAdapter; this.emailAdapter = emailAdapter; }
  async status() { return status(await this.repository.read()); }

  create(input, { idempotencyKey, actor = { actorType: "runner" } } = {}) {
    if (!idempotencyKey || idempotencyKey.length < 12) return Promise.resolve({ ok: false, code: "IDEMPOTENCY_KEY_REQUIRED" });
    return this.repository.transaction(async (db) => {
      const prior = db.idempotency.find((item) => item.operation === "create" && item.key === idempotencyKey);
      if (prior) {
        const registration = db.registrations.find((item) => item.id === prior.registrationId);
        return { ok: true, idempotentReplay: true, registration: view(db, registration, { runnerSafe: true }), confirmationToken: replayableToken(idempotencyKey, registration.id) };
      }
      if (!["test", "open"].includes(db.registrationState)) return { ok: false, code: "REGISTRATION_NOT_ACCEPTING" };
      if (db.environment === "production") return { ok: false, code: "PRODUCTION_CLOSED" };
      const normalized = { ...input, firstName: normalizeName(input.firstName), lastName: normalizeName(input.lastName), email: String(input.email ?? "").trim().toLowerCase(), phone: String(input.phone ?? "").trim(), emergencyName: normalizeName(input.emergencyName), emergencyPhone: String(input.emergencyPhone ?? "").trim() };
      const errors = validateRunner(normalized, { requireSynthetic: true });
      if (normalized.termsVersion && normalized.termsVersion !== db.event.termsVersion) errors.acceptTerms = "The terms version is no longer current.";
      if (normalized.privacyVersion && normalized.privacyVersion !== db.event.privacyVersion) errors.acceptPrivacy = "The privacy version is no longer current.";
      if (Object.keys(errors).length) return { ok: false, code: "VALIDATION_ERROR", errors };
      const duplicate = db.registrations.find((item) => active(item) && db.runners.find((runner) => runner.id === item.runnerId)?.email === normalized.email);
      if (duplicate) return { ok: false, code: "DUPLICATE" };
      const accepted = status(db).accepted < db.event.capacity;
      const createdAt = now(); const registrationId = id("reg"); const runnerId = id("runner"); const confirmationToken = replayableToken(idempotencyKey, registrationId);
      db.runners.push({ id: runnerId, firstName: normalized.firstName, lastName: normalized.lastName, email: normalized.email, phone: normalized.phone, dateOfBirth: normalized.dateOfBirth, genderCategory: normalized.genderCategory, club: normalizeName(normalized.club) || "Unattached", affiliated: Boolean(normalized.affiliated), membershipNumber: normalizeName(normalized.membershipNumber) || null, travelMethod: normalized.travelMethod, anonymisedAt: null });
      db.emergencyContacts.push({ id: id("emergency"), registrationId, name: normalized.emergencyName, phone: normalized.emergencyPhone, deleteAfterEvent: true });
      db.consents.push({ id: id("consent"), registrationId, termsVersion: db.event.termsVersion, privacyVersion: db.event.privacyVersion, recordedAt: createdAt });
      db.payments.push({ id: id("payment"), registrationId, status: "created", providerReference: null, updatedAt: createdAt });
      const registration = { id: registrationId, testReference: `TEST-${crypto.randomBytes(4).toString("hex").toUpperCase()}`, eventId: db.event.id, runnerId, environment: db.environment, entryStatus: accepted ? "accepted" : "waiting_list", waitingSequence: accepted ? null : ++db.counters.waitingSequence, waitingListPosition: null, raceNumber: null, confirmationTokenHash: tokenHash(confirmationToken), createdAt, updatedAt: createdAt, deletedAt: null };
      db.registrations.push(registration); refreshWaiting(db, actor);
      db.idempotency.push({ operation: "create", key: idempotencyKey, registrationId, createdAt });
      db.testProgress.submittedReference = registration.testReference;
      audit(db, actor, "registration_created", registrationId, null, { entryStatus: registration.entryStatus });
      const captured = await this.emailAdapter.capture({ id: id("message"), registrationId, template: "registration_received", intendedRecipientAddress: normalized.email, intendedRecipientReference: runnerId, createdAt }); db.communications.push(captured);
      return { ok: true, registration: view(db, registration, { runnerSafe: true }), confirmationToken };
    });
  }

  async confirmation(confirmationToken) {
    const db = await this.repository.read(); const hash = tokenHash(String(confirmationToken ?? ""));
    const registration = db.registrations.find((item) => crypto.timingSafeEqual(Buffer.from(item.confirmationTokenHash), Buffer.from(hash)) && !item.deletedAt);
    return registration ? { ok: true, registration: view(db, registration, { runnerSafe: true }) } : { ok: false, code: "NOT_FOUND" };
  }

  mockPayment(confirmationToken, outcome, idempotencyKey) {
    return this.repository.transaction(async (db) => {
      if (db.environment === "production") return { ok: false, code: "PRODUCTION_CLOSED" };
      const hash = tokenHash(String(confirmationToken ?? "")); const registration = db.registrations.find((item) => item.confirmationTokenHash === hash && !item.deletedAt);
      if (!registration) return { ok: false, code: "NOT_FOUND" };
      const prior = db.idempotency.find((item) => item.operation === "payment" && item.key === idempotencyKey);
      if (prior) return { ok: true, idempotentReplay: true, registration: view(db, registration, { runnerSafe: true }) };
      if (!["successful", "declined", "abandoned"].includes(outcome)) return { ok: false, code: "INVALID_PAYMENT_TRANSITION" };
      const payment = entities(db, registration).payment; const before = payment.status; const recorded = await this.paymentAdapter.record(outcome); payment.status = recorded.status === "successful" ? "paid" : recorded.status === "declined" ? "failed" : recorded.status; payment.updatedAt = now();
      db.idempotency.push({ operation: "payment", key: idempotencyKey, registrationId: registration.id, createdAt: now() }); audit(db, { actorType: "runner" }, "payment_state_changed", registration.id, { status: before }, { status: payment.status });
      if (payment.status === "paid") { const runner = entities(db, registration).runner; db.communications.push(await this.emailAdapter.capture({ id: id("message"), registrationId: registration.id, template: "payment_successful", intendedRecipientAddress: runner.email, intendedRecipientReference: runner.id, createdAt: now() })); }
      return { ok: true, registration: view(db, registration, { runnerSafe: true }) };
    });
  }

  requestAmendment(confirmationToken, request) {
    return this.repository.transaction((db) => {
      if (db.environment === "production") return { ok: false, code: "PRODUCTION_CLOSED" };
      const registration = db.registrations.find((item) => item.confirmationTokenHash === tokenHash(String(confirmationToken ?? "")) && !item.deletedAt);
      if (!registration) return { ok: false, code: "NOT_FOUND" };
      const item = { id: id("amendment"), registrationId: registration.id, type: request.type === "cancellation" ? "cancellation" : "correction", message: normalizeName(request.message).slice(0, 500), status: "requested", createdAt: now() };
      db.amendmentRequests.push(item); audit(db, { actorType: "runner" }, "amendment_requested", registration.id, null, { type: item.type }); return { ok: true, request: item };
    });
  }

  async snapshot(actor, filters = {}) {
    if (!authorize(actor, "read")) return { ok: false, code: "FORBIDDEN" };
    const db = await this.repository.read(); let registrations = db.registrations.filter((item) => !item.deletedAt).map((item) => view(db, item));
    const search = String(filters.search ?? "").toLowerCase(); if (search) registrations = registrations.filter((item) => [item.testReference, item.runner.firstName, item.runner.lastName, item.runner.email].some((value) => String(value).toLowerCase().includes(search)));
    if (filters.entry) registrations = registrations.filter((item) => item.entryStatus === filters.entry);
    if (filters.payment) registrations = registrations.filter((item) => item.paymentStatus === filters.payment);
    return { ok: true, state: { version: 2, event: db.event, environment: db.environment, registrationState: db.registrationState, registrations, communications: db.communications, auditEvents: [], testProgress: db.testProgress }, totals: status(db) };
  }

  async entry(actor, registrationId) { if (!authorize(actor, "read")) return { ok: false, code: "FORBIDDEN" }; const db = await this.repository.read(); const registration = db.registrations.find((item) => item.id === registrationId && !item.deletedAt); return registration ? { ok: true, registration: view(db, registration) } : { ok: false, code: "NOT_FOUND" }; }

  setState(actor, nextState) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction((db) => { if (db.environment === "production") return { ok: false, code: "PRODUCTION_CLOSED" }; if (!["closed", "test", "paused", "full"].includes(nextState)) return { ok: false, code: "INVALID_STATE" }; const before = db.registrationState; db.registrationState = nextState; audit(db, actor, "registration_state_changed", null, { state: before }, { state: nextState }); return { ok: true, state: nextState }; });
  }

  async importSynthetic(actor, rows) {
    if (!authorize(actor, "manage")) return { ok: false, code: "FORBIDDEN" }; const current = await this.repository.read(); if (current.environment !== "local" || !Array.isArray(rows)) return { ok: false, code: "DEVELOPMENT_ONLY" };
    const results = []; for (const [index, row] of rows.entries()) results.push(await this.create(row, { idempotencyKey: `synthetic-import-${index}-${crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex")}`, actor }));
    return { ok: results.every((item) => item.ok), imported: results.filter((item) => item.ok).length, rejected: results.filter((item) => !item.ok).map((item) => item.code) };
  }
  importSyntheticCsv(actor, text) { return this.importSynthetic(actor, parseSyntheticCsv(text)); }

  markViewed(actor, testReference) {
    if (!authorize(actor, "read")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction((db) => { const registration = db.registrations.find((item) => item.testReference === testReference && !item.deletedAt); if (!registration) return { ok: false, code: "NOT_FOUND" }; db.testProgress.organiserViewed = true; return { ok: true, registration: view(db, registration) }; });
  }

  manage(actor, registrationId, action, payload = {}) {
    if (!authorize(actor, action.includes("race_number") ? "race_number" : "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction(async (db) => {
      const registration = db.registrations.find((item) => item.id === registrationId && !item.deletedAt); if (!registration) return { ok: false, code: "NOT_FOUND" };
      const before = { entryStatus: registration.entryStatus, raceNumber: registration.raceNumber, paymentStatus: entities(db, registration).payment.status };
      const metadata = {};
      if (action === "race_number") {
        const number = Number(payload.raceNumber); if (!Number.isInteger(number) || number < 1 || number > 999) return { ok: false, code: "INVALID_RACE_NUMBER" };
        if (db.registrations.some((item) => item.id !== registration.id && item.raceNumber === number && !item.deletedAt)) return { ok: false, code: "DUPLICATE_RACE_NUMBER" };
        registration.raceNumber = number; audit(db, actor, before.raceNumber ? "race_number_changed" : "race_number_assigned", registration.id, { raceNumber: before.raceNumber }, { raceNumber: number });
      } else if (action === "remove_race_number") {
        if (!registration.raceNumber) return { ok: false, code: "NO_RACE_NUMBER" }; registration.raceNumber = null; metadata.releasedRaceNumber = before.raceNumber; audit(db, actor, "race_number_removed", registration.id, { raceNumber: before.raceNumber }, { raceNumber: null });
      } else if (action === "refund") {
        const payment = entities(db, registration).payment; if (payment.status !== "paid") return { ok: false, code: "INVALID_PAYMENT_TRANSITION" }; payment.status = "refunded"; payment.updatedAt = now(); audit(db, actor, "refund_recorded", registration.id, { status: before.paymentStatus }, { status: "refunded" });
      } else if (action === "cancel") {
        const released = payload.releaseRaceNumber && registration.raceNumber ? registration.raceNumber : null; if (released) { registration.raceNumber = null; metadata.releasedRaceNumber = released; audit(db, actor, "race_number_removed", registration.id, { raceNumber: released }, { raceNumber: null }); }
        const releasedPlace = registration.entryStatus === "accepted"; registration.entryStatus = "cancelled"; registration.waitingListPosition = null; audit(db, actor, "entry_cancelled", registration.id, { entryStatus: before.entryStatus }, { entryStatus: "cancelled" });
        if (releasedPlace) { const promoted = db.registrations.filter((item) => item.entryStatus === "waiting_list" && active(item)).sort((a, b) => a.waitingSequence - b.waitingSequence)[0]; if (promoted) { promoted.entryStatus = "accepted"; promoted.waitingListPosition = null; audit(db, actor, "entry_promoted", promoted.id, { entryStatus: "waiting_list" }, { entryStatus: "accepted" }); } }
        refreshWaiting(db, actor);
        const runner = entities(db, registration).runner; db.communications.push(await this.emailAdapter.capture({ id: id("message"), registrationId: registration.id, template: "registration_cancelled", intendedRecipientAddress: runner.email, intendedRecipientReference: runner.id, createdAt: now() }));
      } else if (action === "promote") {
        if (registration.entryStatus !== "waiting_list" || status(db).remaining < 1) return { ok: false, code: "NO_AVAILABLE_PLACE" }; registration.entryStatus = "accepted"; registration.waitingListPosition = null; refreshWaiting(db, actor); audit(db, actor, "entry_promoted", registration.id, { entryStatus: "waiting_list" }, { entryStatus: "accepted" });
      } else if (action === "entry_status") {
        const requested = payload.entryStatus;
        if (requested === registration.entryStatus) return { ok: true, registration: view(db, registration) };
        if (requested === "accepted" && registration.entryStatus === "waiting_list" && status(db).remaining > 0) { registration.entryStatus = "accepted"; registration.waitingListPosition = null; refreshWaiting(db, actor); audit(db, actor, "entry_status_changed", registration.id, { entryStatus: before.entryStatus }, { entryStatus: "accepted" }); }
        else if (requested === "waiting_list" && registration.entryStatus === "accepted") { registration.entryStatus = "waiting_list"; registration.waitingSequence = ++db.counters.waitingSequence; refreshWaiting(db, actor); audit(db, actor, "entry_status_changed", registration.id, { entryStatus: before.entryStatus }, { entryStatus: "waiting_list" }); }
        else return { ok: false, code: "INVALID_ENTRY_TRANSITION" };
      } else if (action === "correct") {
        const runner = entities(db, registration).runner; const allowed = ["firstName", "lastName", "phone", "club", "travelMethod"]; const changed = {}; for (const field of allowed) if (payload[field] !== undefined) { changed[field] = { before: field === "phone" ? "redacted" : runner[field], after: field === "phone" ? "redacted" : normalizeName(payload[field]) }; runner[field] = normalizeName(payload[field]); } audit(db, actor, "data_corrected", registration.id, null, { fields: Object.keys(changed) });
      } else return { ok: false, code: "INVALID_ACTION" };
      registration.updatedAt = now(); return { ok: true, registration: view(db, registration), ...metadata };
    });
  }

  async auditHistory(actor, registrationId) { if (!authorize(actor, "audit")) return { ok: false, code: "FORBIDDEN" }; const db = await this.repository.read(); return { ok: true, events: db.auditEvents.filter((item) => item.registrationId === registrationId) }; }
  async exportPublic(actor) { if (!authorize(actor, "read")) return { ok: false, code: "FORBIDDEN" }; const db = await this.repository.read(); const rows = db.registrations.filter((item) => !item.deletedAt).map((item) => { const entry = view(db, item); return [entry.testReference, entry.raceNumber, entry.runner.firstName, entry.runner.lastName, entry.runner.club, entry.runner.genderCategory, entry.entryStatus, entry.paymentStatus]; }); return { ok: true, filename: "synthetic-public-results.csv", csv: csv(["test_reference", "race_number", "first_name", "last_name", "club", "category", "entry_status", "mock_payment_status"], rows) }; }
  async exportPrivate(actor) { if (!authorize(actor, "export_private")) return { ok: false, code: "FORBIDDEN" }; const db = await this.repository.read(); const rows = db.registrations.filter((item) => !item.deletedAt).map((item) => { const entry = view(db, item); return [entry.id, entry.runner.firstName, entry.runner.lastName, entry.runner.email, entry.runner.phone, entry.entryStatus, entry.paymentStatus]; }); return { ok: true, warning: "PRIVATE SYNTHETIC OPERATIONAL EXPORT — store outside the public website", filename: `private-exports/synthetic-registration-${new Date().toISOString().slice(0, 10)}.csv`, csv: csv(["registration_id", "first_name", "last_name", "email", "phone", "entry_status", "mock_payment_status"], rows) }; }
  erase(actor, registrationId, mode = "anonymise") { if (!authorize(actor, "erase")) return Promise.resolve({ ok: false, code: "FORBIDDEN" }); return this.repository.transaction((db) => { const registration = db.registrations.find((item) => item.id === registrationId && !item.deletedAt); if (!registration) return { ok: false, code: "NOT_FOUND" }; const runner = entities(db, registration).runner; if (mode === "delete" && db.environment !== "local") return { ok: false, code: "DELETE_TEST_ONLY" }; if (mode === "delete") { registration.deletedAt = now(); db.emergencyContacts = db.emergencyContacts.filter((item) => item.registrationId !== registration.id); audit(db, actor, "record_deleted", registration.id); } else { Object.assign(runner, { firstName: "Anonymised", lastName: "Runner", email: `${registration.id}@deleted.invalid`, phone: "deleted", dateOfBirth: null, membershipNumber: null, anonymisedAt: now() }); db.emergencyContacts = db.emergencyContacts.filter((item) => item.registrationId !== registration.id); audit(db, actor, "record_anonymised", registration.id); } return { ok: true }; }); }
  async resetDevelopment(actor) { if (!authorize(actor, "erase")) return { ok: false, code: "FORBIDDEN" }; const existing = await this.repository.read(); if (existing.environment !== "local") return { ok: false, code: "DEVELOPMENT_ONLY" }; const next = createDatabase({ environment: "local", registrationState: "test", capacity: existing.event.capacity }); next.testProgress.resetCompleted = true; await this.repository.reset(next); return { ok: true, state: next }; }
}

export const csvFormulaSafe = formulaSafe;
