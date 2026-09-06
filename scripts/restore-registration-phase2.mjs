import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../registration/server/service.mjs";
import { createJsonFileRepository } from "../registration/server/repositories.mjs";

const source = process.argv[2]; if (!source) throw new Error("Provide a synthetic backup JSON path.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const dataFile = process.env.REGISTRATION_PHASE2_DATA_FILE || path.join(root, ".local-registration", "development.json");
const serialized = fs.readFileSync(path.resolve(source), "utf8"); const parsed = JSON.parse(serialized);
if (parsed.environment !== "local" || parsed.schemaVersion !== 2) throw new Error("Only a Phase 2 local synthetic backup can be restored.");
const repository = createJsonFileRepository(dataFile, createDatabase({ environment: "local", registrationState: "test" })); await repository.restore(serialized);
console.log("Restored the synthetic Phase 2 development store.");
