#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repositoryRoot, ".deployment", "production-registration-scheduler");
export const PRODUCTION_SCHEDULER_COPIES = Object.freeze([
  ["scheduler/package.json", "package.json"],
  ["scheduler/package-lock.json", "package-lock.json"],
  ["scheduler/host.json", "host.json"],
  ["scheduler/src/production-email.mjs", "src/production-email.mjs"],
  ["scheduler/src/production-scheduler.mjs", "src/production-scheduler.mjs"],
  ["scheduler/src/functions/registration-production-scheduler.mjs", "src/functions/registration-production-scheduler.mjs"],
  ["api/src/production-storage.mjs", "src/production-storage.mjs"],
  ["registration/declarations.mjs", "src/shared/declarations.mjs"],
  ["registration/server/production-auth.mjs", "src/shared/server/auth.mjs"],
  ["registration/server/communications.mjs", "src/shared/server/communications.mjs"],
  ["registration/server/email-templates.mjs", "src/shared/server/email-templates.mjs"],
  ["registration/server/order-service.mjs", "src/shared/server/order-service.mjs"],
  ["registration/server/phase3-domain.mjs", "src/shared/server/phase3-domain.mjs"],
  ["registration/server/phase3-integrations.mjs", "src/shared/server/phase3-integrations.mjs"],
  ["registration/server/phase3-service.mjs", "src/shared/server/phase3-service.mjs"],
  ["registration/server/production-bootstrap.mjs", "src/shared/server/production-bootstrap.mjs"],
  ["registration/server/repositories.mjs", "src/shared/server/repositories.mjs"]
]);

export function stageProductionScheduler({ sourceRoot = repositoryRoot, targetRoot = outputRoot } = {}) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  for (const [source, destination] of PRODUCTION_SCHEDULER_COPIES) {
    const target = path.join(targetRoot, destination); fs.mkdirSync(path.dirname(target), { recursive: true });
    if (source === "scheduler/package.json" || source === "scheduler/package-lock.json") {
      fs.writeFileSync(target, fs.readFileSync(path.join(sourceRoot, source), "utf8").replaceAll("blorenge-registration-development-scheduler", "blorenge-registration-production-scheduler"));
    } else fs.copyFileSync(path.join(sourceRoot, source), target);
  }
  const files = PRODUCTION_SCHEDULER_COPIES.map(([, destination]) => destination).sort();
  const actual = [];
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => { const absolute = path.join(directory, entry.name); if (entry.isDirectory()) walk(absolute); else actual.push(path.relative(targetRoot, absolute).split(path.sep).join("/")); });
  walk(targetRoot); actual.sort();
  if (JSON.stringify(actual) !== JSON.stringify(files)) throw new Error("Production scheduler artifact differs from its allowlist.");
  for (const forbidden of ["registration-scheduler.mjs", "scheduler.mjs", "email.mjs", "development-email.mjs", "storage.mjs"]) if (actual.some((file) => file.endsWith(`/${forbidden}`) || file === forbidden)) throw new Error(`Development scheduler module entered production artifact: ${forbidden}`);
  const entry = fs.readFileSync(path.join(targetRoot, "src/functions/registration-production-scheduler.mjs"), "utf8");
  if (/REGISTRATION_SCHEDULER_TEST_NOW|REGISTRATION_EMAIL_SAFE_RECIPIENTS|createControlledDevelopmentEmail/.test(entry)) throw new Error("Development scheduler controls entered the production entry point.");
  return files;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const files = stageProductionScheduler();
  console.log(`production scheduler artifact (${files.length} files):`); files.forEach((file) => console.log(file));
}
