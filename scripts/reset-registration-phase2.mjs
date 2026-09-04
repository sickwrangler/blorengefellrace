import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../registration/server/service.mjs";
import { createJsonFileRepository } from "../registration/server/repositories.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = process.env.REGISTRATION_PHASE2_DATA_FILE || path.join(root, ".local-registration", "development.json");
const repository = createJsonFileRepository(dataFile, createDatabase({ environment: "local", registrationState: "test" }));
const state = createDatabase({ environment: "local", registrationState: "test" }); state.testProgress.resetCompleted = true;
await repository.reset(state);
console.log("Reset the persistent synthetic Phase 2 development store to zero entries.");
