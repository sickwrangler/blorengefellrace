import crypto from "node:crypto";
import { WFRA_SENIOR_ENTRY_DECLARATION } from "../declarations.mjs";

export const PHASE3_REGISTRATION_STATES = Object.freeze(["CLOSED", "PRIVATE_LIVE", "OPEN", "PAUSED", "CLOSED_FINAL"]);
export const PRIVATE_INVITATION_KINDS = Object.freeze(["registration", "waiting_list_join", "waiting_list_offer"]);
export const RACE_CATEGORIES = Object.freeze(["Female", "Male / Open"]);
export const REFUND_STATES = Object.freeze(["requested", "approved", "rejected", "refunded"]);

export const PHASE3_EVENT = Object.freeze({
  id: "blorenge-2026",
  name: "Blorenge Fell Race 2026",
  raceDate: "2026-11-28",
  timezone: "Europe/London",
  capacity: 120,
  entryFeePence: 600,
  wfraMemberPricePence: null,
  transferRefundCutoffLocal: "2026-10-28T23:59:00",
  transferRefundCutoffUtc: "2026-10-28T23:59:00.000Z",
  waitingListOfferHours: 48,
  waitingListReminderHours: 24,
  raceNumbersInitiallyAssigned: false,
  declaration: Object.freeze({
    identifier: WFRA_SENIOR_ENTRY_DECLARATION.identifier,
    version: WFRA_SENIOR_ENTRY_DECLARATION.version,
    contentStatus: "organiser-supplied-versioned-content"
  })
});

const transitions = Object.freeze({
  CLOSED: ["PRIVATE_LIVE", "OPEN", "CLOSED_FINAL"],
  PRIVATE_LIVE: ["CLOSED", "OPEN", "PAUSED", "CLOSED_FINAL"],
  OPEN: ["PAUSED", "CLOSED_FINAL"],
  PAUSED: ["CLOSED", "PRIVATE_LIVE", "OPEN", "CLOSED_FINAL"],
  CLOSED_FINAL: []
});
const shortId = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const opaqueToken = () => crypto.randomBytes(32).toString("base64url");
const iso = (value = new Date()) => new Date(value).toISOString();
const organiser = (actor) => Boolean(actor?.authenticated && ["Organiser", "administrator"].includes(actor.role));
const systemActor = Object.freeze({ authenticated: true, role: "administrator", actorType: "system", id: "waiting-list-progression" });
const activeRegistration = (entry) => !entry.deletedAt && !["cancelled", "place_released"].includes(entry.entryStatus);

function recordAudit(state, actor, action, subjectId = null, before = null, after = null, at = new Date()) {
  state.auditEvents.push({
    id: shortId("audit"), occurredAt: iso(at), actorType: actor?.actorType ?? "runner",
    actorId: actor?.id ?? null, action, subjectId, before, after, environment: state.environment
  });
}

export function createPhase3State({ environment = "development", registrationState, declarationVersion = WFRA_SENIOR_ENTRY_DECLARATION.version, wfraMemberPricePence = null } = {}) {
  const requested = PHASE3_REGISTRATION_STATES.includes(registrationState) ? registrationState : "CLOSED";
  return {
    schemaVersion: 3,
    environment,
    registrationState: environment === "production" ? "CLOSED" : requested,
    event: {
      ...PHASE3_EVENT,
      wfraMemberPricePence: Number.isInteger(wfraMemberPricePence) && wfraMemberPricePence >= 0 ? wfraMemberPricePence : null,
      declaration: { ...PHASE3_EVENT.declaration, version: declarationVersion }
    },
    runners: [], registrations: [], payments: [], declarations: [], managementTokens: [],
    privateInvitations: [], waitingList: [], waitingListOffers: [], refundRequests: [], auditEvents: []
  };
}

export function transitionRegistrationState(state, nextState, actor, { expectedState = state.registrationState, at = new Date() } = {}) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  if (!PHASE3_REGISTRATION_STATES.includes(nextState)) return { ok: false, code: "INVALID_STATE" };
  if (expectedState !== state.registrationState) return { ok: false, code: "STATE_CONFLICT" };
  if (nextState === state.registrationState) return { ok: true, state: nextState, unchanged: true };
  if (!transitions[state.registrationState]?.includes(nextState)) return { ok: false, code: "FORBIDDEN_TRANSITION" };
  const before = state.registrationState;
  state.registrationState = nextState;
  recordAudit(state, actor, "registration_state_changed", state.event.id, { state: before }, { state: nextState }, at);
  return { ok: true, state: nextState };
}

export function environmentStateLabel(environment, state, { runner = false } = {}) {
  const stateLabel = state === "PRIVATE_LIVE" ? "Private" : state === "CLOSED_FINAL" ? "Closed" : `${state[0]}${state.slice(1).toLowerCase()}`;
  if (runner && environment === "production" && state === "OPEN") return "";
  const environmentLabel = environment === "production" ? "Production" : "Development";
  return `${environmentLabel} · ${stateLabel}`;
}

export function issuePrivateInvitation(state, input, actor, at = new Date()) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  if (!PRIVATE_INVITATION_KINDS.includes(input.kind)) return { ok: false, code: "INVALID_INVITATION_KIND" };
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.valueOf()) || expiresAt <= new Date(at)) return { ok: false, code: "INVALID_EXPIRY" };
  const token = opaqueToken();
  const invitation = {
    id: shortId("invite"), kind: input.kind, tokenHash: hashToken(token), createdAt: iso(at),
    expiresAt: expiresAt.toISOString(), revokedAt: null, lastUsedAt: null,
    uses: 0, maximumUses: Number.isInteger(input.maximumUses) && input.maximumUses > 0 ? input.maximumUses : 1,
    waitingListId: input.waitingListId ?? null, registrationId: input.registrationId ?? null
  };
  state.privateInvitations.push(invitation);
  recordAudit(state, actor, "private_invitation_created", invitation.id, null, { kind: invitation.kind, expiresAt: invitation.expiresAt }, at);
  return { ok: true, invitation: { ...invitation, tokenHash: undefined }, token };
}

export function inspectPrivateInvitation(state, token, { kind, at = new Date(), consume = false } = {}) {
  const invitation = state.privateInvitations.find((item) => item.tokenHash === hashToken(token));
  if (!invitation) return { ok: false, code: "INVITATION_NOT_FOUND" };
  if (invitation.revokedAt) return { ok: false, code: "INVITATION_REVOKED" };
  if (new Date(invitation.expiresAt) <= new Date(at)) return { ok: false, code: "INVITATION_EXPIRED" };
  if (kind && invitation.kind !== kind) return { ok: false, code: "INVITATION_WRONG_PURPOSE" };
  if (invitation.uses >= invitation.maximumUses) return { ok: false, code: "INVITATION_USED" };
  if (consume) { invitation.uses += 1; invitation.lastUsedAt = iso(at); }
  return { ok: true, invitation: { ...invitation, tokenHash: undefined } };
}

export function authorizePrivateInvitation(state, token, { kind, at = new Date(), consume = false, allowDevelopmentTest = false } = {}) {
  const statePermitsPrivateAccess = ["PRIVATE_LIVE", "OPEN"].includes(state.registrationState) || (allowDevelopmentTest && state.environment !== "production" && state.registrationState === "test");
  if (!statePermitsPrivateAccess) return { ok: false, code: "REGISTRATION_NOT_ACCEPTING" };
  const checked = inspectPrivateInvitation(state, token, { kind, at, consume: false });
  if (!checked.ok) return checked;
  if (kind === "waiting_list_offer") {
    const offer = state.waitingListOffers?.find((item) => item.invitationId === checked.invitation.id);
    if (!offer || offer.status !== "offered" || new Date(offer.expiresAt) <= new Date(at)) return { ok: false, code: "OFFER_NOT_ACTIVE" };
  }
  return consume ? inspectPrivateInvitation(state, token, { kind, at, consume: true }) : checked;
}

export function revokePrivateInvitation(state, invitationId, actor, at = new Date()) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  const invitation = state.privateInvitations.find((item) => item.id === invitationId);
  if (!invitation) return { ok: false, code: "NOT_FOUND" };
  if (!invitation.revokedAt) {
    invitation.revokedAt = iso(at);
    const offer = state.waitingListOffers?.find((item) => item.invitationId === invitation.id && item.status === "offered");
    if (offer) {
      offer.status = "revoked"; offer.completedAt = iso(at);
      const waiting = state.waitingList?.find((item) => item.id === offer.waitingListId); if (waiting) waiting.status = "waiting";
    }
    recordAudit(state, actor, "private_invitation_revoked", invitation.id, null, { kind: invitation.kind }, at);
  }
  return { ok: true };
}

export function expirePrivateInvitation(state, invitationId, actor, at = new Date()) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  const invitation = state.privateInvitations.find((item) => item.id === invitationId);
  if (!invitation) return { ok: false, code: "NOT_FOUND" };
  invitation.expiresAt = iso(at);
  const offer = state.waitingListOffers?.find((item) => item.invitationId === invitation.id && item.status === "offered");
  if (offer) {
    offer.status = "expired"; offer.completedAt = iso(at);
    const waiting = state.waitingList?.find((item) => item.id === offer.waitingListId); if (waiting) waiting.status = "waiting";
  }
  recordAudit(state, actor, "private_invitation_expired", invitation.id, null, { kind: invitation.kind }, at);
  return { ok: true };
}

export function canUsePublicRegistration(state, { invitationToken = null, kind = "registration", at = new Date() } = {}) {
  if (state.registrationState === "OPEN" && !invitationToken) return { ok: true, access: "public" };
  if (!["PRIVATE_LIVE", "OPEN"].includes(state.registrationState)) return { ok: false, code: "REGISTRATION_NOT_ACCEPTING" };
  const invitation = authorizePrivateInvitation(state, invitationToken, { kind, at });
  return invitation.ok ? { ok: true, access: "private", invitation: invitation.invitation } : invitation;
}

export function validateProductionRunner(input) {
  const errors = {};
  const required = ["email", "firstName", "lastName", "phone", "addressLine1", "city", "postcode", "raceCategory", "dateOfBirth", "emergencyContactName", "emergencyContactPhone"];
  for (const field of required) if (!String(input[field] ?? "").trim()) errors[field] = "This field is required.";
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email).trim())) errors.email = "Enter a valid email address.";
  if (input.raceCategory && !RACE_CATEGORIES.includes(input.raceCategory)) errors.raceCategory = "Select Female or Male / Open.";
  const age = ageOnRaceDate(input.dateOfBirth);
  if (!Number.isFinite(age)) errors.dateOfBirth = "Enter a valid date of birth.";
  else if (age < 16) errors.dateOfBirth = "Entrants must be at least 16 on race day.";
  if (input.wfraMember && !String(input.wfraMembershipNumber ?? "").trim()) errors.wfraMembershipNumber = "Enter the WFRA membership number.";
  if (String(input.wfraMembershipNumber ?? "").length > 80 || /[\u0000-\u001f\u007f]/.test(String(input.wfraMembershipNumber ?? ""))) errors.wfraMembershipNumber = "Use no more than 80 ordinary text characters.";
  return errors;
}

export function ageOnRaceDate(dateOfBirth, raceDate = PHASE3_EVENT.raceDate) {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`); const race = new Date(`${raceDate}T00:00:00Z`);
  if (!Number.isFinite(birth.valueOf()) || !Number.isFinite(race.valueOf()) || birth > race) return NaN;
  let age = race.getUTCFullYear() - birth.getUTCFullYear();
  if (race.getUTCMonth() < birth.getUTCMonth() || (race.getUTCMonth() === birth.getUTCMonth() && race.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export function calculateEntryPrice(event, runnerInput = {}) {
  const standardPricePence = event.entryFeePence;
  const configuredMemberPrice = Number.isInteger(event.wfraMemberPricePence) && event.wfraMemberPricePence >= 0 ? event.wfraMemberPricePence : null;
  const eligible = runnerInput.wfraMember === true && Boolean(String(runnerInput.wfraMembershipNumber ?? "").trim());
  const wfraDiscountApplied = eligible && configuredMemberPrice !== null;
  return {
    standardPricePence,
    wfraMemberPricePence: configuredMemberPrice,
    priceActuallyChargedPence: wfraDiscountApplied ? configuredMemberPrice : standardPricePence,
    adjustmentReason: wfraDiscountApplied ? "WFRA_MEMBER_SELF_DECLARED" : eligible ? "WFRA_MEMBER_PRICE_NOT_CONFIGURED" : "STANDARD_ENTRY",
    wfraDiscountApplied,
    membershipVerification: "not_automatically_verified"
  };
}

export function capacitySummary(state) {
  const confirmed = state.registrations.filter((item) => activeRegistration(item) && item.placeStatus === "confirmed").length;
  const paymentReserved = state.registrations.filter((item) => activeRegistration(item) && item.placeStatus === "payment_reserved").length;
  const offerReserved = state.waitingListOffers.filter((item) => item.status === "offered").length;
  const reserved = confirmed + paymentReserved + offerReserved;
  return { capacity: state.event.capacity, confirmed, paymentReserved, offerReserved, reserved, remaining: Math.max(0, state.event.capacity - reserved), waiting: state.waitingList.filter((item) => item.status === "waiting").length };
}

export function addPlaceRegistration(state, { runnerId, placeStatus = "payment_reserved" }, actor = { actorType: "runner" }, at = new Date()) {
  if (!["payment_reserved", "confirmed"].includes(placeStatus)) return { ok: false, code: "INVALID_PLACE_STATUS" };
  if (capacitySummary(state).remaining < 1) return { ok: false, code: "CAPACITY_FULL" };
  const registration = { id: shortId("reg"), runnerId, entryStatus: "active", placeStatus, raceNumber: null, createdAt: iso(at), updatedAt: iso(at), deletedAt: null };
  state.registrations.push(registration);
  recordAudit(state, actor, "registration_created", registration.id, null, { placeStatus }, at);
  return { ok: true, registration };
}

function validateDeclarationInput(state, declaration) {
  if (!state.event.declaration.version || declaration?.declarationIdentifier !== state.event.declaration.identifier || declaration?.declarationVersion !== state.event.declaration.version) return { ok: false, code: "DECLARATION_VERSION_UNAVAILABLE" };
  if (declaration.accepted !== true || !String(declaration.typedFullName ?? "").trim()) return { ok: false, code: "DECLARATION_NOT_ACCEPTED" };
  if (!["Competitor", "Parent / Legal Guardian"].includes(declaration.signatoryRole)) return { ok: false, code: "DECLARATION_SIGNATORY_REQUIRED" };
  return { ok: true };
}

function validateUnder18Declaration(state, runner, declaration) {
  const age = ageOnRaceDate(runner.dateOfBirth, state.event.raceDate);
  if (age < 18) return { ok: false, code: "PARENTAL_CONSENT_REQUIREMENTS_PENDING" };
  if (declaration.signatoryRole !== "Competitor") return { ok: false, code: "INVALID_SIGNATORY_ROLE" };
  return { ok: true };
}

function storeRunner(state, input) {
  const runner = { id: shortId("runner") };
  for (const field of ["email", "firstName", "lastName", "phone", "addressLine1", "addressLine2", "city", "postcode", "raceCategory", "dateOfBirth", "club", "wfraMember", "wfraMembershipNumber", "emergencyContactName", "emergencyContactPhone"]) runner[field] = typeof input[field] === "string" ? input[field].trim() : input[field];
  if (runner.wfraMember !== true) runner.wfraMembershipNumber = null;
  runner.wfraMembershipVerified = false;
  state.runners.push(runner);
  return runner;
}

export function beginProductionRegistration(state, input, { invitationToken = null, at = new Date() } = {}) {
  const access = canUsePublicRegistration(state, { invitationToken, kind: "registration", at });
  if (!access.ok) return access;
  const errors = validateProductionRunner(input.runner ?? {});
  if (Object.keys(errors).length) return { ok: false, code: "VALIDATION_ERROR", errors };
  const declarationCheck = validateDeclarationInput(state, input.declaration);
  if (!declarationCheck.ok) return declarationCheck;
  const under18Check = validateUnder18Declaration(state, input.runner, input.declaration);
  if (!under18Check.ok) return under18Check;
  if (capacitySummary(state).remaining < 1) return { ok: false, code: "CAPACITY_FULL" };
  if (state.runners.some((item) => item.email.toLowerCase() === input.runner.email.trim().toLowerCase()) && state.registrations.some((item) => item.runnerId === state.runners.find((runner) => runner.email.toLowerCase() === input.runner.email.trim().toLowerCase())?.id && activeRegistration(item))) return { ok: false, code: "DUPLICATE" };
  if (access.access === "private") {
    const consumed = authorizePrivateInvitation(state, invitationToken, { kind: "registration", at, consume: true });
    if (!consumed.ok) return consumed;
  }
  const runner = storeRunner(state, input.runner);
  const registration = addPlaceRegistration(state, { runnerId: runner.id, placeStatus: "payment_reserved" }, { actorType: "runner" }, at).registration;
  const pricing = calculateEntryPrice(state.event, input.runner);
  runner.wfraDiscountApplied = pricing.wfraDiscountApplied;
  state.payments.push({ id: shortId("payment"), registrationId: registration.id, status: "not_configured", provider: null, externalCall: false, ...pricing, createdAt: iso(at) });
  recordAudit(state, { actorType: "system" }, "entry_price_calculated", registration.id, null, { priceActuallyChargedPence: pricing.priceActuallyChargedPence, adjustmentReason: pricing.adjustmentReason, wfraDiscountApplied: pricing.wfraDiscountApplied }, at);
  recordDeclaration(state, { ...input.declaration, registrationId: registration.id }, at);
  const managementToken = issueManagementToken(state, registration.id, { actorType: "system" }, at).token;
  return { ok: true, registration, managementToken, pricing };
}

export function joinWaitingList(state, input, { invitationToken = null, at = new Date() } = {}) {
  const access = canUsePublicRegistration(state, { invitationToken, kind: "waiting_list_join", at });
  if (!access.ok) return access;
  const minimal = { firstName: String(input.firstName ?? "").trim(), lastName: String(input.lastName ?? "").trim(), email: String(input.email ?? "").trim().toLowerCase() };
  if (!minimal.firstName || !minimal.lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(minimal.email)) return { ok: false, code: "VALIDATION_ERROR" };
  if (state.waitingList.some((item) => item.status === "waiting" && item.email === minimal.email)) return { ok: false, code: "DUPLICATE" };
  if (access.access === "private") {
    const consumed = authorizePrivateInvitation(state, invitationToken, { kind: "waiting_list_join", at, consume: true });
    if (!consumed.ok) return consumed;
  }
  const item = { id: shortId("waiting"), ...minimal, sequence: state.waitingList.length + 1, status: "waiting", joinedAt: iso(at) };
  state.waitingList.push(item);
  recordAudit(state, { actorType: "runner" }, "waiting_list_join", item.id, null, { sequence: item.sequence }, at);
  return { ok: true, waitingListEntry: item };
}

export function createNextWaitingListOffer(state, actor, at = new Date()) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  if (capacitySummary(state).remaining < 1) return { ok: false, code: "CAPACITY_FULL" };
  const waiting = state.waitingList.filter((item) => item.status === "waiting").sort((a, b) => a.sequence - b.sequence)[0];
  if (!waiting) return { ok: false, code: "WAITING_LIST_EMPTY" };
  const expiresAt = new Date(new Date(at).getTime() + state.event.waitingListOfferHours * 3_600_000);
  const reminderAt = new Date(new Date(at).getTime() + state.event.waitingListReminderHours * 3_600_000);
  const issued = issuePrivateInvitation(state, { kind: "waiting_list_offer", waitingListId: waiting.id, expiresAt }, actor, at);
  const offer = { id: shortId("offer"), waitingListId: waiting.id, invitationId: issued.invitation.id, status: "offered", createdAt: iso(at), reminderAt: reminderAt.toISOString(), expiresAt: expiresAt.toISOString() };
  waiting.status = "offered";
  state.waitingListOffers.push(offer);
  recordAudit(state, actor, "waiting_list_offer_created", offer.id, null, { waitingListId: waiting.id, expiresAt: offer.expiresAt }, at);
  return { ok: true, offer, token: issued.token };
}

function finishOffer(state, offer, status, actor, at) {
  offer.status = status;
  offer.completedAt = iso(at);
  const waiting = state.waitingList.find((item) => item.id === offer.waitingListId);
  if (waiting) waiting.status = status;
  const invitation = state.privateInvitations.find((item) => item.id === offer.invitationId);
  if (invitation && !invitation.revokedAt) invitation.revokedAt = iso(at);
  recordAudit(state, actor, `waiting_list_offer_${status}`, offer.id, null, { waitingListId: offer.waitingListId }, at);
}

export function expireWaitingListOffers(state, actor, at = new Date()) {
  const expired = state.waitingListOffers.filter((item) => item.status === "offered" && new Date(item.expiresAt) <= new Date(at));
  for (const offer of expired) finishOffer(state, offer, "expired", actor, at);
  const next = expired.length && capacitySummary(state).remaining > 0 ? createNextWaitingListOffer(state, actor, at) : null;
  return { ok: true, expired: expired.length, nextOffer: next?.ok ? next : null };
}

export function declineWaitingListOffer(state, offerId, actor = { actorType: "runner" }, at = new Date()) {
  const offer = state.waitingListOffers.find((item) => item.id === offerId && item.status === "offered");
  if (!offer) return { ok: false, code: "OFFER_NOT_ACTIVE" };
  finishOffer(state, offer, "declined", actor, at);
  const next = capacitySummary(state).remaining > 0 ? createNextWaitingListOffer(state, organiser(actor) ? actor : systemActor, at) : null;
  return { ok: true, nextOffer: next?.ok ? next : null };
}

export function acceptWaitingListOffer(state, invitationToken, input, at = new Date()) {
  const checked = authorizePrivateInvitation(state, invitationToken, { kind: "waiting_list_offer", at });
  if (!checked.ok) return checked;
  const offer = state.waitingListOffers.find((item) => item.invitationId === checked.invitation.id && item.status === "offered");
  if (!offer || new Date(offer.expiresAt) <= new Date(at)) return { ok: false, code: "OFFER_NOT_ACTIVE" };
  const errors = validateProductionRunner(input.runner ?? {});
  if (Object.keys(errors).length) return { ok: false, code: "VALIDATION_ERROR", errors };
  const declarationCheck = validateDeclarationInput(state, input.declaration);
  if (!declarationCheck.ok) return declarationCheck;
  const under18Check = validateUnder18Declaration(state, input.runner, input.declaration);
  if (!under18Check.ok) return under18Check;
  const consumed = authorizePrivateInvitation(state, invitationToken, { kind: "waiting_list_offer", at, consume: true });
  if (!consumed.ok) return consumed;
  const runner = storeRunner(state, input.runner);
  // The active offer already reserves this place, so convert that reservation atomically.
  offer.status = "accepted"; offer.completedAt = iso(at);
  const waiting = state.waitingList.find((item) => item.id === offer.waitingListId); if (waiting) waiting.status = "accepted";
  const registration = { id: shortId("reg"), runnerId: runner.id, entryStatus: "active", placeStatus: "payment_reserved", raceNumber: null, createdAt: iso(at), updatedAt: iso(at), deletedAt: null };
  state.registrations.push(registration);
  const pricing = calculateEntryPrice(state.event, input.runner);
  runner.wfraDiscountApplied = pricing.wfraDiscountApplied;
  state.payments.push({ id: shortId("payment"), registrationId: registration.id, status: "not_configured", provider: null, externalCall: false, ...pricing, createdAt: iso(at) });
  recordAudit(state, { actorType: "runner" }, "waiting_list_offer_accepted", offer.id, null, { registrationId: registration.id }, at);
  recordAudit(state, { actorType: "runner" }, "registration_created", registration.id, null, { placeStatus: registration.placeStatus }, at);
  recordDeclaration(state, { ...input.declaration, registrationId: registration.id }, at);
  const managementToken = issueManagementToken(state, registration.id, { actorType: "system" }, at).token;
  return { ok: true, registration, managementToken, pricing };
}

export function recordDeclaration(state, input, at = new Date()) {
  const registration = state.registrations.find((item) => item.id === input.registrationId && activeRegistration(item));
  if (!registration) return { ok: false, code: "NOT_FOUND" };
  const declarationCheck = validateDeclarationInput(state, input);
  if (!declarationCheck.ok) return declarationCheck;
  const runner = state.runners.find((item) => item.id === registration.runnerId);
  if (!runner) return { ok: false, code: "NOT_FOUND" };
  const under18Check = validateUnder18Declaration(state, runner, input);
  if (!under18Check.ok) return under18Check;
  const declaration = { id: shortId("declaration"), registrationId: registration.id, runnerId: registration.runnerId, declarationIdentifier: input.declarationIdentifier, declarationVersion: input.declarationVersion, accepted: true, typedFullName: String(input.typedFullName).trim(), signatoryRole: input.signatoryRole, acceptedAt: iso(at) };
  state.declarations.push(declaration);
  recordAudit(state, { actorType: "runner" }, "declaration_accepted", registration.id, null, { declarationIdentifier: declaration.declarationIdentifier, declarationVersion: declaration.declarationVersion }, at);
  return { ok: true, declaration };
}

export function issueManagementToken(state, registrationId, actor = { actorType: "system" }, at = new Date()) {
  const registration = state.registrations.find((item) => item.id === registrationId && activeRegistration(item));
  if (!registration) return { ok: false, code: "NOT_FOUND" };
  for (const token of state.managementTokens.filter((item) => item.registrationId === registrationId && !item.invalidatedAt)) token.invalidatedAt = iso(at);
  const value = opaqueToken();
  const token = { id: shortId("management"), registrationId, tokenHash: hashToken(value), issuedAt: iso(at), invalidatedAt: null };
  state.managementTokens.push(token);
  recordAudit(state, actor, "management_token_issued", registrationId, null, { replacedPriorToken: state.managementTokens.some((item) => item.registrationId === registrationId && item.id !== token.id) }, at);
  return { ok: true, token: value };
}

export function amendRunner(state, managementToken, changes, { actor = { actorType: "runner" }, at = new Date(), organiserOverride = false } = {}) {
  const stored = state.managementTokens.find((item) => item.tokenHash === hashToken(managementToken) && !item.invalidatedAt);
  if (!stored && !organiserOverride) return { ok: false, code: "MANAGEMENT_TOKEN_INVALID" };
  if (organiserOverride && !organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  const registrationId = stored?.registrationId ?? changes.registrationId;
  const registration = state.registrations.find((item) => item.id === registrationId && activeRegistration(item));
  const runner = state.runners.find((item) => item.id === registration?.runnerId);
  if (!registration || !runner) return { ok: false, code: "NOT_FOUND" };
  const beforeCutoff = new Date(at) <= new Date(state.event.transferRefundCutoffUtc);
  const identityFields = ["firstName", "lastName"];
  if (!organiserOverride && !beforeCutoff && identityFields.some((field) => changes[field] !== undefined && changes[field] !== runner[field])) return { ok: false, code: "NAME_LOCKED_AFTER_CUTOFF" };
  const allowed = ["firstName", "lastName", "email", "phone", "addressLine1", "addressLine2", "city", "postcode", "dateOfBirth", "raceCategory", "club", "wfraMember", "wfraMembershipNumber", "emergencyContactName", "emergencyContactPhone"];
  const changedFields = allowed.filter((field) => changes[field] !== undefined && changes[field] !== runner[field]);
  for (const field of changedFields) runner[field] = typeof changes[field] === "string" ? changes[field].trim() : changes[field];
  const ownershipChanged = ["firstName", "lastName", "email"].some((field) => changedFields.includes(field));
  recordAudit(state, actor, organiserOverride ? "organiser_override" : ownershipChanged ? "entry_transferred" : "runner_details_amended", registration.id, null, { fields: changedFields }, at);
  if (ownershipChanged) return { ok: true, runner, replacementManagementToken: issueManagementToken(state, registration.id, actor, at).token };
  return { ok: true, runner, replacementManagementToken: null };
}

export function assignPhase3RaceNumber(state, registrationId, raceNumber, actor, at = new Date()) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  const registration = state.registrations.find((item) => item.id === registrationId && activeRegistration(item));
  const number = Number(raceNumber);
  if (!registration || !Number.isInteger(number) || number < 1 || number > 999) return { ok: false, code: "INVALID_RACE_NUMBER" };
  if (state.registrations.some((item) => item.id !== registrationId && activeRegistration(item) && item.raceNumber === number)) return { ok: false, code: "DUPLICATE_RACE_NUMBER" };
  const before = registration.raceNumber;
  registration.raceNumber = number;
  recordAudit(state, actor, before == null ? "race_number_assigned" : "race_number_changed", registrationId, { raceNumber: before }, { raceNumber: number }, at);
  return { ok: true, registration };
}

export function removePhase3RaceNumber(state, registrationId, actor, at = new Date()) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  const registration = state.registrations.find((item) => item.id === registrationId && activeRegistration(item));
  if (!registration || registration.raceNumber == null) return { ok: false, code: "NO_RACE_NUMBER" };
  const before = registration.raceNumber;
  registration.raceNumber = null;
  recordAudit(state, actor, "race_number_removed", registrationId, { raceNumber: before }, { raceNumber: null }, at);
  return { ok: true, releasedRaceNumber: before };
}

export function requestRefund(state, registrationId, actor = { actorType: "runner" }, at = new Date()) {
  if (new Date(at) > new Date(state.event.transferRefundCutoffUtc) && !organiser(actor)) return { ok: false, code: "REFUND_CUTOFF_PASSED" };
  const registration = state.registrations.find((item) => item.id === registrationId && activeRegistration(item));
  if (!registration) return { ok: false, code: "NOT_FOUND" };
  const request = { id: shortId("refund"), registrationId, status: "requested", requestedAt: iso(at), decidedAt: null, refundedAt: null, placeReleasedAt: null };
  state.refundRequests.push(request);
  recordAudit(state, actor, "refund_requested", registrationId, null, { refundRequestId: request.id }, at);
  return { ok: true, request };
}

export function decideRefund(state, refundRequestId, decision, actor, at = new Date()) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  if (!["approved", "rejected"].includes(decision)) return { ok: false, code: "INVALID_REFUND_DECISION" };
  const request = state.refundRequests.find((item) => item.id === refundRequestId && item.status === "requested");
  if (!request) return { ok: false, code: "NOT_FOUND" };
  request.status = decision; request.decidedAt = iso(at);
  recordAudit(state, actor, `refund_${decision}`, request.registrationId, { status: "requested" }, { status: decision }, at);
  return { ok: true, request };
}

export function markRefunded(state, refundRequestId, actor, at = new Date()) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  const request = state.refundRequests.find((item) => item.id === refundRequestId && item.status === "approved");
  if (!request) return { ok: false, code: "REFUND_NOT_APPROVED" };
  request.status = "refunded"; request.refundedAt = iso(at);
  recordAudit(state, actor, "refunded", request.registrationId, { status: "approved" }, { status: "refunded" }, at);
  return { ok: true, request };
}

export function releaseRefundedPlace(state, refundRequestId, actor, at = new Date()) {
  if (!organiser(actor)) return { ok: false, code: "FORBIDDEN" };
  const request = state.refundRequests.find((item) => item.id === refundRequestId && item.status === "refunded");
  const registration = state.registrations.find((item) => item.id === request?.registrationId && activeRegistration(item));
  if (!request || !registration) return { ok: false, code: "NOT_FOUND" };
  registration.entryStatus = "place_released"; registration.placeStatus = "none"; request.placeReleasedAt = iso(at);
  recordAudit(state, actor, "place_released", registration.id, null, { refundRequestId }, at);
  return { ok: true, registration };
}
