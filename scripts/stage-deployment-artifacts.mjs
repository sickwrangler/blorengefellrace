#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PRODUCTION_FILES = Object.freeze([
  "404.html",
  "components/footer/footer.css",
  "components/footer/footer.html",
  "components/navbar/navbar.css",
  "components/navbar/navbar.html",
  "data/photos/manifest.json",
  "data/public/results/2025.json",
  "data/public/results/2025.schema.json",
  "downloads/blorenge-fell-race-2026.gpx",
  "enter.html",
  "images/OS Map blorenge.png",
  "images/WFRAbanner.png",
  "images/blorenge_contour_lines.png",
  "images/blorenge_fellrace_logo.svg",
  "images/blorenge_fellrace_logo_white.svg",
  "index.html",
  "info.html",
  "photo-manager.js",
  "privacy.html",
  "result.html",
  "route-map.js",
  "route.html",
  "script.js",
  "style.css",
  "style_info.css",
  "style_results.css",
  "style_route.css",
  "style_winners.css"
]);

export const DEVELOPMENT_REGISTRATION_FILES = Object.freeze([
  "registration/declarations.mjs",
  "registration/declaration.html",
  "registration/declaration.mjs",
  "registration/dashboard.html",
  "registration/dashboard.mjs",
  "registration/index.html",
  "registration/manage.html",
  "registration/manage.mjs",
  "registration/organiser-view.mjs",
  "registration/payment-return.html",
  "registration/payment-return.mjs",
  "registration/payment-state.mjs",
  "registration/preview-repository.mjs",
  "registration/prototype-client.mjs",
  "registration/prototype.css",
  "registration/registration-core.mjs",
  "registration/runner-flow.mjs",
  "registration/runner-errors.mjs",
  "registration/runner.mjs",
  "registration/start-list.html",
  "registration/start-list.mjs"
]);

export const PRODUCTION_REGISTRATION_FILES = Object.freeze([
  "registration/declarations.mjs",
  "registration/declaration.html",
  "registration/declaration.mjs",
  "registration/dashboard.html",
  "registration/dashboard.mjs",
  "registration/index.html",
  "registration/manage.html",
  "registration/manage.mjs",
  "registration/organiser-view.mjs",
  "registration/payment-return.html",
  "registration/payment-return.mjs",
  "registration/payment-state.mjs",
  "registration/production-client.mjs",
  "registration/production-query.mjs",
  "registration/production-validation.mjs",
  "registration/prototype.css",
  "registration/runner-flow.mjs",
  "registration/runner-errors.mjs",
  "registration/runner.mjs",
  "registration/start-list.html",
  "registration/start-list.mjs"
]);

const PRODUCTION_API_COPIES = Object.freeze([
  ["api/package.json", "package.json"],
  ["api/package-lock.json", "package-lock.json"],
  ["api/src/functions/registration-production.mjs", "src/functions/registration-production.mjs"],
  ["api/src/production-config.mjs", "src/production-config.mjs"],
  ["api/src/production-providers.mjs", "src/production-providers.mjs"],
  ["api/src/production-storage.mjs", "src/production-storage.mjs"],
  ["registration/declarations.mjs", "src/shared/declarations.mjs"],
  ["registration/server/production-auth.mjs", "src/shared/server/auth.mjs"],
  ["registration/server/communications.mjs", "src/shared/server/communications.mjs"],
  ["registration/server/email-templates.mjs", "src/shared/server/email-templates.mjs"],
  ["registration/server/order-service.mjs", "src/shared/server/order-service.mjs"],
  ["registration/server/phase3-domain.mjs", "src/shared/server/phase3-domain.mjs"],
  ["registration/server/phase3-integrations.mjs", "src/shared/server/phase3-integrations.mjs"],
  ["registration/server/phase3-service.mjs", "src/shared/server/phase3-service.mjs"],
  ["registration/server/production-api.mjs", "src/shared/server/production-api.mjs"],
  ["registration/server/production-bootstrap.mjs", "src/shared/server/production-bootstrap.mjs"],
  ["registration/server/production-service.mjs", "src/shared/server/production-service.mjs"],
  ["registration/server/repositories.mjs", "src/shared/server/repositories.mjs"],
]);

const DEVELOPMENT_API_COPIES = Object.freeze([
  ["api/package.json", "package.json"],
  ["api/package-lock.json", "package-lock.json"],
  ["api/src/functions/registration.mjs", "src/functions/registration.mjs"],
  ["api/src/storage.mjs", "src/storage.mjs"],
  ["api/src/providers.mjs", "src/providers.mjs"],
  ["registration/registration-core.mjs", "src/shared/registration-core.mjs"],
  ["registration/declarations.mjs", "src/shared/declarations.mjs"],
  ["registration/server/adapters.mjs", "src/shared/server/adapters.mjs"],
  ["registration/server/api.mjs", "src/shared/server/api.mjs"],
  ["registration/server/auth.mjs", "src/shared/server/auth.mjs"],
  ["registration/server/phase3-domain.mjs", "src/shared/server/phase3-domain.mjs"],
  ["registration/server/phase3-integrations.mjs", "src/shared/server/phase3-integrations.mjs"],
  ["registration/server/phase3-service.mjs", "src/shared/server/phase3-service.mjs"],
  ["registration/server/order-service.mjs", "src/shared/server/order-service.mjs"],
  ["registration/server/development-email.mjs", "src/shared/server/development-email.mjs"],
  ["registration/server/email-templates.mjs", "src/shared/server/email-templates.mjs"],
  ["registration/server/communications.mjs", "src/shared/server/communications.mjs"],
  ["registration/server/repositories.mjs", "src/shared/server/repositories.mjs"],
  ["registration/server/service.mjs", "src/shared/server/service.mjs"]
]);

const forbiddenProductionPrefixes = Object.freeze([
  ".github/", ".local-registration/", "api/", "docs/", "infrastructure/",
  "private-data/", "private-exports/", "registration/", "registration-backups/",
  "scripts/", "tests/"
]);
const credentialPatterns = Object.freeze([
  /DefaultEndpointsProtocol=/i,
  /AccountKey=/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:^|[?&])sig=[^&\s]+/i,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /\/Users\/[^/]+\//
]);
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt", ".xml"]);

const normalize = (value) => value.split(path.sep).join("/");

function assertSafeRelative(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || normalize(relativePath).split("/").includes("..")) {
    throw new Error(`Unsafe artifact path: ${relativePath}`);
  }
}

function copyFile(sourceRoot, outputRoot, sourcePath, outputPath = sourcePath) {
  assertSafeRelative(sourcePath);
  assertSafeRelative(outputPath);
  const source = path.join(sourceRoot, sourcePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Required deployment file is missing: ${sourcePath}`);
  const target = path.join(outputRoot, outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyTransformedFile(sourceRoot, outputRoot, sourcePath, transform, outputPath = sourcePath) {
  assertSafeRelative(sourcePath);
  assertSafeRelative(outputPath);
  const target = path.join(outputRoot, outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, transform(fs.readFileSync(path.join(sourceRoot, sourcePath), "utf8")));
}

export function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  function walk(current) {
    return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(current, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  }
  return walk(directory).map((file) => normalize(path.relative(directory, file))).sort();
}

function approvedPhotoFiles(sourceRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, "data/photos/manifest.json"), "utf8"));
  if (!Array.isArray(manifest.photos)) throw new Error("Photo manifest does not contain an approved photo list.");
  return [...new Set(manifest.photos.filter((photo) => photo.active).map((photo) => photo.optimizedFilename))].sort().map((file) => {
    if (!/^images\/generated\/photos\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp)$/i.test(file)) {
      throw new Error(`Photo manifest contains a non-public artifact path: ${file}`);
    }
    return file;
  });
}

function productionConfiguration() {
  return {
    responseOverrides: {
      "404": { rewrite: "/404.html" }
    }
  };
}

function developmentConfiguration() {
  return {
    routes: [
      { route: "/registration/dashboard.html", allowedRoles: ["organiser"] },
      { route: "/api/v2/organiser/*", allowedRoles: ["organiser"] },
      { route: "/api/v3/organiser/*", allowedRoles: ["organiser"] },
      { route: "/api/v4/organiser/*", allowedRoles: ["organiser"] }
    ],
    responseOverrides: {
      "401": { redirect: "/.auth/login/aad?post_login_redirect_uri=.referrer", statusCode: 302 },
      "404": { rewrite: "/404.html" }
    }
  };
}

function registrationProductionConfiguration() {
  return {
    routes: [
      { route: "/registration/dashboard.html", allowedRoles: ["organiser"] },
      { route: "/api/v2/organiser/*", allowedRoles: ["organiser"] },
      { route: "/api/v3/organiser/*", allowedRoles: ["organiser"] },
      { route: "/api/v4/organiser/*", allowedRoles: ["organiser"] }
    ],
    responseOverrides: {
      "401": { redirect: "/.auth/login/aad?post_login_redirect_uri=.referrer", statusCode: 302 },
      "404": { rewrite: "/404.html" }
    }
  };
}

function productionBrowserTransform(file, source) {
  let value = source
    .replaceAll('from "./prototype-client.mjs"', 'from "./production-client.mjs"')
    .replaceAll('from "./registration-core.mjs"', 'from "./production-validation.mjs"')
    .replaceAll('from "./preview-repository.mjs"', 'from "./production-query.mjs"')
    .replaceAll("Development · Closed", "Production · Closed")
    .replaceAll("Development · Synthetic test information only", "Production registration")
    .replaceAll("Development test", "Production registration")
    .replaceAll("Development · Checking integrations", "Production · Checking integrations")
    .replaceAll("Stripe sandbox", "Stripe")
    .replaceAll("controlled development channel", "transactional email service")
    .replaceAll("Stripe sandbox refund", "Stripe refund")
    .replaceAll("test refund", "refund")
    .replaceAll("synthetic entry", "entry")
    .replaceAll("Synthetic entry", "Entry")
    .replaceAll("test entry", "entry")
    .replaceAll("Test entries", "Entries")
    .replaceAll("test reference", "entry reference")
    .replaceAll("Test reference", "Entry reference")
    .replaceAll("synthetic-registration-export.csv", "registration-export.csv");
  if (file === "registration/index.html") {
    value = value
      .replace("This test cannot accept or store an entry on the production website.", "Registration is currently closed. No entry or payment can be created.")
      .replace("In development, this journey accepts synthetic information only. It creates no real race entry, takes no money from a real payment method, and keeps payment sandboxed or disabled. Any enabled test email is redirected to an approved safe recipient.", "Enter up to five runners and pay for the order securely when registration is available.")
      .replace("Used for the group payment summary; synthetic address only", "Used for the group payment summary")
      .replace("Start a test registration", "Start registration")
      .replace("View organiser test area", "Organiser area")
      .replace("Use synthetic information only.", "Enter the runner's details.")
      .replace("Reserved example address in development", "Used for entry communications")
      .replace("Payments are not yet enabled in this development environment. No payment will be attempted.", "Online payment is unavailable while registration is closed.")
      .replace("I acknowledge the prototype privacy notice and will use synthetic data only.", "I acknowledge the privacy notice.")
      .replace(/\s*<button id="reset-test"[^>]*>Reset test<\/button>/, "")
      .replace(/ value="(?:alex\.runner@example\.com|Alex|Example|07700 900123|1 Example Street|Abergavenny|NP7 5AA|1990-06-15|Example Harriers)"/g, "");
  }
  if (file === "registration/dashboard.html") {
    value = value
      .replace(' class="prototype-pending"', "")
      .replace(/\s*<script>\s*\(\(\) => \{[\s\S]*?<\/script>/, "")
      .replace(/\s*<details class="technical-details">\s*<summary id="progress-title">[\s\S]*?<\/details>/, "")
      .replace(/\s*<div class="reset-row"><button id="reset-test"[\s\S]*?<\/div>/, "")
      .replace(/\s*<details class="technical-details"><summary>Technical details<\/summary>[\s\S]*?<\/details>/, "")
      .replace(/\s*<div id="message-preview"[\s\S]*?<\/div>/, "")
      .replaceAll("Manage synthetic registration operations in the isolated development environment.", "Manage Blorenge Fell Race registrations.")
      .replaceAll("Payments unavailable · Email captured only", "Payments disabled · Email disabled")
      .replaceAll("Create a single-use private link for controlled testing.", "Create a limited-use private registration link.")
      .replaceAll("There are no test entries. Complete the runner test to add one.", "There are no entries.")
      .replaceAll("Export sanitized test CSV", "Export race-management CSV")
      .replaceAll("The export contains entry reference, name, club, category and race-management statuses—not contact or emergency details.", "The export contains entry reference, name, club, category and race-management statuses—not contact or emergency details.")
      .replaceAll("Cancel test entry", "Cancel entry");
  }
  if (file === "registration/runner.mjs") {
    value = value
      .replace(/\n?document\.querySelector\("#reset-test"\)\?\.addEventListener\([\s\S]*?\);\n/, "\n")
      .replace(/form\.reset\(\); form\.elements\.email\.value = `runner-\$\{next\}@example\.com`; form\.elements\.firstName\.value = `Runner \$\{next\}`; form\.elements\.lastName\.value = "Example"; form\.elements\.declarationName\.value = `Runner \$\{next\} Example`;/, "form.reset();")
      .replace("You will pay for every runner in one Stripe test Checkout.", "You will pay for every runner in one Stripe Checkout.")
      .replace("Online payment is not available in this development environment.", "Online payment is unavailable while registration is closed.");
  }
  if (file === "registration/dashboard.mjs") {
    value = value
      .replace("renderList(); renderProgress(); await renderPrivateInvitations();", "renderList(); await renderPrivateInvitations();")
      .replace(/\n\s*document\.querySelector\("#technical-environment"\)[^\n]+\n\s*document\.querySelector\("#technical-storage"\)[^\n]+\n\s*document\.querySelector\("#technical-schema"\)[^\n]+/, "")
      .replace(/\n\s*if \(!currentState\.testProgress\.organiserViewed[\s\S]*?\n\s*}\n/, "\n")
      .replace("renderActions(item); renderMessages(item);", "renderActions(item);")
      .replace(/\n\s*if \(available\.includes\("messages"\)\)[^\n]+/, "")
      .replace(/\nfunction renderMessages\([\s\S]*?\nfunction renderProgress\([\s\S]*?\n}\n\nfor \(const selector/, "\n\nfor (const selector")
      .replace(/\n?document\.querySelector\("#reset-test"\)\?\.addEventListener\([^\n]+\n/, "\n")
      .replaceAll("Payments unavailable · Email captured only", "Payments disabled · Email disabled")
      .replaceAll("Email captured only", "Email disabled")
      .replaceAll("Controlled email", "Transactional email")
      .replaceAll("No messages have been captured for this entry.", "No communications are recorded for this entry.");
  }
  if (file === "registration/payment-return.mjs") value = value.replaceAll("Development · Stripe", "Production · Stripe").replaceAll("Development · Payments unavailable", "Production · Payments unavailable");
  if (file === "registration/payment-state.mjs") value = value.replaceAll("Online payment is not available yet in this development environment.", "Online payment is currently unavailable.");
  return value;
}

function writeConfiguration(outputRoot, configuration) {
  fs.writeFileSync(path.join(outputRoot, "staticwebapp.config.json"), `${JSON.stringify(configuration, null, 2)}\n`);
}

export function validateProductionArtifact(outputRoot, expectedFiles) {
  const actual = listFiles(outputRoot);
  const expected = [...expectedFiles].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const unexpected = actual.filter((file) => !expected.includes(file));
    const missing = expected.filter((file) => !actual.includes(file));
    throw new Error(`Production artifact mismatch. Unexpected: ${unexpected.join(", ") || "none"}. Missing: ${missing.join(", ") || "none"}.`);
  }
  for (const file of actual) {
    if (forbiddenProductionPrefixes.some((prefix) => file.startsWith(prefix)) || /(?:^|\/)\.DS_Store$/.test(file) || /\.(?:csv|env|log|sql|sqlite|xls|xlsx|xcf)$/i.test(file) || /(?:^|\/)package(?:-lock)?\.json$/.test(file)) {
      throw new Error(`Development, source, or sensitive-shaped file entered the production artifact: ${file}`);
    }
    if (textExtensions.has(path.extname(file).toLowerCase())) {
      const content = fs.readFileSync(path.join(outputRoot, file), "utf8");
      if (credentialPatterns.some((pattern) => pattern.test(content))) throw new Error(`Credential-shaped or workstation-specific content found in production artifact: ${file}`);
    }
  }
  return actual;
}

export function validateRegistrationProductionArtifact(outputRoot, { expectedAppFiles, expectedApiFiles }) {
  const appRoot = path.join(outputRoot, "app"); const apiRoot = path.join(outputRoot, "api");
  const appFiles = listFiles(appRoot); const apiFiles = listFiles(apiRoot);
  const compare = (actual, expected, label) => {
    const approved = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(approved)) throw new Error(`${label} artifact mismatch. Unexpected: ${actual.filter((file) => !approved.includes(file)).join(", ") || "none"}. Missing: ${approved.filter((file) => !actual.includes(file)).join(", ") || "none"}.`);
  };
  compare(appFiles, expectedAppFiles, "Production registration web"); compare(apiFiles, expectedApiFiles, "Production registration API");
  const forbiddenApp = ["prototype-client.mjs", "preview-repository.mjs", "registration-core.mjs", "fixtures.json"];
  for (const file of appFiles) {
    if (forbiddenApp.some((name) => file.endsWith(name)) || file.startsWith("registration/server/") || /(?:^|\/)\.DS_Store$|\.(?:csv|env|log|sql|sqlite|xls|xlsx|xcf)$/i.test(file)) throw new Error(`Development or sensitive file entered production registration web artifact: ${file}`);
    if (textExtensions.has(path.extname(file).toLowerCase())) {
      const content = fs.readFileSync(path.join(appRoot, file), "utf8");
      if (credentialPatterns.some((pattern) => pattern.test(content))) throw new Error(`Credential-shaped content entered production registration web artifact: ${file}`);
      if (/Reset test|mock-payment|localStorage|x-development-organiser|REGISTRATION_EMAIL_SAFE_RECIPIENTS|alex\.runner@example\.com/i.test(content)) throw new Error(`Development-only browser control entered production artifact: ${file}`);
    }
  }
  const forbiddenApiNames = ["src/functions/registration.mjs", "src/providers.mjs", "src/storage.mjs", "src/shared/registration-core.mjs", "src/shared/server/api.mjs", "src/shared/server/adapters.mjs", "src/shared/server/development-email.mjs", "src/shared/server/service.mjs"];
  for (const name of forbiddenApiNames) if (apiFiles.includes(name)) throw new Error(`Development API module entered production artifact: ${name}`);
  const entry = fs.readFileSync(path.join(apiRoot, "src/functions/registration-production.mjs"), "utf8");
  const router = fs.readFileSync(path.join(apiRoot, "src/shared/server/production-api.mjs"), "utf8");
  for (const token of ["mock-payment", "/organiser/reset", "/organiser/import/synthetic", "x-development-organiser", "REGISTRATION_SCHEDULER_TEST_NOW"]) if (entry.includes(token) || router.includes(token)) throw new Error(`Development API route or control entered production entry graph: ${token}`);
  return { appFiles, apiFiles };
}

export function stageProduction({ sourceRoot = repositoryRoot, outputRoot = path.join(repositoryRoot, ".deployment/production") } = {}) {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const approved = [...PRODUCTION_FILES, ...approvedPhotoFiles(sourceRoot)];
  approved.forEach((file) => copyFile(sourceRoot, outputRoot, file));
  writeConfiguration(outputRoot, productionConfiguration());
  return validateProductionArtifact(outputRoot, [...approved, "staticwebapp.config.json"]);
}

export function stageDevelopment({ sourceRoot = repositoryRoot, outputRoot = path.join(repositoryRoot, ".deployment/development") } = {}) {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  const appRoot = path.join(outputRoot, "app");
  const apiRoot = path.join(outputRoot, "api");
  fs.mkdirSync(appRoot, { recursive: true });
  const publicFiles = [...PRODUCTION_FILES, ...approvedPhotoFiles(sourceRoot)];
  [...publicFiles, ...DEVELOPMENT_REGISTRATION_FILES].forEach((file) => copyFile(sourceRoot, appRoot, file));
  writeConfiguration(appRoot, developmentConfiguration());
  DEVELOPMENT_API_COPIES.forEach(([source, target]) => copyFile(sourceRoot, apiRoot, source, target));
  const appFiles = listFiles(appRoot);
  const apiFiles = listFiles(apiRoot);
  if (appFiles.some((file) => file.startsWith("registration/server/") || file === "registration/fixtures.json")) throw new Error("Server source or fixtures entered the development web artifact.");
  if (!appFiles.includes("registration/index.html") || !appFiles.includes("registration/dashboard.html") || !apiFiles.includes("src/functions/registration.mjs")) {
    throw new Error("Development artifact is missing a required registration component.");
  }
  return { appFiles, apiFiles };
}

export function stageRegistrationProduction({ sourceRoot = repositoryRoot, outputRoot = path.join(repositoryRoot, ".deployment/production-registration") } = {}) {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  const appRoot = path.join(outputRoot, "app"); const apiRoot = path.join(outputRoot, "api");
  fs.mkdirSync(appRoot, { recursive: true });
  const publicFiles = [...PRODUCTION_FILES, ...approvedPhotoFiles(sourceRoot)];
  publicFiles.forEach((file) => copyFile(sourceRoot, appRoot, file));
  PRODUCTION_REGISTRATION_FILES.forEach((file) => copyTransformedFile(sourceRoot, appRoot, file, (source) => productionBrowserTransform(file, source)));
  writeConfiguration(appRoot, registrationProductionConfiguration());
  PRODUCTION_API_COPIES.forEach(([source, target]) => {
    if (source === "api/package.json" || source === "api/package-lock.json") {
      copyTransformedFile(sourceRoot, apiRoot, source, (value) => value.replaceAll("blorenge-registration-development-api", "blorenge-registration-production-api"), target);
      return;
    }
    copyFile(sourceRoot, apiRoot, source, target);
  });
  return validateRegistrationProductionArtifact(outputRoot, {
    expectedAppFiles: [...publicFiles, ...PRODUCTION_REGISTRATION_FILES, "staticwebapp.config.json"],
    expectedApiFiles: PRODUCTION_API_COPIES.map(([, target]) => target)
  });
}

function outputArgument(target) {
  const supplied = process.argv.find((argument) => argument.startsWith("--output="));
  return supplied ? path.resolve(supplied.slice("--output=".length)) : path.join(repositoryRoot, ".deployment", target);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!['production', 'development', 'production-registration'].includes(target)) {
    console.error("Usage: node scripts/stage-deployment-artifacts.mjs <production|development|production-registration> [--output=<directory>]");
    process.exit(1);
  }
  const result = target === "production" ? stageProduction({ outputRoot: outputArgument(target) }) : target === "development" ? stageDevelopment({ outputRoot: outputArgument(target) }) : stageRegistrationProduction({ outputRoot: outputArgument(target) });
  const files = Array.isArray(result) ? result : [
    ...result.appFiles.map((file) => `app/${file}`),
    ...result.apiFiles.map((file) => `api/${file}`)
  ].sort();
  console.log(`${target} artifact (${files.length} files):`);
  files.forEach((file) => console.log(file));
}
