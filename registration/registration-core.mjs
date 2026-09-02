export const EVENT = Object.freeze({
  id: "blorenge-2026",
  name: "Blorenge Fell Race 2026",
  date: "2026-11-28",
  capacity: 110,
  minimumAge: 16,
  termsVersion: "prototype-2026-09",
  privacyVersion: "prototype-2026-09"
});

export const REGISTRATION_STATES = Object.freeze(["closed", "test", "open", "paused", "full"]);
export const PAYMENT_STATES = Object.freeze(["not_started", "pending", "successful", "declined", "abandoned", "refunded"]);
const SYNTHETIC_EMAIL = /@(example\.(?:com|org|net)|[^@]+\.invalid)$/i;

export function safeRegistrationState(value, environment = "production") {
  if (!REGISTRATION_STATES.includes(value)) return "closed";
  if (environment === "production" && value !== "closed") return "closed";
  if (environment !== "local" && environment !== "preview") return "closed";
  return value;
}

export function ageOnDate(dateOfBirth, eventDate = EVENT.date) {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const event = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(birth.valueOf()) || birth > event) return NaN;
  let age = event.getUTCFullYear() - birth.getUTCFullYear();
  if (event.getUTCMonth() < birth.getUTCMonth() ||
      (event.getUTCMonth() === birth.getUTCMonth() && event.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export function validateRunner(input, { requireSynthetic = true } = {}) {
  const errors = {};
  const required = ["firstName", "lastName", "email", "phone", "dateOfBirth", "genderCategory", "emergencyName", "emergencyPhone", "travelMethod"];
  for (const field of required) if (!String(input[field] ?? "").trim()) errors[field] = "This field is required.";
  const email = String(input.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  else if (requireSynthetic && email && !SYNTHETIC_EMAIL.test(email)) errors.email = "Use an obviously synthetic example.com, example.org, example.net or .invalid address.";
  for (const field of ["phone", "emergencyPhone"]) {
    const value = String(input[field] ?? "").trim();
    if (value && !/^[+()\d\s-]{7,24}$/.test(value)) errors[field] = "Enter a valid test phone number.";
  }
  const age = ageOnDate(String(input.dateOfBirth ?? ""));
  if (!Number.isFinite(age)) errors.dateOfBirth = "Enter a valid date of birth.";
  else if (age < EVENT.minimumAge) errors.dateOfBirth = `Entrants must be at least ${EVENT.minimumAge} on ${EVENT.date}.`;
  if (input.affiliated && !String(input.membershipNumber ?? "").trim()) errors.membershipNumber = "Enter a test membership number or select not affiliated.";
  if (!input.acceptTerms) errors.acceptTerms = "You must accept the prototype race terms.";
  if (!input.acceptPrivacy) errors.acceptPrivacy = "You must acknowledge the prototype privacy notice.";
  return errors;
}

export function initialState({ capacity = EVENT.capacity, state = "test", environment = "local" } = {}) {
  return {
    version: 1,
    event: { ...EVENT, capacity },
    environment,
    registrationState: safeRegistrationState(state, environment),
    registrations: [],
    auditEvents: [],
    communications: []
  };
}

function identifier(prefix = "reg") {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}

function addAudit(state, type, registrationId = null, detail = {}) {
  state.auditEvents.push({ id: identifier("audit"), occurredAt: new Date().toISOString(), type, registrationId, detail });
}

function addCommunication(state, registration, type) {
  const subjects = {
    registration_received: "Test registration received",
    payment_successful: "Mock payment successful",
    waiting_list: "Test waiting-list place",
    entry_confirmed: "Test entry confirmed",
    registration_cancelled: "Test registration cancelled"
  };
  state.communications.push({
    id: identifier("message"), registrationId: registration.id, type,
    recipient: registration.runner.email, subject: subjects[type],
    body: `${registration.runner.firstName}, this is a preview message for a synthetic test entry. No email has been sent.`,
    capturedAt: new Date().toISOString(), delivery: "captured_only"
  });
}

function acceptedCount(state) {
  return state.registrations.filter((item) => item.entryStatus === "accepted").length;
}

function refreshWaitingList(state) {
  state.registrations.filter((item) => item.entryStatus === "waiting_list")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((item, index) => { item.waitingListPosition = index + 1; });
}

export function statusSummary(state) {
  const accepted = acceptedCount(state);
  return {
    state: state.registrationState,
    environment: state.environment,
    capacity: state.event.capacity,
    accepted,
    remaining: Math.max(0, state.event.capacity - accepted),
    waiting: state.registrations.filter((item) => item.entryStatus === "waiting_list").length
  };
}

export function submitRegistration(state, input, { source = "runner" } = {}) {
  if (!["test", "open"].includes(state.registrationState)) return { ok: false, code: "REGISTRATION_NOT_ACCEPTING", message: "Registration is not accepting entries." };
  const errors = validateRunner(input, { requireSynthetic: state.registrationState === "test" });
  if (Object.keys(errors).length) return { ok: false, code: "VALIDATION_ERROR", errors };
  const email = String(input.email).trim().toLowerCase();
  if (state.registrations.some((item) => item.runner.email === email && item.entryStatus !== "cancelled")) {
    return { ok: false, code: "DUPLICATE", message: "A test registration already uses this email address." };
  }
  const entryStatus = acceptedCount(state) < state.event.capacity ? "accepted" : "waiting_list";
  const registration = {
    id: identifier(), testReference: `TEST-${identifier("").replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}`,
    source, eventId: state.event.id, environment: state.environment,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    runner: {
      id: identifier("runner"), firstName: String(input.firstName).trim(), lastName: String(input.lastName).trim(),
      email, phone: String(input.phone).trim(), dateOfBirth: input.dateOfBirth,
      genderCategory: input.genderCategory, club: String(input.club ?? "").trim() || "Unattached",
      affiliated: Boolean(input.affiliated), membershipNumber: String(input.membershipNumber ?? "").trim() || null,
      emergencyName: String(input.emergencyName).trim(), emergencyPhone: String(input.emergencyPhone).trim(),
      travelMethod: input.travelMethod
    },
    entryStatus, waitingListPosition: null, raceNumber: null,
    paymentStatus: "not_started", termsVersion: EVENT.termsVersion, privacyVersion: EVENT.privacyVersion,
    consentRecordedAt: new Date().toISOString()
  };
  state.registrations.push(registration);
  refreshWaitingList(state);
  addAudit(state, "registration_created", registration.id, { entryStatus });
  addCommunication(state, registration, "registration_received");
  if (entryStatus === "waiting_list") addCommunication(state, registration, "waiting_list");
  return { ok: true, registration };
}

export function applyMockPayment(state, registrationId, outcome) {
  const registration = state.registrations.find((item) => item.id === registrationId);
  if (!registration) return { ok: false, code: "NOT_FOUND" };
  if (!["successful", "declined", "abandoned", "refunded"].includes(outcome)) return { ok: false, code: "INVALID_PAYMENT_TRANSITION" };
  if (outcome === "refunded" && registration.paymentStatus !== "successful") return { ok: false, code: "INVALID_PAYMENT_TRANSITION" };
  registration.paymentStatus = outcome;
  registration.updatedAt = new Date().toISOString();
  addAudit(state, `mock_payment_${outcome}`, registration.id);
  if (outcome === "successful") {
    addCommunication(state, registration, "payment_successful");
    if (registration.entryStatus === "accepted") addCommunication(state, registration, "entry_confirmed");
  }
  return { ok: true, registration };
}

export function cancelRegistration(state, registrationId) {
  const registration = state.registrations.find((item) => item.id === registrationId);
  if (!registration || registration.entryStatus === "cancelled") return { ok: false, code: "NOT_FOUND" };
  const releasedPlace = registration.entryStatus === "accepted";
  registration.entryStatus = "cancelled";
  registration.waitingListPosition = null;
  registration.updatedAt = new Date().toISOString();
  addAudit(state, "registration_cancelled", registration.id);
  addCommunication(state, registration, "registration_cancelled");
  let promoted = null;
  if (releasedPlace) {
    promoted = state.registrations.filter((item) => item.entryStatus === "waiting_list")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
    if (promoted) {
      promoted.entryStatus = "accepted";
      promoted.waitingListPosition = null;
      promoted.updatedAt = new Date().toISOString();
      addAudit(state, "waiting_list_promoted", promoted.id);
      if (promoted.paymentStatus === "successful") addCommunication(state, promoted, "entry_confirmed");
    }
  }
  refreshWaitingList(state);
  return { ok: true, registration, promoted };
}

export function promoteRegistration(state, registrationId) {
  const registration = state.registrations.find((item) => item.id === registrationId && item.entryStatus === "waiting_list");
  if (!registration || acceptedCount(state) >= state.event.capacity) return { ok: false, code: "NO_AVAILABLE_PLACE" };
  registration.entryStatus = "accepted";
  registration.updatedAt = new Date().toISOString();
  refreshWaitingList(state);
  addAudit(state, "waiting_list_promoted", registration.id);
  return { ok: true, registration };
}

export function updateTestSettings(state, changes) {
  if (state.environment === "production") return { ok: false, code: "PRODUCTION_LOCKED" };
  if (changes.registrationState) {
    if (!["test", "paused", "full"].includes(changes.registrationState)) return { ok: false, code: "INVALID_STATE" };
    state.registrationState = changes.registrationState;
  }
  if (changes.capacity !== undefined) {
    const capacity = Number(changes.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return { ok: false, code: "INVALID_CAPACITY" };
    state.event.capacity = capacity;
    if (acceptedCount(state) >= capacity && state.registrationState === "test") state.registrationState = "full";
  }
  addAudit(state, "test_settings_changed", null, changes);
  return { ok: true, summary: statusSummary(state) };
}

export function assignRaceNumber(state, registrationId, raceNumber) {
  const registration = state.registrations.find((item) => item.id === registrationId);
  const number = Number(raceNumber);
  if (!registration || !Number.isInteger(number) || number < 1 || number > 999) return { ok: false, code: "INVALID_RACE_NUMBER" };
  if (state.registrations.some((item) => item.id !== registrationId && item.raceNumber === number)) return { ok: false, code: "DUPLICATE_RACE_NUMBER" };
  registration.raceNumber = number;
  registration.updatedAt = new Date().toISOString();
  addAudit(state, "race_number_assigned", registration.id, { raceNumber: number });
  return { ok: true, registration };
}

export function sanitizedCsv(state) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const headers = ["test_registration_id", "race_number", "first_name", "last_name", "club", "gender_category", "entry_status", "waiting_list_position", "mock_payment_status"];
  const rows = state.registrations.map((item) => [item.id, item.raceNumber, item.runner.firstName, item.runner.lastName, item.runner.club, item.runner.genderCategory, item.entryStatus, item.waitingListPosition, item.paymentStatus]);
  return [headers, ...rows].map((row) => row.map(quote).join(",")).join("\n");
}
