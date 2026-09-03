import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "api", "src", "shared");
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, "server"), { recursive: true });
fs.copyFileSync(path.join(root, "registration", "registration-core.mjs"), path.join(target, "registration-core.mjs"));
for (const name of ["adapters.mjs", "api.mjs", "auth.mjs", "repositories.mjs", "service.mjs"]) {
  fs.copyFileSync(path.join(root, "registration", "server", name), path.join(target, "server", name));
}
console.log("Prepared the managed API from the validated registration server sources.");
