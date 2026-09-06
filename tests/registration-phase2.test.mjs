import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase, RegistrationService, csvFormulaSafe, parseSyntheticCsv } from "../registration/server/service.mjs";
import { createMemoryRepository, createJsonFileRepository, createAzureTableRepository } from "../registration/server/repositories.mjs";
import { createMockPaymentAdapter, createCapturedEmailAdapter, assertSafeAdapters } from "../registration/server/adapters.mjs";
import { authorize, developmentActor, staticWebAppActor } from "../registration/server/auth.mjs";
import { createApi } from "../registration/server/api.mjs";

const runner = (number = 1, overrides = {}) => ({ firstName: `Runner ${number}`, lastName: "Example", email: `phase2-${number}@example.com`, phone: "+44 7700 900123", dateOfBirth: "1990-06-15", genderCategory: "Female", club: "Example Harriers", affiliated: false, membershipNumber: "", emergencyName: "Sam Example", emergencyPhone: "07700 900456", travelMethod: "Shared car", acceptTerms: true, acceptPrivacy: true, termsVersion: "prototype-2026-09", privacyVersion: "prototype-2026-09", ...overrides });
const admin = { authenticated: true, role: "administrator", actorType: "development_organiser", id: "local:administrator" };
function setup(options = {}) { const repository = createMemoryRepository(createDatabase(options)); const paymentAdapter = createMockPaymentAdapter(); const emailAdapter = createCapturedEmailAdapter(); return { repository, service: new RegistrationService({ repository, paymentAdapter, emailAdapter }), paymentAdapter, emailAdapter }; }

test("production and invalid configuration fail closed", async () => {
  for (const registrationState of [undefined, "open", "invalid"]) { const { service } = setup({ environment: "production", registrationState }); assert.equal((await service.status()).state, "closed"); assert.equal((await service.create(runner(), { idempotencyKey: "production-key-123" })).code, "REGISTRATION_NOT_ACCEPTING"); }
});

test("server validation normalizes names and enforces age, consent and affiliation", async () => {
  const { service } = setup(); const invalid = await service.create(runner(1, { firstName: "  A   Runner ", dateOfBirth: "2011-11-29", acceptTerms: false, affiliated: true }), { idempotencyKey: "validation-key-1" });
  assert.equal(invalid.code, "VALIDATION_ERROR"); assert.ok(invalid.errors.dateOfBirth && invalid.errors.acceptTerms && invalid.errors.membershipNumber);
  const valid = await service.create(runner(2, { firstName: "  Alex   Example " }), { idempotencyKey: "validation-key-2" }); assert.equal(valid.registration.runner.firstName, "Alex Example");
});

test("idempotent submission and duplicate policy prevent duplicate entries", async () => {
  const { service, repository } = setup(); const first = await service.create(runner(3), { idempotencyKey: "same-create-key" }); const replay = await service.create(runner(3), { idempotencyKey: "same-create-key" });
  assert.equal(replay.idempotentReplay, true); assert.equal(replay.registration.id, first.registration.id); assert.equal((await repository.read()).registrations.length, 1);
  assert.equal((await service.create(runner(4, { email: runner(3).email }), { idempotencyKey: "different-key-123" })).code, "DUPLICATE");
});

test("atomic final place allocation and waiting-list ordering survive concurrency", async () => {
  const { service } = setup({ capacity: 1 }); const [a, b] = await Promise.all([service.create(runner(5), { idempotencyKey: "final-place-a" }), service.create(runner(6), { idempotencyKey: "final-place-b" })]);
  assert.deepEqual([a.registration.entryStatus, b.registration.entryStatus].sort(), ["accepted", "waiting_list"]); const snapshot = await service.snapshot(admin); assert.equal(snapshot.state.registrations.find((item) => item.entryStatus === "waiting_list").waitingListPosition, 1);
});

test("cancellation releases a place and atomically promotes the first waiting entry", async () => {
  const { service } = setup({ capacity: 1 }); const accepted = await service.create(runner(7), { idempotencyKey: "cancel-create-a" }); const waiting = await service.create(runner(8), { idempotencyKey: "cancel-create-b" });
  await service.manage(admin, accepted.registration.id, "cancel", { releaseRaceNumber: true }); const snapshot = await service.snapshot(admin); assert.equal(snapshot.state.registrations.find((item) => item.id === waiting.registration.id).entryStatus, "accepted");
});

test("entry status changes enforce valid capacity-aware transitions", async () => {
  const { service } = setup({ capacity: 2 }); const created = await service.create(runner(23), { idempotencyKey: "entry-status-create" }); const waiting = await service.manage(admin, created.registration.id, "entry_status", { entryStatus: "waiting_list" }); assert.equal(waiting.registration.entryStatus, "waiting_list"); const accepted = await service.manage(admin, created.registration.id, "entry_status", { entryStatus: "accepted" }); assert.equal(accepted.registration.entryStatus, "accepted"); assert.equal((await service.manage(admin, created.registration.id, "entry_status", { entryStatus: "cancelled" })).code, "INVALID_ENTRY_TRANSITION");
});

test("race numbers assign, change, remove, reject duplicates and can be reused", async () => {
  const { service } = setup(); const a = await service.create(runner(9), { idempotencyKey: "race-a-key-123" }); const b = await service.create(runner(10), { idempotencyKey: "race-b-key-123" });
  assert.equal((await service.manage(admin, a.registration.id, "race_number", { raceNumber: 80 })).ok, true); assert.equal((await service.manage(admin, a.registration.id, "race_number", { raceNumber: 81 })).registration.raceNumber, 81);
  assert.equal((await service.manage(admin, b.registration.id, "race_number", { raceNumber: 81 })).code, "DUPLICATE_RACE_NUMBER"); await service.manage(admin, a.registration.id, "remove_race_number"); assert.equal((await service.manage(admin, b.registration.id, "race_number", { raceNumber: 81 })).ok, true);
});

test("refund retains race number until separately removed", async () => {
  const { service } = setup(); const created = await service.create(runner(11), { idempotencyKey: "refund-create-key" }); await service.manage(admin, created.registration.id, "race_number", { raceNumber: 82 });
  await service.mockPayment(created.confirmationToken, "successful", "payment-success-key"); const refunded = await service.manage(admin, created.registration.id, "refund"); assert.equal(refunded.registration.raceNumber, 82); assert.equal((await service.manage(admin, created.registration.id, "remove_race_number")).registration.raceNumber, null);
});

test("payment retries are idempotent and adapters remain external-call free", async () => {
  const { service, paymentAdapter, emailAdapter } = setup(); assert.doesNotThrow(() => assertSafeAdapters({ payment: paymentAdapter, email: emailAdapter }, "local")); assert.throws(() => assertSafeAdapters({ payment: paymentAdapter, email: emailAdapter }, "production"));
  const created = await service.create(runner(12), { idempotencyKey: "payment-create-key" }); const first = await service.mockPayment(created.confirmationToken, "successful", "payment-callback-key"); const replay = await service.mockPayment(created.confirmationToken, "successful", "payment-callback-key"); assert.equal(first.ok, true); assert.equal(replay.idempotentReplay, true);
});

test("confirmation tokens are opaque and non-enumerable", async () => {
  const { service } = setup(); const created = await service.create(runner(13), { idempotencyKey: "confirmation-key" }); assert.ok(created.confirmationToken.length > 60); assert.equal((await service.confirmation(created.confirmationToken)).ok, true); assert.deepEqual(await service.confirmation(`${created.confirmationToken}x`), { ok: false, code: "NOT_FOUND" });
});

test("public registration responses omit private contact and race-day fields", async () => {
  const { service } = setup(); const created = await service.create(runner(25), { idempotencyKey: "runner-safe-response" });
  const serializedCreate = JSON.stringify(created); const confirmation = await service.confirmation(created.confirmationToken); const serializedConfirmation = JSON.stringify(confirmation);
  for (const privateValue of [runner(25).email, runner(25).phone, runner(25).emergencyName, runner(25).emergencyPhone, runner(25).dateOfBirth, runner(25).travelMethod]) {
    assert.equal(serializedCreate.includes(privateValue), false); assert.equal(serializedConfirmation.includes(privateValue), false);
  }
});

test("local organiser bypass fails outside loopback/local and roles restrict operations", () => {
  const local = developmentActor({ environment: "local", hostname: "127.0.0.1", headers: { "x-development-organiser": "enabled", "x-development-role": "race_day_volunteer" } }); assert.equal(local.authenticated, true); assert.equal(authorize(local, "race_number"), true); assert.equal(authorize(local, "erase"), false);
  for (const context of [{ environment: "production", hostname: "127.0.0.1" }, { environment: "local", hostname: "example.com" }]) assert.equal(developmentActor({ ...context, headers: { "x-development-organiser": "enabled" } }).authenticated, false);
});

test("Static Web Apps principal accepts the Organiser role case-insensitively", () => {
  const header = (userRoles) => Buffer.from(JSON.stringify({ userId: "synthetic-organiser", userRoles })).toString("base64");
  const organiser = staticWebAppActor({ "x-ms-client-principal": header(["anonymous", "authenticated", "organiser"]) });
  assert.equal(organiser.authenticated, true); assert.equal(authorize(organiser, "erase"), true);
  assert.equal(staticWebAppActor({ "x-ms-client-principal": header(["authenticated", "ORGANISER"]) }).role, "Organiser");
  const ordinary = staticWebAppActor({ "x-ms-client-principal": header(["anonymous", "authenticated"]) });
  assert.equal(ordinary.authenticated, true); assert.equal(authorize(ordinary, "read"), false);
  assert.equal(staticWebAppActor({ "x-ms-client-principal": "not-base64" }).authenticated, false);
});

test("Azure repository unwraps state and retries ETag conflicts", async () => {
  let state = createDatabase({ environment: "development", registrationState: "test" }); let etag = "one"; let writes = 0;
  const repository = createAzureTableRepository({
    async loadPartition() { return { state: structuredClone(state), etag }; },
    async submitTransaction({ after }) { writes += 1; if (writes === 1) { const error = new Error("conflict"); error.statusCode = 412; throw error; } state = structuredClone(after); etag = "two"; }
  });
  assert.equal((await repository.read()).environment, "development");
  const result = await repository.transaction((working) => { working.registrationState = "paused"; return { ok: true }; });
  assert.equal(result.ok, true); assert.equal(writes, 2); assert.equal((await repository.read()).registrationState, "paused");
  await repository.reset(createDatabase({ environment: "development", registrationState: "test" }));
  assert.equal((await repository.read()).registrationState, "test");
});

test("registration state transitions are server-controlled and cannot select production open", async () => {
  const { service } = setup(); for (const state of ["closed", "test", "paused", "full"]) assert.equal((await service.setState(admin, state)).state, state); assert.equal((await service.setState(admin, "open")).code, "INVALID_STATE");
  const production = setup({ environment: "production", registrationState: "closed" }); assert.equal((await production.service.setState(admin, "test")).code, "PRODUCTION_CLOSED");
});

test("cloud development rejects submissions if stored state is changed from test", async () => {
  const { service, repository } = setup({ environment: "development", registrationState: "test" });
  await repository.transaction((database) => { database.registrationState = "open"; return { ok: true }; });
  assert.equal((await service.create(runner(24), { idempotencyKey: "cloud-forced-test-key" })).code, "REGISTRATION_NOT_ACCEPTING");
});

test("synthetic import uses server validation and stays local", async () => {
  const { service } = setup(); const result = await service.importSynthetic(admin, [runner(20), runner(21, { email: "real@example.co.uk" })]); assert.equal(result.imported, 1); assert.equal(result.rejected[0], "VALIDATION_ERROR");
  const preview = setup({ environment: "preview", registrationState: "test" }); assert.equal((await preview.service.importSynthetic(admin, [runner(22)])).code, "DEVELOPMENT_ONLY");
});

test("synthetic CSV import parses quoted fields and applies server validation", async () => {
  const headers = "firstName,lastName,email,phone,dateOfBirth,genderCategory,club,affiliated,membershipNumber,emergencyName,emergencyPhone,travelMethod,acceptTerms,acceptPrivacy,termsVersion,privacyVersion";
  const text = `${headers}\nAlex,Example,csv@example.com,07700900123,1990-06-15,Female,"Example, Harriers",false,,Sam Example,07700900456,Shared car,true,true,prototype-2026-09,prototype-2026-09`;
  assert.equal(parseSyntheticCsv(text)[0].club, "Example, Harriers"); const { service } = setup(); assert.equal((await service.importSyntheticCsv(admin, text)).imported, 1);
});

test("organiser API rejects anonymous requests and permits explicit local identity", async () => {
  const { service } = setup(); const api = createApi({ service, environment: "local" }); assert.equal((await api({ method: "GET", pathname: "/api/v2/organiser/snapshot", hostname: "127.0.0.1" })).status, 403);
  assert.equal((await api({ method: "GET", pathname: "/api/v2/organiser/snapshot", hostname: "127.0.0.1", headers: { "x-development-organiser": "enabled" } })).status, 200);
});

test("public write endpoints apply a development rate limit", async () => {
  const { service } = setup(); const api = createApi({ service, environment: "local" }); let response; for (let index = 0; index < 31; index += 1) response = await api({ method: "POST", pathname: "/api/v2/registrations", hostname: "127.0.0.1", headers: { "idempotency-key": `rate-limit-${index}-key` }, body: runner(100 + index) }); assert.equal(response.status, 429); assert.equal(response.headers["retry-after"], "60");
});

test("audit records minimal actor/action/before-after data without form payloads", async () => {
  const { service, repository } = setup(); const created = await service.create(runner(14), { idempotencyKey: "audit-create-key" }); await service.manage(admin, created.registration.id, "race_number", { raceNumber: 83 }); const events = (await repository.read()).auditEvents; assert.ok(events.every((event) => event.timestamp && event.actorType && event.action && event.environment)); assert.equal(JSON.stringify(events).includes(runner(14).email), false);
});

test("CSV formula injection is neutralized in public and private exports", async () => {
  assert.equal(csvFormulaSafe("=HYPERLINK(1)"), "'=HYPERLINK(1)"); const { service } = setup(); await service.create(runner(15, { club: "=CMD|' /C calc'!A0" }), { idempotencyKey: "csv-formula-key" }); const exported = await service.exportPublic(admin); assert.match(exported.csv, /'=CMD/);
});

test("anonymisation and local deletion remove restricted data", async () => {
  const { service } = setup(); const a = await service.create(runner(16), { idempotencyKey: "erase-anon-key" }); assert.equal((await service.erase(admin, a.registration.id, "anonymise")).ok, true); const anonymised = (await service.snapshot(admin)).state.registrations.find((item) => item.id === a.registration.id); assert.equal(anonymised.runner.email.endsWith("@deleted.invalid"), true); assert.equal(anonymised.runner.emergencyName, undefined);
  const b = await service.create(runner(17), { idempotencyKey: "erase-delete-key" }); await service.erase(admin, b.registration.id, "delete"); assert.equal((await service.snapshot(admin)).state.registrations.some((item) => item.id === b.registration.id), false);
});

test("persistent repository survives restart and backup/restore", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blorenge-phase2-")); const file = path.join(directory, "development.json"); const repoA = createJsonFileRepository(file, createDatabase()); const serviceA = new RegistrationService({ repository: repoA, paymentAdapter: createMockPaymentAdapter(), emailAdapter: createCapturedEmailAdapter() }); await serviceA.create(runner(18), { idempotencyKey: "persistent-key" }); const backup = await repoA.backup();
  const repoB = createJsonFileRepository(file, createDatabase()); assert.equal((await repoB.read()).registrations.length, 1); await repoB.reset(createDatabase()); assert.equal((await repoB.read()).registrations.length, 0); await repoB.restore(backup); assert.equal((await repoB.read()).registrations.length, 1); fs.rmSync(directory, { recursive: true });
});

test("private export is warned, safely named and never targets the public tree", async () => {
  const { service } = setup(); await service.create(runner(19), { idempotencyKey: "private-export-key" }); const result = await service.exportPrivate(admin); assert.match(result.warning, /PRIVATE SYNTHETIC/); assert.match(result.filename, /^private-exports\//); assert.doesNotMatch(result.filename, /^(registration|data|images)\//);
});

test("development reset clears synthetic records while preserving event configuration and test mode", async () => {
  const { service, repository } = setup({ environment: "development", registrationState: "test", capacity: 73 });
  const created = await service.create(runner(26), { idempotencyKey: "reset-complete-key" });
  await service.mockPayment(created.confirmationToken, "successful", "reset-payment-key");
  await service.requestAmendment(created.confirmationToken, { type: "correction", message: "Synthetic correction" });
  await service.manage(admin, created.registration.id, "race_number", { raceNumber: 90 });
  const before = await repository.read();
  assert.ok(before.runners.length && before.registrations.length && before.payments.length && before.consents.length && before.communications.length && before.auditEvents.length && before.idempotency.length && before.amendmentRequests.length);

  const reset = await service.resetDevelopment(admin);
  assert.equal(reset.ok, true);
  const after = await repository.read();
  for (const collection of ["runners", "emergencyContacts", "registrations", "payments", "consents", "communications", "auditEvents", "idempotency", "amendmentRequests"]) {
    assert.deepEqual(after[collection], [], `${collection} was not cleared`);
  }
  assert.equal(after.environment, "development");
  assert.equal(after.registrationState, "test");
  assert.equal(after.event.id, before.event.id);
  assert.equal(after.event.capacity, 73);
  assert.equal(after.testProgress.resetCompleted, true);
});

test("source contains no runner payload logging and production remains unlinked", () => {
  const sources = ["registration/server/service.mjs", "registration/server/api.mjs", "scripts/start-registration-phase2.mjs"].map((file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).join("\n"); assert.doesNotMatch(sources, /console\.(log|error)\((input|body|runner|normalized|request)/i); assert.doesNotMatch(fs.readFileSync(new URL("../enter.html", import.meta.url), "utf8"), /href=["'][^"']*registration\//i);
});
