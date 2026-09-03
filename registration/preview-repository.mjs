import { initialState, submitRegistration, applyMockPayment, cancelRegistration } from "./registration-core.mjs";

export const STORAGE_KEY = "blorenge-registration-preview";
export const SCHEMA_VERSION = 3;
export const UPDATE_EVENT = "blorenge-registration-preview-updated";
export const LEGACY_STORAGE_KEYS = Object.freeze(["blorenge-registration-prototype-v1"]);
export const DEVELOPMENT_HOSTNAME = "black-tree-04204eb03.3.azurestaticapps.net";
export function isRepositoryStorageEvent(event) { return event?.key === STORAGE_KEY; }
export function environmentForHostname(hostname) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local";
  if (hostname === DEVELOPMENT_HOSTNAME) return "development";
  if (/azurestaticapps\.net$/i.test(hostname) && /-\d+\.\d+\.azurestaticapps\.net$/i.test(hostname)) return "preview";
  return "production";
}
export function queryRegistrations(state, { search = "", entry = "", payment = "" } = {}) {
  const needle = search.toLowerCase().trim();
  return state.registrations.filter((item) => {
    const text = `${item.testReference} ${item.runner.firstName} ${item.runner.lastName} ${item.runner.club} ${item.runner.email}`.toLowerCase();
    return (!needle || text.includes(needle)) && (!entry || item.entryStatus === entry) && (!payment || item.paymentStatus === payment);
  });
}

export function createFixtureState(fixtures, environment = "preview") {
  const state = initialState({ environment, state: "test", capacity: 110 });
  const waiting = [];
  for (const fixture of fixtures.filter((item) => item.submit)) {
    const result = submitRegistration(state, fixture.runner, { source: "seed" });
    if (!result.ok) continue;
    if (fixture.payment) applyMockPayment(state, result.registration.id, fixture.payment);
    if (fixture.refund) applyMockPayment(state, result.registration.id, "refunded");
    if (fixture.cancel) cancelRegistration(state, result.registration.id);
    if (fixture.seedEntryStatus === "waiting_list" && result.registration.entryStatus !== "cancelled") waiting.push(result.registration);
  }
  waiting.forEach((registration, index) => {
    registration.entryStatus = "waiting_list";
    registration.waitingListPosition = index + 1;
  });
  return state;
}

function validState(state, environment) {
  return state && state.environment === environment && state.event?.id === "blorenge-2026" &&
    Array.isArray(state.registrations) && Array.isArray(state.auditEvents) && Array.isArray(state.communications) && state.testProgress &&
    state.registrations.every((item) => item?.id && item?.testReference && item?.runner?.id && item?.runner?.email);
}

export function createPreviewRepository({ storage, environment = "preview", now = () => new Date().toISOString(), dispatch = () => {} }) {
  function envelope(state) { return { schemaVersion: SCHEMA_VERSION, updatedAt: now(), state }; }
  function write(state) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(envelope(state)));
      dispatch({ key: STORAGE_KEY });
      return { ok: true };
    } catch {
      return { ok: false, code: "STORAGE_UNAVAILABLE", message: "Test data could not be saved in this browser. Use a normal browser window with site storage enabled, then choose Reset test." };
    }
  }
  function baseline() { return initialState({ environment, state: "test", capacity: 110 }); }
  function read() {
    let raw;
    try { raw = storage.getItem(STORAGE_KEY); }
    catch {
      return { state: baseline(), recovery: { required: true, code: "STORAGE_UNAVAILABLE", message: "Browser storage is unavailable. No test registration can be saved." } };
    }
    if (!raw) {
      try {
        if (LEGACY_STORAGE_KEYS.some((key) => storage.getItem(key))) {
          return { state: baseline(), recovery: { required: true, code: "STORAGE_SCHEMA_INVALID", message: "Stored test data uses an older version. Choose Reset test to recover safely." } };
        }
      } catch {
        return { state: baseline(), recovery: { required: true, code: "STORAGE_UNAVAILABLE", message: "Browser storage is unavailable. No test registration can be saved." } };
      }
      const state = baseline();
      const result = write(state);
      return result.ok ? { state, recovery: null } : { state, recovery: { required: true, ...result } };
    }
    try {
      const saved = JSON.parse(raw);
      if (saved.schemaVersion !== SCHEMA_VERSION || !validState(saved.state, environment)) {
        return { state: baseline(), recovery: { required: true, code: "STORAGE_SCHEMA_INVALID", message: "Stored test data is outdated or malformed. Choose Reset test to recover safely." } };
      }
      return { state: saved.state, recovery: null, updatedAt: saved.updatedAt };
    } catch {
      return { state: baseline(), recovery: { required: true, code: "STORAGE_CORRUPT", message: "Stored test data could not be read. Choose Reset test to recover safely." } };
    }
  }
  function mutate(operation) {
    const snapshot = read();
    if (snapshot.recovery) return { ok: false, code: snapshot.recovery.code, message: snapshot.recovery.message };
    const result = operation(snapshot.state);
    if (!result.ok) return result;
    const saved = write(snapshot.state);
    return saved.ok ? result : saved;
  }
  return {
    storageKey: STORAGE_KEY,
    schemaVersion: SCHEMA_VERSION,
    load: read,
    mutate,
    reset() {
      const state = baseline();
      state.testProgress.resetCompleted = true;
      const result = write(state);
      if (result.ok) {
        try { LEGACY_STORAGE_KEYS.forEach((key) => storage.removeItem(key)); } catch { /* The new empty test state is already safely stored. */ }
      }
      return result.ok ? { ok: true, state } : result;
    }
  };
}
