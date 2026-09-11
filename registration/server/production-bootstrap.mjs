import { PHASE3_EVENT, PHASE3_REGISTRATION_STATES } from "./phase3-domain.mjs";

export const PRODUCTION_SCHEMA_VERSION = 4;

const collectionNames = Object.freeze([
  "runners", "emergencyContacts", "registrations", "payments", "consents",
  "communications", "auditEvents", "idempotency", "amendmentRequests",
  "privateInvitations", "waitingList", "waitingListOffers", "refundRequests",
  "managementTokens", "managementRecoveryAttempts", "processedPaymentEvents",
  "orders", "orderTokens", "declarations", "declarationTokens",
  "declarationRecoveryAttempts", "reservations", "scheduledWork"
]);

export function createProductionBootstrap({ under18EntriesEnabled = false } = {}) {
  const state = {
    schemaVersion: PRODUCTION_SCHEMA_VERSION,
    environment: "production",
    registrationState: "CLOSED",
    phase3RegistrationState: "CLOSED",
    event: {
      ...PHASE3_EVENT,
      date: PHASE3_EVENT.raceDate,
      raceDate: PHASE3_EVENT.raceDate,
      minimumAge: 16,
      termsVersion: "prototype-2026-09",
      privacyVersion: "prototype-2026-09",
      declarationIdentifier: PHASE3_EVENT.declaration.identifier,
      declarationVersion: PHASE3_EVENT.declaration.version,
      declarationContentStatus: PHASE3_EVENT.declaration.contentStatus,
      transferRefundCutoff: PHASE3_EVENT.transferRefundCutoffUtc,
      transferRefundCutoffUtc: PHASE3_EVENT.transferRefundCutoffUtc,
      under18EntriesEnabled: under18EntriesEnabled === true
    },
    counters: { waitingSequence: 0 },
    schedulerStatus: { lastSuccessfulRunAt: null, lastResult: null }
  };
  for (const name of collectionNames) state[name] = [];
  return state;
}

export function validateProductionState(state) {
  if (!state || state.environment !== "production") throw new Error("Production registration state has an invalid environment.");
  if (!Number.isInteger(state.schemaVersion) || state.schemaVersion < PRODUCTION_SCHEMA_VERSION) throw new Error("Production registration state has an invalid schema.");
  if (!PHASE3_REGISTRATION_STATES.includes(state.registrationState) || state.phase3RegistrationState !== state.registrationState) throw new Error("Production registration state is missing, malformed or contradictory.");
  if (state.event?.id !== PHASE3_EVENT.id || state.event.capacity !== 120 || state.event.entryFeePence !== 600 || state.event.wfraMemberPricePence !== 400) throw new Error("Production event configuration is invalid.");
  for (const name of collectionNames) if (!Array.isArray(state[name])) throw new Error(`Production registration state is missing ${name}.`);
  return state;
}

export function productionAvailability(state) {
  try {
    validateProductionState(state);
    return { available: true, operationalState: state.registrationState };
  } catch {
    return { available: false, operationalState: "CLOSED" };
  }
}
