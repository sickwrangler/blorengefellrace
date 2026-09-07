import crypto from "node:crypto";
import { authorize } from "./auth.mjs";
import { decideRefund, requestRefund } from "./phase3-domain.mjs";
import { beginStripeCheckout, executeApprovedStripeRefund, processScheduledRegistrationWork, reconcileStripeEvent, runnerPaymentState } from "./phase3-integrations.mjs";

const hashToken = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex");

function registrationForToken(state, token) {
  const stored = state.managementTokens.find((item) => item.tokenHash === hashToken(token) && !item.invalidatedAt);
  return stored ? state.registrations.find((item) => item.id === stored.registrationId && !item.deletedAt) : null;
}

export class Phase3IntegrationService {
  constructor({ repository, stripeGateway = null, emailAdapter, publicBaseUrl = "" }) {
    this.repository = repository;
    this.stripeGateway = stripeGateway;
    this.emailAdapter = emailAdapter;
    this.publicBaseUrl = String(publicBaseUrl ?? "").replace(/\/$/, "");
  }

  integrationStatus() {
    return {
      ok: true,
      environment: "development",
      stripe: this.stripeGateway ? "sandbox" : "disabled",
      paymentsAvailable: Boolean(this.stripeGateway),
      email: this.emailAdapter?.kind ?? "captured-only",
      externalEmailAvailable: this.emailAdapter?.kind === "acs-controlled-development"
    };
  }

  checkout(managementToken, at = new Date()) {
    if (!this.stripeGateway) return Promise.resolve({ ok: false, code: "PAYMENTS_UNAVAILABLE" });
    return this.repository.transaction(async (state) => {
      if (state.environment !== "development" || !(state.registrationState === "test" || ["PRIVATE_LIVE", "OPEN"].includes(state.registrationState))) return { ok: false, code: "REGISTRATION_NOT_ACCEPTING" };
      const registration = registrationForToken(state, managementToken);
      if (!registration) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
      return beginStripeCheckout(state, registration.id, this.stripeGateway, {
        successUrl: `${this.publicBaseUrl}/registration/payment-return.html`,
        cancelUrl: `${this.publicBaseUrl}/registration/payment-return.html?cancelled=1`,
        at
      });
    });
  }

  async paymentStatus(managementToken) {
    const state = await this.repository.read(); const registration = registrationForToken(state, managementToken);
    return registration ? runnerPaymentState(state, registration.id) : { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
  }

  requestRefund(managementToken, at = new Date()) {
    return this.repository.transaction((state) => {
      const registration = registrationForToken(state, managementToken);
      if (!registration) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
      const payment = state.payments.find((item) => item.registrationId === registration.id);
      if (payment?.status !== "paid") return { ok: false, code: "REFUND_NOT_READY" };
      const existing = state.refundRequests.find((item) => item.registrationId === registration.id && ["requested", "approved"].includes(item.status));
      if (existing) return { ok: true, duplicate: true, request: { id: existing.id, status: existing.status, requestedAt: existing.requestedAt } };
      const result = requestRefund(state, registration.id, { actorType: "runner" }, at);
      return result.ok ? { ok: true, request: { id: result.request.id, status: result.request.status, requestedAt: result.request.requestedAt } } : result;
    });
  }

  decideRefund(actor, refundRequestId, decision, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction((state) => decideRefund(state, refundRequestId, decision, actor, at));
  }

  webhook(rawBody, signature, at = new Date()) {
    if (!this.stripeGateway) return Promise.resolve({ ok: false, code: "INTEGRATION_NOT_CONFIGURED" });
    let event;
    try { event = this.stripeGateway.verifyWebhook(rawBody, signature); }
    catch { return Promise.resolve({ ok: false, code: "INVALID_WEBHOOK_SIGNATURE" }); }
    return this.repository.transaction((state) => reconcileStripeEvent(state, event, { at }));
  }

  refund(actor, refundRequestId, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    if (!this.stripeGateway) return Promise.resolve({ ok: false, code: "PAYMENTS_UNAVAILABLE" });
    return this.repository.transaction((state) => executeApprovedStripeRefund(state, refundRequestId, this.stripeGateway, actor, at));
  }

  runScheduledWork(actor, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction((state) => processScheduledRegistrationWork(state, { email: this.emailAdapter, at, actor, offerUrl: (token) => `${this.publicBaseUrl}/registration/?invite=${encodeURIComponent(token)}` }));
  }
}
