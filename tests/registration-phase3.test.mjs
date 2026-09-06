import test from "node:test";
import assert from "node:assert/strict";
import {
  PHASE3_EVENT, PHASE3_REGISTRATION_STATES, RACE_CATEGORIES,
  createPhase3State, transitionRegistrationState, environmentStateLabel,
  issuePrivateInvitation, inspectPrivateInvitation, revokePrivateInvitation, expirePrivateInvitation, canUsePublicRegistration,
  validateProductionRunner, capacitySummary, addPlaceRegistration,
  beginProductionRegistration, joinWaitingList, createNextWaitingListOffer, expireWaitingListOffers, declineWaitingListOffer, acceptWaitingListOffer,
  recordDeclaration, issueManagementToken, amendRunner,
  assignPhase3RaceNumber, removePhase3RaceNumber,
  requestRefund, decideRefund, markRefunded, releaseRefundedPlace
} from "../registration/server/phase3-domain.mjs";

const admin = { authenticated: true, role: "Organiser", actorType: "organiser", id: "organiser-test" };
const runner = (number = 1, overrides = {}) => ({
  id: `runner_${number}`, email: `runner-${number}@example.com`, firstName: `Runner ${number}`, lastName: "Example",
  phone: "07700 900123", addressLine1: "1 Example Street", addressLine2: "", city: "Abergavenny", postcode: "NP7 5AA",
  raceCategory: "Female", dateOfBirth: "1990-06-15", club: "Example Harriers", affiliated: false, membershipNumber: "",
  emergencyContactName: "Contact Example", emergencyContactPhone: "07700 900456", ...overrides
});
const beforeCutoff = new Date("2026-10-01T12:00:00.000Z");
const afterCutoff = new Date("2026-10-29T00:00:00.000Z");

function stateWithRegistration(options = {}) {
  const state = createPhase3State({ registrationState: "OPEN", declarationVersion: "wfra-approved-v1", ...options });
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

test("private and open registration reserve a place only after state, capacity, runner and declaration checks", () => {
  const state = createPhase3State({ registrationState: "PRIVATE_LIVE", declarationVersion: "wfra-approved-v1" });
  const invite = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-02T12:00:00Z" }, admin, beforeCutoff);
  const input = { runner: runner(), declaration: { declarationIdentifier: "wfra-competitor-declaration", declarationVersion: "wfra-approved-v1", accepted: true, typedFullName: "Runner 1 Example" } };
  const created = beginProductionRegistration(state, input, { invitationToken: invite.token, at: beforeCutoff });
  assert.equal(created.ok, true); assert.equal(created.registration.placeStatus, "payment_reserved"); assert.ok(created.managementToken.length >= 40);
  assert.equal(state.payments[0].status, "not_configured"); assert.equal(state.payments[0].externalCall, false);
  assert.equal(beginProductionRegistration(state, { ...input, runner: runner(2) }, { invitationToken: invite.token, at: beforeCutoff }).code, "INVITATION_USED");
  const closed = createPhase3State({ environment: "production", declarationVersion: "wfra-approved-v1" });
  assert.equal(beginProductionRegistration(closed, input, { at: beforeCutoff }).code, "REGISTRATION_NOT_ACCEPTING");
});

test("runner validation accepts exactly the approved competition categories and conditional affiliation", () => {
  assert.deepEqual(RACE_CATEGORIES, ["Female", "Male / Open"]);
  for (const raceCategory of RACE_CATEGORIES) assert.deepEqual(validateProductionRunner(runner(1, { raceCategory })), {});
  assert.equal(validateProductionRunner(runner(1, { raceCategory: "Non-binary" })).raceCategory, "Select Female or Male / Open.");
  assert.ok(validateProductionRunner(runner(1, { affiliated: true })).membershipNumber);
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
  const state = createPhase3State({ registrationState: "OPEN", declarationVersion: "wfra-approved-v1" });
  const waiting = joinWaitingList(state, runner(), { at: beforeCutoff }).waitingListEntry;
  const offer = createNextWaitingListOffer(state, admin, beforeCutoff);
  assert.equal(capacitySummary(state).offerReserved, 1);
  const accepted = acceptWaitingListOffer(state, offer.token, { runner: runner(), declaration: { declarationIdentifier: "wfra-competitor-declaration", declarationVersion: "wfra-approved-v1", accepted: true, typedFullName: "Runner 1 Example" } }, beforeCutoff);
  assert.equal(accepted.ok, true); assert.equal(state.waitingList.find((item) => item.id === waiting.id).status, "accepted");
  assert.deepEqual({ offerReserved: capacitySummary(state).offerReserved, paymentReserved: capacitySummary(state).paymentReserved, reserved: capacitySummary(state).reserved }, { offerReserved: 0, paymentReserved: 1, reserved: 1 });
  assert.equal(acceptWaitingListOffer(state, offer.token, { runner: runner(2), declaration: {} }, beforeCutoff).code, "INVITATION_USED");
});

test("declaration records exact identifier/version and fails closed without approved wording", () => {
  const unavailable = stateWithRegistration({ declarationVersion: null });
  assert.equal(recordDeclaration(unavailable.state, { registrationId: unavailable.registration.id, declarationIdentifier: "wfra-competitor-declaration", declarationVersion: null, accepted: true, typedFullName: "Runner Example" }).code, "DECLARATION_VERSION_UNAVAILABLE");
  const { state, registration } = stateWithRegistration();
  const accepted = recordDeclaration(state, { registrationId: registration.id, declarationIdentifier: "wfra-competitor-declaration", declarationVersion: "wfra-approved-v1", accepted: true, typedFullName: "Runner Example" }, beforeCutoff);
  assert.equal(accepted.declaration.acceptedAt, beforeCutoff.toISOString()); assert.equal(accepted.declaration.declarationVersion, "wfra-approved-v1");
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
