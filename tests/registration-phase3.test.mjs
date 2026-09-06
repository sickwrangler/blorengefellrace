import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PHASE3_EVENT, PHASE3_REGISTRATION_STATES, RACE_CATEGORIES,
  createPhase3State, transitionRegistrationState, environmentStateLabel,
  issuePrivateInvitation, inspectPrivateInvitation, authorizePrivateInvitation, revokePrivateInvitation, expirePrivateInvitation, canUsePublicRegistration,
  validateProductionRunner, calculateEntryPrice, capacitySummary, addPlaceRegistration,
  beginProductionRegistration, joinWaitingList, createNextWaitingListOffer, expireWaitingListOffers, declineWaitingListOffer, acceptWaitingListOffer,
  recordDeclaration, issueManagementToken, amendRunner,
  assignPhase3RaceNumber, removePhase3RaceNumber,
  requestRefund, decideRefund, markRefunded, releaseRefundedPlace
} from "../registration/server/phase3-domain.mjs";
import { WFRA_SENIOR_ENTRY_DECLARATION } from "../registration/declarations.mjs";

const admin = { authenticated: true, role: "Organiser", actorType: "organiser", id: "organiser-test" };
const runner = (number = 1, overrides = {}) => ({
  id: `runner_${number}`, email: `runner-${number}@example.com`, firstName: `Runner ${number}`, lastName: "Example",
  phone: "07700 900123", addressLine1: "1 Example Street", addressLine2: "", city: "Abergavenny", postcode: "NP7 5AA",
  raceCategory: "Female", dateOfBirth: "1990-06-15", club: "Example Harriers", affiliated: false, membershipNumber: "", wfraMember: false, wfraMembershipNumber: "",
  emergencyContactName: "Contact Example", emergencyContactPhone: "07700 900456", ...overrides
});
const beforeCutoff = new Date("2026-10-01T12:00:00.000Z");
const afterCutoff = new Date("2026-10-29T00:00:00.000Z");

const declaration = (overrides = {}) => ({ declarationIdentifier: "WFRA_SENIOR_ENTRY", declarationVersion: "21/02/23", accepted: true, typedFullName: "Runner 1 Example", signatoryRole: "Competitor", ...overrides });

function stateWithRegistration(options = {}) {
  const state = createPhase3State({ registrationState: "OPEN", ...options });
  const person = runner(); state.runners.push(person);
  const created = addPlaceRegistration(state, { runnerId: person.id, placeStatus: "confirmed" }, { actorType: "runner" }, beforeCutoff);
  return { state, person, registration: created.registration };
}

test("production initialization always fails closed and exposes the five operational states", () => {
  assert.deepEqual(PHASE3_REGISTRATION_STATES, ["CLOSED", "PRIVATE_LIVE", "OPEN", "PAUSED", "CLOSED_FINAL"]);
  for (const requested of [...PHASE3_REGISTRATION_STATES, "invalid"]) assert.equal(createPhase3State({ environment: "production", registrationState: requested }).registrationState, "CLOSED");
  assert.equal(PHASE3_EVENT.capacity, 120); assert.equal(PHASE3_EVENT.entryFeePence, 600); assert.equal(PHASE3_EVENT.timezone, "Europe/London");
});

test("registration state transitions require an organiser, reject stale/forbidden changes and audit success", () => {
  const state = createPhase3State();
  assert.equal(transitionRegistrationState(state, "OPEN", { authenticated: false }).code, "FORBIDDEN");
  assert.equal(transitionRegistrationState(state, "PRIVATE_LIVE", admin, { expectedState: "OPEN" }).code, "STATE_CONFLICT");
  assert.equal(transitionRegistrationState(state, "PRIVATE_LIVE", admin).ok, true);
  assert.equal(transitionRegistrationState(state, "PAUSED", admin).ok, true);
  assert.equal(transitionRegistrationState(state, "OPEN", admin).ok, true);
  assert.equal(transitionRegistrationState(state, "CLOSED", admin).code, "FORBIDDEN_TRANSITION");
  assert.equal(transitionRegistrationState(state, "CLOSED_FINAL", admin).ok, true);
  assert.equal(transitionRegistrationState(state, "OPEN", admin).code, "FORBIDDEN_TRANSITION");
  assert.equal(state.auditEvents.filter((item) => item.action === "registration_state_changed").length, 4);
});

test("environment indicators stay subtle and may disappear for ordinary open production", () => {
  assert.equal(environmentStateLabel("development", "CLOSED"), "Development · Closed");
  assert.equal(environmentStateLabel("production", "PRIVATE_LIVE"), "Production · Private");
  assert.equal(environmentStateLabel("production", "OPEN", { runner: true }), "");
});

test("private invitations are opaque, purpose-bound, hashed, expiring, revocable and single-use", () => {
  const state = createPhase3State({ registrationState: "PRIVATE_LIVE" });
  const created = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
  assert.equal(created.ok, true); assert.ok(created.token.length >= 40);
  assert.equal(JSON.stringify(state).includes(created.token), false); assert.equal(state.privateInvitations[0].tokenHash.length, 64);
  assert.equal(inspectPrivateInvitation(state, created.token, { kind: "waiting_list_join", at: beforeCutoff }).code, "INVITATION_WRONG_PURPOSE");
  assert.equal(canUsePublicRegistration(state, { invitationToken: created.token, at: beforeCutoff }).ok, true);
  assert.equal(inspectPrivateInvitation(state, created.token, { kind: "registration", at: beforeCutoff, consume: true }).ok, true);
  assert.equal(inspectPrivateInvitation(state, created.token, { kind: "registration", at: beforeCutoff }).code, "INVITATION_USED");
  const revoked = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
  revokePrivateInvitation(state, revoked.invitation.id, admin, beforeCutoff);
  assert.equal(inspectPrivateInvitation(state, revoked.token, { at: beforeCutoff }).code, "INVITATION_REVOKED");
  const expired = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-01T13:00:00Z" }, admin, beforeCutoff);
  assert.equal(inspectPrivateInvitation(state, expired.token, { at: "2026-10-01T14:00:00Z" }).code, "INVITATION_EXPIRED");
  const manuallyExpired = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
  assert.equal(expirePrivateInvitation(state, manuallyExpired.invitation.id, admin, beforeCutoff).ok, true);
  assert.equal(inspectPrivateInvitation(state, manuallyExpired.token, { at: beforeCutoff }).code, "INVITATION_EXPIRED");
});

test("a private URL never bypasses CLOSED, PAUSED or CLOSED_FINAL state", () => {
  for (const registrationState of ["CLOSED", "PAUSED", "CLOSED_FINAL"]) {
    const state = createPhase3State({ registrationState });
    const invite = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
    assert.equal(canUsePublicRegistration(state, { invitationToken: invite.token, at: beforeCutoff }).code, "REGISTRATION_NOT_ACCEPTING");
  }
});

test("every private-link purpose is revalidated for revocation, manual/natural expiry, purpose and usage", () => {
  for (const kind of ["registration", "waiting_list_join"]) {
    const revokedState = createPhase3State({ registrationState: "PRIVATE_LIVE" });
    const revoked = issuePrivateInvitation(revokedState, { kind, expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
    assert.equal(authorizePrivateInvitation(revokedState, revoked.token, { kind, at: beforeCutoff }).ok, true);
    revokePrivateInvitation(revokedState, revoked.invitation.id, admin, beforeCutoff);
    assert.equal(authorizePrivateInvitation(revokedState, revoked.token, { kind, at: beforeCutoff }).code, "INVITATION_REVOKED");

    const manualState = createPhase3State({ registrationState: "PRIVATE_LIVE" });
    const manual = issuePrivateInvitation(manualState, { kind, expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
    expirePrivateInvitation(manualState, manual.invitation.id, admin, beforeCutoff);
    assert.equal(authorizePrivateInvitation(manualState, manual.token, { kind, at: beforeCutoff }).code, "INVITATION_EXPIRED");

    const naturalState = createPhase3State({ registrationState: "PRIVATE_LIVE" });
    const natural = issuePrivateInvitation(naturalState, { kind, expiresAt: "2026-10-01T13:00:00Z" }, admin, beforeCutoff);
    assert.equal(authorizePrivateInvitation(naturalState, natural.token, { kind, at: "2026-10-01T13:00:01Z" }).code, "INVITATION_EXPIRED");
  }

  const state = createPhase3State({ registrationState: "PRIVATE_LIVE" });
  const invitation = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
  assert.equal(authorizePrivateInvitation(state, "unknown", { kind: "registration", at: beforeCutoff }).code, "INVITATION_NOT_FOUND");
  assert.equal(authorizePrivateInvitation(state, `${invitation.token}tampered`, { kind: "registration", at: beforeCutoff }).code, "INVITATION_NOT_FOUND");
  assert.equal(authorizePrivateInvitation(state, invitation.token, { kind: "waiting_list_join", at: beforeCutoff }).code, "INVITATION_WRONG_PURPOSE");
  assert.equal(authorizePrivateInvitation(state, invitation.token, { kind: "registration", at: beforeCutoff, consume: true }).ok, true);
  assert.equal(authorizePrivateInvitation(state, invitation.token, { kind: "registration", at: beforeCutoff }).code, "INVITATION_USED");
});

test("private waiting-list join is single-use and rechecks the invitation during the operation", () => {
  const state = createPhase3State({ registrationState: "PRIVATE_LIVE" });
  const invite = issuePrivateInvitation(state, { kind: "waiting_list_join", expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
  assert.equal(joinWaitingList(state, runner(), { invitationToken: invite.token, at: beforeCutoff }).ok, true);
  assert.equal(joinWaitingList(state, runner(2), { invitationToken: invite.token, at: beforeCutoff }).code, "INVITATION_USED");
});

test("revoked or expired waiting-list offers cannot create a registration or claim their reserved place", () => {
  for (const mode of ["revoke", "manual-expiry", "natural-expiry"]) {
    const state = createPhase3State({ registrationState: "OPEN" });
    joinWaitingList(state, runner(), { at: beforeCutoff });
    const offered = createNextWaitingListOffer(state, admin, beforeCutoff);
    assert.equal(authorizePrivateInvitation(state, offered.token, { kind: "waiting_list_offer", at: beforeCutoff }).ok, true);
    if (mode === "revoke") revokePrivateInvitation(state, state.privateInvitations[0].id, admin, beforeCutoff);
    if (mode === "manual-expiry") expirePrivateInvitation(state, state.privateInvitations[0].id, admin, beforeCutoff);
    const attemptedAt = mode === "natural-expiry" ? new Date(offered.offer.expiresAt).getTime() + 1 : beforeCutoff;
    const result = acceptWaitingListOffer(state, offered.token, { runner: runner(), declaration: declaration() }, attemptedAt);
    assert.equal(result.ok, false); assert.equal(state.registrations.length, 0); assert.equal(state.payments.length, 0);
    if (mode !== "natural-expiry") assert.equal(capacitySummary(state).offerReserved, 0);
  }
});

test("private and open registration reserve a place only after state, capacity, runner and declaration checks", () => {
  const state = createPhase3State({ registrationState: "PRIVATE_LIVE" });
  const invite = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
  const input = { runner: runner(), declaration: declaration() };
  const created = beginProductionRegistration(state, input, { invitationToken: invite.token, at: beforeCutoff });
  assert.equal(created.ok, true); assert.equal(created.registration.placeStatus, "payment_reserved"); assert.ok(created.managementToken.length >= 40);
  assert.equal(state.payments[0].status, "not_configured"); assert.equal(state.payments[0].externalCall, false);
  assert.equal(beginProductionRegistration(state, { ...input, runner: runner(2) }, { invitationToken: invite.token, at: beforeCutoff }).code, "INVITATION_USED");
  const closed = createPhase3State({ environment: "production" });
  assert.equal(beginProductionRegistration(closed, input, { at: beforeCutoff }).code, "REGISTRATION_NOT_ACCEPTING");
});

test("runner validation accepts exactly the approved competition categories and conditional affiliation", () => {
  assert.deepEqual(RACE_CATEGORIES, ["Female", "Male / Open"]);
  for (const raceCategory of RACE_CATEGORIES) assert.deepEqual(validateProductionRunner(runner(1, { raceCategory })), {});
  assert.equal(validateProductionRunner(runner(1, { raceCategory: "Non-binary" })).raceCategory, "Select Female or Male / Open.");
  assert.ok(validateProductionRunner(runner(1, { affiliated: true })).membershipNumber);
});

test("UK Athletics and WFRA membership are separate and WFRA numbers remain format-neutral", () => {
  assert.deepEqual(validateProductionRunner(runner(1, { affiliated: true, membershipNumber: "UKA-123", wfraMember: true, wfraMembershipNumber: "South Wales ABC / 42" })), {});
  assert.ok(validateProductionRunner(runner(1, { wfraMember: true, wfraMembershipNumber: "" })).wfraMembershipNumber);
  assert.deepEqual(validateProductionRunner(runner(1, { wfraMember: true, wfraMembershipNumber: "AB 12-XY/9" })), {});
  assert.ok(validateProductionRunner(runner(1, { wfraMember: true, wfraMembershipNumber: "x".repeat(81) })).wfraMembershipNumber);
});

test("server calculates standard and configured WFRA prices and ignores browser amount fields", () => {
  const unconfigured = createPhase3State({ registrationState: "OPEN" });
  const standard = calculateEntryPrice(unconfigured.event, { wfraMember: false, priceActuallyChargedPence: 1, amount: 1 });
  assert.equal(standard.priceActuallyChargedPence, 600);
  const pending = calculateEntryPrice(unconfigured.event, { wfraMember: true, wfraMembershipNumber: "WFRA A-12", amount: 1 });
  assert.equal(pending.priceActuallyChargedPence, 600); assert.equal(pending.adjustmentReason, "WFRA_MEMBER_PRICE_NOT_CONFIGURED"); assert.equal(pending.wfraDiscountApplied, false);
  const configured = createPhase3State({ registrationState: "OPEN", wfraMemberPricePence: 500 });
  const member = calculateEntryPrice(configured.event, { wfraMember: true, wfraMembershipNumber: "WFRA A-12", priceActuallyChargedPence: 1 });
  assert.equal(member.priceActuallyChargedPence, 500); assert.equal(member.wfraDiscountApplied, true);
  const created = beginProductionRegistration(configured, { runner: runner(9, { wfraMember: true, wfraMembershipNumber: "WFRA A-12", amount: 1 }), declaration: declaration({ typedFullName: "Runner 9 Example" }) }, { at: beforeCutoff });
  assert.equal(created.pricing.priceActuallyChargedPence, 500); assert.equal(configured.payments[0].priceActuallyChargedPence, 500);
});

test("official declaration content and version load from one source", () => {
  assert.equal(WFRA_SENIOR_ENTRY_DECLARATION.identifier, "WFRA_SENIOR_ENTRY");
  assert.equal(WFRA_SENIOR_ENTRY_DECLARATION.version, "21/02/23");
  assert.equal(WFRA_SENIOR_ENTRY_DECLARATION.paragraphs[0], "I accept the hazards inherent in fell running and acknowledge that I am entering and running at my own risk.");
  assert.equal(WFRA_SENIOR_ENTRY_DECLARATION.paragraphs.at(-1), "(v.21/02/23)");
  assert.equal(PHASE3_EVENT.declaration.identifier, WFRA_SENIOR_ENTRY_DECLARATION.identifier);
});

test("under-18 entries cannot falsely complete pending the parental-consent decision", () => {
  for (const signatoryRole of ["Competitor", "Parent / Legal Guardian"]) {
    const state = createPhase3State({ registrationState: "OPEN" });
    const result = beginProductionRegistration(state, { runner: runner(16, { dateOfBirth: "2009-12-01" }), declaration: declaration({ signatoryRole }) }, { at: beforeCutoff });
    assert.equal(result.code, "PARENTAL_CONSENT_REQUIREMENTS_PENDING"); assert.equal(state.registrations.length, 0);
  }
  const state = createPhase3State({ registrationState: "OPEN" });
  assert.equal(beginProductionRegistration(state, { runner: runner(), declaration: declaration({ accepted: false }) }, { at: beforeCutoff }).code, "DECLARATION_NOT_ACCEPTED");
});

test("all runner data-field labels use reviewed English and South Wales Welsh copy", () => {
  const html = fs.readFileSync("registration/index.html", "utf8");
  for (const label of [
    "Email address / Cyfeiriad e-bost", "First name / Enw cyntaf", "Last name / Cyfenw", "Phone number / Rhif ffôn",
    "Address line 1 / Llinell cyfeiriad 1", "Address line 2 / Llinell cyfeiriad 2", "City / Dinas", "Postcode / Cod post",
    "Race category / Categori ras", "Date of birth / Dyddiad geni", "Club / Clwb",
    "Affiliated with UK Athletics? / Ydych chi'n gysylltiedig ag UK Athletics?", "UK Athletics membership number / Rhif aelodaeth UK Athletics",
    "WFRA member? / Ydych chi'n aelod o WFRA?", "WFRA membership number / Rhif aelodaeth WFRA",
    "Emergency contact name / Enw cyswllt mewn argyfwng", "Emergency contact phone number / Rhif ffôn cyswllt mewn argyfwng",
    "Enter your full name to sign the declaration / Rhowch eich enw llawn i lofnodi'r datganiad"
  ]) assert.ok(html.includes(label), `missing bilingual label: ${label}`);
  assert.ok(html.includes("Female / Benyw")); assert.ok(html.includes("Male / Open — Gwryw / Agored"));
  assert.equal(html.includes("Dyddiad Genu"), false); assert.equal(html.includes("Cyfeiriad (1)"), false);
});

test("capacity counts confirmed, payment reservations and live offers and never exceeds 120", () => {
  const state = createPhase3State({ registrationState: "OPEN" });
  for (let number = 1; number <= 120; number += 1) assert.equal(addPlaceRegistration(state, { runnerId: `runner_${number}`, placeStatus: number % 2 ? "confirmed" : "payment_reserved" }).ok, true);
  assert.deepEqual(capacitySummary(state), { capacity: 120, confirmed: 60, paymentReserved: 60, offerReserved: 0, reserved: 120, remaining: 0, waiting: 0 });
  assert.equal(addPlaceRegistration(state, { runnerId: "runner_121" }).code, "CAPACITY_FULL");
});

test("waiting list stores minimum data and advances in order after offer expiry", () => {
  const state = createPhase3State({ registrationState: "OPEN" });
  const first = joinWaitingList(state, { firstName: "Alys", lastName: "Example", email: "alys@example.com", phone: "must-not-store" }, { at: beforeCutoff });
  const second = joinWaitingList(state, { firstName: "Bryn", lastName: "Example", email: "bryn@example.com" }, { at: beforeCutoff });
  assert.equal(first.waitingListEntry.phone, undefined);
  const offered = createNextWaitingListOffer(state, admin, beforeCutoff);
  assert.equal(offered.offer.waitingListId, first.waitingListEntry.id);
  assert.equal(offered.offer.reminderAt, "2026-10-02T12:00:00.000Z");
  assert.equal(offered.offer.expiresAt, "2026-10-03T12:00:00.000Z");
  const advanced = expireWaitingListOffers(state, admin, "2026-10-03T12:00:01.000Z");
  assert.equal(advanced.expired, 1); assert.equal(advanced.nextOffer.offer.waitingListId, second.waitingListEntry.id);
});

test("declining an offer automatically progresses to the next eligible person", () => {
  const state = createPhase3State({ registrationState: "OPEN" });
  const first = joinWaitingList(state, runner(1), { at: beforeCutoff }).waitingListEntry;
  const second = joinWaitingList(state, runner(2), { at: beforeCutoff }).waitingListEntry;
  const offered = createNextWaitingListOffer(state, admin, beforeCutoff);
  const declined = declineWaitingListOffer(state, offered.offer.id, { actorType: "runner" }, beforeCutoff);
  assert.equal(state.waitingList.find((item) => item.id === first.id).status, "declined");
  assert.equal(declined.nextOffer.offer.waitingListId, second.id);
});

test("a waiting-list offer collects full details only on acceptance and converts its reserved place", () => {
  const state = createPhase3State({ registrationState: "OPEN" });
  const waiting = joinWaitingList(state, runner(), { at: beforeCutoff }).waitingListEntry;
  const offer = createNextWaitingListOffer(state, admin, beforeCutoff);
  assert.equal(capacitySummary(state).offerReserved, 1);
  const accepted = acceptWaitingListOffer(state, offer.token, { runner: runner(), declaration: declaration() }, beforeCutoff);
  assert.equal(accepted.ok, true); assert.equal(state.waitingList.find((item) => item.id === waiting.id).status, "accepted");
  assert.deepEqual({ offerReserved: capacitySummary(state).offerReserved, paymentReserved: capacitySummary(state).paymentReserved, reserved: capacitySummary(state).reserved }, { offerReserved: 0, paymentReserved: 1, reserved: 1 });
  assert.equal(acceptWaitingListOffer(state, offer.token, { runner: runner(2), declaration: {} }, beforeCutoff).code, "INVITATION_USED");
});

test("declaration records exact identifier/version and fails closed without approved wording", () => {
  const unavailable = stateWithRegistration({ declarationVersion: null });
  assert.equal(recordDeclaration(unavailable.state, { registrationId: unavailable.registration.id, ...declaration({ declarationVersion: null, typedFullName: "Runner Example" }) }).code, "DECLARATION_VERSION_UNAVAILABLE");
  const { state, registration } = stateWithRegistration();
  const accepted = recordDeclaration(state, { registrationId: registration.id, ...declaration({ typedFullName: "Runner Example" }) }, beforeCutoff);
  assert.equal(accepted.declaration.acceptedAt, beforeCutoff.toISOString()); assert.equal(accepted.declaration.declarationVersion, "21/02/23");
});

test("transfer before cutoff rotates the management token and names lock after cutoff", () => {
  const { state, registration } = stateWithRegistration();
  const firstToken = issueManagementToken(state, registration.id, admin, beforeCutoff).token;
  const transferred = amendRunner(state, firstToken, { firstName: "New", lastName: "Runner", email: "new.runner@example.com" }, { at: beforeCutoff });
  assert.ok(transferred.replacementManagementToken); assert.notEqual(transferred.replacementManagementToken, firstToken);
  assert.equal(amendRunner(state, firstToken, { phone: "07700 900999" }, { at: beforeCutoff }).code, "MANAGEMENT_TOKEN_INVALID");
  assert.equal(amendRunner(state, transferred.replacementManagementToken, { firstName: "Locked" }, { at: afterCutoff }).code, "NAME_LOCKED_AFTER_CUTOFF");
  assert.equal(amendRunner(state, transferred.replacementManagementToken, { phone: "07700 900999" }, { at: afterCutoff }).ok, true);
  assert.equal(amendRunner(state, "", { registrationId: registration.id, firstName: "Exceptional" }, { actor: admin, at: afterCutoff, organiserOverride: true }).ok, true);
  assert.ok(state.auditEvents.some((item) => item.action === "organiser_override"));
});

test("race numbers remain optional, unique while active, removable and reusable", () => {
  const setup = stateWithRegistration();
  setup.state.runners.push(runner(2));
  const second = addPlaceRegistration(setup.state, { runnerId: "runner_2", placeStatus: "confirmed" }, admin, beforeCutoff).registration;
  assert.equal(setup.registration.raceNumber, null);
  assert.equal(assignPhase3RaceNumber(setup.state, setup.registration.id, 42, admin, beforeCutoff).ok, true);
  assert.equal(assignPhase3RaceNumber(setup.state, second.id, 42, admin, beforeCutoff).code, "DUPLICATE_RACE_NUMBER");
  assert.equal(removePhase3RaceNumber(setup.state, setup.registration.id, admin, beforeCutoff).releasedRaceNumber, 42);
  assert.equal(assignPhase3RaceNumber(setup.state, second.id, 42, admin, beforeCutoff).ok, true);
});

test("refund workflow is organiser-approved, cutoff-aware and releases the place separately", () => {
  const { state, registration } = stateWithRegistration();
  assert.equal(requestRefund(state, registration.id, { actorType: "runner" }, afterCutoff).code, "REFUND_CUTOFF_PASSED");
  const requested = requestRefund(state, registration.id, { actorType: "runner" }, beforeCutoff).request;
  assert.equal(decideRefund(state, requested.id, "approved", { authenticated: false }).code, "FORBIDDEN");
  assert.equal(decideRefund(state, requested.id, "approved", admin, beforeCutoff).ok, true);
  assert.equal(markRefunded(state, requested.id, admin, beforeCutoff).ok, true);
  assert.equal(capacitySummary(state).confirmed, 1);
  assert.equal(releaseRefundedPlace(state, requested.id, admin, beforeCutoff).ok, true);
  assert.equal(capacitySummary(state).remaining, 120);
  assert.equal(requestRefund(state, registration.id, admin, afterCutoff).code, "NOT_FOUND");
});

test("audit records remain privacy-minimal and never contain tokens or runner field values", () => {
  const { state, registration } = stateWithRegistration();
  const token = issueManagementToken(state, registration.id, admin, beforeCutoff).token;
  amendRunner(state, token, { phone: "07700 900999" }, { at: beforeCutoff });
  const invitation = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
  const serialized = JSON.stringify(state.auditEvents);
  assert.equal(serialized.includes(token), false); assert.equal(serialized.includes(invitation.token), false); assert.equal(serialized.includes("07700 900999"), false); assert.equal(serialized.includes("runner-1@example.com"), false);
});
