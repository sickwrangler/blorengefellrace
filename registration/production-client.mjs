export const canTest = true;
export const supportsManagedApi = true;
const privateInvitationToken = new URLSearchParams(window.location.search).get("invite");
const MANAGEMENT_TOKEN_SESSION_KEY = "blorenge-management-token";
const ORDER_TOKEN_SESSION_KEY = "blorenge-order-token";

async function request(version, path, options = {}) {
  const response = await fetch(`/api/${version}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) }, cache: "no-store" });
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { ok: false, code: response.status === 401 || response.status === 403 ? "FORBIDDEN" : "API_UNAVAILABLE" };
  return response.json();
}
const v2 = (path, options) => request("v2", path, options);
const v3 = (path, options) => request("v3", path, options);
const v4 = (path, options) => request("v4", path, options);

export const prototype = {
  hasPrivateInvitation: Boolean(privateInvitationToken),
  inspectPrivateAccess(purpose = "registration") { return privateInvitationToken ? v2(`/private-access?purpose=${encodeURIComponent(purpose)}`, { headers: { "x-private-invitation": privateInvitationToken } }) : Promise.resolve({ ok: true }); },
  status() { return v2("/registration/status"); },
  rememberManagementToken(token) { if (token) sessionStorage.setItem(MANAGEMENT_TOKEN_SESSION_KEY, token); },
  forgetManagementToken() { sessionStorage.removeItem(MANAGEMENT_TOKEN_SESSION_KEY); },
  managementToken() { return sessionStorage.getItem(MANAGEMENT_TOKEN_SESSION_KEY); },
  rememberOrderToken(token) { if (token) sessionStorage.setItem(ORDER_TOKEN_SESSION_KEY, token); },
  orderToken() { const fragment = new URLSearchParams(location.hash.replace(/^#/, "")).get("order"); if (fragment) this.rememberOrderToken(fragment); return fragment || sessionStorage.getItem(ORDER_TOKEN_SESSION_KEY); },
  async createOrder(purchaserEmail) { const result = await v4("/orders", { method: "POST", body: JSON.stringify({ purchaserEmail }), headers: privateInvitationToken ? { "x-private-invitation": privateInvitationToken } : {} }); if (result.ok) this.rememberOrderToken(result.orderToken); return result; },
  currentOrder(token = this.orderToken()) { return token ? v4("/orders/current", { headers: { "x-order-token": token } }) : Promise.resolve({ ok: false, code: "ORDER_TOKEN_INVALID" }); },
  addOrderRunner(input, token = this.orderToken()) { return v4("/orders/runners", { method: "POST", body: JSON.stringify(input), headers: { "x-order-token": token } }); },
  updateOrderRunner(id, input, token = this.orderToken()) { return v4(`/orders/runners/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(input), headers: { "x-order-token": token } }); },
  removeOrderRunner(id, token = this.orderToken()) { return v4(`/orders/runners/${encodeURIComponent(id)}/remove`, { method: "POST", headers: { "x-order-token": token } }); },
  checkoutOrder(token = this.orderToken()) { return v4("/orders/checkout", { method: "POST", headers: { "x-order-token": token } }); },
  declarationEntry(token) { return v4("/declarations/entry", { headers: { "x-declaration-token": token } }); },
  recoverDeclarationLink(email) { return v4("/declarations/recover", { method: "POST", body: JSON.stringify({ email }) }); },
  completeDeclaration(token, input) { return v4("/declarations/complete", { method: "POST", body: JSON.stringify(input), headers: { "x-declaration-token": token } }); },
  resendDeclaration(id) { return v4(`/organiser/registrations/${encodeURIComponent(id)}/declaration/resend`, { method: "POST" }); },
  recordPaperDeclaration(id) { return v4(`/organiser/registrations/${encodeURIComponent(id)}/declaration/paper`, { method: "POST" }); },
  organiserTransfer(id, input) { return v4(`/organiser/registrations/${encodeURIComponent(id)}/transfer`, { method: "POST", body: JSON.stringify(input) }); },
  integrationStatus() { return v3("/registration/status"); },
  paymentStatus(token = this.managementToken()) { return token ? v3("/payments/status", { headers: { "x-management-token": token } }) : Promise.resolve({ ok: false, code: "MANAGEMENT_TOKEN_INVALID" }); },
  checkout(token = this.managementToken()) { return token ? v3("/payments/checkout", { method: "POST", headers: { "x-management-token": token } }) : Promise.resolve({ ok: false, code: "PAYMENTS_UNAVAILABLE" }); },
  requestRefund(token = this.managementToken()) { return token ? v3("/refunds/request", { method: "POST", headers: { "x-management-token": token } }) : Promise.resolve({ ok: false, code: "MANAGEMENT_TOKEN_INVALID" }); },
  managementEntry(token = this.managementToken()) { return token ? v3("/management/entry", { headers: { "x-management-token": token } }) : Promise.resolve({ ok: false, code: "MANAGEMENT_TOKEN_INVALID" }); },
  recoverManagementLink(email) { return v3("/management/recover", { method: "POST", body: JSON.stringify({ email }) }); },
  amendEntry(changes, token = this.managementToken()) { return v3("/management/amend", { method: "POST", body: JSON.stringify(changes), headers: { "x-management-token": token } }); },
  transferEntry(input, token = this.managementToken()) { return v3("/management/transfer", { method: "POST", body: JSON.stringify(input), headers: { "x-management-token": token } }); },
  decideRefund(id, decision) { return v3(`/organiser/refunds/${encodeURIComponent(id)}/${decision}`, { method: "POST" }); },
  executeRefund(id) { return v3(`/organiser/refunds/${encodeURIComponent(id)}/execute`, { method: "POST" }); },
  resendManagementLink(id) { return v3(`/organiser/registrations/${encodeURIComponent(id)}/resend-management`, { method: "POST" }); },
  async all() { const result = await v2("/organiser/snapshot"); return { ...result, recovery: result.ok ? null : { required: true, message: "Registration data is unavailable." }, diagnostics: { environment: "production", storageType: "private server storage", schemaVersion: result.state?.version ?? "unavailable" } }; },
  cancel(id, releaseRaceNumber = false) { return v2(`/organiser/registrations/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ releaseRaceNumber }) }); },
  promote(id) { return v2(`/organiser/registrations/${encodeURIComponent(id)}/promote`, { method: "POST" }); },
  assign(id, raceNumber) { return v2(`/organiser/registrations/${encodeURIComponent(id)}/race-number`, { method: "POST", body: JSON.stringify({ raceNumber }) }); },
  removeRaceNumber(id) { return v2(`/organiser/registrations/${encodeURIComponent(id)}/remove-race-number`, { method: "POST" }); },
  correctEntry(id, changes) { return v2(`/organiser/registrations/${encodeURIComponent(id)}/correct`, { method: "POST", body: JSON.stringify(changes) }); },
  audit(id) { return v2(`/organiser/registrations/${encodeURIComponent(id)}/audit`); },
  async csv() { const result = await v2("/organiser/export/public"); return result.csv ?? ""; },
  privateInvitations() { return v2("/organiser/private-invitations"); },
  createPrivateInvitation(input) { return v2("/organiser/private-invitations", { method: "POST", body: JSON.stringify(input) }); },
  revokePrivateInvitation(id) { return v2(`/organiser/private-invitations/${encodeURIComponent(id)}/revoke`, { method: "POST" }); },
  expirePrivateInvitation(id) { return v2(`/organiser/private-invitations/${encodeURIComponent(id)}/expire`, { method: "POST" }); },
  subscribe(callback) { const polling = window.setInterval(() => callback("server-poll"), 5000); return () => window.clearInterval(polling); }
};
