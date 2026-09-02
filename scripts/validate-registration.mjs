import fs from "node:fs";
import { execFileSync } from "node:child_process";

const files = ["registration/index.html", "registration/dashboard.html", "registration/prototype.css", "registration/runner.mjs", "registration/dashboard.mjs", "registration/prototype-client.mjs", "registration/preview-repository.mjs", "registration/registration-core.mjs", "registration/fixtures.json", "scripts/start-registration-prototype.mjs"];
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
for (const required of ["TEST REGISTRATION — NOT A REAL ENTRY", "No card details", "dateOfBirth", "acceptTerms", "acceptPrivacy", "Emergency-contact"])
  if (!runnerPage.includes(required)) errors.push(`Runner prototype missing: ${required}`);
for (const required of ["Stage 1 of 5", "Create test registration and continue to mock payment", "confirmation-reference"])
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
if (!repository.includes('STORAGE_KEY = "blorenge-registration-preview"') || !repository.includes("SCHEMA_VERSION = 2")) errors.push("Shared preview storage contract is missing");
const dashboard = fs.readFileSync("registration/dashboard.html", "utf8");
for (const required of ["Development diagnostics", "Refresh test data", "Load/reset synthetic fixtures", "Schema version"])
  if (!dashboard.includes(required)) errors.push(`Dashboard diagnostic is missing: ${required}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("Validated registration state guards, synthetic fixtures, HTML/mobile source, JavaScript syntax and external-service boundaries.");
