import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repositoryRoot, ".deployment", "scheduler");

const copies = [
  ["scheduler/package.json", "package.json"],
  ["scheduler/package-lock.json", "package-lock.json"],
  ["scheduler/host.json", "host.json"],
  ["scheduler/src/scheduler.mjs", "src/scheduler.mjs"],
  ["scheduler/src/email.mjs", "src/email.mjs"],
  ["scheduler/src/functions/registration-scheduler.mjs", "src/functions/registration-scheduler.mjs"],
  ["api/src/storage.mjs", "src/storage.mjs"],
  ["registration/registration-core.mjs", "src/shared/registration-core.mjs"],
  ["registration/declarations.mjs", "src/shared/declarations.mjs"],
  ["registration/server/auth.mjs", "src/shared/server/auth.mjs"],
  ["registration/server/communications.mjs", "src/shared/server/communications.mjs"],
  ["registration/server/development-email.mjs", "src/shared/server/development-email.mjs"],
  ["registration/server/email-templates.mjs", "src/shared/server/email-templates.mjs"],
  ["registration/server/phase3-domain.mjs", "src/shared/server/phase3-domain.mjs"],
  ["registration/server/phase3-integrations.mjs", "src/shared/server/phase3-integrations.mjs"],
  ["registration/server/phase3-service.mjs", "src/shared/server/phase3-service.mjs"],
  ["registration/server/order-service.mjs", "src/shared/server/order-service.mjs"],
  ["registration/server/repositories.mjs", "src/shared/server/repositories.mjs"],
  ["registration/server/service.mjs", "src/shared/server/service.mjs"]
];

fs.rmSync(outputRoot, { recursive: true, force: true });
for (const [source, destination] of copies) {
  const target = path.join(outputRoot, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, source), target);
}

const forbidden = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SIGNING_SECRET", "ACS_EMAIL_CONNECTION_STRING"];
const files = [];
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
  const absolute = path.join(directory, entry.name);
  if (entry.isDirectory()) walk(absolute);
  else files.push(path.relative(outputRoot, absolute).split(path.sep).join("/"));
});
walk(outputRoot);
for (const file of files.filter((item) => /\.(?:mjs|json)$/.test(item))) {
  const content = fs.readFileSync(path.join(outputRoot, file), "utf8");
  for (const value of forbidden) if (content.includes(value)) throw new Error(`Forbidden credential setting entered scheduler package: ${value}`);
}
console.log(`scheduler artifact (${files.length} files) staged at ${path.relative(repositoryRoot, outputRoot)}`);
