#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { extractPublicResults } from "./results-workbook.mjs";

const workbookPath = process.argv[2];
const outputPath = process.argv[3] ?? "data/public/results/2025.json";

if (!workbookPath) {
  console.error("Usage: node scripts/generate-public-results-2025.mjs <workbook.xlsx> [output.json]");
  process.exit(1);
}

const results = extractPublicResults(workbookPath);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
console.log(`Generated ${results.length} public result rows in ${outputPath}.`);
