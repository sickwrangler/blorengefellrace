#!/usr/bin/env node

import fs from "node:fs";
import { extractPublicResults } from "./results-workbook.mjs";

const dataPath = "data/public/results/2025.json";
const workbookPath = process.argv[2];
const results = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const errors = [];
const allowedFields = [
  "year",
  "position",
  "raceNumber",
  "runnerName",
  "club",
  "category",
  "categoryPosition",
  "genderPosition",
  "recordedGenderCategory",
  "finishTime",
];
const allowedSet = new Set(allowedFields);

if (!Array.isArray(results)) errors.push("Public results must be a JSON array.");
if (results.length !== 102) errors.push(`Expected 102 result rows, found ${results.length}.`);

for (const [index, result] of results.entries()) {
  const fields = Object.keys(result);
  const unexpected = fields.filter((field) => !allowedSet.has(field));
  const missing = allowedFields.filter((field) => !fields.includes(field));
  if (unexpected.length) errors.push(`Row ${index + 1} has forbidden fields: ${unexpected.join(", ")}.`);
  if (missing.length) errors.push(`Row ${index + 1} is missing fields: ${missing.join(", ")}.`);
  if (result.year !== 2025) errors.push(`Row ${index + 1} has an invalid year.`);
  for (const field of ["position", "raceNumber", "categoryPosition", "genderPosition"]) {
    if (!Number.isInteger(result[field]) || result[field] < 1) {
      errors.push(`Row ${index + 1} has an invalid ${field}.`);
    }
  }
  if (!result.runnerName?.trim()) errors.push(`Row ${index + 1} has no runner name.`);
  if (!result.category?.trim()) errors.push(`Row ${index + 1} has no category.`);
  if (!/^(?:Male|Female)$/.test(result.recordedGenderCategory)) {
    errors.push(`Row ${index + 1} has an invalid recorded gender category.`);
  }
  if (!/^\d{2}:[0-5]\d:[0-5]\d$/.test(result.finishTime)) {
    errors.push(`Row ${index + 1} has an invalid finish time.`);
  }
}

const positions = results.map((result) => result.position);
if (new Set(positions).size !== results.length) errors.push("Finishing positions are not unique.");
if (Math.min(...positions) !== 1 || Math.max(...positions) !== 102) {
  errors.push("Finishing positions must cover 1 through 102.");
}

const maleCount = results.filter((result) => result.recordedGenderCategory === "Male").length;
const femaleCount = results.filter((result) => result.recordedGenderCategory === "Female").length;
if (maleCount !== 76 || femaleCount !== 26) errors.push("Recorded gender totals do not match 76 male and 26 female finishers.");

const expectedOverall = [
  [1, "Tom Spearman", "OUSC", "00:33:25"],
  [2, "Rhys Goodrick", "VEGAN RUNNERS UK", "00:34:34"],
  [3, "Jonathan Ford", "MYNYDD DU", "00:35:54"],
];
for (const [position, name, club, time] of expectedOverall) {
  const result = results.find((row) => row.position === position);
  if (!result || result.runnerName !== name || result.club !== club || result.finishTime !== time) {
    errors.push(`Overall podium position ${position} does not match the confirmed result.`);
  }
}

const expectedWomen = [
  [1, "Bethan Logan", "MYNYDD DU", "00:40:21"],
  [2, "Ceri Merwood", "CDF RUNNERS", "00:42:39"],
  [3, "Rhian Probert", "MYNYDD DU", "00:43:31"],
];
for (const [genderPosition, name, club, time] of expectedWomen) {
  const result = results.find((row) => row.recordedGenderCategory === "Female" && row.genderPosition === genderPosition);
  if (!result || result.runnerName !== name || result.club !== club || result.finishTime !== time) {
    errors.push(`Women's podium position ${genderPosition} does not match the confirmed result.`);
  }
}

const mynyddDuCount = results.filter((result) => result.club === "MYNYDD DU").length;
if (mynyddDuCount !== 26) errors.push(`Expected 26 Mynydd Du finishers, found ${mynyddDuCount}.`);

if (workbookPath) {
  const workbookResults = extractPublicResults(workbookPath);
  if (JSON.stringify(workbookResults) !== JSON.stringify(results)) {
    errors.push("Public results do not exactly match the authoritative workbook export.");
  }
}

if (errors.length) {
  errors.forEach((error) => console.error(`ERROR: ${error}`));
  process.exit(1);
}

console.log(`Validated ${results.length} public result rows, allowlisted fields, positions, times, podiums, and summary totals${workbookPath ? ", including exact workbook reconciliation" : ""}.`);
