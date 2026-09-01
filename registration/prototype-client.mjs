import { initialState, submitRegistration, applyMockPayment, cancelRegistration, promoteRegistration, updateTestSettings, assignRaceNumber, statusSummary, sanitizedCsv } from "./registration-core.mjs";

const STORAGE_KEY = "blorenge-registration-prototype-v1";
const hostname = window.location.hostname;
export const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
export const isPreview = /azurestaticapps\.net$/i.test(hostname) && /-\d+\.\d+\.azurestaticapps\.net$/i.test(hostname);
export const canTest = isLocal || isPreview;

function browserState() {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch { window.localStorage.removeItem(STORAGE_KEY); }
  }
  return initialState({ environment: isPreview ? "preview" : "local" });
}

function save(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("registration-prototype-updated"));
}

async function api(path, options = {}) {
  const response = await fetch(`/api/registration${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) }
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error(`API ${response.status}`);
  return response.json();
}

async function localApiOrSimulation(path, options, simulate) {
  if (!canTest) return { ok: false, code: "PRODUCTION_CLOSED", message: "2026 entries are not yet open." };
  if (isLocal) {
    try { return await api(path, options); } catch { /* A plain static localhost server uses the isolated simulation. */ }
  }
  const state = browserState();
  const result = simulate(state);
  save(state);
  return result;
}

export const prototype = {
  async status() {
    if (!canTest) return { state: "closed", environment: "production", capacity: 110, accepted: 0, remaining: 110, waiting: 0 };
    if (isLocal) {
      try { return await api("/status"); } catch { /* fallback below */ }
    }
    return statusSummary(browserState());
  },
  submit(payload) {
    return localApiOrSimulation("/entries", { method: "POST", body: JSON.stringify(payload) }, (state) => submitRegistration(state, payload));
  },
  payment(id, outcome) {
    return localApiOrSimulation(`/entries/${id}/payment`, { method: "POST", body: JSON.stringify({ outcome }) }, (state) => applyMockPayment(state, id, outcome));
  },
  async all() {
    if (!canTest) return { state: initialState({ environment: "production", state: "closed" }) };
    if (isLocal) {
      try { return await api("/organiser"); } catch { /* fallback below */ }
    }
    return { state: browserState() };
  },
  cancel(id) { return localApiOrSimulation(`/entries/${id}/cancel`, { method: "POST" }, (state) => cancelRegistration(state, id)); },
  promote(id) { return localApiOrSimulation(`/entries/${id}/promote`, { method: "POST" }, (state) => promoteRegistration(state, id)); },
  assign(id, raceNumber) { return localApiOrSimulation(`/entries/${id}/race-number`, { method: "POST", body: JSON.stringify({ raceNumber }) }, (state) => assignRaceNumber(state, id, raceNumber)); },
  settings(changes) { return localApiOrSimulation("/settings", { method: "POST", body: JSON.stringify(changes) }, (state) => updateTestSettings(state, changes)); },
  reset() {
    return localApiOrSimulation("/reset", { method: "POST" }, (state) => {
      const fresh = initialState({ environment: state.environment });
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, fresh);
      return { ok: true };
    });
  },
  async csv() {
    const { state } = await this.all();
    return sanitizedCsv(state);
  }
};
