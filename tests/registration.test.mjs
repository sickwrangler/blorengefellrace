import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ageOnDate, initialState, safeRegistrationState, submitRegistration, applyMockPayment, cancelRegistration, updateTestSettings, sanitizedCsv } from "../registration/registration-core.mjs";

const runner = (number = 1, overrides = {}) => ({
  firstName: `Runner${number}`, lastName: "Example", email: `runner${number}@example.com`, phone: "07700 900123",
  dateOfBirth: "1990-06-15", genderCategory: "Female", club: number % 2 ? "Example Harriers" : "",
  affiliated: false, membershipNumber: "", emergencyName: "Contact Example", emergencyPhone: "07700 900456",
  travelMethod: "Shared car", acceptTerms: true, acceptPrivacy: true, ...overrides
});

test("production and invalid configurations fail closed", () => {
  assert.equal(safeRegistrationState(undefined, "production"), "closed");
  assert.equal(safeRegistrationState("invalid", "production"), "closed");
  assert.equal(safeRegistrationState("open", "production"), "closed");
  assert.equal(initialState({ environment: "production", state: "open" }).registrationState, "closed");
});

test("closed, paused and full states reject without storing", () => {
  for (const registrationState of ["closed", "paused", "full"]) {
    const state = initialState({ environment: "local", state: registrationState });
    assert.equal(submitRegistration(state, runner()).ok, false);
    assert.equal(state.registrations.length, 0);
    assert.equal(state.communications.length, 0);
  }
});

test("test entries stay in the test environment and communications are captured only", () => {
  const state = initialState({ environment: "preview" });
  const result = submitRegistration(state, runner());
  assert.equal(result.ok, true);
  assert.equal(result.registration.environment, "preview");
  assert.ok(state.communications.every((message) => message.delivery === "captured_only"));
  assert.equal(applyMockPayment(state, result.registration.id, "successful").ok, true);
  assert.equal(result.registration.paymentStatus, "successful");
  assert.ok(state.communications.every((message) => message.delivery === "captured_only"));
});

test("open behaviour exists behind the server state model but cannot be selected in production", () => {
  const local = initialState({ environment: "local", state: "open" });
  assert.equal(submitRegistration(local, runner(1, { email: "future.runner@real.test" })).ok, true);
  const production = initialState({ environment: "production", state: "open" });
  assert.equal(submitRegistration(production, runner(2)).ok, false);
});

test("minimum age is calculated on race day", () => {
  assert.equal(ageOnDate("2010-11-28"), 16);
  assert.equal(ageOnDate("2010-11-29"), 15);
  const state = initialState();
  assert.equal(submitRegistration(state, runner(1, { dateOfBirth: "2010-11-28" })).ok, true);
  assert.equal(submitRegistration(state, runner(2, { dateOfBirth: "2010-11-29" })).code, "VALIDATION_ERROR");
});

test("required fields, email and phone formats are validated", () => {
  const state = initialState();
  const result = submitRegistration(state, runner(1, { firstName: "", email: "not-an-email", phone: "123" }));
  assert.equal(result.code, "VALIDATION_ERROR");
  assert.deepEqual(Object.keys(result.errors).sort(), ["email", "firstName", "phone"]);
});

test("duplicate active email addresses are rejected", () => {
  const state = initialState();
  assert.equal(submitRegistration(state, runner()).ok, true);
  assert.equal(submitRegistration(state, runner(2, { email: "RUNNER1@EXAMPLE.COM" })).code, "DUPLICATE");
});

test("capacity accepts entries 109 and 110 then wait-lists entry 111", () => {
  const state = initialState({ capacity: 110 });
  for (let number = 1; number <= 108; number += 1) assert.equal(submitRegistration(state, runner(number)).registration.entryStatus, "accepted");
  assert.equal(submitRegistration(state, runner(109)).registration.entryStatus, "accepted");
  assert.equal(submitRegistration(state, runner(110)).registration.entryStatus, "accepted");
  const final = submitRegistration(state, runner(111)).registration;
  assert.equal(final.entryStatus, "waiting_list");
  assert.equal(final.waitingListPosition, 1);
});

test("simultaneous final-place attempts cannot both take the final place", async () => {
  const state = initialState({ capacity: 2 });
  submitRegistration(state, runner(1));
  const [first, second] = await Promise.all([
    Promise.resolve().then(() => submitRegistration(state, runner(2))),
    Promise.resolve().then(() => submitRegistration(state, runner(3)))
  ]);
  assert.deepEqual([first.registration.entryStatus, second.registration.entryStatus].sort(), ["accepted", "waiting_list"]);
});

test("waiting-list order is stable and cancellation promotes the first runner", () => {
  const state = initialState({ capacity: 1 });
  const accepted = submitRegistration(state, runner(1)).registration;
  const waitingOne = submitRegistration(state, runner(2)).registration;
  const waitingTwo = submitRegistration(state, runner(3)).registration;
  assert.equal(waitingOne.waitingListPosition, 1); assert.equal(waitingTwo.waitingListPosition, 2);
  const result = cancelRegistration(state, accepted.id);
  assert.equal(result.promoted.id, waitingOne.id);
  assert.equal(waitingTwo.waitingListPosition, 1);
});

test("mock payment transitions include decline, abandonment, success and refund", () => {
  const state = initialState(); const entry = submitRegistration(state, runner()).registration;
  assert.equal(applyMockPayment(state, entry.id, "declined").ok, true);
  assert.equal(applyMockPayment(state, entry.id, "abandoned").ok, true);
  assert.equal(applyMockPayment(state, entry.id, "successful").ok, true);
  assert.equal(applyMockPayment(state, entry.id, "refunded").ok, true);
});

test("sanitized CSV excludes private contact, birth, consent and emergency fields", () => {
  const state = initialState(); submitRegistration(state, runner());
  const csv = sanitizedCsv(state);
  for (const forbidden of ["email", "phone", "date_of_birth", "emergency", "membership", "consent", "07700", "@example.com"]) assert.equal(csv.toLowerCase().includes(forbidden), false);
  assert.match(csv, /Runner1/);
});

test("test settings cannot select open and reset yields an empty isolated state", () => {
  const state = initialState(); submitRegistration(state, runner());
  assert.equal(updateTestSettings(state, { registrationState: "open" }).ok, false);
  const reset = initialState({ environment: state.environment });
  assert.equal(reset.registrations.length, 0); assert.equal(reset.communications.length, 0);
});

test("fixture file contains the required synthetic scenarios", () => {
  const fixtures = JSON.parse(fs.readFileSync(new URL("../registration/fixtures.json", import.meta.url), "utf8"));
  const ids = fixtures.map((fixture) => fixture.id);
  for (const id of ["accepted-with-club", "unattached", "underage-rejected", "duplicate-rejected", "refunded", "cancelled-entry", "waiting-list", "capacity-reached"]) assert.ok(ids.includes(id));
  assert.ok(fixtures.every((fixture) => !fixture.runner?.email || /@(example\.(com|org|net)|[^@]+\.invalid)$/i.test(fixture.runner.email)));
});
