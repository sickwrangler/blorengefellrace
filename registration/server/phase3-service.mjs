import crypto from "node:crypto";
import { authorize } from "./auth.mjs";
import { createNextWaitingListOffer, decideRefund, declineWaitingListOffer, inspectPrivateInvitation, issueManagementToken, requestRefund, validateProductionRunner } from "./phase3-domain.mjs";
import { beginStripeCheckout, completeApprovedStripeRefund, failApprovedStripeRefund, prepareApprovedStripeRefund, processScheduledRegistrationWork, reconcileStripeEvent, runnerPaymentState } from "./phase3-integrations.mjs";
import { deliverRegistrationCommunication } from "./communications.mjs";
import { OrderRegistrationService, issueDeclarationToken } from "./order-service.mjs";

const hashToken = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
const iso = (value = new Date()) => new Date(value).toISOString();
const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();
const syntheticEmail = /@(example\.(?:com|org|net)|[^@]+\.invalid)$/i;
const activeRegistration = (item) => item && !item.deletedAt && !["cancelled", "place_released"].includes(item.entryStatus);
const runnerFor = (state, registration) => state.runners.find((item) => item.id === registration?.runnerId);
const paymentFor = (state, registration) => state.payments.find((item) => item.registrationId === registration?.id || item.registrationIds?.includes(registration?.id));
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
      declaration: { status: registration.declarationStatus ?? "complete", completionMethod: registration.declarationCompletionMethod ?? "digital_during_entry", clearedToStart: (registration.declarationStatus ?? "complete") === "complete" && registration.placeStatus === "confirmed" },
      payment: { state: stateName, label: labels[stateName] ?? paymentState.label, canContinue: ["created", "not_configured", "failed", "expired"].includes(payment?.status) },
      amendmentEligible: beforeCutoff && activeRegistration(registration),
      transferEligible: beforeCutoff && activeRegistration(registration),
      refundEligible: beforeCutoff && payment?.status === "paid" && !refund,
      raceNumber: registration.raceNumber ?? null
    }
  };
}

export class Phase3IntegrationService {
  constructor({ repository, stripeGateway = null, emailAdapter, publicBaseUrl = "", orderConfiguration = {} }) {
    this.repository = repository;
    this.stripeGateway = stripeGateway;
    this.emailAdapter = emailAdapter;
    this.publicBaseUrl = String(publicBaseUrl ?? "").replace(/\/$/, "");
    this.orders = new OrderRegistrationService({ repository, stripeGateway, emailAdapter, publicBaseUrl, ...orderConfiguration });
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
      return managementView(state, registration, at);
    });
  }

  transferRegistration({ managementToken = null, registrationId = null, input, actor, allowCutoffOverride = false }, at = new Date()) {
    return this.repository.transaction(async (state) => {
      const registration = managementToken ? registrationForToken(state, managementToken) : state.registrations.find((item) => item.id === registrationId && activeRegistration(item));
      if (!registration || !activeRegistration(registration)) return { ok: false, code: managementToken ? "MANAGEMENT_TOKEN_INVALID" : "NOT_FOUND" };
      const afterCutoff = new Date(at) > new Date(state.event.transferRefundCutoffUtc);
      if (afterCutoff && !allowCutoffOverride) return { ok: false, code: managementToken ? "TRANSFER_CUTOFF_PASSED" : "ORGANISER_OVERRIDE_REQUIRED" };
      const next = input.runner ?? {};
      const errors = validateProductionRunner(next);
      if (!syntheticEmail.test(normalizeEmail(next.email))) errors.email = "Use synthetic information only in development.";
      if (Object.keys(errors).length) return { ok: false, code: "VALIDATION_ERROR", errors };
      if (state.registrations.some((item) => item.id !== registration.id && activeRegistration(item) && ["payment_reserved", "confirmed"].includes(item.placeStatus) && normalizeEmail(runnerFor(state, item)?.email) === normalizeEmail(next.email))) return { ok: false, code: "DUPLICATE_ACTIVE_ENTRY" };
      const previous = runnerFor(state, registration);
      const runner = { ...next, id: `runner_${crypto.randomUUID()}`, email: normalizeEmail(next.email), firstName: String(next.firstName).trim(), lastName: String(next.lastName).trim(), wfraMembershipNumber: next.wfraMember === true ? String(next.wfraMembershipNumber ?? "").trim() || null : null, wfraMembershipVerified: false, wfraDiscountApplied: false, transferredAt: iso(at) };
      state.runners.push(runner); registration.runnerId = runner.id; registration.updatedAt = iso(at);
      registration.declarationStatus = "pending"; registration.declarationCompletionMethod = null;
      for (const priorDeclaration of (state.declarations ?? []).filter((item) => item.registrationId === registration.id && !item.revokedAt)) priorDeclaration.revokedAt = iso(at);
      for (const consent of state.consents.filter((item) => item.registrationId === registration.id && item.declaration)) {
        state.declarations ??= []; state.declarations.push({ ...consent.declaration, id: `declaration_${crypto.randomUUID()}`, registrationId: registration.id, runnerId: previous.id, completionMethod: "digital_during_entry", revokedAt: iso(at), revocationReason: "entry_transferred" }); consent.declaration = null;
      }
      for (const token of (state.declarationTokens ?? []).filter((item) => item.registrationId === registration.id && !item.revokedAt)) { token.revokedAt = iso(at); token.revokedReason = "entry_transferred"; }
      const emergency = state.emergencyContacts.find((item) => item.registrationId === registration.id);
      if (emergency) { emergency.name = String(next.emergencyContactName).trim(); emergency.phone = String(next.emergencyContactPhone).trim(); }
      else state.emergencyContacts.push({ id: `emergency_${crypto.randomUUID()}`, registrationId: registration.id, name: String(next.emergencyContactName).trim(), phone: String(next.emergencyContactPhone).trim(), deleteAfterEvent: true });
      const issued = issueManagementToken(state, registration.id, actor, at);
      const declarationToken = issueDeclarationToken(state, registration.id, at);
      const action = actor.actorType === "organiser" ? "organiser_entry_transferred" : "entry_transferred";
      state.auditEvents.push({ id: `audit_${crypto.randomUUID()}`, occurredAt: iso(at), actorType: actor.actorType, actorId: actor.id ?? null, action, subjectId: registration.id, before: { runnerId: previous.id }, after: { runnerId: runner.id, declarationStatus: "pending", cutoffOverride: Boolean(afterCutoff && allowCutoffOverride) }, environment: state.environment });
      await this.communicate(state, { registrationId: registration.id, template: "entry_transferred_previous_runner", intendedRecipientAddress: previous.email, data: {} }, `registration:${registration.id}:transfer-old:${registration.updatedAt}`, at);
      await this.communicate(state, { registrationId: registration.id, template: "entry_transferred", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}`, managementUrl: this.managementUrl(issued.token), secureUrl: this.orders.declarationUrl(declarationToken), status: "Declaration required before race day" } }, `registration:${registration.id}:transfer-new:${registration.updatedAt}`, at);
      return managementView(state, registration, at);
    });
  }

  transfer(managementToken, input, at = new Date()) {
    return this.transferRegistration({ managementToken, input, actor: { actorType: "runner", id: null } }, at);
  }

  organiserTransfer(actor, registrationId, input, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.transferRegistration({ registrationId, input, actor, allowCutoffOverride: input.overrideCutoff === true }, at);
  }

  resendManagementLink(actor, registrationId, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction(async (state) => {
      const registration = state.registrations.find((item) => item.id === registrationId && activeRegistration(item)); const runner = runnerFor(state, registration);
      if (!registration || !runner) return { ok: false, code: "NOT_FOUND" };
      const issued = issueManagementToken(state, registration.id, actor, at);
      await this.communicate(state, { registrationId, template: "management_link", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}`, secureUrl: this.managementUrl(issued.token) } }, `registration:${registration.id}:management-organiser:${registration.updatedAt}:${state.managementTokens.at(-1).id}`, at);
      state.auditEvents.push({ id: `audit_${crypto.randomUUID()}`, occurredAt: iso(at), actorType: actor.actorType ?? "organiser", actorId: actor.id ?? null, action: "management_link_resent", subjectId: registration.id, before: null, after: {}, environment: state.environment });
      return { ok: true };
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
      if (result.ok && runner && decision === "rejected") await this.communicate(state, { registrationId: registration.id, template: "refund_rejected", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}` } }, `refund:${refundRequestId}:${decision}`, at);
      return result;
    });
  }

  async webhook(rawBody, signature, at = new Date()) {
    if (!this.stripeGateway) return Promise.resolve({ ok: false, code: "INTEGRATION_NOT_CONFIGURED" });
    let event; try { event = this.stripeGateway.verifyWebhook(rawBody, signature); } catch { return Promise.resolve({ ok: false, code: "INVALID_WEBHOOK_SIGNATURE" }); }
    if (event?.data?.object?.metadata?.orderId) return this.orders.webhook(event, at);
    const providerPaymentIntent = event?.data?.object?.payment_intent?.id ?? event?.data?.object?.payment_intent;
    if (providerPaymentIntent) {
      const snapshot = await this.repository.read();
      if (snapshot.payments.some((item) => item.orderId && item.paymentIntentId === providerPaymentIntent)) return this.orders.webhook(event, at);
    }
    return this.repository.transaction(async (state) => {
      const result = reconcileStripeEvent(state, event, { at });
      if (!result.ok || result.duplicate) return result;
      const object = event?.data?.object ?? {};
      const payment = state.payments.find((item) => item.checkoutSessionId === object.id || (object.payment_intent && item.paymentIntentId === (object.payment_intent.id ?? object.payment_intent)));
      const registration = state.registrations.find((item) => item.id === payment?.registrationId); const runner = runnerFor(state, registration);
      const template = result.paymentStatus === "paid" ? "entry_confirmed" : result.paymentStatus === "failed" ? "payment_unsuccessful" : result.paymentStatus === "refunded" ? "refund_completed" : null;
      if (template && runner) await this.communicate(state, { registrationId: registration.id, template, intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}` } }, `stripe-event:${event.id}:${template}`, at);
      return result;
    });
  }

  async refund(actor, refundRequestId, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    if (!this.stripeGateway) return Promise.resolve({ ok: false, code: "PAYMENTS_UNAVAILABLE" });
    const prepared = await this.repository.transaction((state) => {
      const result = prepareApprovedStripeRefund(state, refundRequestId, actor, at);
      if (result.ok) result.refundRequestId = refundRequestId;
      return result;
    });
    if (!prepared.ok) return prepared;
    let providerRefund;
    try {
      providerRefund = prepared.partial
        ? await this.stripeGateway.createPartialRefund({ paymentIntentId: prepared.paymentIntentId, paymentId: prepared.paymentId, registrationId: prepared.registrationId, amountPence: prepared.refundAmountPence })
        : await this.stripeGateway.createFullRefund({ paymentIntentId: prepared.paymentIntentId, paymentId: prepared.paymentId });
    } catch {
      return this.repository.transaction((state) => failApprovedStripeRefund(state, prepared, at));
    }
    const result = await this.repository.transaction((state) => completeApprovedStripeRefund(state, prepared, providerRefund, at));
    if (result.ok && result.refundState === "refunded") {
      try {
        const snapshot = await this.repository.read(); const registration = snapshot.registrations.find((item) => item.id === result.registrationId); const runner = runnerFor(snapshot, registration);
        const key = `refund:${refundRequestId}:completed`; const before = snapshot.communications.length;
        if (runner) await this.communicate(snapshot, { registrationId: registration.id, template: "refund_completed", intendedRecipientAddress: runner.email, data: { runnerName: `${runner.firstName} ${runner.lastName}` } }, key, at);
        const receipt = snapshot.communications.length > before ? snapshot.communications.at(-1) : null;
        if (receipt) await this.repository.transaction((state) => { if (!state.communications.some((item) => item.idempotencyKey === key)) state.communications.push(receipt); return { ok: true }; });
      } catch { /* A notification failure must not roll back a completed refund. */ }
    }
    return result;
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
      if (result.nextOffer) {
        const next = state.waitingList.find((item) => item.id === result.nextOffer.offer.waitingListId);
        await this.communicate(state, { waitingListId: next.id, template: "waiting_list_offer", intendedRecipientAddress: next.email, data: { runnerName: `${next.firstName} ${next.lastName}`, expiresAt: result.nextOffer.offer.expiresAt, secureUrl: `${this.publicBaseUrl}/registration/?invite=${encodeURIComponent(result.nextOffer.token)}` } }, `waiting-list:${result.nextOffer.offer.id}:offered`, at);
      }
      return { ok: true };
    });
  }

  runScheduledWork(actor, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction(async (state) => {
      const scheduledEmail = { send: (message) => this.communicate(state, message, `scheduled:${message.template}:${hashToken(message.intendedRecipientAddress)}:${message.data?.expiresAt ?? iso(at)}`, at) };
      const result = await processScheduledRegistrationWork(state, { email: scheduledEmail, at, actor, offerUrl: (token) => `${this.publicBaseUrl}/registration/?invite=${encodeURIComponent(token)}` });
      state.schedulerStatus = {
        lastSuccessfulRunAt: iso(at),
        lastResult: {
          reminders: result.reminders,
          expiredOffers: result.expiredOffers,
          expiredPayments: result.expiredPayments,
          nextOfferCreated: result.nextOfferCreated
        }
      };
      return result;
    }).then(async (result) => {
      if (!result.ok) return result;
      const orderResult = await this.orders.runScheduledWork(at);
      return { ...result, declarationReminders: orderResult.declarationReminders, abandonedOrders: orderResult.abandonedOrders };
    });
  }
}
