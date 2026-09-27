import { gzipSync, gunzipSync } from "node:zlib";
import { validateProductionState } from "./production-bootstrap.mjs";

export const PRODUCTION_TABLE_CHUNK_CHARACTERS = 30_000;
export const PRODUCTION_TABLE_MAX_PROPERTIES = 255;
export const PRODUCTION_TABLE_AZURE_ENTITY_BYTES = 1024 * 1024;
// Deliberately stop at 75% of Azure's documented 1 MiB entity limit.
export const PRODUCTION_TABLE_SAFE_ENTITY_BYTES = 768 * 1024;
export const PRODUCTION_TABLE_MAX_CHUNKS = 200;

const ROW_KEY = "registration-state";
const utf16Bytes = (value) => String(value).length * 2;

function estimatePropertyBytes(name, value) {
  // Includes UTF-16 names/values plus deliberately conservative per-property
  // serialization/service overhead. It is a guardrail, not a billing measure.
  return utf16Bytes(name) + (typeof value === "string" ? utf16Bytes(value) : 16) + 128;
}

export function storageHeadroomLevel(percent) {
  if (percent >= 85) return "urgent";
  if (percent >= 75) return "warning";
  if (percent >= 60) return "information";
  return "healthy";
}

export function measureProductionEntityMetadata(entity) {
  const count = Number(entity.chunkCount);
  if (!Number.isInteger(count) || count < 1 || count > PRODUCTION_TABLE_MAX_CHUNKS || entity.format !== "gzip-json-v1") {
    throw new Error("Stored production registration state metadata is invalid.");
  }
  const chunks = Array.from({ length: count }, (_, index) => entity[`chunk${String(index).padStart(3, "0")}`]);
  if (chunks.some((chunk) => typeof chunk !== "string" || !chunk.length)) {
    throw new Error("Stored production registration state metadata is missing a chunk.");
  }
  const entityPropertyCount = Object.keys(entity).filter((key) => !key.startsWith("odata.") && key !== "etag").length + (entity.Timestamp || entity.timestamp ? 0 : 1);
  const estimatedEntityBytes = 512 + Object.entries(entity)
    .filter(([name]) => !name.startsWith("odata.") && name !== "etag")
    .reduce((total, [name, value]) => total + estimatePropertyBytes(name, value), 0);
  const totalEncodedCharacters = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const storageHeadroomPercent = Number(((estimatedEntityBytes / PRODUCTION_TABLE_SAFE_ENTITY_BYTES) * 100).toFixed(2));
  return {
    totalEncodedCharacters,
    chunkCount: count,
    largestChunkCharacters: Math.max(...chunks.map((chunk) => chunk.length)),
    chunkLengths: chunks.map((chunk) => chunk.length),
    estimatedUtf16ChunkBytes: totalEncodedCharacters * 2,
    estimatedEntityBytes,
    entityPropertyCount,
    storageHeadroomPercent,
    storageHeadroomLevel: storageHeadroomLevel(storageHeadroomPercent)
  };
}

export function productionStateEntity(partitionKey, state) {
  validateProductionState(state);
  const compressed = gzipSync(Buffer.from(JSON.stringify(state)));
  const encoded = compressed.toString("base64");
  const chunks = [];
  for (let index = 0; index < encoded.length; index += PRODUCTION_TABLE_CHUNK_CHARACTERS) {
    chunks.push(encoded.slice(index, index + PRODUCTION_TABLE_CHUNK_CHARACTERS));
  }
  if (!chunks.length || chunks.length > PRODUCTION_TABLE_MAX_CHUNKS) {
    throw new Error("Production registration state exceeds its storage chunk limit.");
  }
  if (chunks.some((chunk) => chunk.length > PRODUCTION_TABLE_CHUNK_CHARACTERS)) {
    throw new Error("Production registration state exceeds its string-property limit.");
  }

  const entity = {
    partitionKey,
    rowKey: ROW_KEY,
    chunkCount: chunks.length,
    format: "gzip-json-v1",
    schemaVersion: state.schemaVersion,
    environment: "production",
    operationalState: state.registrationState
  };
  chunks.forEach((chunk, index) => { entity[`chunk${String(index).padStart(3, "0")}`] = chunk; });

  const measured = measureProductionEntityMetadata(entity);
  const { entityPropertyCount, estimatedEntityBytes, storageHeadroomPercent } = measured;
  if (entityPropertyCount > PRODUCTION_TABLE_MAX_PROPERTIES) {
    throw new Error("Production registration state exceeds its property-count limit.");
  }
  if (estimatedEntityBytes >= PRODUCTION_TABLE_SAFE_ENTITY_BYTES) {
    throw new Error("Production registration state exceeds its conservative entity-size limit.");
  }

  return {
    entity,
    measurements: {
      compressedJsonBytes: compressed.length,
      ...measured
    }
  };
}

export function encodeProductionState(state) {
  return productionStateEntity("measurement-only", state).measurements;
}

export function decodeProductionState(entity) {
  const count = Number(entity.chunkCount);
  if (!Number.isInteger(count) || count < 1 || count > PRODUCTION_TABLE_MAX_CHUNKS || entity.format !== "gzip-json-v1") {
    throw new Error("Stored production registration state is invalid.");
  }
  const chunks = Array.from({ length: count }, (_, index) => entity[`chunk${String(index).padStart(3, "0")}`]);
  if (chunks.some((chunk) => typeof chunk !== "string" || !chunk.length)) {
    throw new Error("Stored production registration state is missing a chunk.");
  }
  return validateProductionState(JSON.parse(gunzipSync(Buffer.from(chunks.join(""), "base64")).toString("utf8")));
}
