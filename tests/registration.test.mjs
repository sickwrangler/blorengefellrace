import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ageOnDate, initialState, safeRegistrationState, submitRegistration, applyMockPayment, cancelRegistration, updateTestSettings, assignRaceNumber, removeRaceNumber, markOrganiserViewed, statusSummary, sanitizedCsv } from "../registration/registration-core.mjs";
import { createPreviewRepository, STORAGE_KEY, SCHEMA_VERSION, LEGACY_STORAGE_KEYS, isRepositoryStorageEvent, queryRegistrations, environmentForHostname } from "../registration/preview-repository.mjs";
import { RUNNER_STAGE_ACTIONS, isRunnerActionAvailable, organiserHandoverUrl } from "../registration/runner-flow.mjs";
import { availableOrganiserActions } from "../registration/organiser-view.mjs";

const fixtures = JSON.parse(fs.readFileSync(new URL("../registration/fixtures.json", import.meta.url), "utf8"));
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values };
}
function previewRepository(storage = memoryStorage()) { return createPreviewRepository({ storage, environment: "preview", now: () => "2026-09-01T12:00:00.000Z" }); }

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

test("isolated cloud development permits test mode but never production open", () => {
  assert.equal(safeRegistrationState("test", "development"), "test");
  assert.equal(safeRegistrationState("open", "production"), "closed");
  assert.equal(safeRegistrationState("test", "unknown"), "closed");
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

test("repeated Stage 3 submission cannot create two records", () => {
  const state = initialState(); const payload = runner(77);
  assert.equal(submitRegistration(state, payload).ok, true);
  assert.equal(submitRegistration(state, payload).code, "DUPLICATE");
  assert.equal(state.registrations.length, 1);
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

test("direct race-number removal updates the entry, export and audit history", () => {
  const state = initialState(); const entry = submitRegistration(state, runner(1201)).registration;
  assignRaceNumber(state, entry.id, 51);
  const result = removeRaceNumber(state, entry.id);
  assert.equal(result.ok, true); assert.equal(result.releasedRaceNumber, 51); assert.equal(entry.raceNumber, null);
  assert.match(sanitizedCsv(state), new RegExp(`"${entry.id}","","Runner1201"`));
  assert.ok(state.auditEvents.some((event) => event.type === "race_number_removed" && event.registrationId === entry.id && event.detail.raceNumber === 51));
});

test("cancellation can release an assigned race number", () => {
  const state = initialState(); const entry = submitRegistration(state, runner(1202)).registration;
  assignRaceNumber(state, entry.id, 52);
  const result = cancelRegistration(state, entry.id, { releaseRaceNumber: true });
  assert.equal(result.ok, true); assert.equal(result.releasedRaceNumber, 52); assert.equal(entry.raceNumber, null);
  assert.ok(state.auditEvents.some((event) => event.type === "race_number_removed" && event.detail.reason === "registration_cancelled"));
});

test("cancellation can retain an assigned race number", () => {
  const state = initialState(); const entry = submitRegistration(state, runner(1203)).registration;
  assignRaceNumber(state, entry.id, 53);
  const result = cancelRegistration(state, entry.id, { releaseRaceNumber: false });
  assert.equal(result.ok, true); assert.equal(result.releasedRaceNumber, null); assert.equal(entry.raceNumber, 53);
  assert.ok(availableOrganiserActions(entry).includes("remove_race_number"));
  assert.equal(removeRaceNumber(state, entry.id).ok, true); assert.equal(entry.raceNumber, null);
});

test("refunding retains the assigned race number", () => {
  const state = initialState(); const entry = submitRegistration(state, runner(1204)).registration;
  assignRaceNumber(state, entry.id, 54); applyMockPayment(state, entry.id, "successful");
  assert.equal(applyMockPayment(state, entry.id, "refunded").ok, true);
  assert.equal(entry.raceNumber, 54);
});

test("a refunded entry permits separate manual race-number removal", () => {
  const state = initialState(); const entry = submitRegistration(state, runner(1205)).registration;
  assignRaceNumber(state, entry.id, 55); applyMockPayment(state, entry.id, "successful"); applyMockPayment(state, entry.id, "refunded");
  assert.ok(availableOrganiserActions(entry).includes("remove_race_number"));
  assert.equal(removeRaceNumber(state, entry.id).ok, true); assert.equal(entry.raceNumber, null); assert.equal(entry.paymentStatus, "refunded");
});

test("a released race number is available for reassignment", () => {
  const state = initialState(); const first = submitRegistration(state, runner(1206)).registration; const second = submitRegistration(state, runner(1207)).registration;
  assignRaceNumber(state, first.id, 56); removeRaceNumber(state, first.id);
  assert.equal(assignRaceNumber(state, second.id, 56).ok, true); assert.equal(second.raceNumber, 56);
});

test("duplicate race numbers are rejected", () => {
  const state = initialState(); const first = submitRegistration(state, runner(1208)).registration; const second = submitRegistration(state, runner(1209)).registration;
  assignRaceNumber(state, first.id, 57);
  assert.equal(assignRaceNumber(state, second.id, 57).code, "DUPLICATE_RACE_NUMBER"); assert.equal(second.raceNumber, null);
});

test("sanitized CSV excludes private contact, birth, consent and emergency fields", () => {
  const state = initialState(); submitRegistration(state, runner());
  const csv = sanitizedCsv(state);
  for (const forbidden of ["email", "phone", "date_of_birth", "emergency", "membership", "consent", "07700", "@example.com"]) assert.equal(csv.toLowerCase().includes(forbidden), false);
  assert.match(csv, /Runner1/);
});

test("test settings cannot select open and a fresh isolated state contains no carried-over records", () => {
  const state = initialState(); submitRegistration(state, runner());
  assert.equal(updateTestSettings(state, { registrationState: "open" }).ok, false);
  const reset = initialState({ environment: state.environment });
  assert.equal(reset.registrations.length, 0); assert.equal(reset.communications.length, 0);
});

test("fixture file contains the required synthetic scenarios", () => {
  const ids = fixtures.map((fixture) => fixture.id);
  for (const id of ["accepted-with-club", "unattached", "underage-rejected", "duplicate-rejected", "refunded", "cancelled-entry", "waiting-list", "capacity-reached"]) assert.ok(ids.includes(id));
  assert.ok(fixtures.every((fixture) => !fixture.runner?.email || /@(example\.(com|org|net)|[^@]+\.invalid)$/i.test(fixture.runner.email)));
});

test("runner and dashboard share one versioned storage contract", () => {
  assert.equal(STORAGE_KEY, "blorenge-registration-preview");
  assert.equal(SCHEMA_VERSION, 3);
  const source = fs.readFileSync(new URL("../registration/prototype-client.mjs", import.meta.url), "utf8");
  assert.match(source, /createPreviewRepository/);
  assert.doesNotMatch(source, /sessionStorage/);
});

test("production hosts remain closed and are not classified for preview persistence", () => {
  assert.equal(environmentForHostname("www.blorengefellrace.cymru"), "production");
  assert.equal(environmentForHostname("ambitious-bay-0339ed203.5.azurestaticapps.net"), "production");
  assert.equal(environmentForHostname("ambitious-bay-0339ed203-8.5.azurestaticapps.net"), "preview");
  assert.equal(environmentForHostname("black-tree-04204eb03.3.azurestaticapps.net"), "development");
  assert.equal(environmentForHostname("127.0.0.1"), "local");
});

test("review submission creates exactly one runner record visible on refresh", () => {
  const storage = memoryStorage(); const repository = previewRepository(storage);
  const start = repository.load().state.registrations.length;
  const created = repository.mutate((state) => submitRegistration(state, runner(501), { source: "runner" }));
  assert.equal(created.ok, true);
  assert.equal(repository.load().state.registrations.length, start + 1);
  const refreshed = previewRepository(storage).load().state;
  assert.equal(refreshed.registrations.filter((item) => item.id === created.registration.id).length, 1);
  assert.equal(refreshed.registrations.find((item) => item.id === created.registration.id).source, "runner");
  assert.equal(queryRegistrations(refreshed, { search: created.registration.testReference }).length, 1);
  assert.equal(queryRegistrations(refreshed, { search: created.registration.runner.email }).length, 1);
  const duplicate = repository.mutate((state) => submitRegistration(state, runner(501), { source: "runner" }));
  assert.equal(duplicate.code, "DUPLICATE");
  assert.equal(repository.load().state.registrations.length, start + 1);
});

test("mock payment updates the existing record and all outcomes remain queryable", () => {
  const repository = previewRepository(); repository.load();
  const successful = repository.mutate((state) => submitRegistration(state, runner(601), { source: "runner" })).registration;
  const declined = repository.mutate((state) => submitRegistration(state, runner(602), { source: "runner" })).registration;
  const abandoned = repository.mutate((state) => submitRegistration(state, runner(603), { source: "runner" })).registration;
  assert.equal(repository.mutate((state) => applyMockPayment(state, successful.id, "successful")).ok, true);
  repository.mutate((state) => applyMockPayment(state, declined.id, "declined"));
  repository.mutate((state) => applyMockPayment(state, abandoned.id, "abandoned"));
  const records = repository.load().state.registrations;
  assert.equal(records.filter((item) => item.id === successful.id).length, 1);
  assert.equal(records.find((item) => item.id === successful.id).paymentStatus, "successful");
  assert.equal(records.find((item) => item.id === declined.id).paymentStatus, "declined");
  assert.equal(records.find((item) => item.id === abandoned.id).paymentStatus, "abandoned");
});

test("dashboard-style initialization does not overwrite existing records", () => {
  const repository = previewRepository(); const first = repository.load();
  const created = repository.mutate((state) => submitRegistration(state, runner(701), { source: "runner" })).registration;
  const second = repository.load(); const third = repository.load();
  assert.equal(second.state.registrations.length, first.state.registrations.length + 1);
  assert.ok(third.state.registrations.some((item) => item.testReference === created.testReference));
});

test("cross-tab storage events are recognized only for the shared key", () => {
  assert.equal(isRepositoryStorageEvent({ key: STORAGE_KEY }), true);
  assert.equal(isRepositoryStorageEvent({ key: "unrelated" }), false);
});

test("reset removes every test entry and returns counts to zero", () => {
  const repository = previewRepository();
  const created = repository.mutate((state) => submitRegistration(state, runner(801), { source: "runner" })).registration;
  assert.ok(repository.load().state.registrations.some((item) => item.id === created.id));
  const reset = repository.reset();
  assert.equal(reset.ok, true);
  assert.equal(reset.state.registrations.length, 0);
  assert.equal(statusSummary(reset.state).accepted, 0);
  assert.equal(statusSummary(reset.state).waiting, 0);
  assert.equal(reset.state.testProgress.resetCompleted, true);
});

test("invalid stored data fails safely and explicit reset recovers", () => {
  const storage = memoryStorage({ [STORAGE_KEY]: "not-json" }); const repository = previewRepository(storage);
  const snapshot = repository.load();
  assert.equal(snapshot.recovery.required, true);
  assert.equal(repository.mutate((state) => submitRegistration(state, runner(901))).ok, false);
  assert.equal(repository.reset().ok, true);
  assert.equal(repository.load().recovery, null);
});

test("legacy preview data requires visible recovery and reset removes the old store", () => {
  const storage = memoryStorage({ [LEGACY_STORAGE_KEYS[0]]: JSON.stringify(initialState({ environment: "preview" })) });
  const repository = previewRepository(storage);
  assert.equal(repository.load().recovery.code, "STORAGE_SCHEMA_INVALID");
  assert.equal(repository.reset().ok, true);
  assert.equal(storage.getItem(LEGACY_STORAGE_KEYS[0]), null);
  assert.equal(repository.load().recovery, null);
});

test("runner stages expose only their relevant actions and block later actions early", () => {
  assert.deepEqual(RUNNER_STAGE_ACTIONS[1], ["details-continue"]);
  assert.deepEqual(RUNNER_STAGE_ACTIONS[2], ["race-back", "race-continue"]);
  assert.deepEqual(RUNNER_STAGE_ACTIONS[3], ["review-back", "submit-test"]);
  assert.equal(isRunnerActionAvailable(1, "submit-test"), false);
  assert.equal(isRunnerActionAvailable(2, "payment-successful", true), false);
  assert.equal(isRunnerActionAvailable(4, "payment-successful", false), false);
  assert.equal(isRunnerActionAvailable(4, "payment-successful", true), true);
});

test("organiser handover focuses the exact encoded test reference", () => {
  assert.equal(organiserHandoverUrl("TEST-A B/1"), "dashboard.html?ref=TEST-A%20B%2F1");
});

test("runner and organiser counts derive from the same records", () => {
  const repository = previewRepository();
  repository.mutate((state) => submitRegistration(state, runner(1001), { source: "runner" }));
  const state = repository.load().state;
  assert.equal(statusSummary(state).accepted, 1);
  assert.equal(queryRegistrations(state).filter((item) => item.entryStatus === "accepted").length, 1);
});

test("guided progress follows the same runner record", () => {
  const repository = previewRepository(); repository.reset();
  const created = repository.mutate((state) => submitRegistration(state, runner(1101), { source: "runner" })).registration;
  repository.mutate((state) => applyMockPayment(state, created.id, "successful"));
  repository.mutate((state) => markOrganiserViewed(state, created.testReference));
  repository.mutate((state) => assignRaceNumber(state, created.id, 42));
  const state = repository.load().state; const entry = state.registrations[0];
  assert.equal(state.testProgress.submittedReference, entry.testReference);
  assert.equal(state.testProgress.organiserViewed, true);
  assert.equal(state.testProgress.resetCompleted, true);
  assert.equal(entry.paymentStatus, "successful"); assert.equal(entry.raceNumber, 42);
});

test("invalid organiser actions are not offered", () => {
  const accepted = { entryStatus: "accepted", paymentStatus: "successful" };
  assert.deepEqual(availableOrganiserActions(accepted).sort(), ["cancel", "messages", "race_number", "refund"].sort());
  const cancelled = { entryStatus: "cancelled", paymentStatus: "refunded" };
  assert.deepEqual(availableOrganiserActions(cancelled), ["messages"]);
  const waiting = { entryStatus: "waiting_list", paymentStatus: "not_started" };
  assert.ok(availableOrganiserActions(waiting).includes("promote"));
  assert.ok(!availableOrganiserActions(waiting).includes("refund"));
});
