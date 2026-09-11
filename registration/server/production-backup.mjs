import crypto from "node:crypto";
import { validateProductionState } from "./production-bootstrap.mjs";

const digest = (content) => crypto.createHash("sha256").update(content).digest("hex");
const iso = (value = new Date()) => new Date(value).toISOString();

export const PRODUCTION_BACKUP_POLICY = Object.freeze({
  preLaunch: "manual-required",
  beforeSignificantChange: "manual-required",
  operationalDailyHourUtc: 2,
  preRace: "manual-required",
  automaticDeletion: false
});

export function operationalDailyBackupDue(state, lastSnapshotAt, at = new Date()) {
  validateProductionState(state);
  if (!["PRIVATE_LIVE", "OPEN", "PAUSED"].includes(state.registrationState)) return false;
  const current = new Date(at);
  if (!Number.isFinite(current.valueOf()) || current.getUTCHours() < PRODUCTION_BACKUP_POLICY.operationalDailyHourUtc) return false;
  if (!lastSnapshotAt) return true;
  const previous = new Date(lastSnapshotAt);
  return !Number.isFinite(previous.valueOf()) || previous.toISOString().slice(0, 10) !== current.toISOString().slice(0, 10);
}

export function createProductionBackupService({ stateTransport, blobTransport, reconcilePayments }) {
  if (!stateTransport?.loadPartition || !stateTransport?.submitTransaction || !blobTransport?.put || !blobTransport?.get || !blobTransport?.list) throw new Error("Production backup transports are incomplete.");
  return Object.freeze({
    async createSnapshot({ reason, at = new Date() }) {
      if (!String(reason ?? "").trim()) throw new Error("A backup reason is required.");
      const snapshot = await stateTransport.loadPartition(); validateProductionState(snapshot.state);
      const stateJson = JSON.stringify(snapshot.state); const checksum = digest(stateJson);
      const createdAt = iso(at); const name = `${createdAt.replaceAll(":", "-")}-${crypto.randomUUID()}.json`;
      await blobTransport.put(name, JSON.stringify({ format: "blorenge-registration-backup-v1", createdAt, reason: String(reason).trim(), sourceEtag: snapshot.etag, schemaVersion: snapshot.state.schemaVersion, checksum, state: snapshot.state }), { ifNoneMatch: "*" });
      return { name, createdAt, reason: String(reason).trim(), sourceEtag: snapshot.etag, schemaVersion: snapshot.state.schemaVersion, checksum };
    },
    async listSnapshots() {
      const items = await blobTransport.list();
      return items.map(({ name, createdAt, reason, schemaVersion, checksum }) => ({ name, createdAt, reason, schemaVersion, checksum }));
    },
    async validateSnapshot(name) {
      const parsed = JSON.parse(await blobTransport.get(name));
      if (parsed.format !== "blorenge-registration-backup-v1" || parsed.checksum !== digest(JSON.stringify(parsed.state))) throw new Error("Backup checksum or format is invalid.");
      validateProductionState(parsed.state);
      return { valid: true, name, createdAt: parsed.createdAt, reason: parsed.reason, schemaVersion: parsed.schemaVersion, checksum: parsed.checksum, state: parsed.state };
    },
    async restoreSnapshot(name, controls) {
      if (controls?.confirmation !== `RESTORE ${name}` || controls?.writesSuspended !== true || controls?.schedulerSuspended !== true) throw new Error("Controlled restore prerequisites are incomplete.");
      const current = await stateTransport.loadPartition(); validateProductionState(current.state);
      if (current.state.registrationState !== "CLOSED" || current.state.phase3RegistrationState !== "CLOSED") throw new Error("Production must be CLOSED before restore.");
      const backup = await this.validateSnapshot(name);
      if (backup.state.registrationState !== "CLOSED" || backup.state.phase3RegistrationState !== "CLOSED") throw new Error("Only a CLOSED snapshot can be restored.");
      if (typeof reconcilePayments !== "function" || await reconcilePayments(backup.state) !== true) throw new Error("Stripe/payment reconciliation approval is required before restore.");
      await stateTransport.submitTransaction({ before: current.state, after: backup.state, etag: current.etag });
      return { restored: true, name, restoredAt: iso(), previousEtag: current.etag, checksum: backup.checksum };
    }
  });
}
