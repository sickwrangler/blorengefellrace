#!/usr/bin/env node
// Offline encrypted backup/restore verification. No cloud clients or production writes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { decodeProductionState } from "../registration/server/production-storage-codec.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { capacitySummary } from "../registration/server/phase3-domain.mjs";
const format = "blorenge-encrypted-table-backup-v1";
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export function encryptBackup(entity, key) {
  const state = decodeProductionState(entity);
  const payload = {
    createdAt: new Date().toISOString(),
    entity,
    entityChecksum: digest(JSON.stringify(entity)),
    stateChecksum: digest(JSON.stringify(state)),
  };
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(format));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]);
  return {
    format,
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
export async function verifyBackup(envelope, key) {
  if (envelope.format !== format) throw new Error("Backup format invalid");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.nonce, "base64"),
  );
  decipher.setAAD(Buffer.from(format));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const payload = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString(),
  );
  if (digest(JSON.stringify(payload.entity)) !== payload.entityChecksum)
    throw new Error("Entity checksum invalid");
  const state = decodeProductionState(payload.entity);
  const repository = createMemoryRepository(state);
  // Exercise the repository restore contract only in isolated memory.
  await repository.restore(await repository.backup());
  if (digest(JSON.stringify(await repository.read())) !== payload.stateChecksum)
    throw new Error("State restore checksum invalid");
  return {
    verified: true,
    createdAt: payload.createdAt,
    sourceTimestamp: payload.entity.Timestamp ?? payload.entity.timestamp,
    sourceEtag: payload.entity.etag ?? payload.entity["odata.etag"] ?? null,
    stateChecksum: payload.stateChecksum,
    entityChecksum: payload.entityChecksum,
    capacity: capacitySummary(state),
    counts: Object.fromEntries(
      [
        "registrations",
        "payments",
        "orders",
        "waitingList",
        "waitingListOffers",
        "auditEvents",
        "processedPaymentEvents",
        "emailOutbox",
        "communications",
      ].map((k) => [k, state[k]?.length ?? 0]),
    ),
  };
}
async function main() {
  const [mode, backupPath, keyPath] = process.argv.slice(2);
  if (!["create", "verify"].includes(mode) || !backupPath || !keyPath)
    throw new Error("Usage: create|verify backupPath keyPath");
  if (mode === "create") {
    const key = crypto.randomBytes(32);
    const entity = JSON.parse(fs.readFileSync(0, "utf8"));
    const envelope = encryptBackup(entity, key);
    await verifyBackup(envelope, key);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyPath, key, { mode: 0o600, flag: "wx" });
    fs.writeFileSync(backupPath, JSON.stringify(envelope), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const verified = await verifyBackup(
    JSON.parse(fs.readFileSync(backupPath, "utf8")),
    fs.readFileSync(keyPath),
  );
  console.log(
    JSON.stringify(
      {
        ...verified,
        encryptedBackupSha256: digest(fs.readFileSync(backupPath)),
      },
      null,
      2,
    ),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error("Backup operation failed", { category: error.name });
    process.exitCode = 1;
  });
