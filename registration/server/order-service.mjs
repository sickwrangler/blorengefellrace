import crypto from "node:crypto";
import { authorize } from "./auth.mjs";
import { ageOnRaceDate, calculateEntryPrice, capacitySummary, issueManagementToken, validateProductionRunner } from "./phase3-domain.mjs";
import { deliverRegistrationCommunication } from "./communications.mjs";

export const DEFAULT_MAX_RUNNERS_PER_ORDER = 5;
export const DECLARATION_REMINDER_POLICY = Object.freeze({ afterPaymentDays: 7 });
const SYNTHETIC_EMAIL = /@(example\.(?:com|org|net)|[^@]+\.invalid)$/i;
const iso = (value = new Date()) => new Date(value).toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const opaqueToken = () => crypto.randomBytes(32).toString("base64url");
const hashToken = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();
const normalizeText = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const active = (entry) => entry && !entry.deletedAt && !["cancelled", "place_released"].includes(entry.entryStatus);

function audit(state, action, subjectId, detail = {}, at = new Date(), actor = { actorType: "system" }) {
  state.auditEvents.push({ id: id("audit"), occurredAt: iso(at), actorType: actor.actorType ?? "system", actorId: actor.id ?? null, action, subjectId, before: null, after: detail, environment: state.environment });
}

function ensureCollections(state) {
  for (const name of ["orders", "orderTokens", "declarations", "declarationTokens", "declarationRecoveryAttempts", "processedPaymentEvents"]) state[name] ??= [];
}

function orderForToken(state, token) {
  const stored = state.orderTokens.find((item) => item.tokenHash === hashToken(token) && !item.invalidatedAt);
  return stored ? state.orders.find((item) => item.id === stored.orderId && !item.deletedAt) : null;
}

function registrationForDeclarationToken(state, token) {
  const stored = state.declarationTokens.find((item) => item.tokenHash === hashToken(token) && item.purpose === "runner_declaration" && (!item.revokedAt || item.revokedReason === "completed"));
  return stored ? state.registrations.find((item) => item.id === stored.registrationId && active(item)) : null;
}

function runnerFor(state, registration) { return state.runners.find((item) => item.id === registration?.runnerId); }
function registrationsFor(state, order) { return order.registrationIds.map((registrationId) => state.registrations.find((item) => item.id === registrationId)).filter(Boolean); }
function orderPayment(state, order) { return state.payments.find((item) => item.orderId === order.id); }
function fullName(runner) { return normalizeText(`${runner?.firstName ?? ""} ${runner?.lastName ?? ""}`); }
function declarationFor(state, registrationId) { return [...state.declarations].reverse().find((item) => item.registrationId === registrationId && !item.revokedAt); }

function paidRegistration(state, registration) {
  if (!active(registration) || registration.placeStatus !== "confirmed") return false;
  const payment = state.payments.find((item) => item.registrationId === registration.id || item.registrationIds?.includes(registration.id));
  return payment?.status === "paid" && !payment.refundedRegistrationIds?.includes(registration.id);
}

function comparePublicEntries(left, right) {
  const leftNumber = Number.isInteger(left.raceNumber) ? left.raceNumber : null;
  const rightNumber = Number.isInteger(right.raceNumber) ? right.raceNumber : null;
  if (leftNumber !== null || rightNumber !== null) {
    if (leftNumber === null) return 1;
    if (rightNumber === null) return -1;
    if (leftNumber !== rightNumber) return leftNumber - rightNumber;
  }
  return left.sortLastName.localeCompare(right.sortLastName, "en-GB", { sensitivity: "base" })
    || left.runnerName.localeCompare(right.runnerName, "en-GB", { sensitivity: "base" });
}

export function buildPublicStartList(state) {
  const entries = state.registrations.filter((registration) => paidRegistration(state, registration)).map((registration) => {
    const runner = runnerFor(state, registration);
    return runner ? {
      runnerName: fullName(runner),
      club: normalizeText(runner.club) || null,
      category: normalizeText(runner.raceCategory ?? runner.genderCategory),
      raceNumber: Number.isInteger(registration.raceNumber) ? registration.raceNumber : null,
      sortLastName: normalizeText(runner.lastName)
    } : null;
  }).filter(Boolean).sort(comparePublicEntries).map(({ sortLastName, ...entry }) => entry);
  const lastUpdatedAt = state.registrations
    .map((registration) => registration.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  return {
    ok: true,
    confirmedCount: entries.length,
    capacity: state.event.capacity,
    raceFull: entries.length >= state.event.capacity,
    lastUpdatedAt,
    entries
  };
}

function declarationView(state, registration) {
  const declaration = declarationFor(state, registration.id);
  return {
    status: declaration ? "complete" : "pending",
    label: declaration ? "Complete" : "Declaration required",
    completionMethod: declaration?.completionMethod ?? null,
    completedAt: declaration?.completedAt ?? null,
    clearedToStart: Boolean(declaration && registration.placeStatus === "confirmed" && registration.entryStatus !== "place_released")
  };
}

function orderView(state, order) {
  const payment = orderPayment(state, order);
  return {
    id: order.id,
    status: order.status,
    purchaserEmail: order.purchaserEmail,
    runnerCount: order.registrationIds.length,
    totalPence: order.totalPence,
    currency: "gbp",
    paymentStatus: payment?.status ?? "not_started",
    paymentRequired: !["paid", "refunded"].includes(payment?.status),
    canContinuePayment: ["draft", "checkout_expired", "checkout_pending"].includes(order.status),
    registrations: registrationsFor(state, order).map((registration) => {
      const runner = runnerFor(state, registration);
      return {
        id: registration.id,
        reference: registration.testReference,
        entryStatus: registration.entryStatus,
        placeStatus: registration.placeStatus,
        pricePence: registration.priceActuallyChargedPence,
        runner: { firstName: runner.firstName, lastName: runner.lastName, email: runner.email, phone: runner.phone, addressLine1: runner.addressLine1, addressLine2: runner.addressLine2, city: runner.city, postcode: runner.postcode, raceCategory: runner.raceCategory, dateOfBirth: runner.dateOfBirth, club: runner.club, wfraMember: runner.wfraMember, wfraMembershipNumber: runner.wfraMembershipNumber, emergencyContactName: state.emergencyContacts.find((item) => item.registrationId === registration.id)?.name, emergencyContactPhone: state.emergencyContacts.find((item) => item.registrationId === registration.id)?.phone },
        declaration: declarationView(state, registration)
      };
    })
  };
}

function validateAdultRunner(state, input) {
  const runner = { ...input, email: normalizeEmail(input.email), raceCategory: input.raceCategory ?? input.genderCategory, emergencyContactName: input.emergencyContactName ?? input.emergencyName, emergencyContactPhone: input.emergencyContactPhone ?? input.emergencyPhone };
  const errors = validateProductionRunner(runner);
  if (["local", "development"].includes(state.environment) && runner.email && !SYNTHETIC_EMAIL.test(runner.email)) errors.email = "Use synthetic information only in development.";
  const age = ageOnRaceDate(runner.dateOfBirth, state.event.raceDate);
  if (Number.isFinite(age) && age < 18) errors.dateOfBirth = "The approved under-18 consent process is not yet available.";
  if (input.acceptTerms !== true) errors.acceptTerms = "Accept the race terms.";
  if (input.acceptPrivacy !== true) errors.acceptPrivacy = "Acknowledge the privacy notice.";
  return { runner, errors };
}

function validateDeclaration(state, runner, mode, declaration) {
  if (mode === "later") return { ok: true };
  if (mode !== "now") return { ok: false, code: "DECLARATION_CHOICE_REQUIRED" };
  if (declaration?.completedByNamedRunner !== true) return { ok: false, code: "RUNNER_MUST_COMPLETE_DECLARATION" };
  if (declaration?.declarationIdentifier !== state.event.declarationIdentifier || declaration?.declarationVersion !== state.event.declarationVersion || declaration?.accepted !== true || declaration?.signatoryRole !== "Competitor") return { ok: false, code: "DECLARATION_NOT_ACCEPTED" };
  if (normalizeText(declaration.typedFullName).toLowerCase() !== fullName(runner).toLowerCase()) return { ok: false, code: "DECLARATION_NAME_MISMATCH" };
  return { ok: true };
}

function issueOrderToken(state, orderId, at = new Date()) {
  for (const token of state.orderTokens.filter((item) => item.orderId === orderId && !item.invalidatedAt)) token.invalidatedAt = iso(at);
  const value = opaqueToken();
  state.orderTokens.push({ id: id("order_token"), orderId, purpose: "unpaid_order_management", tokenHash: hashToken(value), issuedAt: iso(at), invalidatedAt: null });
  return value;
}

export function issueDeclarationToken(state, registrationId, at = new Date()) {
  for (const token of state.declarationTokens.filter((item) => item.registrationId === registrationId && !item.revokedAt)) { token.revokedAt = iso(at); token.revokedReason = "superseded"; }
  const value = opaqueToken();
  state.declarationTokens.push({ id: id("declaration_token"), registrationId, purpose: "runner_declaration", tokenHash: hashToken(value), issuedAt: iso(at), revokedAt: null });
  audit(state, "declaration_link_issued", registrationId, {}, at);
  return value;
}

function recordDigitalDeclaration(state, registration, runner, input, completionMethod, at = new Date()) {
  if (declarationFor(state, registration.id)) return { ok: true, duplicate: true, declaration: declarationFor(state, registration.id) };
  const checked = validateDeclaration(state, runner, "now", input);
  if (!checked.ok) return checked;
  const declaration = { id: id("declaration"), registrationId: registration.id, runnerId: runner.id, declarationIdentifier: state.event.declarationIdentifier, declarationVersion: state.event.declarationVersion, accepted: true, typedFullName: normalizeText(input.typedFullName), signatoryRole: "Competitor", completedAt: iso(at), completionMethod };
  state.declarations.push(declaration);
  registration.declarationStatus = "complete"; registration.declarationCompletionMethod = completionMethod; registration.updatedAt = iso(at);
  for (const token of state.declarationTokens.filter((item) => item.registrationId === registration.id && !item.revokedAt)) { token.revokedAt = iso(at); token.revokedReason = "completed"; }
  audit(state, "declaration_completed", registration.id, { completionMethod, declarationVersion: declaration.declarationVersion }, at, { actorType: "runner" });
  return { ok: true, declaration };
}

export class OrderRegistrationService {
  constructor({ repository, stripeGateway = null, emailAdapter, publicBaseUrl = "", maxRunnersPerOrder = DEFAULT_MAX_RUNNERS_PER_ORDER, reminderPolicy = DECLARATION_REMINDER_POLICY, draftRetentionHours = null }) {
    this.repository = repository; this.stripeGateway = stripeGateway; this.emailAdapter = emailAdapter;
    this.publicBaseUrl = String(publicBaseUrl).replace(/\/$/, ""); this.maxRunnersPerOrder = Math.min(DEFAULT_MAX_RUNNERS_PER_ORDER, Number.isInteger(maxRunnersPerOrder) && maxRunnersPerOrder > 0 ? maxRunnersPerOrder : DEFAULT_MAX_RUNNERS_PER_ORDER); this.reminderPolicy = reminderPolicy; this.draftRetentionHours = Number.isInteger(draftRetentionHours) && draftRetentionHours > 0 ? draftRetentionHours : null;
  }
  declarationUrl(token) { return `${this.publicBaseUrl}/registration/declaration.html#token=${encodeURIComponent(token)}`; }
  orderUrl(token) { return `${this.publicBaseUrl}/registration/#order=${encodeURIComponent(token)}`; }
  communicate(state, message, key, at) { return deliverRegistrationCommunication(state, this.emailAdapter, message, { idempotencyKey: key, at }); }

  createOrder(input, at = new Date()) {
    return this.repository.transaction(async (state) => {
      ensureCollections(state);
      const purchaserEmail = normalizeEmail(input.purchaserEmail);
      if (!["local", "development"].includes(state.environment) || state.registrationState !== "test") return { ok: false, code: "REGISTRATION_NOT_ACCEPTING" };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(purchaserEmail) || !SYNTHETIC_EMAIL.test(purchaserEmail)) return { ok: false, code: "VALIDATION_ERROR", errors: { purchaserEmail: "Use a valid synthetic email address." } };
      const order = { id: id("order"), purchaserEmail, status: "draft", registrationIds: [], totalPence: 0, createdAt: iso(at), updatedAt: iso(at), checkoutExpiresAt: null, deletedAt: null };
      state.orders.push(order); const orderToken = issueOrderToken(state, order.id, at); audit(state, "order_created", order.id, {}, at, { actorType: "purchaser" });
      return { ok: true, order: orderView(state, order), orderToken };
    });
  }

  async getOrder(token) {
    const state = await this.repository.read(); ensureCollections(state); const order = orderForToken(state, token);
    return order ? { ok: true, order: orderView(state, order) } : { ok: false, code: "ORDER_TOKEN_INVALID" };
  }

  addRunner(token, input, at = new Date()) {
    return this.repository.transaction((state) => {
      ensureCollections(state); const order = orderForToken(state, token);
      if (!order || !["draft", "checkout_expired"].includes(order.status)) return { ok: false, code: "ORDER_TOKEN_INVALID" };
      if (order.registrationIds.length >= this.maxRunnersPerOrder) return { ok: false, code: "ORDER_RUNNER_LIMIT" };
      const { runner: normalized, errors } = validateAdultRunner(state, input.runner ?? input);
      if (Object.keys(errors).length) return { ok: false, code: "VALIDATION_ERROR", errors };
      const existingOrderEmails = registrationsFor(state, order).map((registration) => normalizeEmail(runnerFor(state, registration)?.email));
      if (existingOrderEmails.includes(normalized.email)) return { ok: false, code: "DUPLICATE_ORDER_EMAIL", message: "Each adult runner needs their own email address so we can send their declaration and entry-management link directly to them." };
      const alreadyActive = state.registrations.some((registration) => active(registration) && ["payment_reserved", "confirmed"].includes(registration.placeStatus) && normalizeEmail(runnerFor(state, registration)?.email) === normalized.email);
      if (alreadyActive) return { ok: false, code: "DUPLICATE_ACTIVE_ENTRY", message: "An active entry may already exist for this email address." };
      const declarationMode = input.declarationMode;
      const declarationCheck = validateDeclaration(state, normalized, declarationMode, input.declaration);
      if (!declarationCheck.ok) return declarationCheck;
      const runner = { id: id("runner"), email: normalized.email, firstName: normalizeText(normalized.firstName), lastName: normalizeText(normalized.lastName), phone: normalizeText(normalized.phone), addressLine1: normalizeText(normalized.addressLine1), addressLine2: normalizeText(normalized.addressLine2), city: normalizeText(normalized.city), postcode: normalizeText(normalized.postcode).toUpperCase(), raceCategory: normalized.raceCategory, genderCategory: normalized.raceCategory, dateOfBirth: normalized.dateOfBirth, club: normalizeText(normalized.club), wfraMember: normalized.wfraMember === true, wfraMembershipNumber: normalized.wfraMember === true ? normalizeText(normalized.wfraMembershipNumber) || null : null, wfraMembershipVerified: false, anonymisedAt: null };
      state.runners.push(runner);
      const pricing = calculateEntryPrice(state.event, runner);
      const registration = { id: id("registration"), orderId: order.id, testReference: `TEST-${crypto.randomBytes(4).toString("hex").toUpperCase()}`, eventId: state.event.id, runnerId: runner.id, environment: state.environment, entryStatus: "draft", placeStatus: "none", raceNumber: null, declarationStatus: declarationMode === "now" ? "complete" : "pending", declarationCompletionMethod: declarationMode === "now" ? "digital_during_entry" : null, priceActuallyChargedPence: pricing.priceActuallyChargedPence, pricing, createdAt: iso(at), updatedAt: iso(at), deletedAt: null };
      state.registrations.push(registration); order.registrationIds.push(registration.id); order.totalPence += pricing.priceActuallyChargedPence; order.updatedAt = iso(at);
      state.emergencyContacts.push({ id: id("emergency"), registrationId: registration.id, name: normalizeText(normalized.emergencyContactName), phone: normalizeText(normalized.emergencyContactPhone), deleteAfterEvent: true });
      state.consents.push({ id: id("consent"), registrationId: registration.id, termsVersion: state.event.termsVersion, privacyVersion: state.event.privacyVersion, recordedAt: iso(at), declaration: null });
      if (declarationMode === "now") recordDigitalDeclaration(state, registration, runner, input.declaration, "digital_during_entry", at);
      audit(state, "order_runner_added", registration.id, { orderId: order.id, pricePence: pricing.priceActuallyChargedPence, declarationStatus: registration.declarationStatus }, at, { actorType: "purchaser" });
      return { ok: true, order: orderView(state, order) };
    });
  }

  removeRunner(token, registrationId, at = new Date()) {
    return this.repository.transaction((state) => {
      ensureCollections(state); const order = orderForToken(state, token);
      if (!order || !["draft", "checkout_expired"].includes(order.status) || !order.registrationIds.includes(registrationId)) return { ok: false, code: "ORDER_NOT_EDITABLE" };
      const registration = state.registrations.find((item) => item.id === registrationId);
      registration.deletedAt = iso(at); order.registrationIds = order.registrationIds.filter((value) => value !== registrationId); order.totalPence -= registration.priceActuallyChargedPence; order.updatedAt = iso(at);
      for (const tokenRecord of state.declarationTokens.filter((item) => item.registrationId === registrationId && !item.revokedAt)) tokenRecord.revokedAt = iso(at);
      audit(state, "order_runner_removed", registrationId, { orderId: order.id }, at, { actorType: "purchaser" });
      return { ok: true, order: orderView(state, order) };
    });
  }

  updateRunner(token, registrationId, input, at = new Date()) {
    return this.repository.transaction((state) => {
      ensureCollections(state); const order = orderForToken(state, token); const registration = state.registrations.find((item) => item.id === registrationId && !item.deletedAt);
      if (!order || !["draft", "checkout_expired"].includes(order.status) || !order.registrationIds.includes(registrationId) || !registration) return { ok: false, code: "ORDER_NOT_EDITABLE" };
      const { runner: normalized, errors } = validateAdultRunner(state, input.runner ?? input); if (Object.keys(errors).length) return { ok: false, code: "VALIDATION_ERROR", errors };
      const duplicate = registrationsFor(state, order).some((item) => item.id !== registrationId && normalizeEmail(runnerFor(state, item)?.email) === normalized.email);
      if (duplicate) return { ok: false, code: "DUPLICATE_ORDER_EMAIL" };
      const declarationCheck = validateDeclaration(state, normalized, input.declarationMode, input.declaration); if (!declarationCheck.ok) return declarationCheck;
      const runner = runnerFor(state, registration); const previousPrice = registration.priceActuallyChargedPence;
      Object.assign(runner, { email: normalized.email, firstName: normalizeText(normalized.firstName), lastName: normalizeText(normalized.lastName), phone: normalizeText(normalized.phone), addressLine1: normalizeText(normalized.addressLine1), addressLine2: normalizeText(normalized.addressLine2), city: normalizeText(normalized.city), postcode: normalizeText(normalized.postcode).toUpperCase(), raceCategory: normalized.raceCategory, genderCategory: normalized.raceCategory, dateOfBirth: normalized.dateOfBirth, club: normalizeText(normalized.club), wfraMember: normalized.wfraMember === true, wfraMembershipNumber: normalized.wfraMember === true ? normalizeText(normalized.wfraMembershipNumber) || null : null });
      const emergency = state.emergencyContacts.find((item) => item.registrationId === registrationId); Object.assign(emergency, { name: normalizeText(normalized.emergencyContactName), phone: normalizeText(normalized.emergencyContactPhone) });
      const pricing = calculateEntryPrice(state.event, runner); registration.priceActuallyChargedPence = pricing.priceActuallyChargedPence; registration.pricing = pricing; order.totalPence += pricing.priceActuallyChargedPence - previousPrice;
      for (const prior of state.declarations.filter((item) => item.registrationId === registrationId && !item.revokedAt)) prior.revokedAt = iso(at);
      registration.declarationStatus = input.declarationMode === "now" ? "complete" : "pending"; registration.declarationCompletionMethod = input.declarationMode === "now" ? "digital_during_entry" : null; registration.updatedAt = iso(at); order.updatedAt = iso(at);
      if (input.declarationMode === "now") recordDigitalDeclaration(state, registration, runner, input.declaration, "digital_during_entry", at);
      audit(state, "order_runner_updated", registrationId, { orderId: order.id, declarationStatus: registration.declarationStatus }, at, { actorType: "purchaser" });
      return { ok: true, order: orderView(state, order) };
    });
  }

  checkout(token, at = new Date()) {
    if (!this.stripeGateway) return Promise.resolve({ ok: false, code: "PAYMENTS_UNAVAILABLE" });
    const checkoutAttemptId = id("checkout_attempt");
    return this.repository.transaction(async (state) => {
      let recognisedExpiredCheckout = false;
      const reject = (result) => recognisedExpiredCheckout ? { ok: true, committedError: result } : result;
      ensureCollections(state); const order = orderForToken(state, token);
      if (!order) return { ok: false, code: "ORDER_NOT_EDITABLE" };
      let payment = orderPayment(state, order);
      if (order.status === "checkout_pending" && payment?.status === "checkout_pending" && new Date(payment.checkoutExpiresAt) > new Date(at)) {
        return { ok: true, duplicate: true, checkoutUrl: payment.checkoutUrl, expiresAt: payment.checkoutExpiresAt, totalPence: payment.expectedAmountPence };
      }
      if (order.status === "checkout_pending" && (!payment?.checkoutExpiresAt || new Date(payment.checkoutExpiresAt) <= new Date(at))) {
        recognisedExpiredCheckout = true;
        order.status = "checkout_expired"; if (payment) payment.status = "expired";
        registrationsFor(state, order).filter(active).forEach((registration) => { registration.placeStatus = "none"; registration.entryStatus = "draft"; });
        audit(state, "order_checkout_released", order.id, { runnerCount: order.registrationIds.length, recognisedOnReturn: true }, at, { actorType: "purchaser" });
      }
      if (!["draft", "checkout_expired"].includes(order.status)) return reject({ ok: false, code: "ORDER_NOT_EDITABLE" });
      const registrations = registrationsFor(state, order).filter(active);
      if (!registrations.length || registrations.length > this.maxRunnersPerOrder) return reject({ ok: false, code: "ORDER_RUNNER_COUNT_INVALID" });
      let recalculatedTotal = 0;
      for (const registration of registrations) {
        const runner = runnerFor(state, registration);
        const checked = validateAdultRunner(state, { ...runner, emergencyContactName: state.emergencyContacts.find((item) => item.registrationId === registration.id)?.name, emergencyContactPhone: state.emergencyContacts.find((item) => item.registrationId === registration.id)?.phone, acceptTerms: true, acceptPrivacy: true });
        if (Object.keys(checked.errors).length) return reject({ ok: false, code: "VALIDATION_ERROR", errors: checked.errors });
        const pricing = calculateEntryPrice(state.event, runner); registration.pricing = pricing; registration.priceActuallyChargedPence = pricing.priceActuallyChargedPence; recalculatedTotal += pricing.priceActuallyChargedPence;
      }
      order.totalPence = recalculatedTotal;
      if (capacitySummary(state).remaining < registrations.length) return reject({ ok: false, code: "GROUP_CAPACITY_UNAVAILABLE", availablePlaces: capacitySummary(state).remaining });
      const emails = registrations.map((registration) => normalizeEmail(runnerFor(state, registration)?.email));
      if (new Set(emails).size !== emails.length) return reject({ ok: false, code: "DUPLICATE_ORDER_EMAIL" });
      const conflicts = state.registrations.some((candidate) => !order.registrationIds.includes(candidate.id) && active(candidate) && ["payment_reserved", "confirmed"].includes(candidate.placeStatus) && emails.includes(normalizeEmail(runnerFor(state, candidate)?.email)));
      if (conflicts) return reject({ ok: false, code: "DUPLICATE_ACTIVE_ENTRY" });
      if (!payment) { payment = { id: id("payment"), orderId: order.id, registrationIds: [...order.registrationIds], status: "created", expectedAmountPence: order.totalPence, actualPaidAmountPence: null, refundedAmountPence: 0, refundedRegistrationIds: [], checkoutAttempts: [], currency: "gbp", provider: "stripe", providerMode: "test", createdAt: iso(at), updatedAt: iso(at) }; state.payments.push(payment); }
      payment.checkoutAttempts ??= [];
      if (payment.checkoutSessionId) payment.checkoutAttempts = payment.checkoutAttempts.map((attempt) => attempt.sessionId === payment.checkoutSessionId && attempt.status === "active" ? { ...attempt, status: "expired", expiredAt: iso(at) } : attempt);
      payment.expectedAmountPence = order.totalPence; payment.registrationIds = [...order.registrationIds];
      registrations.forEach((registration) => { registration.placeStatus = "payment_reserved"; registration.entryStatus = "accepted"; registration.updatedAt = iso(at); });
      const created = await this.stripeGateway.createOrderCheckoutSession({ orderId: order.id, paymentId: payment.id, checkoutAttemptId, runnerPricesPence: registrations.map((registration) => registration.priceActuallyChargedPence), successUrl: `${this.publicBaseUrl}/registration/payment-return.html?order=1`, cancelUrl: `${this.publicBaseUrl}/registration/?cancelled=1`, at });
      payment.checkoutAttempts.push({ id: checkoutAttemptId, sessionId: created.id, status: "active", createdAt: iso(at), expiresAt: created.expiresAt, amountPence: order.totalPence, runnerCount: registrations.length });
      Object.assign(payment, { status: "checkout_pending", checkoutSessionId: created.id, checkoutUrl: created.url, checkoutExpiresAt: created.expiresAt, webhookReconciliationState: "awaiting_event", externalCall: true, updatedAt: iso(at) });
      Object.assign(order, { status: "checkout_pending", checkoutExpiresAt: created.expiresAt, updatedAt: iso(at) });
      audit(state, "order_checkout_created", order.id, { runnerCount: registrations.length, totalPence: order.totalPence }, at, { actorType: "purchaser" });
      return { ok: true, checkoutUrl: created.url, expiresAt: created.expiresAt, totalPence: payment.expectedAmountPence };
    }).then((result) => result.committedError ?? result);
  }

  async webhook(event, at = new Date()) {
    return this.repository.transaction(async (state) => {
      ensureCollections(state);
      if (!event?.id || state.processedPaymentEvents.some((item) => item.id === event.id)) return event?.id ? { ok: true, duplicate: true } : { ok: false, code: "UNSUPPORTED_EVENT" };
      const object = event.data?.object ?? {};
      const payment = state.payments.find((item) => item.orderId && (item.checkoutSessionId === object.id || item.paymentIntentId === (object.payment_intent?.id ?? object.payment_intent)));
      if (!payment) return { ok: false, code: "PAYMENT_NOT_FOUND" };
      const order = state.orders.find((item) => item.id === payment.orderId); const registrations = registrationsFor(state, order).filter(active);
      if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
        const paid = object.amount_total ?? object.amount_received; const currency = String(object.currency ?? "").toLowerCase();
        if (paid !== payment.expectedAmountPence || currency !== "gbp") return { ok: false, code: "PAYMENT_MISMATCH" };
        if (event.type === "checkout.session.completed" && object.payment_status && object.payment_status !== "paid") { payment.status = "processing"; order.status = "payment_processing"; }
        else {
          payment.checkoutAttempts = (payment.checkoutAttempts ?? []).map((attempt) => attempt.sessionId === object.id ? { ...attempt, status: "completed", completedAt: iso(at) } : attempt);
          payment.status = "paid"; payment.actualPaidAmountPence = paid; payment.paymentIntentId = typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id; payment.completedAt = iso(at); payment.webhookReconciliationState = "reconciled"; order.status = "paid"; order.paidAt = iso(at);
          for (const registration of registrations) {
            registration.placeStatus = "confirmed"; registration.entryStatus = "accepted"; registration.updatedAt = iso(at);
            const runner = runnerFor(state, registration); const management = issueManagementToken(state, registration.id, { actorType: "system" }, at);
            if (declarationView(state, registration).status === "pending") {
              const declarationToken = issueDeclarationToken(state, registration.id, at);
              await this.communicate(state, { registrationId: registration.id, template: "entry_confirmed_declaration_required", intendedRecipientAddress: runner.email, data: { runnerName: fullName(runner), raceDate: state.event.raceDate, raceInfoUrl: `${this.publicBaseUrl}/info.html`, secureUrl: this.declarationUrl(declarationToken), managementUrl: `${this.publicBaseUrl}/registration/manage.html#token=${encodeURIComponent(management.token)}` } }, `order:${order.id}:registration:${registration.id}:confirmed-pending`, at);
              registration.declarationInitialSentAt = iso(at);
            } else await this.communicate(state, { registrationId: registration.id, template: "entry_confirmed", intendedRecipientAddress: runner.email, data: { runnerName: fullName(runner), raceDate: state.event.raceDate, raceInfoUrl: `${this.publicBaseUrl}/info.html`, managementUrl: `${this.publicBaseUrl}/registration/manage.html#token=${encodeURIComponent(management.token)}` } }, `order:${order.id}:registration:${registration.id}:confirmed`, at);
          }
          if (registrations.length > 1) await this.communicate(state, { orderId: order.id, template: "order_payment_confirmed", intendedRecipientAddress: order.purchaserEmail, data: { runnerCount: registrations.length, amountPence: order.totalPence } }, `order:${order.id}:purchaser-confirmed`, at);
          audit(state, "order_payment_confirmed", order.id, { runnerCount: registrations.length, totalPence: order.totalPence }, at);
        }
      } else if (["checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
        if (payment.status !== "paid") { payment.status = event.type === "checkout.session.expired" ? "expired" : "failed"; payment.checkoutAttempts = (payment.checkoutAttempts ?? []).map((attempt) => attempt.sessionId === object.id ? { ...attempt, status: payment.status, expiredAt: iso(at) } : attempt); order.status = "checkout_expired"; registrations.forEach((registration) => { registration.placeStatus = "none"; registration.entryStatus = "draft"; }); audit(state, "order_checkout_released", order.id, { runnerCount: registrations.length }, at); }
      } else if (event.type === "charge.refunded") {
        payment.webhookReconciliationState = "refund_event_observed";
      } else if (event.type === "refund.failed") {
        payment.refundState = "failed";
        const registrationId = object.metadata?.registrationId;
        const request = state.refundRequests.find((item) => item.registrationId === registrationId && item.status === "approved");
        if (request) request.refundFailureAt = iso(at);
        audit(state, "stripe_refund_failed", registrationId ?? order.id, {}, at);
      } else return { ok: false, code: "UNSUPPORTED_EVENT" };
      payment.updatedAt = iso(at); order.updatedAt = iso(at); state.processedPaymentEvents.push({ id: event.id, type: event.type, processedAt: iso(at) });
      return { ok: true, orderStatus: order.status, paymentStatus: payment.status, confirmed: registrations.filter((item) => item.placeStatus === "confirmed").length };
    });
  }

  async inspectDeclaration(token) {
    const state = await this.repository.read(); ensureCollections(state); const registration = registrationForDeclarationToken(state, token); const runner = runnerFor(state, registration);
    if (!registration || !runner) return { ok: false, code: "LINK_UNAVAILABLE" };
    return { ok: true, registration: { reference: registration.testReference, runner: { firstName: runner.firstName, lastName: runner.lastName, raceCategory: runner.raceCategory, club: runner.club }, declaration: declarationView(state, registration), declarationIdentifier: state.event.declarationIdentifier, declarationVersion: state.event.declarationVersion } };
  }

  async publicStartList() {
    const state = await this.repository.read();
    ensureCollections(state);
    return buildPublicStartList(state);
  }

  recoverDeclarationLink(emailAddress, at = new Date()) {
    const email = normalizeEmail(emailAddress); const generic = { ok: true, message: "If an eligible entry matches, a secure declaration link will be sent." };
    return this.repository.transaction(async (state) => {
      ensureCollections(state); const emailHash = hashToken(email);
      state.declarationRecoveryAttempts = state.declarationRecoveryAttempts.filter((item) => new Date(item.requestedAt) > new Date(new Date(at).getTime() - 24 * 60 * 60_000));
      const recent = state.declarationRecoveryAttempts.filter((item) => item.emailHash === emailHash && new Date(item.requestedAt) > new Date(new Date(at).getTime() - 60 * 60_000));
      state.declarationRecoveryAttempts.push({ emailHash, requestedAt: iso(at) });
      if (recent.length >= 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return generic;
      const matches = state.registrations.filter((registration) => active(registration) && registration.placeStatus === "confirmed" && declarationView(state, registration).status === "pending" && normalizeEmail(runnerFor(state, registration)?.email) === email);
      for (const registration of matches) {
        const runner = runnerFor(state, registration); const token = issueDeclarationToken(state, registration.id, at);
        await this.communicate(state, { registrationId: registration.id, template: "declaration_reminder", intendedRecipientAddress: runner.email, data: { runnerName: fullName(runner), secureUrl: this.declarationUrl(token) } }, `registration:${registration.id}:declaration-recovery:${state.declarationTokens.at(-1).id}`, at);
      }
      return generic;
    }).catch(() => generic);
  }

  completeDeclaration(token, input, at = new Date()) {
    return this.repository.transaction((state) => {
      ensureCollections(state); const registration = registrationForDeclarationToken(state, token); const runner = runnerFor(state, registration);
      if (!registration || !runner) return { ok: false, code: "LINK_UNAVAILABLE" };
      const result = recordDigitalDeclaration(state, registration, runner, { ...input, declarationIdentifier: state.event.declarationIdentifier, declarationVersion: state.event.declarationVersion, signatoryRole: "Competitor" }, "digital_remote", at);
      return result.ok ? { ok: true, duplicate: result.duplicate === true, declaration: declarationView(state, registration) } : result;
    });
  }

  resendDeclaration(actor, registrationId, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction(async (state) => {
      ensureCollections(state); const registration = state.registrations.find((item) => item.id === registrationId && active(item)); const runner = runnerFor(state, registration);
      if (!registration || !runner) return { ok: false, code: "NOT_FOUND" };
      if (declarationView(state, registration).status === "complete") return { ok: false, code: "DECLARATION_ALREADY_COMPLETE" };
      const token = issueDeclarationToken(state, registration.id, at);
      await this.communicate(state, { registrationId, template: "declaration_reminder", intendedRecipientAddress: runner.email, data: { runnerName: fullName(runner), secureUrl: this.declarationUrl(token) } }, `registration:${registration.id}:declaration-resend:${state.declarationTokens.at(-1).id}`, at);
      audit(state, "declaration_email_resent", registration.id, {}, at, actor);
      return { ok: true };
    });
  }

  recordPaperDeclaration(actor, registrationId, at = new Date()) {
    if (!authorize(actor, "manage")) return Promise.resolve({ ok: false, code: "FORBIDDEN" });
    return this.repository.transaction((state) => {
      ensureCollections(state); const registration = state.registrations.find((item) => item.id === registrationId && active(item)); const runner = runnerFor(state, registration);
      if (!registration || !runner) return { ok: false, code: "NOT_FOUND" };
      if (declarationFor(state, registration.id)) return { ok: true, duplicate: true, declaration: declarationView(state, registration) };
      const declaration = { id: id("declaration"), registrationId, runnerId: runner.id, declarationIdentifier: state.event.declarationIdentifier, declarationVersion: state.event.declarationVersion, accepted: true, typedFullName: null, signatoryRole: "Competitor", completedAt: iso(at), completionMethod: "paper_in_person", recordedByActorId: actor.id ?? null };
      state.declarations.push(declaration); registration.declarationStatus = "complete"; registration.declarationCompletionMethod = "paper_in_person"; registration.updatedAt = iso(at);
      for (const token of state.declarationTokens.filter((item) => item.registrationId === registrationId && !item.revokedAt)) { token.revokedAt = iso(at); token.revokedReason = "paper_completed"; }
      audit(state, "paper_declaration_received", registration.id, { completionMethod: "paper_in_person", declarationVersion: declaration.declarationVersion }, at, actor);
      return { ok: true, declaration: declarationView(state, registration) };
    });
  }

  runScheduledWork(at = new Date()) {
    return this.repository.transaction(async (state) => {
      ensureCollections(state); let declarationReminders = 0; let abandonedOrders = 0;
      for (const registration of state.registrations.filter((item) => active(item) && item.placeStatus === "confirmed" && declarationView(state, item).status === "pending")) {
        const firstDue = registration.declarationInitialSentAt && new Date(at) >= new Date(new Date(registration.declarationInitialSentAt).getTime() + this.reminderPolicy.afterPaymentDays * 86_400_000);
        if (!firstDue || registration.declarationReminderSentAt) continue;
        const runner = runnerFor(state, registration); const token = issueDeclarationToken(state, registration.id, at);
        await this.communicate(state, { registrationId: registration.id, template: "declaration_reminder", intendedRecipientAddress: runner.email, data: { runnerName: fullName(runner), secureUrl: this.declarationUrl(token) } }, `registration:${registration.id}:declaration-reminder`, at);
        registration.declarationReminderSentAt = iso(at); declarationReminders += 1;
      }
      for (const order of state.orders.filter((item) => item.status === "checkout_pending" && new Date(item.checkoutExpiresAt) <= new Date(at))) {
        const payment = orderPayment(state, order); if (payment?.status === "paid") continue;
        order.status = "checkout_expired"; if (payment) { payment.status = "expired"; payment.checkoutAttempts = (payment.checkoutAttempts ?? []).map((attempt) => attempt.status === "active" ? { ...attempt, status: "expired", expiredAt: iso(at) } : attempt); }
        registrationsFor(state, order).forEach((registration) => { registration.placeStatus = "none"; registration.entryStatus = "draft"; }); abandonedOrders += 1;
      }
      if (this.draftRetentionHours) for (const order of state.orders.filter((item) => item.status === "draft" && new Date(item.updatedAt) <= new Date(new Date(at).getTime() - this.draftRetentionHours * 3_600_000))) {
        order.status = "abandoned"; order.deletedAt = iso(at); registrationsFor(state, order).forEach((registration) => { registration.deletedAt = iso(at); });
        for (const token of state.orderTokens.filter((item) => item.orderId === order.id && !item.invalidatedAt)) token.invalidatedAt = iso(at);
        abandonedOrders += 1; audit(state, "stale_order_abandoned", order.id, { runnerCount: order.registrationIds.length }, at);
      }
      return { ok: true, declarationReminders, abandonedOrders };
    });
  }
}

export const orderInternals = Object.freeze({ declarationView, orderView, hashToken });
