import crypto from "node:crypto";
import { authorize } from "./auth.mjs";
import { ageOnRaceDate, createNextWaitingListOffer, decideRefund, declineWaitingListOffer, inspectPrivateInvitation, issueManagementToken, requestRefund } from "./phase3-domain.mjs";
import { beginStripeCheckout, executeApprovedStripeRefund, processScheduledRegistrationWork, reconcileStripeEvent, runnerPaymentState } from "./phase3-integrations.mjs";
import { deliverRegistrationCommunication } from "./communications.mjs";

const hashToken = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
const iso = (value = new Date()) => new Date(value).toISOString();
const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();
const activeRegistration = (item) => item && !item.deletedAt && !["cancelled", "place_released"].includes(item.entryStatus);
const runnerFor = (state, registration) => state.runners.find((item) => item.id === registration?.runnerId);
const paymentFor = (state, registration) => state.payments.find((item) => item.registrationId === registration?.id);
const refundFor = (state, registration) => [...state.refundRequests].reverse().find((item) => item.registrationId === registration?.id);

function registrationForToken(state, token) {
  const stored = state.managementTokens.find((item) => item.tokenHash === hashToken(token) && !item.invalidatedAt);
  return stored ? state.registrations.find((item) => item.id === stored.registrationId && !item.deletedAt) : null;
}

function managementView(state, registration, at = new Date()) {
  const runner = runnerFor(state, registration);
  const payment = paymentFor(state, registration);
  const refund = refundFor(state, registration);
  const beforeCutoff = new Date(at) <= new Date(state.event.transferRefundCutoffUtc);
  const paymentState = runnerPaymentState(state, registration.id);
  const stateName = refund?.status === "requested" ? "refund_requested" : refund?.status === "approved" ? "refund_approved" : refund?.status === "rejected" ? "refund_rejected" : paymentState.state;
  const labels = { refund_requested: "Refund requested", refund_approved: "Refund approved", refund_rejected: "Refund request not approved", refunded: "Refund completed" };
  return {
    ok: true,
    registration: {
      reference: registration.testReference,
      runner: {
        firstName: runner.firstName, lastName: runner.lastName, email: runner.email, phone: runner.phone,
        addressLine1: runner.addressLine1, addressLine2: runner.addressLine2, city: runner.city, postcode: runner.postcode,
        dateOfBirth: runner.dateOfBirth, raceCategory: runner.raceCategory ?? runner.genderCategory,
        club: runner.club, wfraMember: runner.wfraMember === true
      },
      entryStatus: registration.entryStatus, placeStatus: registration.placeStatus,
      payment: { state: stateName, label: labels[stateName] ?? paymentState.label, canContinue: ["created", "not_configured", "failed", "expired"].includes(payment?.status) },
      amendmentEligible: beforeCutoff && activeRegistration(registration),
      transferEligible: beforeCutoff && activeRegistration(registration),
      refundEligible: beforeCutoff && payment?.status === "paid" && !refund,
      raceNumber: registration.raceNumber ?? null
    }
  };
}

export class Phase3IntegrationService {
  constructor({ repository, stripeGateway = null, emailAdapter, publicBaseUrl = "" }) {
    this.repository = repository;
    this.stripeGateway = stripeGateway;
    this.emailAdapter = emailAdapter;
    this.publicBaseUrl = String(publicBaseUrl ?? "").replace(/\/$/, "");
  }

  managementUrl(token) { return `${this.publicBaseUrl}/registration/manage.html#token=${encodeURIComponent(token)}`; }
  communicate(state, message, key, at = new Date()) { return deliverRegistrationCommunication(state, this.emailAdapter, message, { idempotencyKey: key, at }); }

  integrationStatus() {
    return { ok: true, environment: "development", stripe: this.stripeGateway ? "sandbox" : "disabled", paymentsAvailable: Boolean(this.stripeGateway), email: this.emailAdapter?.kind ?? "captured-only", externalEmailAvailable: this.emailAdapter?.kind === "acs-controlled-development" };
  }

  checkout(managementToken, at = new Date()) {
    if (!this.stripeGateway) return Promise.resolve({ ok: false, code: "PAYMENTS_UNAVAILABLE" });
    return this.repository.transaction(async (state) => {
      if (state.environment !== "development" || !(state.registrationState === "test" || ["PRIVATE_LIVE", "OPEN"].includes(state.registrationState))) return { ok: false, code: "REGISTRATION_NOT_ACCEPTING" };
      const registration = registrationForToken(state, managementToken);
      if (!registration) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
      return beginStripeCheckout(state, registration.id, this.stripeGateway, { successUrl: `${this.publicBaseUrl}/registration/payment-return.html`, cancelUrl: `${this.publicBaseUrl}/registration/payment-return.html?cancelled=1`, at });
    });
  }

  async paymentStatus(managementToken) {
    const state = await this.repository.read(); const registration = registrationForToken(state, managementToken);
    if (!registration) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
    const view = managementView(state, registration);
    return { ...runnerPaymentState(state, registration.id), state: view.registration.payment.state, label: view.registration.payment.label };
  }

  async managementEntry(managementToken, at = new Date()) {
    const state = await this.repository.read(); const registration = registrationForToken(state, managementToken);
    return registration ? managementView(state, registration, at) : { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
  }

  async recoverManagementLink(emailAddress, at = new Date()) {
    const email = normalizeEmail(emailAddress);
    const generic = { ok: true, message: "If an eligible entry matches, a secure link will be sent." };
    try { return await this.repository.transaction(async (state) => {
      state.managementRecoveryAttempts ??= [];
      const emailHash = hashToken(email);
      const recent = state.managementRecoveryAttempts.filter((item) => item.emailHash === emailHash && new Date(item.requestedAt) > new Date(new Date(at).getTime() - 60 * 60_000));
      state.managementRecoveryAttempts = state.managementRecoveryAttempts.filter((item) => new Date(item.requestedAt) > new Date(new Date(at).getTime() - 24 * 60 * 60_000));
      state.managementRecoveryAttempts.push({ emailHash, requestedAt: iso(at) });
      if (recent.length >= 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return generic;
      const matches = state.registrations.filter((registration) => activeRegistration(registration) && normalizeEmail(runnerFor(state, registration)?.email) === email);
      for (const registration of matches) {
        const runner = runnerFor(state, registration);
        const issued = issueManagementToken(state, registration.id, { actorType: "system", id: "management-recovery" }, at);
        const tokenId = state.managementTokens.find((item) => item.registrationId === registration.id && !item.invalidatedAt)?.id;
        await this.communicate(state, { registrationId: registration.id, template: "management_link", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}`, secureUrl: this.managementUrl(issued.token) } }, `registration:${registration.id}:management-recovery:${tokenId}`, at);
      }
      return generic;
    }); } catch { return generic; }
  }

  amend(managementToken, changes, at = new Date()) {
    return this.repository.transaction(async (state) => {
      const registration = registrationForToken(state, managementToken);
      if (!registration || !activeRegistration(registration)) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
      if (new Date(at) > new Date(state.event.transferRefundCutoffUtc)) return { ok: false, code: "AMENDMENT_CUTOFF_PASSED" };
      const runner = runnerFor(state, registration); const changedFields = [];
      const allowed = ["phone", "addressLine1", "addressLine2", "city", "postcode", "raceCategory", "genderCategory", "club", "wfraMember", "wfraMembershipNumber"];
      for (const field of allowed) if (changes[field] !== undefined && changes[field] !== runner[field]) { runner[field] = typeof changes[field] === "string" ? changes[field].trim() : changes[field]; changedFields.push(field); }
      if (runner.wfraMember !== true) runner.wfraMembershipNumber = null;
      registration.updatedAt = iso(at);
      state.auditEvents.push({ id: `audit_${crypto.randomUUID()}`, occurredAt: iso(at), actorType: "runner", actorId: null, action: "runner_details_amended", subjectId: registration.id, before: null, after: { fields: changedFields }, environment: state.environment });
      await this.communicate(state, { registrationId: registration.id, template: "entry_amended", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}` } }, `registration:${registration.id}:amended:${registration.updatedAt}`, at);
      return managementView(state, registration, at);
    });
  }

  transfer(managementToken, input, at = new Date()) {
    return this.repository.transaction(async (state) => {
      const registration = registrationForToken(state, managementToken);
      if (!registration || !activeRegistration(registration)) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
      if (new Date(at) > new Date(state.event.transferRefundCutoffUtc)) return { ok: false, code: "TRANSFER_CUTOFF_PASSED" };
      const next = input.runner ?? {}; const declaration = input.declaration ?? {};
      const required = ["email", "firstName", "lastName", "phone", "addressLine1", "city", "postcode", "dateOfBirth", "raceCategory", "emergencyContactName", "emergencyContactPhone"];
      if (required.some((field) => !String(next[field] ?? "").trim())) return { ok: false, code: "VALIDATION_ERROR" };
      if (ageOnRaceDate(next.dateOfBirth, state.event.raceDate) < 18) return { ok: false, code: "PARENTAL_CONSENT_REQUIREMENTS_PENDING" };
      if (declaration.declarationIdentifier !== state.event.declarationIdentifier || declaration.declarationVersion !== state.event.declarationVersion || declaration.accepted !== true || declaration.signatoryRole !== "Competitor" || !String(declaration.typedFullName ?? "").trim()) return { ok: false, code: "DECLARATION_NOT_ACCEPTED" };
      const previous = runnerFor(state, registration);
      const runner = { ...next, id: `runner_${crypto.randomUUID()}`, email: normalizeEmail(next.email), firstName: String(next.firstName).trim(), lastName: String(next.lastName).trim(), wfraMembershipNumber: next.wfraMember === true ? String(next.wfraMembershipNumber ?? "").trim() || null : null, wfraMembershipVerified: false, wfraDiscountApplied: false, transferredAt: iso(at) };
      state.runners.push(runner); registration.runnerId = runner.id; registration.updatedAt = iso(at);
      const emergency = state.emergencyContacts.find((item) => item.registrationId === registration.id);
      if (emergency) { emergency.name = String(next.emergencyContactName).trim(); emergency.phone = String(next.emergencyContactPhone).trim(); }
      else state.emergencyContacts.push({ id: `emergency_${crypto.randomUUID()}`, registrationId: registration.id, name: String(next.emergencyContactName).trim(), phone: String(next.emergencyContactPhone).trim(), deleteAfterEvent: true });
      state.consents.push({ id: `consent_${crypto.randomUUID()}`, registrationId: registration.id, termsVersion: state.event.termsVersion, privacyVersion: state.event.privacyVersion, recordedAt: iso(at), declaration: { identifier: declaration.declarationIdentifier, version: declaration.declarationVersion, accepted: true, typedFullName: String(declaration.typedFullName).trim(), signatoryRole: "Competitor", acceptedAt: iso(at), contentStatus: state.event.declarationContentStatus } });
      const issued = issueManagementToken(state, registration.id, { actorType: "runner" }, at);
      state.auditEvents.push({ id: `audit_${crypto.randomUUID()}`, occurredAt: iso(at), actorType: "runner", actorId: null, action: "entry_transferred", subjectId: registration.id, before: null, after: { declarationVersion: declaration.declarationVersion }, environment: state.environment });
      await this.communicate(state, { registrationId: registration.id, template: "entry_transferred_previous_runner", intendedRecipientAddress: previous.email, data: {} }, `registration:${registration.id}:transfer-old:${registration.updatedAt}`, at);
      await this.communicate(state, { registrationId: registration.id, template: "entry_transferred", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}`, secureUrl: this.managementUrl(issued.token) } }, `registration:${registration.id}:transfer-new:${registration.updatedAt}`, at);
      return { ...managementView(state, registration, at), replacementManagementToken: issued.token };
    });
  }

  revokeManagementLink(actor, registrationId, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction((state) => {
      const registration = state.registrations.find((item) => item.id === registrationId && !item.deletedAt);
      if (!registration) return { ok: false, code: "NOT_FOUND" };
      let revoked = 0;
      for (const token of state.managementTokens.filter((item) => item.registrationId === registration.id && !item.invalidatedAt)) { token.invalidatedAt = iso(at); revoked += 1; }
      state.auditEvents.push({ id: `audit_${crypto.randomUUID()}`, occurredAt: iso(at), actorType: actor.actorType ?? "organiser", actorId: actor.id ?? null, action: "management_token_revoked", subjectId: registration.id, before: null, after: { revoked }, environment: state.environment });
      return { ok: true, revoked };
    });
  }

  requestRefund(managementToken, at = new Date()) {
    return this.repository.transaction(async (state) => {
      const registration = registrationForToken(state, managementToken);
      if (!registration) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
      const payment = paymentFor(state, registration);
      if (payment?.status !== "paid") return { ok: false, code: "REFUND_NOT_READY" };
      const existing = state.refundRequests.find((item) => item.registrationId === registration.id && ["requested", "approved"].includes(item.status));
      if (existing) return { ok: true, duplicate: true, request: { id: existing.id, status: existing.status, requestedAt: existing.requestedAt } };
      const result = requestRefund(state, registration.id, { actorType: "runner" }, at); const runner = runnerFor(state, registration);
      if (result.ok) await this.communicate(state, { registrationId: registration.id, template: "refund_requested", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}` } }, `refund:${result.request.id}:requested`, at);
      return result.ok ? { ok: true, request: { id: result.request.id, status: result.request.status, requestedAt: result.request.requestedAt } } : result;
    });
  }

  decideRefund(actor, refundRequestId, decision, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction(async (state) => {
      const result = decideRefund(state, refundRequestId, decision, actor, at);
      const registration = state.registrations.find((item) => item.id === result.request?.registrationId); const runner = runnerFor(state, registration);
      if (result.ok && runner) await this.communicate(state, { registrationId: registration.id, template: decision === "approved" ? "refund_approved" : "refund_rejected", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}` } }, `refund:${refundRequestId}:${decision}`, at);
      return result;
    });
  }

  webhook(rawBody, signature, at = new Date()) {
    if (!this.stripeGateway) return Promise.resolve({ ok: false, code: "INTEGRATION_NOT_CONFIGURED" });
    let event; try { event = this.stripeGateway.verifyWebhook(rawBody, signature); } catch { return Promise.resolve({ ok: false, code: "INVALID_WEBHOOK_SIGNATURE" }); }
    return this.repository.transaction(async (state) => {
      const result = reconcileStripeEvent(state, event, { at });
      if (!result.ok || result.duplicate) return result;
      const object = event?.data?.object ?? {};
      const payment = state.payments.find((item) => item.checkoutSessionId === object.id || (object.payment_intent && item.paymentIntentId === (object.payment_intent.id ?? object.payment_intent)));
      const registration = state.registrations.find((item) => item.id === payment?.registrationId); const runner = runnerFor(state, registration);
      const template = result.paymentStatus === "paid" ? "entry_confirmed" : result.paymentStatus === "failed" ? "payment_unsuccessful" : result.paymentStatus === "expired" ? "payment_session_expired" : result.paymentStatus === "refunded" ? "refund_completed" : null;
      if (template && runner) await this.communicate(state, { registrationId: registration.id, template, intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}` } }, `stripe-event:${event.id}:${template}`, at);
      return result;
    });
  }

  refund(actor, refundRequestId, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    if (!this.stripeGateway) return Promise.resolve({ ok: false, code: "PAYMENTS_UNAVAILABLE" });
    return this.repository.transaction(async (state) => {
      const result = await executeApprovedStripeRefund(state, refundRequestId, this.stripeGateway, actor, at);
      const request = state.refundRequests.find((item) => item.id === refundRequestId); const registration = state.registrations.find((item) => item.id === request?.registrationId); const runner = runnerFor(state, registration);
      if (result.ok && result.refundState === "refunded" && runner) await this.communicate(state, { registrationId: registration.id, template: "refund_completed", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}` } }, `refund:${refundRequestId}:completed`, at);
      return result;
    });
  }

  joinWaitingList(input, at = new Date()) {
    return this.repository.transaction(async (state) => {
      if (state.environment !== "development" || state.registrationState !== "test") return { ok: false, code: "REGISTRATION_NOT_ACCEPTING" };
      const firstName = String(input.firstName ?? "").trim(), lastName = String(input.lastName ?? "").trim(), email = normalizeEmail(input.email);
      if (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, code: "VALIDATION_ERROR" };
      const existing = state.waitingList.find((item) => item.status === "waiting" && item.email === email);
      if (existing) return { ok: true, duplicate: true, waitingListEntry: { id: existing.id, status: existing.status } };
      const item = { id: `waiting_${crypto.randomUUID()}`, firstName, lastName, email, sequence: state.waitingList.length + 1, status: "waiting", joinedAt: iso(at) };
      state.waitingList.push(item);
      state.auditEvents.push({ id: `audit_${crypto.randomUUID()}`, occurredAt: iso(at), actorType: "runner", actorId: null, action: "waiting_list_join", subjectId: item.id, before: null, after: { sequence: item.sequence }, environment: state.environment });
      await this.communicate(state, { waitingListId: item.id, template: "waiting_list_joined", intendedRecipientAddress: email, data: { runnerName: `${firstName} ${lastName}` } }, `waiting-list:${item.id}:joined`, at);
      return { ok: true, waitingListEntry: { id: item.id, status: item.status } };
    });
  }

  offerNextWaitingPlace(actor, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction(async (state) => {
      const result = createNextWaitingListOffer(state, actor, at);
      if (!result.ok) return result;
      const waiting = state.waitingList.find((item) => item.id === result.offer.waitingListId);
      await this.communicate(state, { waitingListId: waiting.id, template: "waiting_list_offer", intendedRecipientAddress: waiting.email, data: { runnerName: `${waiting.firstName} ${waiting.lastName}`, expiresAt: result.offer.expiresAt, secureUrl: `${this.publicBaseUrl}/registration/?invite=${encodeURIComponent(result.token)}` } }, `waiting-list:${result.offer.id}:offered`, at);
      return { ok: true, offer: { id: result.offer.id, status: result.offer.status, expiresAt: result.offer.expiresAt } };
    });
  }

  declineWaitingPlace(token, at = new Date()) {
    return this.repository.transaction(async (state) => {
      const checked = inspectPrivateInvitation(state, token, { kind: "waiting_list_offer", at });
      if (!checked.ok) return { ok: false, code: "LINK_UNAVAILABLE" };
      const offer = state.waitingListOffers.find((item) => item.invitationId === checked.invitation.id);
      const waiting = state.waitingList.find((item) => item.id === offer?.waitingListId);
      const result = declineWaitingListOffer(state, offer?.id, { actorType: "runner" }, at);
      if (!result.ok) return result;
      await this.communicate(state, { waitingListId: waiting.id, template: "waiting_list_declined", intendedRecipientAddress: waiting.email, data: { runnerName: `${waiting.firstName} ${waiting.lastName}` } }, `waiting-list:${offer.id}:declined`, at);
      if (result.nextOffer) {
        const next = state.waitingList.find((item) => item.id === result.nextOffer.offer.waitingListId);
        await this.communicate(state, { waitingListId: next.id, template: "waiting_list_offer", intendedRecipientAddress: next.email, data: { runnerName: `${next.firstName} ${next.lastName}`, expiresAt: result.nextOffer.offer.expiresAt, secureUrl: `${this.publicBaseUrl}/registration/?invite=${encodeURIComponent(result.nextOffer.token)}` } }, `waiting-list:${result.nextOffer.offer.id}:offered`, at);
      }
      return { ok: true };
    });
  }

  runScheduledWork(actor, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction((state) => {
      const scheduledEmail = { send: (message) => this.communicate(state, message, `scheduled:${message.template}:${hashToken(message.intendedRecipientAddress)}:${message.data?.expiresAt ?? iso(at)}`, at) };
      return processScheduledRegistrationWork(state, { email: scheduledEmail, at, actor, offerUrl: (token) => `${this.publicBaseUrl}/registration/?invite=${encodeURIComponent(token)}` });
    });
  }
}
