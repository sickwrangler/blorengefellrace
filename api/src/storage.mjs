import { gzipSync, gunzipSync } from "node:zlib";
import { AzureSASCredential, TableClient } from "@azure/data-tables";
import { createDatabase } from "./shared/server/service.mjs";

const ROW_KEY = "registration-state";
const CHUNK_SIZE = 60_000;

export function encodeState(state) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(state))).toString("base64");
  const chunks = [];
  for (let index = 0; index < compressed.length; index += CHUNK_SIZE) chunks.push(compressed.slice(index, index + CHUNK_SIZE));
  if (chunks.length > 200) throw new Error("Synthetic registration state exceeds the development storage limit.");
  return chunks;
}

export function decodeState(entity) {
  const count = Number(entity.chunkCount);
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error("Stored synthetic registration state is invalid.");
  const encoded = Array.from({ length: count }, (_, index) => entity[`chunk${String(index).padStart(3, "0")}`]).join("");
  return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
}

function entityFor(partitionKey, state) {
  const chunks = encodeState(state);
  const entity = { partitionKey, rowKey: ROW_KEY, chunkCount: chunks.length, format: "gzip-json-v1" };
  chunks.forEach((chunk, index) => { entity[`chunk${String(index).padStart(3, "0")}`] = chunk; });
  return entity;
}

export function createAzureTableTransport({ accountName, tableName, sasToken, partitionKey }) {
  if (!/^[a-z0-9]{3,24}$/.test(accountName) || !tableName || !sasToken || !partitionKey) throw new Error("Registration storage settings are incomplete.");
  const token = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;
  const client = new TableClient(`https://${accountName}.table.core.windows.net`, tableName, new AzureSASCredential(token));
  const baseline = () => createDatabase({ environment: "development", registrationState: "test" });

  async function loadPartition() {
    try {
      const entity = await client.getEntity(partitionKey, ROW_KEY);
      return { state: decodeState(entity), etag: entity.etag };
    } catch (error) {
      if (error?.statusCode !== 404) throw error;
      try { await client.createEntity(entityFor(partitionKey, baseline())); }
      catch (createError) { if (createError?.statusCode !== 409) throw createError; }
      const entity = await client.getEntity(partitionKey, ROW_KEY);
      return { state: decodeState(entity), etag: entity.etag };
    }
  }

  async function submitTransaction({ after, etag }) {
    if (after.environment !== "development" || after.registrationState === "open") throw new Error("Unsafe registration state rejected.");
    await client.updateEntity(entityFor(partitionKey, after), "Replace", { etag });
  }

  return { loadPartition, submitTransaction };
}
