import { initialState, submitRegistration, applyMockPayment, cancelRegistration, promoteRegistration, updateTestSettings, assignRaceNumber, removeRaceNumber, markOrganiserViewed, statusSummary, sanitizedCsv } from "./registration-core.mjs";
import { createPreviewRepository, STORAGE_KEY, SCHEMA_VERSION, UPDATE_EVENT, isRepositoryStorageEvent, environmentForHostname } from "./preview-repository.mjs";

const hostname = window.location.hostname;
const environment = environmentForHostname(hostname);
export const isLocal = environment === "local";
export const isPreview = environment === "preview";
export const canTest = isLocal || isPreview;
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

async function api(path, options = {}) {
  const response = await fetch(`/api/registration${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) }
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error(`API ${response.status}`);
  return response.json();
}

async function localApiOrRepository(path, options, operation) {
  if (!canTest) return { ok: false, code: "PRODUCTION_CLOSED", message: "2026 entries are not yet open." };
  if (isLocal) {
    try { return await api(path, options); } catch { /* A plain static localhost server uses the same browser repository as the preview. */ }
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
    if (isLocal) {
      try { return await api("/status"); } catch { /* fallback below */ }
    }
    const snapshot = repositorySnapshot();
    return { ...statusSummary(snapshot.state), recovery: snapshot.recovery };
  },
  submit(payload) {
    return localApiOrRepository("/entries", { method: "POST", body: JSON.stringify(payload) }, (state) => submitRegistration(state, payload, { source: "runner" }));
  },
  payment(id, outcome) {
    return localApiOrRepository(`/entries/${id}/payment`, { method: "POST", body: JSON.stringify({ outcome }) }, (state) => applyMockPayment(state, id, outcome));
  },
  async all() {
    if (!canTest) return { state: initialState({ environment: "production", state: "closed" }), recovery: null, diagnostics: { environment: "production", storageType: "none", storageKey: "none", schemaVersion: SCHEMA_VERSION, registrationsLoaded: 0, lastRefreshTime: new Date().toISOString() } };
    if (isLocal) {
      try {
        const result = await api("/organiser");
        return { ...result, recovery: null, diagnostics: { environment: "local test server", storageType: "in-memory server repository", storageKey: "server session", schemaVersion: SCHEMA_VERSION, registrationsLoaded: result.state.registrations.length, lastRefreshTime: new Date().toISOString() } };
      } catch { /* fallback below */ }
    }
    return repositorySnapshot();
  },
  cancel(id, releaseRaceNumber = false) { return localApiOrRepository(`/entries/${id}/cancel`, { method: "POST", body: JSON.stringify({ releaseRaceNumber }) }, (state) => cancelRegistration(state, id, { releaseRaceNumber })); },
  promote(id) { return localApiOrRepository(`/entries/${id}/promote`, { method: "POST" }, (state) => promoteRegistration(state, id)); },
  assign(id, raceNumber) { return localApiOrRepository(`/entries/${id}/race-number`, { method: "POST", body: JSON.stringify({ raceNumber }) }, (state) => assignRaceNumber(state, id, raceNumber)); },
  removeRaceNumber(id) { return localApiOrRepository(`/entries/${id}/remove-race-number`, { method: "POST" }, (state) => removeRaceNumber(state, id)); },
  markViewed(testReference) { return localApiOrRepository(`/entries/${encodeURIComponent(testReference)}/viewed`, { method: "POST" }, (state) => markOrganiserViewed(state, testReference)); },
  settings(changes) { return localApiOrRepository("/settings", { method: "POST", body: JSON.stringify(changes) }, (state) => updateTestSettings(state, changes)); },
  async reset() {
    if (!canTest) return { ok: false, code: "PRODUCTION_CLOSED" };
    if (isLocal) {
      try { return await api("/reset", { method: "POST" }); } catch { /* fallback below */ }
    }
    return repository.reset();
  },
  async csv() { const { state } = await this.all(); return sanitizedCsv(state); },
  subscribe(callback) {
    const localHandler = () => callback("same-tab");
    const storageHandler = (event) => { if (isRepositoryStorageEvent(event)) callback("cross-tab"); };
    window.addEventListener(UPDATE_EVENT, localHandler);
    window.addEventListener("storage", storageHandler);
    return () => { window.removeEventListener(UPDATE_EVENT, localHandler); window.removeEventListener("storage", storageHandler); };
  }
};

export const previewStorage = Object.freeze({ key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
