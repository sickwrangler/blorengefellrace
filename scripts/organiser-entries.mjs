import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const site = "https://www.blorengefellrace.cymru";
const cliHome = join(homedir(), ".blorenge-organiser");
const usage = `Usage
  node scripts/organiser-entries.mjs find SEARCH
  node scripts/organiser-entries.mjs restore REFERENCE --email EMAIL --reason REASON --apply
  node scripts/organiser-entries.mjs add RUNNER_JSON --reason REASON --apply
  node scripts/organiser-entries.mjs withdraw REFERENCE --email EMAIL --reason REASON --apply`;

async function request(context, route, data) {
  const url = new URL(route, site);
  const response = await context.request.fetch(url.href, {
    method: data === undefined ? "GET" : "POST", data, maxRedirects: 0, timeout: 30_000
  });
  const type = response.headers()["content-type"] ?? "";
  if (!type.includes("application/json")) throw new Error(`Registration API returned HTTP ${response.status()}.`);
  const result = await response.json();
  if (!response.ok() || result.ok !== true) {
    const details = result.errors ? ` (${Object.keys(result.errors).join(", ")})` : "";
    throw new Error(`${result.code ?? `HTTP ${response.status()}`}${details}`);
  }
  return result;
}

async function findEntries(context, search) {
  const result = await request(context, `/api/v2/organiser/snapshot?search=${encodeURIComponent(search)}`);
  return result.state.registrations;
}

async function run() {
  const { positionals: [command, value, ...extra], values } = parseArgs({
    allowPositionals: true,
    options: { email: { type: "string" }, reason: { type: "string" }, apply: { type: "boolean" }, help: { type: "boolean" } }
  });
  if (values.help || !command) { console.log(usage); return; }
  if (!["find", "add", "restore", "withdraw"].includes(command) || !value?.trim() || extra.length) throw new Error(usage);
  if (command !== "find" && (!values.apply || !values.reason?.trim())) throw new Error("Pass --reason and --apply to execute a change.");
  if (["restore", "withdraw"].includes(command) && !values.email?.trim()) throw new Error("Pass --email to confirm the runner's identity.");
  const runner = command === "add" ? JSON.parse(await readFile(value, "utf8")) : undefined;
  if (command === "add" && (!runner || typeof runner !== "object" || Array.isArray(runner))) {
    throw new Error("The runner file must contain a JSON object.");
  }

  await mkdir(cliHome, { recursive: true, mode: 0o700 });
  const require = createRequire(join(cliHome, "package.json"));
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch { throw new Error("Install Playwright for this command with npm install --prefix ~/.blorenge-organiser playwright."); }
  const context = await chromium.launchPersistentContext(join(cliHome, "browser"), { headless: false });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    const dashboard = `${site}/registration/dashboard.html`;
    console.error("Sign in with your organiser account if prompted.");
    await page.goto(dashboard, { waitUntil: "domcontentloaded" });
    await page.waitForURL(dashboard, { timeout: 180_000, waitUntil: "domcontentloaded" });

    if (command === "find") {
      const entries = await findEntries(context, value);
      console.table(entries.map((item) => ({
        reference: item.testReference,
        runner: `${item.runner.firstName} ${item.runner.lastName}`,
        entry: item.entryStatus,
        place: item.placeStatus,
        payment: item.paymentStatus,
        declaration: item.declarationStatus
      })));
      return;
    }
    if (command === "withdraw") {
      const entries = await findEntries(context, value);
      const matches = entries.filter((item) => item.testReference === value);
      if (matches.length !== 1) throw new Error("The entry reference must identify exactly one registration.");
      const result = await request(context, `/api/v3/organiser/registrations/${encodeURIComponent(matches[0].id)}/withdraw`, {
        reason: values.reason, expectedEmail: values.email
      });
      console.log(JSON.stringify({
        reference: value, entryStatus: result.registration.entryStatus, placeStatus: result.registration.placeStatus,
        duplicate: result.duplicate, notificationDeliveryFailed: result.notificationDeliveryFailed
      }, null, 2));
      return;
    }
    const input = command === "restore" ? { restoreReference: value, expectedEmail: values.email } : { runner };
    const result = await request(context, "/api/v4/organiser/direct-entries", {
      ...input, confirmFeeWaiver: true, reason: values.reason
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
