import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  decodeProductionState,
  productionStateEntity,
  PRODUCTION_TABLE_CHUNK_CHARACTERS,
  PRODUCTION_TABLE_SAFE_ENTITY_BYTES
} from "../registration/server/production-storage-codec.mjs";
import { createStorageForecastState } from "../scripts/registration-storage-fixtures.mjs";

test("production codec keeps every string chunk within the safe UTF-16 boundary", () => {
  const { entity, measurements } = productionStateEntity("synthetic-boundary", createStorageForecastState(120, { lifecycleHistory: true }));
  const chunks = Object.entries(entity).filter(([name]) => /^chunk\d{3}$/.test(name)).map(([, value]) => value);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= PRODUCTION_TABLE_CHUNK_CHARACTERS));
  assert.equal(measurements.largestChunkCharacters, PRODUCTION_TABLE_CHUNK_CHARACTERS);
});

test("large multi-chunk production state round trips exactly", () => {
  const expected = createStorageForecastState(120, { lifecycleHistory: true });
  const { entity, measurements } = productionStateEntity("synthetic-round-trip", expected);
  assert.ok(measurements.chunkCount > 1);
  assert.deepEqual(decodeProductionState(entity), expected);
});

test("previous 30k-to-60k single-chunk entity remains readable and rewrites safely", () => {
  const expected = createStorageForecastState(100);
  const legacyEncoded = gzipSync(Buffer.from(JSON.stringify(expected))).toString("base64");
  assert.ok(legacyEncoded.length > 30_000 && legacyEncoded.length < 60_000);
  const legacy = { chunkCount: 1, format: "gzip-json-v1", chunk000: legacyEncoded };
  assert.deepEqual(decodeProductionState(legacy), expected);
  const rewritten = productionStateEntity("synthetic-compatibility", decodeProductionState(legacy));
  assert.ok(rewritten.measurements.chunkCount > 1);
  assert.deepEqual(decodeProductionState(rewritten.entity), expected);
});

test("Replace payload for a shrinking state contains no stale chunk properties", () => {
  const large = productionStateEntity("synthetic-shrink", createStorageForecastState(120, { lifecycleHistory: true }));
  const small = productionStateEntity("synthetic-shrink", createStorageForecastState(18));
  assert.ok(large.measurements.chunkCount > small.measurements.chunkCount);
  for (let index = small.measurements.chunkCount; index < large.measurements.chunkCount; index += 1) {
    assert.equal(Object.hasOwn(small.entity, `chunk${String(index).padStart(3, "0")}`), false);
  }
  assert.deepEqual(decodeProductionState(small.entity), createStorageForecastState(18));
});

test("entity-size guard rejects state before the conservative service ceiling", () => {
  const oversized = createStorageForecastState(120, { lifecycleHistory: true });
  for (let index = 0; index < 8_000; index += 1) {
    const entropy = Array.from({ length: 4 }, (_, part) => createHash("sha256").update(`oversized-fixture:${index}:${part}`).digest("hex")).join("");
    oversized.auditEvents.push({ id: `oversized-${index}`, action: "synthetic_retained_history", at: "2026-09-27T12:00:00.000Z", detail: entropy });
  }
  assert.throws(() => productionStateEntity("synthetic-oversized", oversized), /conservative entity-size limit/);

  const forecast = productionStateEntity("synthetic-safe", createStorageForecastState(120, { lifecycleHistory: true }));
  assert.ok(forecast.measurements.estimatedEntityBytes < PRODUCTION_TABLE_SAFE_ENTITY_BYTES);
  assert.ok(forecast.measurements.entityPropertyCount < 255);
});
