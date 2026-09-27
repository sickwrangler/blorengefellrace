#!/usr/bin/env node
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { AzureSASCredential, TableClient } from "@azure/data-tables";
import { createAzureTableRepository } from "../../registration/server/repositories.mjs";
import { createProductionBootstrap, validateProductionState } from "../../registration/server/production-bootstrap.mjs";
import { decodeProductionState, productionStateEntity } from "../../registration/server/production-storage-codec.mjs";
import { createStorageForecastState } from "../../scripts/registration-storage-fixtures.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
if (process.env.ALLOW_DEVELOPMENT_STORAGE_INTEGRATION !== "SYNTHETIC_ONLY") throw new Error("Development integration guard is missing.");
const accountName = required("REGISTRATION_STORAGE_ACCOUNT");
const tableName = required("REGISTRATION_TABLE");
const sasToken = required("REGISTRATION_TABLE_SAS_TOKEN");
if (!/dev|test/i.test(`${accountName}:${tableName}`) || /prod/i.test(`${accountName}:${tableName}`)) throw new Error("Development Azure Table resources are required.");

const credential = new AzureSASCredential(sasToken.replace(/^\?/, ""));
const endpoint = `https://${accountName}.table.core.windows.net`;
const client = new TableClient(endpoint, tableName, credential);
const partitions = [];
const cleanups = [];
const createPartition = async (label, state) => {
  const partitionKey = `codex-storage-${label}-${crypto.randomUUID()}`;
  partitions.push(partitionKey);
  const encoded = productionStateEntity(partitionKey, state);
  await client.createEntity(encoded.entity);
  cleanups.push(() => client.deleteEntity(partitionKey, "registration-state"));
  return { partitionKey, encoded };
};

try {
  const largeState = createStorageForecastState(120, { lifecycleHistory: true });
  const large = await createPartition("roundtrip", largeState);
  const loadedLarge = await client.getEntity(large.partitionKey, "registration-state");
  assert.deepEqual(decodeProductionState(loadedLarge), largeState);
  const smallState = createStorageForecastState(18);
  await client.updateEntity(productionStateEntity(large.partitionKey, smallState).entity, "Replace", { etag: loadedLarge.etag });
  const loadedSmall = await client.getEntity(large.partitionKey, "registration-state");
  assert.deepEqual(decodeProductionState(loadedSmall), smallState);
  assert.equal(Object.hasOwn(loadedSmall, "chunk002"), false);

  const concurrencyState = createProductionBootstrap({ under18EntriesEnabled: true });
  concurrencyState.registrationState = "OPEN";
  concurrencyState.phase3RegistrationState = "OPEN";
  const concurrent = await createPartition("concurrency", concurrencyState);
  let conflicts = 0;
  const makeRepository = () => createAzureTableRepository({
    async loadPartition() {
      const entity = await client.getEntity(concurrent.partitionKey, "registration-state");
      return { state: decodeProductionState(entity), etag: entity.etag };
    },
    async submitTransaction({ after, etag }) {
      await client.updateEntity(productionStateEntity(concurrent.partitionKey, after).entity, "Replace", { etag });
    },
    maximumAttempts: 12,
    telemetry: { info(event) { if (event === "registration_state_write_conflict_retry") conflicts += 1; } }
  });
  const runBatch = async (count, offset) => {
    const started = Date.now();
    const results = await Promise.all(Array.from({ length: count }, (_, index) => {
      const number = offset + index + 1;
      return makeRepository().transaction((state) => {
        const registrationId = `synthetic-concurrent-registration-${number}`;
        if (state.registrations.some((item) => item.id === registrationId)) return { ok: true, duplicate: true };
        const accepted = state.registrations.filter((item) => item.entryStatus === "accepted" && item.placeStatus === "confirmed").length;
        if (accepted >= state.event.capacity) return { ok: false, code: "CAPACITY_REACHED" };
        state.runners.push({ id: `synthetic-concurrent-runner-${number}`, email: `concurrent-${number}@example.invalid` });
        state.registrations.push({ id: registrationId, runnerId: `synthetic-concurrent-runner-${number}`, entryStatus: "accepted", placeStatus: "confirmed" });
        state.auditEvents.push({ id: `synthetic-concurrent-audit-${number}`, action: "synthetic_concurrent_order", subjectId: registrationId, occurredAt: "2026-09-27T12:00:00.000Z" });
        return { ok: true, registrationId };
      });
    }));
    return { attempted: count, succeeded: results.filter((item) => item.ok).length, explicitFailures: results.filter((item) => !item.ok).length, elapsedMs: Date.now() - started };
  };
  const tenWay = await runBatch(10, 0);
  const twentyWay = await runBatch(20, 10);
  const finalEntity = await client.getEntity(concurrent.partitionKey, "registration-state");
  const finalState = validateProductionState(decodeProductionState(finalEntity));
  const ids = finalState.registrations.map((item) => item.id);
  assert.equal(ids.length, 30);
  assert.equal(new Set(ids).size, 30);
  assert.ok(ids.length <= finalState.event.capacity);

  console.log(JSON.stringify({
    storageRoundTrip: "passed",
    multiChunkCount: large.encoded.measurements.chunkCount,
    largestChunkCharacters: large.encoded.measurements.largestChunkCharacters,
    replaceShrink: "passed",
    tenWay,
    twentyWay,
    conflictsRetried: conflicts,
    finalAccepted: ids.length,
    capacity: finalState.event.capacity,
    duplicateOrders: ids.length - new Set(ids).size,
    environment: "development",
    syntheticOnly: true
  }, null, 2));
} finally {
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); } catch { /* best-effort cleanup; caller can use reported partition prefix */ }
  }
}
