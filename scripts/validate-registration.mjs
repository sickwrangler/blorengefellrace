import fs from "node:fs";
import { execFileSync } from "node:child_process";

const files = ["registration/index.html", "registration/dashboard.html", "registration/prototype.css", "registration/runner.mjs", "registration/runner-flow.mjs", "registration/dashboard.mjs", "registration/organiser-view.mjs", "registration/prototype-client.mjs", "registration/preview-repository.mjs", "registration/registration-core.mjs", "registration/fixtures.json", "registration/server/service.mjs", "registration/server/api.mjs", "registration/server/auth.mjs", "registration/server/adapters.mjs", "registration/server/repositories.mjs", "api/package.json", "api/src/storage.mjs", "api/src/functions/registration.mjs", "scripts/prepare-registration-api.mjs", "scripts/prepare-registration-development-routes.mjs", "scripts/start-registration-prototype.mjs", "scripts/start-registration-phase2.mjs", "scripts/reset-registration-phase2.mjs", "scripts/backup-registration-phase2.mjs", "scripts/restore-registration-phase2.mjs"];
const errors = [];
for (const file of files) if (!fs.existsSync(file)) errors.push(`Missing ${file}`);
for (const file of files.filter((name) => name.endsWith(".mjs"))) {
  try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); } catch { errors.push(`JavaScript syntax failed: ${file}`); }
}
for (const htmlFile of ["registration/index.html", "registration/dashboard.html"]) {
  const html = fs.readFileSync(htmlFile, "utf8");
  for (const required of ["<meta name=\"viewport\"", "skip-link"]) if (!html.includes(required)) errors.push(`${htmlFile} missing ${required}`);
  if (!/prototype/i.test(html)) errors.push(`${htmlFile} is not clearly labelled as a prototype`);
  if (!/<title>[^<]+<\/title>/.test(html)) errors.push(`${htmlFile} missing title`);
}
const runnerPage = fs.readFileSync("registration/index.html", "utf8");
for (const required of ["TEST REGISTRATION — NOT A REAL ENTRY", "No money, card details", "dateOfBirth", "acceptTerms", "acceptPrivacy", "Emergency-contact"])
  if (!runnerPage.includes(required)) errors.push(`Runner prototype missing: ${required}`);
for (const required of ["Stage 1 of 4", "Submit test entry", "View this entry as organiser", "Start a test registration"])
  if (!runnerPage.includes(required)) errors.push(`Runner journey is missing: ${required}`);
const client = fs.readFileSync("registration/prototype-client.mjs", "utf8");
if (!client.includes("PRODUCTION_CLOSED") || !client.includes("canTest")) errors.push("Production-closed client guard is missing");
if (/searchParams|location\.search|querySelector\([^)]*mode/i.test(client)) errors.push("A URL/query override could alter registration mode");
const allSource = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
for (const forbidden of ["stripe.com", "paypal.com", "sendgrid", "mailgun", "connectionString", "AZURE_STATIC_WEB_APPS_API_TOKEN"])
  if (allSource.toLowerCase().includes(forbidden.toLowerCase())) errors.push(`Unexpected external/credential integration: ${forbidden}`);
const entryPage = fs.readFileSync("enter.html", "utf8");
if (/href=["'][^"']*registration\//i.test(entryPage)) errors.push("Public entry page activates the prototype");
const fixtures = JSON.parse(fs.readFileSync("registration/fixtures.json", "utf8"));
if (fixtures.some((fixture) => fixture.runner?.email && !/@(example\.(com|org|net)|[^@]+\.invalid)$/i.test(fixture.runner.email))) errors.push("Fixture contains a non-synthetic email");
const repository = fs.readFileSync("registration/preview-repository.mjs", "utf8");
if (!repository.includes('STORAGE_KEY = "blorenge-registration-preview"') || !repository.includes("SCHEMA_VERSION = 3")) errors.push("Shared preview storage contract is missing");
const dashboard = fs.readFileSync("registration/dashboard.html", "utf8");
for (const required of ["Testing progress", "Technical details", "Reset test", "There are no test entries", "Also release race number?", "available for another entrant", "Audit history", "entry-audit"])
  if (!dashboard.includes(required)) errors.push(`Dashboard workflow is missing: ${required}`);
if (!dashboard.includes("prototype-pending") || !dashboard.includes('location.replace("../404.html")')) errors.push("Production organiser redirect/hidden guard is missing");
const prototypeCss = fs.readFileSync("registration/prototype.css", "utf8");
if (!prototypeCss.includes("[hidden]") || !prototypeCss.includes("display: none !important")) errors.push("Hidden stage controls can be exposed by button display styles");
if (dashboard.includes("dashboard-table") || prototypeCss.includes("min-width: 72rem")) errors.push("Organiser view retains a clipped wide table");
const runnerScript = fs.readFileSync("registration/runner.mjs", "utf8");
for (const id of ["start-test", "reset-test", "details-continue", "race-back", "race-continue", "review-back", "submit-test", "retry-payment"])
  if (!runnerScript.includes(`\"#${id}\"`)) errors.push(`Runner button lacks a handler: ${id}`);
const dashboardScript = fs.readFileSync("registration/dashboard.mjs", "utf8");
for (const id of ["close-detail", "reset-test", "export-csv", "keep-entry", "confirm-cancel-entry"])
  if (!dashboardScript.includes(`\"#${id}\"`)) errors.push(`Organiser button lacks a handler: ${id}`);
for (const required of ["Remove race number", "removeRaceNumber", "releaseRaceNumber"])
  if (!dashboardScript.includes(required)) errors.push(`Organiser race-number workflow is missing: ${required}`);
const phase2 = fs.readFileSync("registration/server/service.mjs", "utf8") + fs.readFileSync("registration/server/api.mjs", "utf8");
for (const required of ["IDEMPOTENCY_KEY_REQUIRED", "confirmationTokenHash", "race_number_removed", "record_anonymised", "csvFormulaSafe", "/api/v2/organiser/"])
  if (!phase2.includes(required)) errors.push(`Phase 2 server boundary is missing: ${required}`);
const staticConfig = fs.readFileSync("staticwebapp.config.json", "utf8");
for (const blocked of ["/registration/server/*", "/registration/fixtures.json", "/api/src/*", "/api/package.json", "/api/package-lock.json", "/infrastructure/*", "/docs/internal/*", "/tests/*"])
  if (!staticConfig.includes(blocked)) errors.push(`Preview source route is not blocked: ${blocked}`);
const developmentRoutes = fs.readFileSync("scripts/prepare-registration-development-routes.mjs", "utf8");
for (const protectedRoute of ["/registration/dashboard.html", "/api/v2/organiser/*", '"Organiser"', "/.auth/login/aad"])
  if (!developmentRoutes.includes(protectedRoute)) errors.push(`Cloud organiser boundary is missing: ${protectedRoute}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("Validated registration state guards, synthetic fixtures, HTML/mobile source, JavaScript syntax and external-service boundaries.");
