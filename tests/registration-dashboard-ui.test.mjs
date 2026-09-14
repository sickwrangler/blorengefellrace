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
