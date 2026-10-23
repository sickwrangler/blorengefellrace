import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("race-number assignment uses an accessible form dialog instead of a native prompt", () => {
  const page = fs.readFileSync("registration/dashboard.html", "utf8");
  const script = fs.readFileSync("registration/dashboard.mjs", "utf8");

  assert.match(page, /<dialog id="race-number-dialog"[^>]+aria-labelledby="race-number-title"/);
  assert.match(page, /<form id="race-number-form">/);
  assert.match(page, /id="race-number-value"[^>]+type="number"[^>]+min="1"[^>]+max="999"/);
  assert.match(script, /#race-number-dialog/);
  assert.match(script, /#race-number-form/);
  assert.match(script, /prototype\.assign\(registrationId, value\)/);
  assert.doesNotMatch(script, /window\.prompt\("Enter a synthetic race number"/);
});

test("routine correction uses an accessible form dialog instead of native prompts", () => {
  const page = fs.readFileSync("registration/dashboard.html", "utf8");
  const script = fs.readFileSync("registration/dashboard.mjs", "utf8");

  assert.match(page, /<dialog id="entry-correction-dialog"[^>]+aria-labelledby="entry-correction-title"/);
  assert.match(page, /<form id="entry-correction-form">/);
  assert.match(script, /prototype\.correctEntry\(registrationId, data\)/);
  assert.doesNotMatch(script, /window\.prompt/);
});

test("provider-proof refund controls are explicit and mode-aware", () => {
  const script = fs.readFileSync("registration/dashboard.mjs", "utf8");
  assert.match(script, /Create controlled proof refund request/);
  assert.match(script, /requestProviderProofRefund\(item\.id\)/);
  assert.match(script, /This does not send money yet/);
  assert.match(script, /This will return real money when Stripe is live/);
  assert.match(script, /Revoke proof access/);
});

test("organiser dashboard reports aggregate email health and receipt delivery semantics", () => {
  const page = fs.readFileSync("registration/dashboard.html", "utf8");
  const script = fs.readFileSync("registration/dashboard.mjs", "utf8");
  assert.match(page, /id="email-health-title">Email health/);
  for (const id of ["email-expected", "email-sent", "email-failed", "email-missing"]) assert.match(page, new RegExp(`id="${id}"`));
  assert.match(script, /prototype\.emailHealth\(\)/);
  assert.match(script, /message\.delivery === "sent" \? "Sent"/);
  assert.match(script, /Recipient \$\{message\.intendedRecipientAddress/);
  assert.doesNotMatch(script, /strong\.textContent = message\.subject/);
});

test("organiser dashboard separates the private workbook and marks transferred entries", () => {
  const html = fs.readFileSync("registration/dashboard.html", "utf8");
  const source = fs.readFileSync("registration/dashboard.mjs", "utf8");
  const localServer = fs.readFileSync("scripts/start-registration-phase2.mjs", "utf8");
  assert.match(html, /id="export-csv"[^>]*>Export race-day CSV/);
  assert.match(html, /id="export-private-workbook"[^>]*>Export full registration workbook/);
  assert.match(html, /Private operational data including contact details and transfer history/);
  assert.match(source, /item\.transfer\?\.transferred/);
  assert.match(source, /marker\.textContent = "Transferred"/);
  for (const label of ["Transfer count", "Original runner", "Previous runner", "Latest transfer"]) assert.ok(source.includes(`"${label}"`));
  assert.match(localServer, /privateWorkbookExporter: createPrivateRegistrationWorkbook/);
  assert.match(localServer, /Buffer\.isBuffer\(result\.body\)/);
});

test("Azure Function entry modules lazy-load private workbook generation", () => {
  for (const filename of ["api/src/functions/registration.mjs", "api/src/functions/registration-production.mjs"]) {
    const source = fs.readFileSync(filename, "utf8");
    assert.doesNotMatch(source, /^import\s+\{\s*createPrivateRegistrationWorkbook\s*\}\s+from/m, filename);
    assert.match(source, /await import\("\.\.\/private-workbook\.mjs"\)/, filename);
    assert.match(source, /privateWorkbookExporter\s*\}/, filename);
  }
});
