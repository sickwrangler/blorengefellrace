import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "../api/node_modules/exceljs/excel.js";
import { createPrivateRegistrationWorkbook } from "../api/src/private-workbook.mjs";
import { buildPrivateWorkbookModel, buildTransferHistory } from "../registration/server/private-export.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";
import { ProductionRegistrationService } from "../registration/server/production-service.mjs";
import { createProductionApi } from "../registration/server/production-api.mjs";

const organiser = { authenticated: true, role: "organiser", actorType: "entra_organiser", id: "synthetic-organiser" };
const anonymous = { authenticated: false, role: null, actorType: "anonymous" };
const emailAdapter = { kind: "disabled", externalDelivery: false };

function state() {
  return {
    schemaVersion: 3,
    environment: "production",
    registrationState: "OPEN",
    event: { id: "blorenge-2026", name: "Blorenge Fell Race 2026", raceDate: "2026-11-28", capacity: 120, entryFeePence: 600 },
    runners: [
      { id: "runner-original", firstName: "Dafydd", lastName: "Jones", email: "dafydd@example.invalid" },
      { id: "runner-middle", firstName: "Tomos", lastName: "Evans", email: "tomos@example.invalid" },
      { id: "runner-current", firstName: "Sara", lastName: "Williams", email: "sara@example.invalid", phone: "07000 000003", dateOfBirth: "1990-05-20", raceCategory: "Female", genderCategory: "Female", club: "Example Harriers", wfraMember: true, wfraMembershipNumber: "SYN-123" }
    ],
    emergencyContacts: [{ id: "emergency-1", registrationId: "registration-1", name: "Synthetic Contact", phone: "07000 000004" }],
    registrations: [{ id: "registration-1", testReference: "BFR-SYNTHETIC", runnerId: "runner-current", entryStatus: "accepted", placeStatus: "confirmed", declarationStatus: "pending", priceActuallyChargedPence: 400, raceNumber: 21, createdAt: "2026-09-28T09:00:00Z", updatedAt: "2026-10-02T11:00:00Z" }],
    payments: [{ id: "payment-1", registrationIds: ["registration-1"], status: "paid", actualPaidAmountPence: 400, currency: "gbp", refundState: "not_requested", refundedRegistrationIds: [] }],
    declarations: [], consents: [], orders: [], communications: [], refundRequests: [], privateInvitations: [], waitingList: [], waitingListOffers: [],
    auditEvents: [
      { id: "audit-unrelated", action: "runner_details_amended", subjectId: "registration-1", occurredAt: "2026-09-29T10:00:00Z", actorType: "runner" },
      { id: "audit-transfer-2", action: "organiser_entry_transferred", subjectId: "registration-1", occurredAt: "2026-10-02T11:00:00Z", actorType: "entra_organiser", before: { runnerId: "runner-middle" }, after: { runnerId: "runner-current", cutoffOverride: true } },
      { id: "audit-transfer-1", action: "entry_transferred", subjectId: "registration-1", occurredAt: "2026-10-01T10:00:00Z", actorType: "runner", before: { runnerId: "runner-original" }, after: { runnerId: "runner-middle", cutoffOverride: false } }
    ]
  };
}

const cloneState = () => structuredClone(state());

test("private export leaves transfer fields blank when a registration has no transfers", () => {
  const source = cloneState();
  source.registrations[0].runnerId = "runner-original";
  source.auditEvents = source.auditEvents.filter((event) => event.action === "runner_details_amended");
  const [entry] = buildPrivateWorkbookModel(source).currentEntries;
  assert.deepEqual({
    current: `${entry.firstName} ${entry.lastName}`,
    transferred: entry.transferred,
    count: entry.transferCount,
    original: entry.originalRunnerName,
    previous: entry.previousRunnerName,
    history: buildTransferHistory(source).length
  }, { current: "Dafydd Jones", transferred: "No", count: 0, original: "", previous: "", history: 0 });
});
test("private export reconstructs a single runner transfer", () => {
  const source = cloneState();
  source.registrations[0].runnerId = "runner-middle";
  source.auditEvents = source.auditEvents.filter((event) => event.id === "audit-transfer-1" || event.id === "audit-unrelated");
  const model = buildPrivateWorkbookModel(source);
  const [entry] = model.currentEntries;
  assert.deepEqual({
    current: `${entry.firstName} ${entry.lastName}`,
    transferred: entry.transferred,
    count: entry.transferCount,
    original: entry.originalRunnerName,
    previous: entry.previousRunnerName
  }, { current: "Tomos Evans", transferred: "Yes", count: 1, original: "Dafydd Jones", previous: "Dafydd Jones" });
  assert.equal(model.transferHistory.length, 1);
  assert.equal(model.transferHistory[0].initiatedBy, "Runner");
});

test("private export reconstructs a chronological multi-transfer chain from audit events only", () => {
  const source = state();
  const history = buildTransferHistory(source);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((event) => [event.sequence, event.fromRunnerName, event.toRunnerName, event.initiatedBy, event.cutoffOverride]), [
    [1, "Dafydd Jones", "Tomos Evans", "Runner", "No"],
    [2, "Tomos Evans", "Sara Williams", "Organiser", "Yes"]
  ]);
  const model = buildPrivateWorkbookModel(source, new Date("2026-10-22T08:30:00Z"));
  assert.equal(model.currentEntries.length, 1);
  assert.deepEqual({ current: `${model.currentEntries[0].firstName} ${model.currentEntries[0].lastName}`, transferred: model.currentEntries[0].transferred, count: model.currentEntries[0].transferCount, original: model.currentEntries[0].originalRunnerName, previous: model.currentEntries[0].previousRunnerName }, { current: "Sara Williams", transferred: "Yes", count: 2, original: "Dafydd Jones", previous: "Tomos Evans" });
  assert.deepEqual({ registrations: model.summary.registrationsEverTransferred, events: model.summary.totalTransferEvents, pending: model.summary.pendingDeclarations }, { registrations: 1, events: 2, pending: 1 });
});

test("private export ignores malformed and non-transfer audit events", () => {
  const source = cloneState();
  source.auditEvents = [
    { id: "valid-a-b", action: "entry_transferred", subjectId: "registration-1", occurredAt: "2026-10-01T10:00:00Z", before: { runnerId: "runner-original" }, after: { runnerId: "runner-middle" } },
    { id: "missing-both", action: "entry_transferred", subjectId: "registration-1", occurredAt: "2026-10-01T10:01:00Z", before: {}, after: {} },
    { id: "missing-before", action: "entry_transferred", subjectId: "registration-1", occurredAt: "2026-10-01T10:02:00Z", before: {}, after: { runnerId: "runner-current" } },
    { id: "missing-after", action: "organiser_entry_transferred", subjectId: "registration-1", occurredAt: "2026-10-01T10:03:00Z", before: { runnerId: "runner-middle" }, after: {} },
    { id: "blank-before", action: "entry_transferred", subjectId: "registration-1", occurredAt: "2026-10-01T10:04:00Z", before: { runnerId: "   " }, after: { runnerId: "runner-current" } },
    { id: "identical", action: "organiser_entry_transferred", subjectId: "registration-1", occurredAt: "2026-10-01T10:05:00Z", before: { runnerId: "runner-middle" }, after: { runnerId: "runner-middle" } },
    { id: "missing-registration", action: "entry_transferred", occurredAt: "2026-10-01T10:06:00Z", before: { runnerId: "runner-middle" }, after: { runnerId: "runner-current" } },
    { id: "unrelated", action: "runner_details_amended", subjectId: "registration-1", occurredAt: "2026-10-01T10:07:00Z", before: { runnerId: "runner-middle" }, after: { runnerId: "runner-current" } }
  ];

  const history = buildTransferHistory(source);
  assert.deepEqual(history.map((event) => event.auditEventId), ["valid-a-b"]);
  assert.deepEqual(history.map((event) => [event.fromRunnerId, event.toRunnerId]), [["runner-original", "runner-middle"]]);
});

test("private export handles a missing historical runner without failing or inventing contact data", () => {
  const source = state(); source.runners = source.runners.filter((runner) => runner.id !== "runner-original");
  const [first] = buildTransferHistory(source);
  assert.equal(first.fromRunnerName, "Historical runner record unavailable");
  assert.equal(first.fromRunnerEmail, "");
});

test("private export preserves inactive and refunded states and uses only the current declaration", () => {
  const source = cloneState();
  const base = source.registrations[0];
  source.runners.push(
    { id: "runner-cancelled", firstName: "Cancelled", lastName: "Runner", email: "cancelled@example.invalid" },
    { id: "runner-released", firstName: "Released", lastName: "Runner", email: "released@example.invalid" },
    { id: "runner-refunded", firstName: "Refunded", lastName: "Runner", email: "refunded@example.invalid" }
  );
  source.registrations.push(
    { ...base, id: "registration-cancelled", testReference: "BFR-CANCELLED", runnerId: "runner-cancelled", entryStatus: "cancelled", raceNumber: null },
    { ...base, id: "registration-released", testReference: "BFR-RELEASED", runnerId: "runner-released", entryStatus: "place_released", placeStatus: "released", raceNumber: null },
    { ...base, id: "registration-refunded", testReference: "BFR-REFUNDED", runnerId: "runner-refunded", entryStatus: "accepted", raceNumber: null }
  );
  source.payments.push(
    { id: "payment-cancelled", registrationId: "registration-cancelled", status: "paid", currency: "gbp" },
    { id: "payment-released", registrationId: "registration-released", status: "paid", currency: "gbp" },
    { id: "payment-refunded", registrationId: "registration-refunded", status: "refunded", currency: "gbp", refundState: "refunded" }
  );
  source.declarations.push(
    { id: "old-declaration", registrationId: "registration-1", revokedAt: "2026-10-01T10:00:00Z" },
    { id: "cancelled-declaration", registrationId: "registration-cancelled" },
    { id: "released-declaration", registrationId: "registration-released" },
    { id: "refunded-declaration", registrationId: "registration-refunded" }
  );
  const entries = Object.fromEntries(buildPrivateWorkbookModel(source).currentEntries.map((entry) => [entry.entryReference, entry]));
  assert.deepEqual([entries["BFR-CANCELLED"].entryStatus, entries["BFR-CANCELLED"].clearedToStart], ["cancelled", "No"]);
  assert.deepEqual([entries["BFR-RELEASED"].placeStatus, entries["BFR-RELEASED"].clearedToStart], ["released", "No"]);
  assert.deepEqual([entries["BFR-REFUNDED"].paymentStatus, entries["BFR-REFUNDED"].refundState, entries["BFR-REFUNDED"].clearedToStart], ["refunded", "refunded", "No"]);
  assert.deepEqual([entries["BFR-SYNTHETIC"].declarationStatus, entries["BFR-SYNTHETIC"].clearedToStart], ["pending", "No"]);
  source.declarations.push({ id: "current-declaration", registrationId: "registration-1" });
  const current = buildPrivateWorkbookModel(source).currentEntries.find((entry) => entry.entryReference === "BFR-SYNTHETIC");
  assert.deepEqual([current.firstName, current.declarationStatus, current.clearedToStart], ["Sara", "complete", "Yes"]);
});

test("private export omits credentials, secure tokens and unnecessary transfer details", async () => {
  const source = cloneState();
  const forbidden = ["management-secret", "declaration-secret", "private-invite-secret", "stripe-secret", "acs-secret", "azure-secret", "bearer-secret"];
  source.managementTokens = [{ tokenHash: forbidden[0] }];
  source.declarationTokens = [{ tokenHash: forbidden[1] }];
  source.privateInvitations = [{ tokenHash: forbidden[2] }];
  source.providerSecrets = { stripe: forbidden[3], acs: forbidden[4], azure: forbidden[5], authorization: forbidden[6] };
  const model = buildPrivateWorkbookModel(source);
  const serialized = JSON.stringify(model);
  for (const value of forbidden) assert.doesNotMatch(serialized, new RegExp(value));

  const repository = createMemoryRepository(source);
  const service = new ProductionRegistrationService({ repository, emailAdapter });
  const snapshot = await service.snapshot(organiser);
  const transfer = snapshot.state.registrations[0].transfer;
  assert.deepEqual(Object.keys(transfer).sort(), ["count", "latestAt", "latestCutoffOverride", "latestInitiatedBy", "originalRunnerName", "previousRunnerName", "transferred"].sort());
  assert.equal(snapshot.state.auditEvents.length, 0);
  assert.equal("fromRunnerEmail" in transfer, false);
  assert.equal("toRunnerEmail" in transfer, false);
  assert.equal("fromRunnerId" in transfer, false);
  assert.equal("toRunnerId" in transfer, false);
});

test("private workbook contains the requested sheets, typed values, filters and frozen headers", async () => {
  const model = buildPrivateWorkbookModel(state(), new Date("2026-10-22T08:30:00Z"));
  const bytes = await createPrivateRegistrationWorkbook(model);
  assert.ok(bytes.length > 5_000);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Summary", "Current Entries", "Transfer History"]);
  const entries = workbook.getWorksheet("Current Entries");
  assert.equal(entries.getCell("A1").value, "PRIVATE OPERATIONAL DATA");
  assert.equal(entries.getCell("A4").value, "Entry reference");
  assert.equal(entries.getCell("A5").value, "BFR-SYNTHETIC");
  assert.ok(entries.getCell("H5").value instanceof Date);
  assert.equal(entries.getCell("T5").value, 4);
  assert.equal(entries.getCell("T5").numFmt, "£#,##0.00");
  assert.equal(entries.views[0].ySplit, 4);
  assert.equal(entries.views[0].xSplit, 3);
  assert.ok(entries.autoFilter);
  assert.equal(entries.rowCount, model.currentEntries.length + 4);
  const transfers = workbook.getWorksheet("Transfer History");
  assert.equal(transfers.rowCount, 6);
  assert.equal(transfers.rowCount, model.transferHistory.length + 4);
  assert.equal(transfers.getCell("E5").value, 1);
  assert.equal(transfers.getCell("E6").value, 2);
  assert.ok(transfers.getCell("D5").value instanceof Date);
});

test("private workbook keeps every formula-shaped runner value as literal text", async () => {
  const source = cloneState();
  const runner = source.runners.find((item) => item.id === "runner-current");
  const original = source.runners.find((item) => item.id === "runner-original");
  Object.assign(runner, { firstName: "=1+1", lastName: "+2+2", club: "-3+3" });
  Object.assign(original, { firstName: "=ORIGINAL", email: "+original@example.invalid" });
  source.emergencyContacts[0].name = "@SUM(1,1)";
  const bytes = await createPrivateRegistrationWorkbook(buildPrivateWorkbookModel(source));
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  const entries = workbook.getWorksheet("Current Entries");
  for (const [address, expected] of [["D5", "=1+1"], ["E5", "+2+2"], ["J5", "-3+3"], ["M5", "@SUM(1,1)"]]) {
    const cell = entries.getCell(address);
    assert.equal(cell.value, expected);
    assert.equal(cell.formula, undefined);
  }
  const transfers = workbook.getWorksheet("Transfer History");
  for (const [address, expected] of [["F5", "=ORIGINAL Jones"], ["G5", "+original@example.invalid"]]) {
    const cell = transfers.getCell(address);
    assert.equal(cell.value, expected);
    assert.equal(cell.formula, undefined);
  }
});

test("private workbook remains organiser-only and the existing race-day CSV stays unchanged", async () => {
  const repository = createMemoryRepository(state());
  const service = new ProductionRegistrationService({ repository, emailAdapter });
  assert.deepEqual(await service.exportPrivateWorkbook(anonymous), { ok: false, code: "FORBIDDEN" });
  const snapshot = await service.snapshot(organiser);
  assert.deepEqual(snapshot.state.registrations[0].transfer, { transferred: true, count: 2, originalRunnerName: "Dafydd Jones", previousRunnerName: "Tomos Evans", latestAt: new Date("2026-10-02T11:00:00Z"), latestInitiatedBy: "Organiser", latestCutoffOverride: "Yes" });
  const publicCsv = await service.exportPublic(organiser);
  assert.equal(publicCsv.filename, "registration-race-management.csv");
  assert.equal(publicCsv.csv, '"entry_reference","race_number","first_name","last_name","club","category","entry_status","payment_status"\n"BFR-SYNTHETIC","21","Sara","Williams","Example Harriers","Female","accepted","successful"');

  const principal = Buffer.from(JSON.stringify({ userId: "synthetic-organiser", userRoles: ["authenticated", "organiser"] })).toString("base64");
  const api = createProductionApi({ service, phase3Integrations: {}, repository, privateWorkbookExporter: createPrivateRegistrationWorkbook });
  const denied = await api({ method: "GET", pathname: "/api/v2/organiser/export/private-workbook", headers: {} });
  assert.equal(denied.status, 403);
  const allowed = await api({ method: "GET", pathname: "/api/v2/organiser/export/private-workbook", headers: { "x-ms-client-principal": principal } });
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers["content-type"], /spreadsheetml/);
  assert.match(allowed.headers["content-disposition"], /^attachment; filename="blorenge-registration-private-\d{4}-\d{2}-\d{2}\.xlsx"$/);
  assert.equal(allowed.headers["cache-control"], "no-store");
  assert.equal(allowed.headers["x-content-type-options"], "nosniff");
  assert.ok(Buffer.isBuffer(allowed.body));
});

test("ordinary API routes do not invoke the lazy workbook exporter", async () => {
  const repository = createMemoryRepository(state());
  const service = new ProductionRegistrationService({ repository, emailAdapter });
  let workbookExportCount = 0;
  const lazyExporter = async (model) => {
    workbookExportCount += 1;
    const { createPrivateRegistrationWorkbook: exportWorkbook } = await import("../api/src/private-workbook.mjs");
    return exportWorkbook(model);
  };
  const api = createProductionApi({ service, phase3Integrations: {}, repository, privateWorkbookExporter: lazyExporter });
  const status = await api({ method: "GET", pathname: "/api/v2/registration/status" });
  assert.equal(status.status, 200);
  assert.equal(workbookExportCount, 0);

  const principal = Buffer.from(JSON.stringify({ userId: "synthetic-organiser", userRoles: ["authenticated", "organiser"] })).toString("base64");
  const workbook = await api({ method: "GET", pathname: "/api/v2/organiser/export/private-workbook", headers: { "x-ms-client-principal": principal } });
  assert.equal(workbook.status, 200);
  assert.equal(workbookExportCount, 1);
  assert.ok(Buffer.isBuffer(workbook.body));
});
