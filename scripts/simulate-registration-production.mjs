#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageRegistrationProduction } from "./stage-deployment-artifacts.mjs";
import { stageProductionScheduler } from "./stage-registration-production-scheduler.mjs";
import { createProductionBootstrap, productionAvailability, validateProductionState } from "../registration/server/production-bootstrap.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { ProductionRegistrationService } from "../registration/server/production-service.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";
import { createProductionApi } from "../registration/server/production-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = createProductionBootstrap(); validateProductionState(state);
assert.equal(state.registrationState, "CLOSED"); assert.equal(state.phase3RegistrationState, "CLOSED"); assert.equal(state.event.capacity, 120); assert.equal(state.event.under18EntriesEnabled, false);
for (const name of ["registrations", "orders", "payments", "refundRequests", "reservations", "waitingList", "waitingListOffers", "privateInvitations", "scheduledWork"]) assert.equal(state[name].length, 0, `${name} must start empty`);
assert.deepEqual(productionAvailability({ environment: "production" }), { available: false, operationalState: "CLOSED" });

const repository = createMemoryRepository(state);
const emailAdapter = { kind: "disabled", externalDelivery: false, async send() { throw new Error("Email must not be called while CLOSED and empty."); } };
const integrations = new Phase3IntegrationService({ repository, stripeGateway: null, emailAdapter, publicBaseUrl: "https://www.blorengefellrace.cymru", environment: "production" });
const service = new ProductionRegistrationService({ repository, emailAdapter });
const api = createProductionApi({ service, phase3Integrations: integrations, repository });
const call = (method, pathname, extras = {}) => api({ method, pathname, hostname: "www.blorengefellrace.cymru", ...extras });
assert.equal((await call("GET", "/api/v2/registration/status")).body.operationalState, "CLOSED");
assert.equal((await call("POST", "/api/v4/orders", { body: { purchaserEmail: "runner@example.com" } })).body.code, "REGISTRATION_NOT_ACCEPTING");
assert.deepEqual((await call("GET", "/api/v4/start-list")).body.entries, []);
assert.equal((await call("POST", "/api/v2/organiser/reset")).status, 404);
assert.equal((await call("POST", "/api/v2/registrations/token/mock-payment")).status, 404);
assert.equal((await call("GET", "/api/v2/organiser/snapshot")).status, 403);

const artifact = stageRegistrationProduction(); const scheduler = stageProductionScheduler();
assert.ok(artifact.appFiles.includes("registration/production-client.mjs"));
assert.ok(artifact.apiFiles.includes("src/functions/registration-production.mjs"));
assert.ok(scheduler.includes("src/functions/registration-production-scheduler.mjs"));
fs.writeFileSync(path.join(root, ".deployment/production-registration/manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), appFiles: artifact.appFiles, apiFiles: artifact.apiFiles, schedulerFiles: scheduler }, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, operationalState: state.registrationState, capacity: state.event.capacity, counts: { registrations: 0, orders: 0, payments: 0, waitingList: 0 }, stripe: "disabled", email: "disabled", under18Entries: "disabled", appFiles: artifact.appFiles.length, apiFiles: artifact.apiFiles.length, schedulerFiles: scheduler.length }));
