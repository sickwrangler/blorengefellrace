import ExcelJS from "exceljs";

const HEADER_FILL = "E8D6D9";
const WARNING_FILL = "FCE8E6";
const BODY_FONT = { name: "Arial", size: 10, color: { argb: "FF222222" } };
const HEADER_FONT = { name: "Arial", size: 10, bold: true, color: { argb: "FF222222" } };
const TITLE_FONT = { name: "Arial", size: 14, bold: true, color: { argb: "FF6B1F2B" } };
const DATE_TIME_FORMAT = "dd/mm/yyyy hh:mm";
const DATE_FORMAT = "dd/mm/yyyy";

const entriesColumns = [
  ["Entry reference", "entryReference", 18], ["Registration ID", "registrationId", 38], ["Race number", "raceNumber", 12],
  ["First name", "firstName", 16], ["Last name", "lastName", 18], ["Email", "email", 30], ["Phone", "phone", 18],
  ["Date of birth", "dateOfBirth", 14], ["Race category", "raceCategory", 18], ["Club", "club", 24],
  ["WFRA member", "wfraMember", 13], ["WFRA membership number", "wfraMembershipNumber", 22],
  ["Emergency contact name", "emergencyContactName", 24], ["Emergency contact phone", "emergencyContactPhone", 22],
  ["Entry status", "entryStatus", 16], ["Place status", "placeStatus", 16], ["Payment status", "paymentStatus", 16],
  ["Declaration status", "declarationStatus", 18], ["Cleared to start", "clearedToStart", 16],
  ["Price actually charged", "priceActuallyCharged", 20], ["Currency", "currency", 10], ["Refund state", "refundState", 16],
  ["Transferred?", "transferred", 13], ["Transfer count", "transferCount", 14], ["Original runner name", "originalRunnerName", 24],
  ["Previous runner name", "previousRunnerName", 24], ["Latest transfer date/time", "latestTransferAt", 23],
  ["Latest transfer initiated by", "latestTransferInitiatedBy", 25], ["Cutoff override used", "cutoffOverrideUsed", 20],
  ["Registration created", "createdAt", 22], ["Registration last updated", "updatedAt", 24]
];

const transferColumns = [
  ["Entry reference", "entryReference", 18], ["Registration ID", "registrationId", 38], ["Race number", "raceNumber", 12],
  ["Transfer date/time", "occurredAt", 22], ["Transfer sequence", "sequence", 17], ["From runner name", "fromRunnerName", 24],
  ["From runner email", "fromRunnerEmail", 30], ["To runner name", "toRunnerName", 24], ["To runner email", "toRunnerEmail", 30],
  ["Initiated by", "initiatedBy", 15], ["Cutoff override", "cutoffOverride", 16], ["Audit event ID", "auditEventId", 40],
  ["From runner ID", "fromRunnerId", 38], ["To runner ID", "toRunnerId", 38]
];

function addPrivacyHeading(sheet, classification, columnCount) {
  sheet.mergeCells(1, 1, 1, columnCount);
  const title = sheet.getCell(1, 1);
  title.value = classification;
  title.font = TITLE_FONT;
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${WARNING_FILL}` } };
  title.alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 24;
  sheet.mergeCells(2, 1, 2, columnCount);
  const notice = sheet.getCell(2, 1);
  notice.value = "Contains personal information. Store securely and share only with authorised race organisers.";
  notice.font = { ...BODY_FONT, italic: true };
  sheet.getRow(2).height = 20;
}

function styleDataSheet(sheet, columns, rows, classification) {
  addPrivacyHeading(sheet, classification, columns.length);
  const headerRow = 4;
  sheet.getRow(headerRow).values = columns.map(([label]) => label);
  for (const row of rows) sheet.addRow(columns.map(([, key]) => row[key] ?? ""));
  sheet.views = [{ state: "frozen", ySplit: headerRow, xSplit: 3 }];
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: columns.length } };
  sheet.showGridLines = false;
  sheet.getRow(headerRow).eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER_FILL}` } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  sheet.getRow(headerRow).height = 32;
  columns.forEach(([, , width], index) => { sheet.getColumn(index + 1).width = width; });
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber); row.font = BODY_FONT; row.alignment = { vertical: "middle" };
  }
  return headerRow;
}

export async function createPrivateRegistrationWorkbook(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Blorenge Fell Race organiser export";
  workbook.title = model.classification;
  workbook.subject = "Blorenge Fell Race 2026 private registration operations";
  workbook.created = model.summary.generatedAt ?? new Date();

  const summary = workbook.addWorksheet("Summary", { properties: { tabColor: { argb: `FF${HEADER_FILL}` } } });
  summary.showGridLines = false;
  summary.getColumn(1).width = 34; summary.getColumn(2).width = 30;
  summary.mergeCells("A1:B1"); summary.getCell("A1").value = model.classification; summary.getCell("A1").font = TITLE_FONT;
  summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${WARNING_FILL}` } };
  summary.mergeCells("A2:B2"); summary.getCell("A2").value = "Contains personal information. Store securely and share only with authorised race organisers."; summary.getCell("A2").font = { ...BODY_FONT, italic: true };
  summary.getRow(4).values = ["Measure", "Value"];
  const summaryRows = [
    ["Event", model.summary.event], ["Race date", model.summary.raceDate], ["Export generated at", model.summary.generatedAt],
    ["Registration operational state", model.summary.operationalState], ["Capacity", model.summary.capacity],
    ["Current confirmed places", model.summary.confirmedPlaces], ["Waiting list count", model.summary.waitingListCount],
    ["Cancelled / released registrations", model.summary.cancelledReleasedCount], ["Registrations ever transferred", model.summary.registrationsEverTransferred],
    ["Total transfer events", model.summary.totalTransferEvents], ["Pending declarations", model.summary.pendingDeclarations],
    ["Cleared to start", model.summary.clearedToStartCount]
  ];
  summary.addRows(summaryRows); summary.views = [{ state: "frozen", ySplit: 4 }]; summary.autoFilter = "A4:B16";
  summary.getRow(4).eachCell((cell) => { cell.font = HEADER_FONT; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER_FILL}` } }; cell.alignment = { horizontal: "center", vertical: "middle" }; });
  summary.getColumn(1).font = BODY_FONT; summary.getColumn(2).font = BODY_FONT;
  summary.getCell("B6").numFmt = DATE_FORMAT; summary.getCell("B7").numFmt = DATE_TIME_FORMAT;

  const current = workbook.addWorksheet("Current Entries");
  const currentHeader = styleDataSheet(current, entriesColumns, model.currentEntries, model.classification);
  const currentColumn = Object.fromEntries(entriesColumns.map(([, key], index) => [key, index + 1]));
  for (let row = currentHeader + 1; row <= current.rowCount; row += 1) {
    current.getCell(row, currentColumn.dateOfBirth).numFmt = DATE_FORMAT;
    for (const key of ["latestTransferAt", "createdAt", "updatedAt"]) current.getCell(row, currentColumn[key]).numFmt = DATE_TIME_FORMAT;
    current.getCell(row, currentColumn.priceActuallyCharged).numFmt = "£#,##0.00";
  }

  const transfers = workbook.addWorksheet("Transfer History");
  const transferHeader = styleDataSheet(transfers, transferColumns, model.transferHistory, model.classification);
  const transferDateColumn = transferColumns.findIndex(([, key]) => key === "occurredAt") + 1;
  for (let row = transferHeader + 1; row <= transfers.rowCount; row += 1) transfers.getCell(row, transferDateColumn).numFmt = DATE_TIME_FORMAT;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export const privateWorkbookContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
