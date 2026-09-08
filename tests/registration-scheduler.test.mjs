import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { createDatabase } from "../registration/server/service.mjs";
import { Phase3IntegrationService } from "../registration/server/phase3-service.mjs";
import { createControlledDevelopmentEmail } from "../registration/server/development-email.mjs";
import { createSchedulerHandler, emailOperationId, resolveSchedulerTime } from "../scheduler/src/scheduler.mjs";

const environment = Object.freeze({ REGISTRATION_ENVIRONMENT: "development", REGISTRATION_STATE: "test" });
const admin = Object.freeze({ authenticated: true, role: "administrator", actorType: "organiser", id: "test-organiser" });
const start = new Date("2026-09-01T12:00:00Z");

function setup({ send } = {}) {
  const state = createDatabase({ environment: "development", registrationState: "test" });
  state.phase3RegistrationState = "CLOSED";
  const repository = createMemoryRepository(state);
  const sent = [];
  const emailAdapter = send ? { kind: "test", send } : createControlledDevelopmentEmail({
    senderAddress: "sender@example.com",
    safeRecipients: ["safe@example.com"],
    transport: { async send(message) { sent.push(message); return { id: `email-${sent.length}` }; } }
  });
  const service = new Phase3IntegrationService({ repository, emailAdapter, publicBaseUrl: "https://development.example" });
  return { repository, sent, service };
}

async function offerTwo(service) {
  await service.joinWaitingList({ firstName: "First", lastName: "Synthetic", email: "first@example.com" }, start);
  await service.joinWaitingList({ firstName: "Second", lastName: "Synthetic", email: "second@example.com" }, start);
  return service.offerNextWaitingPlace(admin, start);
}

test("scheduler refuses non-development configuration and controlled time fails closed", () => {
  assert.throws(() => createSchedulerHandler({ service: {}, environment: { REGISTRATION_ENVIRONMENT: "production", REGISTRATION_STATE: "test" } }));
  assert.throws(() => resolveSchedulerTime({ ...environment, REGISTRATION_SCHEDULER_TEST_NOW: "2026-09-02T12:00:00Z" }));
  assert.equal(resolveSchedulerTime({ ...environment, REGISTRATION_SCHEDULER_ALLOW_TEST_TIME: "true", REGISTRATION_SCHEDULER_TEST_NOW: "2026-09-02T12:00:00Z" }).toISOString(), "2026-09-02T12:00:00.000Z");
});

test("ACS operation identifiers are stable UUIDs derived from business idempotency keys", () => {
  const first = emailOperationId("waiting-list:offer-1:reminder");
  assert.equal(first, emailOperationId("waiting-list:offer-1:reminder"));
  assert.notEqual(first, emailOperationId("waiting-list:offer-2:reminder"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("concurrent scheduler calls send one reminder and persist one successful result", async () => {
  const { repository, sent, service } = setup();
  await offerTwo(service);
  const at = new Date("2026-09-02T12:01:00Z");
  const handler = createSchedulerHandler({ service, environment, clock: () => at, logger: { log() {}, error() {} } });
  const results = await Promise.all([handler(), handler()]);
  assert.equal(results.reduce((total, result) => total + result.reminders, 0), 1);
  assert.equal(sent.filter((message) => message.subject.includes("reminder")).length, 1);
  const state = await repository.read();
  assert.equal(state.schedulerStatus.lastSuccessfulRunAt, at.toISOString());
  assert.equal(state.schedulerStatus.lastResult.reminders, 0);
});

test("failed email leaves reminder due and the next scheduler run retries safely", async () => {
  let calls = 0;
  const { repository, service } = setup({ send: async () => { calls += 1; if (calls === 4) throw new Error("synthetic transport failure"); return { delivery: "test", externalCall: false }; } });
  await offerTwo(service);
  const at = new Date("2026-09-02T12:01:00Z");
  const handler = createSchedulerHandler({ service, environment, clock: () => at, logger: { log() {}, error() {} } });
  await assert.rejects(handler(), /synthetic transport failure/);
  assert.equal((await repository.read()).waitingListOffers[0].reminderSentAt ?? null, null);
  assert.equal((await handler()).reminders, 1);
  assert.equal((await repository.read()).waitingListOffers[0].reminderSentAt, at.toISOString());
});

test("expiry is idempotent, revokes the old offer and progresses exactly one next runner", async () => {
  const { repository, service } = setup();
  await offerTwo(service);
  const at = new Date("2026-09-03T12:01:00Z");
  const handler = createSchedulerHandler({ service, environment, clock: () => at, logger: { log() {}, error() {} } });
  const first = await handler(); const second = await handler(); const state = await repository.read();
  assert.equal(first.expiredOffers, 1); assert.equal(first.nextOfferCreated, true);
  assert.equal(second.expiredOffers, 0); assert.equal(second.nextOfferCreated, false);
  assert.equal(state.waitingListOffers.filter((offer) => offer.status === "expired").length, 1);
  assert.equal(state.waitingListOffers.filter((offer) => offer.status === "offered").length, 1);
  const expired = state.waitingListOffers.find((offer) => offer.status === "expired");
  assert.ok(state.privateInvitations.find((item) => item.id === expired.invitationId).revokedAt);
});

test("CLOSED development state with no due work is harmless and observable", async () => {
  const { repository, service } = setup();
  const at = new Date("2026-09-04T12:00:00Z");
  const result = await createSchedulerHandler({ service, environment, clock: () => at, logger: { log() {}, error() {} } })();
  assert.deepEqual(result, { ok: true, reminders: 0, expiredOffers: 0, expiredPayments: 0, nextOfferCreated: false, declarationReminders: 0, abandonedOrders: 0 });
  assert.equal((await repository.read()).schedulerStatus.lastSuccessfulRunAt, at.toISOString());
});

test("scheduler has only a monitored 30-minute timer and remains outside production artifacts", () => {
  const source = fs.readFileSync("scheduler/src/functions/registration-scheduler.mjs", "utf8");
  assert.match(source, /app\.timer\("registration-scheduled-work"/);
  assert.match(source, /schedule: "0 \*\/30 \* \* \* \*"/);
  assert.match(source, /useMonitor: true/);
  assert.doesNotMatch(source, /app\.http|x-functions-key|STRIPE_/);
  const staging = fs.readFileSync("scripts/stage-deployment-artifacts.mjs", "utf8");
  assert.doesNotMatch(staging, /scheduler\/src/);
  assert.doesNotMatch(staging, /prove-registration-phase3b2/);
  const proof = fs.readFileSync("scripts/prove-registration-phase3b2.mjs", "utf8");
  assert.match(proof, /synthetic-development-only/);
  assert.match(proof, /REGISTRATION_ENVIRONMENT.*development/s);
  assert.match(proof, /black-tree-04204eb03\.3\.azurestaticapps\.net/);
  assert.doesNotMatch(proof, /(?:sk|rk)_live_/i);
});
