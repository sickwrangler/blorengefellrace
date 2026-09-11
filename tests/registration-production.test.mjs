import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProductionBootstrap, productionAvailability, validateProductionState } from "../registration/server/production-bootstrap.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { issuePrivateInvitation, transitionRegistrationState } from "../registration/server/phase3-domain.mjs";
import { authorize as authorizeProduction, staticWebAppActor } from "../registration/server/production-auth.mjs";
import { OrderRegistrationService } from "../registration/server/order-service.mjs";
import { createProductionBackupService, operationalDailyBackupDue, PRODUCTION_BACKUP_POLICY } from "../registration/server/production-backup.mjs";
import { createProductionApi } from "../registration/server/production-api.mjs";
import { ProductionRegistrationService } from "../registration/server/production-service.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";
import { assertStripeDevelopmentConfiguration, assertStripeProductionConfiguration } from "../registration/server/phase3-integrations.mjs";
import { loadProductionConfiguration } from "../api/src/production-config.mjs";
import { stageRegistrationProduction } from "../scripts/stage-deployment-artifacts.mjs";
import { stageProductionScheduler } from "../scripts/stage-registration-production-scheduler.mjs";
import { createProductionSchedulerHandler } from "../scheduler/src/production-scheduler.mjs";

const organiser = { authenticated: true, role: "organiser", actorType: "entra_organiser", id: "configured-at-deployment" };
const email = { kind: "disabled", externalDelivery: false, async send() { return { delivery: "disabled", externalCall: false }; } };
const env = (extra = {}) => ({ REGISTRATION_ENVIRONMENT: "production", REGISTRATION_STORAGE_ACCOUNT: "stblorengeregprodabc", REGISTRATION_TABLE: "RegistrationProduction", REGISTRATION_EVENT_PARTITION: "blorenge-2026-live", REGISTRATION_TABLE_SAS_TOKEN: "review-only-placeholder", REGISTRATION_PUBLIC_BASE_URL: "https://www.blorengefellrace.cymru", STRIPE_ENABLED: "false", ACS_EMAIL_ENABLED: "false", ...extra });

test("production bootstrap is CLOSED, exact, empty and junior-gated", () => {
  const state = createProductionBootstrap(); assert.equal(validateProductionState(state), state);
  assert.equal(state.environment, "production"); assert.equal(state.registrationState, "CLOSED"); assert.equal(state.phase3RegistrationState, "CLOSED"); assert.equal(state.event.capacity, 120); assert.equal(state.event.entryFeePence, 600); assert.equal(state.event.wfraMemberPricePence, 400); assert.equal(state.event.under18EntriesEnabled, false);
  for (const name of ["registrations", "orders", "payments", "refundRequests", "reservations", "waitingList", "waitingListOffers", "privateInvitations", "scheduledWork"]) assert.deepEqual(state[name], []);
  assert.deepEqual(productionAvailability({ environment: "production", registrationState: "OPEN" }), { available: false, operationalState: "CLOSED" });
});

test("production configuration rejects environment crossover and permits disabled providers", () => {
  const config = loadProductionConfiguration(env()); assert.equal(config.stripeEnabled, false); assert.equal(config.emailEnabled, false); assert.equal(config.under18EntriesEnabled, false);
  assert.throws(() => loadProductionConfiguration(env({ REGISTRATION_STORAGE_ACCOUNT: "stblorengeregdev2026" })), /development storage/);
  assert.throws(() => loadProductionConfiguration(env({ REGISTRATION_EMAIL_SAFE_RECIPIENTS: "configured-elsewhere" })), /forbidden/);
  assert.throws(() => loadProductionConfiguration(env({ REGISTRATION_STATE: "OPEN" })), /cannot open/);
  assert.throws(() => loadProductionConfiguration(env({ STRIPE_SECRET_KEY: ["sk", "live", "placeholder"].join("_") })), /disabled/);
});

test("Stripe configuration keeps live and sandbox modes separated", () => {
  const liveKey = ["sk", "live", "placeholder"].join("_"); const testKey = ["sk", "test", "placeholder"].join("_"); const webhook = ["whsec", "placeholder"].join("_");
  assert.deepEqual(assertStripeProductionConfiguration({ environment: "production", secretKey: liveKey, webhookSecret: webhook }), { mode: "live" });
  assert.throws(() => assertStripeProductionConfiguration({ environment: "production", secretKey: testKey, webhookSecret: webhook }), /live secret/);
  assert.throws(() => assertStripeDevelopmentConfiguration({ environment: "development", secretKey: liveKey, webhookSecret: webhook }), /forbidden/);
});

test("under-18 launch gate blocks only 16/17 production runners", async () => {
  const state = createProductionBootstrap(); transitionRegistrationState(state, "OPEN", organiser);
  const repository = createMemoryRepository(state); const orders = new OrderRegistrationService({ repository, emailAdapter: email, publicBaseUrl: "https://www.blorengefellrace.cymru" });
  const created = await orders.createOrder({ purchaserEmail: "purchaser@example.com" }); assert.equal(created.ok, true);
  const runner = { firstName: "Junior", lastName: "Runner", email: "junior@example.com", phone: "07000 000000", addressLine1: "1 Hill Road", city: "Town", postcode: "NP7 0AA", raceCategory: "Female", dateOfBirth: "2010-01-01", club: "", wfraMember: false, emergencyContactName: "Adult Contact", emergencyContactPhone: "07000 000001", acceptTerms: true, acceptPrivacy: true };
  const blocked = await orders.addRunner(created.orderToken, { runner, declarationMode: "later" }); assert.equal(blocked.errors.dateOfBirth, "Entries for runners aged 16 or 17 are not currently enabled.");
  runner.dateOfBirth = "1990-01-01"; const adult = await orders.addRunner(created.orderToken, { runner: { ...runner, email: "adult@example.com" }, declarationMode: "later" }); assert.equal(adult.ok, true);
});

test("production API omits development routes and requires organiser role", async () => {
  const repository = createMemoryRepository(createProductionBootstrap()); const integrations = new Phase3IntegrationService({ repository, emailAdapter: email, publicBaseUrl: "https://www.blorengefellrace.cymru", environment: "production" }); const service = new ProductionRegistrationService({ repository, emailAdapter: email }); const api = createProductionApi({ service, phase3Integrations: integrations, repository });
  const call = (method, pathname, extra = {}) => api({ method, pathname, hostname: "www.blorengefellrace.cymru", ...extra });
  for (const pathname of ["/api/v2/organiser/reset", "/api/v2/organiser/import/synthetic", "/api/v2/registrations/x/mock-payment"]) assert.equal((await call("POST", pathname)).status, 404);
  assert.equal((await call("GET", "/api/v2/organiser/snapshot")).status, 403);
  assert.equal((await call("POST", "/api/v4/orders", { body: { purchaserEmail: "runner@example.com" } })).body.code, "REGISTRATION_NOT_ACCEPTING");
});

test("production Entra authorization requires the literal organiser role", () => {
  const principal = (roles) => Buffer.from(JSON.stringify({ userId: "configured-at-deployment", userRoles: roles })).toString("base64");
  assert.equal(staticWebAppActor({ "x-ms-client-principal": principal(["authenticated", "organiser"]) }).role, "organiser");
  assert.equal(staticWebAppActor({ "x-ms-client-principal": principal(["authenticated"]) }).role, null);
});

test("PRIVATE_LIVE requires a purpose-bound invitation and consumes it only for a valid order", async () => {
  const state = createProductionBootstrap(); transitionRegistrationState(state, "PRIVATE_LIVE", organiser);
  const invitation = issuePrivateInvitation(state, { kind: "registration", expiresAt: "2026-10-02T12:00:00Z" }, organiser, new Date("2026-10-01T12:00:00Z"));
  const repository = createMemoryRepository(state); const orders = new OrderRegistrationService({ repository, emailAdapter: email, publicBaseUrl: "https://www.blorengefellrace.cymru" });
  assert.equal((await orders.createOrder({ purchaserEmail: "invalid" }, new Date("2026-10-01T12:01:00Z"), invitation.token)).code, "VALIDATION_ERROR");
  assert.equal((await repository.read()).privateInvitations[0].uses, 0);
  assert.equal((await orders.createOrder({ purchaserEmail: "runner@example.com" }, new Date("2026-10-01T12:02:00Z"), invitation.token)).ok, true);
  assert.equal((await repository.read()).privateInvitations[0].uses, 1);
  assert.equal((await orders.createOrder({ purchaserEmail: "other@example.com" }, new Date("2026-10-01T12:03:00Z"), invitation.token)).code, "LINK_UNAVAILABLE");
});

test("production scheduler is harmless while CLOSED and empty", async () => {
  const service = { async runScheduledWork(actor) {
    assert.equal(authorizeProduction(actor, "manage"), true);
    return { ok: true, reminders: 0, expiredOffers: 0, expiredPayments: 0, nextOfferCreated: false };
  } };
  const handler = createProductionSchedulerHandler({ service, environment: env(), clock: () => new Date("2026-10-01T12:00:00Z"), logger: { log() {}, error() {} } });
  const result = await handler(); assert.equal(result.ok, true); assert.equal(result.reminders, 0); assert.equal(result.expiredOffers, 0);
});

test("production artifacts are exact and physically exclude browser test controls", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blorenge-production-package-"));
  try {
    const artifact = stageRegistrationProduction({ outputRoot: path.join(root, "site") }); const scheduler = stageProductionScheduler({ targetRoot: path.join(root, "scheduler") });
    assert.equal(artifact.appFiles.includes("registration/prototype-client.mjs"), false); assert.equal(artifact.appFiles.includes("registration/preview-repository.mjs"), false); assert.equal(artifact.apiFiles.includes("src/functions/registration.mjs"), false); assert.ok(scheduler.includes("src/functions/registration-production-scheduler.mjs"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("backup snapshots are checksummed and restore is guarded", async () => {
  let state = createProductionBootstrap(); let etag = "etag-1"; const blobs = new Map();
  const stateTransport = { async loadPartition() { return { state: structuredClone(state), etag }; }, async submitTransaction({ after, etag: expected }) { assert.equal(expected, etag); state = structuredClone(after); etag = "etag-2"; } };
  const blobTransport = { async put(name, content) { blobs.set(name, content); }, async get(name) { return blobs.get(name); }, async list() { return [...blobs].map(([name, content]) => { const parsed = JSON.parse(content); return { name, ...parsed }; }); } };
  const backups = createProductionBackupService({ stateTransport, blobTransport, reconcilePayments: async () => true }); const saved = await backups.createSnapshot({ reason: "pre-launch" }); assert.equal((await backups.validateSnapshot(saved.name)).valid, true);
  await assert.rejects(backups.restoreSnapshot(saved.name, {}), /prerequisites/);
  await assert.rejects(backups.restoreSnapshot(saved.name, { confirmation: `RESTORE ${saved.name}`, writesSuspended: true, schedulerSuspended: false }), /prerequisites/);
  assert.equal((await backups.restoreSnapshot(saved.name, { confirmation: `RESTORE ${saved.name}`, writesSuspended: true, schedulerSuspended: true })).restored, true);
});

test("backup policy schedules one daily operational snapshot without embedding deletion", () => {
  const state = createProductionBootstrap(); assert.equal(operationalDailyBackupDue(state, null, new Date("2026-10-01T03:00:00Z")), false);
  transitionRegistrationState(state, "PRIVATE_LIVE", organiser);
  assert.equal(operationalDailyBackupDue(state, null, new Date("2026-10-01T01:59:00Z")), false);
  assert.equal(operationalDailyBackupDue(state, null, new Date("2026-10-01T02:00:00Z")), true);
  assert.equal(operationalDailyBackupDue(state, "2026-10-01T02:00:00Z", new Date("2026-10-01T12:00:00Z")), false);
  assert.equal(operationalDailyBackupDue(state, "2026-10-01T02:00:00Z", new Date("2026-10-02T02:00:00Z")), true);
  assert.equal(PRODUCTION_BACKUP_POLICY.automaticDeletion, false);
});
