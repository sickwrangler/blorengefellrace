import { AzureSASCredential, TableClient } from "@azure/data-tables";
import { applyProductionRuntimeConfiguration, createProductionBootstrap, validateProductionState } from "./shared/server/production-bootstrap.mjs";
import { decodeProductionState, measureProductionEntityMetadata, productionStateEntity } from "./shared/server/production-storage-codec.mjs";

const ROW_KEY = "registration-state";

export function createProductionAzureTableTransport({ accountName, tableName, sasToken = "", credential = null, partitionKey, under18EntriesEnabled = false, telemetry = console }) {
  if (!/^[a-z0-9]{3,24}$/.test(accountName) || /dev|test/i.test(accountName) || !tableName || /development|test/i.test(tableName) || !partitionKey || /dev|test/i.test(partitionKey) || (!sasToken && !credential)) throw new Error("Production storage settings are incomplete or reference development resources.");
  const authentication = credential ?? new AzureSASCredential(sasToken.startsWith("?") ? sasToken.slice(1) : sasToken);
  const client = new TableClient(`https://${accountName}.table.core.windows.net`, tableName, authentication);
  const baseline = () => createProductionBootstrap({ under18EntriesEnabled });

  async function loadPartition() {
    try {
      const entity = await client.getEntity(partitionKey, ROW_KEY);
      return { state: applyProductionRuntimeConfiguration(decodeProductionState(entity), { under18EntriesEnabled }), etag: entity.etag };
    } catch (error) {
      if (error?.statusCode !== 404) throw error;
      try { await client.createEntity(productionStateEntity(partitionKey, baseline()).entity); }
      catch (createError) { if (createError?.statusCode !== 409) throw createError; }
      const entity = await client.getEntity(partitionKey, ROW_KEY);
      return { state: applyProductionRuntimeConfiguration(decodeProductionState(entity), { under18EntriesEnabled }), etag: entity.etag };
    }
  }

  async function submitTransaction({ after, etag }) {
    validateProductionState(after);
    const encoded = productionStateEntity(partitionKey, after);
    const { chunkLengths: _chunkLengths, compressedJsonBytes: _compressedJsonBytes, ...safeMeasurements } = encoded.measurements;
    try {
      await client.updateEntity(encoded.entity, "Replace", { etag });
      telemetry.info?.("registration_state_write_succeeded", { environment: "production", ...safeMeasurements });
    } catch (error) {
      const conflict = error?.statusCode === 409 || error?.statusCode === 412;
      const event = conflict ? "registration_state_write_conflict" : "registration_state_write_failed";
      const log = conflict ? telemetry.info : telemetry.error;
      log?.call(telemetry, event, {
        environment: "production",
        operationCategory: "table_replace",
        statusCode: Number(error?.statusCode) || null,
        errorCategory: String(error?.code || error?.name || "storage_error").slice(0, 80),
        ...safeMeasurements
      });
      throw error;
    }
  }

  async function storageMetadata() {
    const entity = await client.getEntity(partitionKey, ROW_KEY);
    return measureProductionEntityMetadata(entity);
  }

  return { loadPartition, submitTransaction, storageMetadata };
}
