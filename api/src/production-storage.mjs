import { gzipSync, gunzipSync } from "node:zlib";
import { AzureSASCredential, TableClient } from "@azure/data-tables";
import { createProductionBootstrap, validateProductionState } from "./shared/server/production-bootstrap.mjs";

const ROW_KEY = "registration-state";
const CHUNK_SIZE = 60_000;

export function encodeProductionState(state) {
  validateProductionState(state);
  const encoded = gzipSync(Buffer.from(JSON.stringify(state))).toString("base64");
  const chunks = [];
  for (let index = 0; index < encoded.length; index += CHUNK_SIZE) chunks.push(encoded.slice(index, index + CHUNK_SIZE));
  if (!chunks.length || chunks.length > 200) throw new Error("Production registration state exceeds its storage limit.");
  return chunks;
}

export function decodeProductionState(entity) {
  const count = Number(entity.chunkCount);
  if (!Number.isInteger(count) || count < 1 || count > 200 || entity.format !== "gzip-json-v1") throw new Error("Stored production registration state is invalid.");
  const encoded = Array.from({ length: count }, (_, index) => entity[`chunk${String(index).padStart(3, "0")}`]).join("");
  return validateProductionState(JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8")));
}

function entityFor(partitionKey, state) {
  const chunks = encodeProductionState(state);
  const entity = { partitionKey, rowKey: ROW_KEY, chunkCount: chunks.length, format: "gzip-json-v1", schemaVersion: state.schemaVersion, environment: "production", operationalState: state.registrationState };
  chunks.forEach((chunk, index) => { entity[`chunk${String(index).padStart(3, "0")}`] = chunk; });
  return entity;
}

export function createProductionAzureTableTransport({ accountName, tableName, sasToken = "", credential = null, partitionKey, under18EntriesEnabled = false }) {
  if (!/^[a-z0-9]{3,24}$/.test(accountName) || /dev|test/i.test(accountName) || !tableName || /development|test/i.test(tableName) || !partitionKey || /dev|test/i.test(partitionKey) || (!sasToken && !credential)) throw new Error("Production storage settings are incomplete or reference development resources.");
  const authentication = credential ?? new AzureSASCredential(sasToken.startsWith("?") ? sasToken.slice(1) : sasToken);
  const client = new TableClient(`https://${accountName}.table.core.windows.net`, tableName, authentication);
  const baseline = () => createProductionBootstrap({ under18EntriesEnabled });

  async function loadPartition() {
    try {
      const entity = await client.getEntity(partitionKey, ROW_KEY);
      return { state: decodeProductionState(entity), etag: entity.etag };
    } catch (error) {
      if (error?.statusCode !== 404) throw error;
      try { await client.createEntity(entityFor(partitionKey, baseline())); }
      catch (createError) { if (createError?.statusCode !== 409) throw createError; }
      const entity = await client.getEntity(partitionKey, ROW_KEY);
      return { state: decodeProductionState(entity), etag: entity.etag };
    }
  }

  async function submitTransaction({ after, etag }) {
    validateProductionState(after);
    await client.updateEntity(entityFor(partitionKey, after), "Replace", { etag });
  }

  return { loadPartition, submitTransaction };
}
