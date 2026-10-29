import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "../api/node_modules/exceljs/excel.js";
import { createPrivateRegistrationWorkbook } from "../api/src/private-workbook.mjs";
import { buildPrivateWorkbookModel, buildWaitingListView, waitingListSummary } from "../registration/server/private-export.mjs";
import { createProductionApi } from "../registration/server/production-api.mjs";
import { ProductionRegistrationService } from "../registration/server/production-service.mjs";
import { createMemoryRepository } from "../registration/server/repositories.mjs";

const organiser = { authenticated: true, role: "organiser", actorType: "entra_organiser", id: "synthetic-organiser" };
const anonymous = { authenticated: false, role: null, actorType: "anonymous" };
const emailAdapter = { kind: "disabled", externalDelivery: false };
const iso = (day, hour = 9) => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

function waiting(id, sequence, status = "waiting", overrides = {}) {
  return { id: `waiting-${id}`, firstName: id, lastName: "Runner", email: `${id.toLowerCase()}@example.invalid`, sequence, status, joinedAt: iso(sequence), ...overrides };
}

function offer(id, waitingListId, status, createdDay, overrides = {}) {
  return { id: `offer-${id}`, waitingListId, invitationId: `private-invitation-${id}`, status, createdAt: iso(createdDay), reminderAt: iso(createdDay + 1), expiresAt: iso(createdDay + 2), ...overrides };
}

function state() {
  return {
    schemaVersion: 3,
    environment: "production",
    registrationState: "OPEN",
    event: { id: "blorenge-2026", name: "Blorenge Fell Race 2026", raceDate: "2026-11-28", capacity: 120, entryFeePence: 600 },
    runners: [{ id: "runner-current", firstName: "Current", lastName: "Entrant", email: "current@example.invalid", club: "Example AC", genderCategory: "Open" }],
    emergencyContacts: [],
    registrations: [{ id: "registration-current", testReference: "BFR-CURRENT", runnerId: "runner-current", entryStatus: "accepted", placeStatus: "confirmed", raceNumber: 41, createdAt: iso(1), updatedAt: iso(1) }],
    payments: [{ id: "payment-current", registrationId: "registration-current", status: "paid", currency: "gbp" }],
    declarations: [], consents: [], orders: [], communications: [], refundRequests: [], privateInvitations: [],
    waitingList: [], waitingListOffers: [], auditEvents: []
  };
}

test("simple queue positions waiting people without changing original sequence", () => {
  const source = state();
  source.waitingList = [waiting("A", 10), waiting("B", 11), waiting("C", 12)];
  const result = buildWaitingListView(source);
  assert.deepEqual(result.map(({ firstName, originalSequence, currentPosition, status }) => ({ firstName, originalSequence, currentPosition, status })), [
    { firstName: "A", originalSequence: 10, currentPosition: 1, status: "waiting" },
    { firstName: "B", originalSequence: 11, currentPosition: 2, status: "waiting" },
    { firstName: "C", originalSequence: 12, currentPosition: 3, status: "waiting" }
  ]);
});

test("accepted and declined people leave the current queue while original sequence remains", () => {
  const source = state();
  source.waitingList = [waiting("A", 10, "accepted"), waiting("B", 11, "declined"), waiting("C", 12), waiting("D", 13)];
  const result = buildWaitingListView(source);
  const byName = Object.fromEntries(result.map((item) => [item.firstName, item]));
  assert.deepEqual([byName.C.currentPosition, byName.D.currentPosition], [1, 2]);
  assert.deepEqual([byName.C.originalSequence, byName.D.originalSequence], [12, 13]);
  assert.equal(byName.A.currentPosition, null);
  assert.equal(byName.B.currentPosition, null);
});

test("offer states, timestamps and deterministic latest offer are represented and sorted operationally", () => {
  const source = state();
  source.waitingList = [waiting("Waiting", 4), waiting("Offered", 1, "offered"), waiting("Expired", 2, "expired"), waiting("Declined", 3, "declined")];
  source.waitingListOffers = [
    offer("old", "waiting-Offered", "expired", 10, { completedAt: iso(12) }),
    offer("active", "waiting-Offered", "offered", 13),
    offer("expired", "waiting-Expired", "expired", 15, { completedAt: iso(17) }),
    offer("declined", "waiting-Declined", "declined", 16, { completedAt: iso(18) })
  ];
  const result = buildWaitingListView(source);
  assert.deepEqual(result.map((item) => item.firstName), ["Offered", "Waiting", "Declined", "Expired"]);
  const active = result[0];
  assert.deepEqual({ status: active.status, offerStatus: active.offerStatus, currentPosition: active.currentPosition, created: active.offerCreatedAt, expires: active.offerExpiresAt }, { status: "offered", offerStatus: "offered", currentPosition: null, created: iso(13), expires: iso(15) });
  assert.equal(result.find((item) => item.firstName === "Expired").offerCompletedAt, iso(17));
  assert.equal(result.find((item) => item.firstName === "Declined").offerStatus, "declined");
});

test("latest equal-time offer is selected by stable source order", () => {
  const source = state();
  source.waitingList = [waiting("A", 1, "accepted")];
  source.waitingListOffers = [offer("first", "waiting-A", "declined", 10), offer("second", "waiting-A", "accepted", 10, { completedAt: iso(11) })];
  assert.deepEqual(buildWaitingListView(source).map(({ offerStatus, offerCompletedAt }) => ({ offerStatus, offerCompletedAt })), [{ offerStatus: "accepted", offerCompletedAt: iso(11) }]);
});

test("accepted offer links to an existing registration only through its acceptance audit event", () => {
  const source = state();
  source.waitingList = [waiting("A", 1, "accepted")];
  source.waitingListOffers = [offer("accepted", "waiting-A", "accepted", 10, { completedAt: iso(11) })];
  source.auditEvents = [{ id: "acceptance", action: "waiting_list_offer_accepted", subjectId: "offer-accepted", occurredAt: iso(11), after: { registrationId: "registration-current" } }];
  const [linked] = buildWaitingListView(source);
  assert.deepEqual([linked.registrationId, linked.entryReference, linked.currentPosition], ["registration-current", "BFR-CURRENT", null]);
  source.auditEvents = [];
  const [unlinked] = buildWaitingListView(source);
  assert.deepEqual([unlinked.registrationId, unlinked.entryReference], ["", ""]);
});

test("organiser snapshot exposes only the deliberately limited waiting-list projection", async () => {
  const source = state();
  source.waitingList = [waiting("A", 1, "offered", { tokenHash: "never-expose-waiting-secret" })];
  source.waitingListOffers = [offer("A", "waiting-A", "offered", 10, { invitationToken: "never-expose-token", secureUrl: "https://secret.invalid" })];
  source.privateInvitations = [{ id: "private-invitation-A", tokenHash: "never-expose-hash" }];
  const service = new ProductionRegistrationService({ repository: createMemoryRepository(source), emailAdapter });
  const snapshot = await service.snapshot(organiser);
  assert.equal(snapshot.ok, true);
  assert.deepEqual(Object.keys(snapshot.state.waitingList[0]).sort(), ["currentPosition", "email", "entryReference", "firstName", "joinedAt", "lastName", "offerCompletedAt", "offerCreatedAt", "offerExpiresAt", "offerReminderAt", "offerStatus", "originalSequence", "registrationId", "status", "waitingListId"].sort());
  const serialized = JSON.stringify(snapshot.state.waitingList);
  for (const forbidden of ["never-expose-waiting-secret", "never-expose-token", "never-expose-hash", "secret.invalid", "private-invitation-A"]) assert.doesNotMatch(serialized, new RegExp(forbidden));
  assert.deepEqual(snapshot.state.waitingListSummary, { currentlyWaiting: 0, outstandingOffers: 1, accepted: 0, declined: 0, expired: 0 });
});

test("waiting-list CSV is private, UTF-8 safe, formula safe and operationally ordered", async () => {
  const source = state();
  source.waitingList = [
    waiting("Carys", 3, "waiting", { firstName: "Carys", lastName: "Ôl", email: "=FORMULA@example.invalid" }),
    waiting("Offer", 1, "offered"),
    waiting("Past", 2, "declined", { firstName: "+Past" })
  ];
  source.waitingListOffers = [offer("active", "waiting-Offer", "offered", 12), offer("past", "waiting-Past", "declined", 10, { completedAt: iso(11) })];
  const repository = createMemoryRepository(source);
  const service = new ProductionRegistrationService({ repository, emailAdapter });
  assert.deepEqual(await service.exportWaitingList(anonymous), { ok: false, code: "FORBIDDEN" });
  const exported = await service.exportWaitingList(organiser, new Date("2026-10-23T12:00:00Z"));
  assert.equal(exported.filename, "blorenge-waiting-list-2026-10-23.csv");
  assert.equal(exported.csv.split("\n")[0], '"waiting_list_id","original_sequence","current_position","first_name","last_name","email","status","joined_at","offer_status","offer_created_at","offer_reminder_at","offer_expires_at","offer_completed_at","registration_id","entry_reference"');
  assert.deepEqual(exported.csv.split("\n").slice(1).map((line) => line.match(/^"([^"]+)"/)?.[1]), ["waiting-Offer", "waiting-Carys", "waiting-Past"]);
  assert.match(exported.csv, /Carys/); assert.match(exported.csv, /Ôl/); assert.match(exported.csv, /"'=FORMULA@example\.invalid"/); assert.match(exported.csv, /"'\+Past"/);

  const principal = Buffer.from(JSON.stringify({ userId: "synthetic-organiser", userRoles: ["authenticated", "organiser"] })).toString("base64");
  const api = createProductionApi({ service, phase3Integrations: {}, repository });
  assert.equal((await api({ method: "GET", pathname: "/api/v2/organiser/export/waiting-list", headers: {} })).status, 403);
  const response = await api({ method: "GET", pathname: "/api/v2/organiser/export/waiting-list", headers: { "x-ms-client-principal": principal } });
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "text/csv; charset=utf-8");
  assert.match(response.headers["content-disposition"], /^attachment; filename="blorenge-waiting-list-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.ok(Buffer.isBuffer(response.body));
});

test("race-day CSV filename, header, rows and semantics remain exactly unchanged", async () => {
  const source = state(); source.waitingList = [waiting("OnlyWaiting", 1)];
  const service = new ProductionRegistrationService({ repository: createMemoryRepository(source), emailAdapter });
  const exported = await service.exportPublic(organiser);
  assert.equal(exported.filename, "registration-race-management.csv");
  assert.equal(exported.csv, '"entry_reference","race_number","first_name","last_name","club","category","entry_status","payment_status"\n"BFR-CURRENT","41","Current","Entrant","Example AC","Open","accepted","successful"');
  assert.doesNotMatch(exported.csv, /OnlyWaiting/);
});

test("workbook Waiting List sheet and Summary agree with the shared projection", async () => {
  const source = state();
  source.waitingList = [waiting("Waiting", 4, "waiting", { firstName: "=Waiting" }), waiting("Offered", 1, "offered"), waiting("Accepted", 2, "accepted"), waiting("Declined", 3, "declined"), waiting("Expired", 5, "expired")];
  source.waitingListOffers = [offer("active", "waiting-Offered", "offered", 12), offer("accepted", "waiting-Accepted", "accepted", 10, { completedAt: iso(11) }), offer("declined", "waiting-Declined", "declined", 9, { completedAt: iso(10) }), offer("expired", "waiting-Expired", "expired", 8, { completedAt: iso(9) })];
  const projection = buildWaitingListView(source);
  assert.deepEqual(waitingListSummary(projection), { currentlyWaiting: 1, outstandingOffers: 1, accepted: 1, declined: 1, expired: 1 });
  const model = buildPrivateWorkbookModel(source, new Date("2026-10-23T12:00:00Z"));
  const bytes = await createPrivateRegistrationWorkbook(model);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Summary", "Current Entries", "Transfer History", "Waiting List"]);
  const sheet = workbook.getWorksheet("Waiting List");
  assert.equal(sheet.rowCount, projection.length + 4);
  assert.deepEqual(sheet.getRow(4).values.slice(1), ["Waiting list ID", "Original sequence", "Current position", "First name", "Last name", "Email", "Status", "Joined", "Offer status", "Offer created", "Reminder due", "Offer expires", "Offer completed", "Registration ID", "Entry reference"]);
  assert.deepEqual(sheet.getColumn(1).values.slice(5), projection.map((item) => item.waitingListId));
  const formulaShapedName = sheet.getCell("D6"); assert.equal(formulaShapedName.value, "=Waiting"); assert.equal(formulaShapedName.formula, undefined);
  assert.ok(sheet.autoFilter); assert.deepEqual({ state: sheet.views[0].state, ySplit: sheet.views[0].ySplit, xSplit: sheet.views[0].xSplit }, { state: "frozen", ySplit: 4, xSplit: 3 });
  const summaryValues = new Map(workbook.getWorksheet("Summary").getRows(5, 16).map((row) => [row.getCell(1).value, row.getCell(2).value]));
  assert.deepEqual([summaryValues.get("Currently waiting"), summaryValues.get("Outstanding waiting-list offers"), summaryValues.get("Accepted from waiting list"), summaryValues.get("Declined waiting-list offers"), summaryValues.get("Expired waiting-list offers")], [1, 1, 1, 1, 1]);
});
