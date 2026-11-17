import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  encryptBackup,
  verifyBackup,
} from "../scripts/production-state-backup.mjs";
import { createProductionBootstrap } from "../registration/server/production-bootstrap.mjs";
import { productionStateEntity } from "../registration/server/production-storage-codec.mjs";
test("encrypted backup validates and restores the exact Table state in isolated memory", async () => {
  const entity = productionStateEntity(
    "blorenge-2026-live",
    createProductionBootstrap(),
  ).entity;
  const key = crypto.randomBytes(32),
    envelope = encryptBackup(entity, key);
  assert.equal(JSON.stringify(envelope).includes("registrationState"), false);
  const result = await verifyBackup(envelope, key);
  assert.equal(result.verified, true);
  assert.equal(result.counts.registrations, 0);
  assert.equal(result.capacity.capacity, 120);
});
test("backup verification rejects corruption and wrong recovery key", async () => {
  const key = crypto.randomBytes(32),
    envelope = encryptBackup(
      productionStateEntity("blorenge-2026-live", createProductionBootstrap())
        .entity,
      key,
    );
  await assert.rejects(verifyBackup(envelope, crypto.randomBytes(32)));
  const data = Buffer.from(envelope.ciphertext, "base64");
  data[0] ^= 1;
  envelope.ciphertext = data.toString("base64");
  await assert.rejects(verifyBackup(envelope, key));
});
