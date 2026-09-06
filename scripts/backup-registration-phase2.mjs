import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../registration/server/service.mjs";
import { createJsonFileRepository } from "../registration/server/repositories.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = process.env.REGISTRATION_PHASE2_DATA_FILE || path.join(root, ".local-registration", "development.json");
const output = path.resolve(process.argv[2] || path.join(root, "registration-backups", `synthetic-${new Date().toISOString().replaceAll(":", "-")}.json`));
const repository = createJsonFileRepository(dataFile, createDatabase({ environment: "local", registrationState: "test" }));
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 }); fs.writeFileSync(output, await repository.backup(), { mode: 0o600 });
console.log(`Created synthetic development backup at ${path.relative(root, output)}.`);
