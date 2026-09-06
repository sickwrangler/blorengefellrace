import { initialState, submitRegistration, applyMockPayment, cancelRegistration, promoteRegistration, updateTestSettings, assignRaceNumber, removeRaceNumber, markOrganiserViewed, statusSummary, sanitizedCsv } from "./registration-core.mjs";
import { createPreviewRepository, STORAGE_KEY, SCHEMA_VERSION, UPDATE_EVENT, isRepositoryStorageEvent, environmentForHostname } from "./preview-repository.mjs";

const hostname = window.location.hostname;
const environment = environmentForHostname(hostname);
export const isLocal = environment === "local";
export const isPreview = environment === "preview";
export const isDevelopment = environment === "development";
export const canTest = isLocal || isPreview || isDevelopment;
const usesApi = isLocal || isDevelopment;
const storageAdapter = {
  getItem(key) { return window.localStorage.getItem(key); },
  setItem(key, value) { window.localStorage.setItem(key, value); },
  removeItem(key) { window.localStorage.removeItem(key); }
};
const repository = createPreviewRepository({
  storage: storageAdapter,
  environment: isPreview ? "preview" : "local",
  dispatch: () => window.dispatchEvent(new CustomEvent(UPDATE_EVENT))
});
let submissionKey = crypto.randomUUID();
const confirmationTokens = new Map();
const paymentKeys = new Map();

async function api(path, options = {}, organiser = false) {
  const response = await fetch(`/api/v2${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(organiser && isLocal ? { "x-development-organiser": "enabled" } : {}), ...(options.headers ?? {}) }
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error(`API ${response.status}`);
  return response.json();
}

async function localApiOrRepository(path, options, operation, organiser = false) {
  if (!canTest) return { ok: false, code: "PRODUCTION_CLOSED", message: "2026 entries are not yet open." };
  if (usesApi) {
    try { return await api(path, options, organiser); } catch { return { ok: false, code: "API_UNAVAILABLE", message: "The persistent development API is unavailable. Start it with the documented Phase 2 command." }; }
  }
  return repository.mutate(operation);
}

function repositorySnapshot() {
  const snapshot = repository.load();
  return {
    ...snapshot,
    diagnostics: {
      environment: isPreview ? "Azure PR preview" : "local browser fallback",
      storageType: "localStorage (same browser and profile only)",
      storageKey: STORAGE_KEY,
      schemaVersion: SCHEMA_VERSION,
      registrationsLoaded: snapshot.state.registrations.length,
      lastRefreshTime: new Date().toISOString()
    }
  };
}

export const prototype = {
  async status() {
    if (!canTest) return { state: "closed", environment: "production", capacity: 110, accepted: 0, remaining: 110, waiting: 0, recovery: null };
    if (usesApi) {
      try { return await api("/registration/status"); } catch { return { state: "closed", environment: "local", capacity: 110, accepted: 0, remaining: 110, waiting: 0, recovery: { required: true, message: "The persistent development API is unavailable." } }; }
    }
    const snapshot = repositorySnapshot();
    return { ...statusSummary(snapshot.state), recovery: snapshot.recovery };
  },
  submit(payload) {
    if (usesApi) return api("/registrations", { method: "POST", body: JSON.stringify(payload), headers: { "idempotency-key": submissionKey } }).then((result) => { if (result.ok) { confirmationTokens.set(result.registration.id, result.confirmationToken); submissionKey = crypto.randomUUID(); } return result; }).catch(() => ({ ok: false, code: "API_UNAVAILABLE", message: "The persistent development API is unavailable." }));
    return localApiOrRepository("/registrations", { method: "POST", body: JSON.stringify(payload) }, (state) => submitRegistration(state, payload, { source: "runner" }));
  },
  payment(id, outcome) {
    if (usesApi) { const confirmationToken = confirmationTokens.get(id); const key = paymentKeys.get(id) ?? crypto.randomUUID(); paymentKeys.set(id, key); return api(`/registrations/${encodeURIComponent(confirmationToken)}/mock-payment`, { method: "POST", body: JSON.stringify({ outcome }), headers: { "idempotency-key": key } }).then((result) => { if (result.ok) paymentKeys.delete(id); return result; }); }
    return localApiOrRepository(`/registrations/${id}/payment`, { method: "POST", body: JSON.stringify({ outcome }) }, (state) => applyMockPayment(state, id, outcome));
  },
  async all() {
    if (!canTest) return { state: initialState({ environment: "production", state: "closed" }), recovery: null, diagnostics: { environment: "production", storageType: "none", storageKey: "none", schemaVersion: SCHEMA_VERSION, registrationsLoaded: 0, lastRefreshTime: new Date().toISOString() } };
    if (usesApi) {
      try {
        const result = await api("/organiser/snapshot", {}, true);
        return { ...result, recovery: null, diagnostics: { environment: "local development API", storageType: "persistent server repository", storageKey: "server-side only", schemaVersion: result.state.version, registrationsLoaded: result.state.registrations.length, lastRefreshTime: new Date().toISOString() } };
      } catch { return { state: initialState({ environment: "local", state: "closed" }), recovery: { required: true, message: "The persistent development API is unavailable." }, diagnostics: { environment: "local", storageType: "unavailable", storageKey: "server-side only", schemaVersion: 2, registrationsLoaded: 0, lastRefreshTime: new Date().toISOString() } }; }
    }
    return repositorySnapshot();
  },
  cancel(id, releaseRaceNumber = false) { return localApiOrRepository(`/organiser/registrations/${id}/cancel`, { method: "POST", body: JSON.stringify({ releaseRaceNumber }) }, (state) => cancelRegistration(state, id, { releaseRaceNumber }), true); },
  promote(id) { return localApiOrRepository(`/organiser/registrations/${id}/promote`, { method: "POST" }, (state) => promoteRegistration(state, id), true); },
  assign(id, raceNumber) { return localApiOrRepository(`/organiser/registrations/${id}/race-number`, { method: "POST", body: JSON.stringify({ raceNumber }) }, (state) => assignRaceNumber(state, id, raceNumber), true); },
  removeRaceNumber(id) { return localApiOrRepository(`/organiser/registrations/${id}/remove-race-number`, { method: "POST" }, (state) => removeRaceNumber(state, id), true); },
  refund(id) { return localApiOrRepository(`/organiser/registrations/${id}/refund`, { method: "POST" }, (state) => applyMockPayment(state, id, "refunded"), true); },
  markViewed(testReference) { return localApiOrRepository(`/organiser/registrations/reference/${encodeURIComponent(testReference)}/viewed`, { method: "POST" }, (state) => markOrganiserViewed(state, testReference), true); },
  async audit(id) {
    if (!canTest) return { ok: false, code: "PRODUCTION_CLOSED", events: [] };
    if (usesApi) return api(`/organiser/registrations/${encodeURIComponent(id)}/audit`, {}, true).catch(() => ({ ok: false, code: "API_UNAVAILABLE", events: [] }));
    const { state } = await this.all();
    return { ok: true, events: state.auditEvents.filter((event) => event.registrationId === id) };
  },
  settings(changes) { return localApiOrRepository("/settings", { method: "POST", body: JSON.stringify(changes) }, (state) => updateTestSettings(state, changes)); },
  async reset() {
    if (!canTest) return { ok: false, code: "PRODUCTION_CLOSED" };
    if (usesApi) {
      try { return await api("/organiser/reset", { method: "POST" }, true); } catch { return { ok: false, code: "API_UNAVAILABLE" }; }
    }
    return repository.reset();
  },
  async csv() { if (usesApi) { const result = await api("/organiser/export/public", {}, true); return result.csv; } const { state } = await this.all(); return sanitizedCsv(state); },
  subscribe(callback) {
    const localHandler = () => callback("same-tab");
    const storageHandler = (event) => { if (isRepositoryStorageEvent(event)) callback("cross-tab"); };
    window.addEventListener(UPDATE_EVENT, localHandler);
    window.addEventListener("storage", storageHandler);
    const polling = usesApi ? window.setInterval(() => callback("server-poll"), 2000) : null;
    return () => { window.removeEventListener(UPDATE_EVENT, localHandler); window.removeEventListener("storage", storageHandler); if (polling) window.clearInterval(polling); };
  }
};

export const previewStorage = Object.freeze({ key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
