import { initialState, submitRegistration, applyMockPayment, cancelRegistration, promoteRegistration, updateTestSettings, assignRaceNumber, removeRaceNumber, markOrganiserViewed, statusSummary, sanitizedCsv } from "./registration-core.mjs";
import { createPreviewRepository, STORAGE_KEY, SCHEMA_VERSION, UPDATE_EVENT, isRepositoryStorageEvent, environmentForHostname } from "./preview-repository.mjs";

const hostname = window.location.hostname;
const environment = environmentForHostname(hostname);
export const isLocal = environment === "local";
export const isPreview = environment === "preview";
export const isDevelopment = environment === "development";
export const canTest = isLocal || isPreview || isDevelopment;
const usesApi = isLocal || isDevelopment;
const privateInvitationToken = new URLSearchParams(window.location.search).get("invite");
export const supportsManagedApi = usesApi;
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
const MANAGEMENT_TOKEN_SESSION_KEY = "blorenge-development-management-token";
const ORDER_TOKEN_SESSION_KEY = "blorenge-development-order-token";

async function api(path, options = {}, organiser = false) {
  const response = await fetch(`/api/v2${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(organiser && isLocal ? { "x-development-organiser": "enabled" } : {}), ...(options.headers ?? {}) }
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error(`API ${response.status}`);
  return response.json();
}

async function phase3Api(path, options = {}, organiser = false) {
  const response = await fetch(`/api/v3${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(organiser && isLocal ? { "x-development-organiser": "enabled" } : {}), ...(options.headers ?? {}) }
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error(`API ${response.status}`);
  return response.json();
}

async function phase4Api(path, options = {}, organiser = false) {
  const response = await fetch(`/api/v4${path}`, {
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
  hasPrivateInvitation: Boolean(privateInvitationToken),
  async inspectPrivateAccess(purpose = "registration") {
    if (!privateInvitationToken || !usesApi) return { ok: !privateInvitationToken };
    try { return await api(`/private-access?purpose=${encodeURIComponent(purpose)}`, { headers: { "x-private-invitation": privateInvitationToken } }); }
    catch { return { ok: false, code: "LINK_UNAVAILABLE" }; }
  },
  async status() {
    if (!canTest) return { state: "closed", operationalState: "CLOSED", environment: "production", capacity: 120, accepted: 0, remaining: 120, waiting: 0, recovery: null };
    if (usesApi) {
      try { return await api("/registration/status"); } catch { return { state: "closed", operationalState: "CLOSED", environment: "local", capacity: 120, accepted: 0, remaining: 120, waiting: 0, recovery: { required: true, message: "The persistent development API is unavailable." } }; }
    }
    const snapshot = repositorySnapshot();
    return { ...statusSummary(snapshot.state), recovery: snapshot.recovery };
  },
  submit(payload) {
    if (usesApi) return api("/registrations", { method: "POST", body: JSON.stringify(payload), headers: { "idempotency-key": submissionKey, ...(privateInvitationToken ? { "x-private-invitation": privateInvitationToken } : {}) } }).then((result) => { if (result.ok) { confirmationTokens.set(result.registration.id, result.confirmationToken); this.rememberManagementToken(result.managementToken); submissionKey = crypto.randomUUID(); } return result; }).catch(() => ({ ok: false, code: "API_UNAVAILABLE", message: "The persistent development API is unavailable." }));
    return localApiOrRepository("/registrations", { method: "POST", body: JSON.stringify(payload) }, (state) => submitRegistration(state, payload, { source: "runner" }));
  },
  rememberManagementToken(token) { if (token) window.sessionStorage.setItem(MANAGEMENT_TOKEN_SESSION_KEY, token); },
  forgetManagementToken() { window.sessionStorage.removeItem(MANAGEMENT_TOKEN_SESSION_KEY); },
  managementToken() { return window.sessionStorage.getItem(MANAGEMENT_TOKEN_SESSION_KEY); },
  rememberOrderToken(token) { if (token) window.sessionStorage.setItem(ORDER_TOKEN_SESSION_KEY, token); },
  orderToken() {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("order");
    if (fragment) this.rememberOrderToken(fragment);
    return fragment || window.sessionStorage.getItem(ORDER_TOKEN_SESSION_KEY);
  },
  async createOrder(purchaserEmail) {
    try { const result = await phase4Api("/orders", { method: "POST", body: JSON.stringify({ purchaserEmail }) }); if (result.ok) this.rememberOrderToken(result.orderToken); return result; }
    catch { return { ok: false, code: "API_UNAVAILABLE" }; }
  },
  async currentOrder(token = this.orderToken()) {
    if (!token) return { ok: false, code: "ORDER_TOKEN_INVALID" };
    try { return await phase4Api("/orders/current", { headers: { "x-order-token": token } }); } catch { return { ok: false, code: "API_UNAVAILABLE" }; }
  },
  async addOrderRunner(input, token = this.orderToken()) {
    try { return await phase4Api("/orders/runners", { method: "POST", body: JSON.stringify(input), headers: { "x-order-token": token } }); } catch { return { ok: false, code: "API_UNAVAILABLE" }; }
  },
  async updateOrderRunner(registrationId, input, token = this.orderToken()) {
    try { return await phase4Api(`/orders/runners/${encodeURIComponent(registrationId)}`, { method: "POST", body: JSON.stringify(input), headers: { "x-order-token": token } }); } catch { return { ok: false, code: "API_UNAVAILABLE" }; }
  },
  async removeOrderRunner(registrationId, token = this.orderToken()) {
    try { return await phase4Api(`/orders/runners/${encodeURIComponent(registrationId)}/remove`, { method: "POST", headers: { "x-order-token": token } }); } catch { return { ok: false, code: "API_UNAVAILABLE" }; }
  },
  async checkoutOrder(token = this.orderToken()) {
    try { return await phase4Api("/orders/checkout", { method: "POST", headers: { "x-order-token": token } }); } catch { return { ok: false, code: "PAYMENTS_UNAVAILABLE" }; }
  },
  async declarationEntry(token) { try { return await phase4Api("/declarations/entry", { headers: { "x-declaration-token": token } }); } catch { return { ok: false, code: "LINK_UNAVAILABLE" }; } },
  async recoverDeclarationLink(email) { try { return await phase4Api("/declarations/recover", { method: "POST", body: JSON.stringify({ email }) }); } catch { return { ok: false, code: "API_UNAVAILABLE" }; } },
  async completeDeclaration(token, input) { try { return await phase4Api("/declarations/complete", { method: "POST", body: JSON.stringify(input), headers: { "x-declaration-token": token } }); } catch { return { ok: false, code: "LINK_UNAVAILABLE" }; } },
  async resendDeclaration(registrationId) { try { return await phase4Api(`/organiser/registrations/${encodeURIComponent(registrationId)}/declaration/resend`, { method: "POST" }, true); } catch { return { ok: false, code: "API_UNAVAILABLE" }; } },
  async recordPaperDeclaration(registrationId) { try { return await phase4Api(`/organiser/registrations/${encodeURIComponent(registrationId)}/declaration/paper`, { method: "POST" }, true); } catch { return { ok: false, code: "API_UNAVAILABLE" }; } },
  async organiserTransfer(registrationId, input) { try { return await phase4Api(`/organiser/registrations/${encodeURIComponent(registrationId)}/transfer`, { method: "POST", body: JSON.stringify(input) }, true); } catch { return { ok: false, code: "API_UNAVAILABLE" }; } },
  async integrationStatus() {
    if (!usesApi) return { ok: true, stripe: "disabled", paymentsAvailable: false, email: "captured-only", externalEmailAvailable: false };
    try { return await phase3Api("/registration/status"); }
    catch { return { ok: false, stripe: "disabled", paymentsAvailable: false, email: "captured-only", externalEmailAvailable: false }; }
  },
  async paymentStatus(token = this.managementToken()) {
    if (!usesApi || !token) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
    try { return await phase3Api("/payments/status", { headers: { "x-management-token": token } }); }
    catch { return { ok: false, code: "PAYMENTS_UNAVAILABLE" }; }
  },
  async checkout(token = this.managementToken()) {
    if (!usesApi || !token) return { ok: false, code: "PAYMENTS_UNAVAILABLE" };
    try { return await phase3Api("/payments/checkout", { method: "POST", headers: { "x-management-token": token } }); }
    catch { return { ok: false, code: "PAYMENTS_UNAVAILABLE" }; }
  },
  async requestRefund(token = this.managementToken()) {
    if (!usesApi || !token) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
    try { return await phase3Api("/refunds/request", { method: "POST", headers: { "x-management-token": token } }); }
    catch { return { ok: false, code: "REFUND_UNAVAILABLE" }; }
  },
  async managementEntry(token = this.managementToken()) {
    if (!usesApi || !token) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
    try { return await phase3Api("/management/entry", { headers: { "x-management-token": token } }); }
    catch { return { ok: false, code: "MANAGEMENT_UNAVAILABLE" }; }
  },
  async recoverManagementLink(email) {
    if (!usesApi) return { ok: false, code: "MANAGEMENT_UNAVAILABLE" };
    try { return await phase3Api("/management/recover", { method: "POST", body: JSON.stringify({ email }) }); }
    catch { return { ok: false, code: "MANAGEMENT_UNAVAILABLE" }; }
  },
  async amendEntry(changes, token = this.managementToken()) {
    if (!usesApi || !token) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
    try { return await phase3Api("/management/amend", { method: "POST", body: JSON.stringify(changes), headers: { "x-management-token": token } }); }
    catch { return { ok: false, code: "MANAGEMENT_UNAVAILABLE" }; }
  },
  async transferEntry(input, token = this.managementToken()) {
    if (!usesApi || !token) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
    try { return await phase3Api("/management/transfer", { method: "POST", body: JSON.stringify(input), headers: { "x-management-token": token } }); }
    catch { return { ok: false, code: "MANAGEMENT_UNAVAILABLE" }; }
  },
  async decideRefund(id, decision) {
    if (!usesApi || !["approve", "reject"].includes(decision)) return { ok: false, code: "REFUND_UNAVAILABLE" };
    try { return await phase3Api(`/organiser/refunds/${encodeURIComponent(id)}/${decision}`, { method: "POST" }, true); }
    catch { return { ok: false, code: "REFUND_UNAVAILABLE" }; }
  },
  async executeRefund(id) {
    if (!usesApi) return { ok: false, code: "REFUND_UNAVAILABLE" };
    try { return await phase3Api(`/organiser/refunds/${encodeURIComponent(id)}/execute`, { method: "POST" }, true); }
    catch { return { ok: false, code: "REFUND_UNAVAILABLE" }; }
  },
  async resendManagementLink(registrationId) {
    if (!usesApi) return { ok: false, code: "MANAGED_API_REQUIRED" };
    try { return await phase3Api(`/organiser/registrations/${encodeURIComponent(registrationId)}/resend-management`, { method: "POST" }, true); }
    catch { return { ok: false, code: "MANAGEMENT_UNAVAILABLE" }; }
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
  correctEntry(id, changes) { return localApiOrRepository(`/organiser/registrations/${id}/correct`, { method: "POST", body: JSON.stringify(changes) }, () => ({ ok: false, code: "MANAGED_API_REQUIRED" }), true); },
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
  async privateInvitations() { return usesApi ? api("/organiser/private-invitations", {}, true) : { ok: false, code: "MANAGED_API_REQUIRED", invitations: [] }; },
  async createPrivateInvitation(input) { return usesApi ? api("/organiser/private-invitations", { method: "POST", body: JSON.stringify(input) }, true) : { ok: false, code: "MANAGED_API_REQUIRED" }; },
  async revokePrivateInvitation(id) { return usesApi ? api(`/organiser/private-invitations/${encodeURIComponent(id)}/revoke`, { method: "POST" }, true) : { ok: false, code: "MANAGED_API_REQUIRED" }; },
  async expirePrivateInvitation(id) { return usesApi ? api(`/organiser/private-invitations/${encodeURIComponent(id)}/expire`, { method: "POST" }, true) : { ok: false, code: "MANAGED_API_REQUIRED" }; },
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
