import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WFRA_SENIOR_ENTRY_DECLARATION } from "../registration/declarations.mjs";
import { renderRegistrationEmail } from "../registration/server/email-templates.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("runner registration removes prototype and internal operational wording", async () => {
  const [html, runner] = await Promise.all([
    read("registration/index.html"),
    read("registration/runner.mjs")
  ]);

  assert.match(html, /components\/navbar\/navbar\.html/);
  assert.match(html, /name="emergencyName"/);
  assert.match(html, /name="emergencyPhone"/);
  assert.match(html, /Continue to payment/);
  for (const unwanted of [
    "Prototype race terms",
    "Prototype acknowledgement",
    "Not automatically verified",
    "When will this runner complete their declaration?",
    "View payment status",
    "emergency-contact information needing to be removed later"
  ]) assert.doesNotMatch(html, new RegExp(unwanted, "i"));

  assert.doesNotMatch(runner, /Stripe test checkout/i);
  assert.doesNotMatch(runner, /Outstanding declarations do not prevent payment/i);
  assert.match(runner, /You are paying for/);
  assert.match(runner, /function declarationMode\(/);
  assert.match(runner, /function refreshSyntheticDeclarationName\(/);
  assert.doesNotMatch(runner, /form\.elements\.declarationTiming/);
});

test("removing the final basket runner clears review and restarts runner details", async () => {
  const runner = await read("registration/runner.mjs");
  assert.match(runner, /function restartEmptyOrder\(\)/);
  assert.match(runner, /order-runner-list"\)\.replaceChildren\(\)/);
  assert.match(runner, /order-total"\)\.textContent = "£0\.00"/);
  assert.match(runner, /order-review"\)\.hidden = true/);
  assert.match(runner, /currentOrder\.runnerCount === 0\) restartEmptyOrder\(\)/);
  assert.match(runner, /Your basket is empty\. Add a runner to start again\./);
});

test("declaration wording hides its version while retaining audit metadata", async () => {
  const [runner, declaration] = await Promise.all([
    read("registration/runner.mjs"),
    read("registration/declaration.mjs")
  ]);

  assert.equal(WFRA_SENIOR_ENTRY_DECLARATION.version, "21/02/23");
  assert.ok(WFRA_SENIOR_ENTRY_DECLARATION.paragraphs.some((paragraph) => paragraph.includes("v.21/02/23")));
  assert.ok(WFRA_SENIOR_ENTRY_DECLARATION.displayParagraphs.every((paragraph) => !paragraph.includes("21/02/23")));
  assert.match(runner, /displayParagraphs/);
  assert.match(declaration, /displayParagraphs/);
});

test("successful confirmation is concise and has normal site navigation", async () => {
  const [html, script] = await Promise.all([
    read("registration/payment-return.html"),
    read("registration/payment-return.mjs")
  ]);

  assert.match(html, /components\/navbar\/navbar\.html/);
  assert.doesNotMatch(html, /Return to entry information/i);
  assert.doesNotMatch(html, /Manage race entry/i);
  assert.match(script, /Entry confirmed/);
  assert.doesNotMatch(script, /Group entries confirmed/i);
  assert.doesNotMatch(script, /Stripe test/i);
});

test("declaration completion securely returns to Manage race entry", async () => {
  const [html, script] = await Promise.all([
    read("registration/declaration.html"),
    read("registration/declaration.mjs")
  ]);

  assert.match(html, /components\/navbar\/navbar\.html/);
  assert.match(script, /rememberManagementToken/);
  assert.match(script, /history\.replaceState/);
  assert.match(script, /manage\.html\?declaration=complete/);
  assert.doesNotMatch(script, /registration\/index\.html/);
});

test("manage page is read-only by default with separate accessible dialogs", async () => {
  const [html, script, css] = await Promise.all([
    read("registration/manage.html"),
    read("registration/manage.mjs"),
    read("registration/prototype.css")
  ]);

  assert.match(html, /components\/navbar\/navbar\.html/);
  assert.match(html, /id="entry-summary"/);
  assert.match(html, /id="payment-status-badge"/);
  assert.match(html, /id="declaration-status-badge"/);
  assert.match(html, /id="edit-entry-dialog"[^>]*aria-labelledby="edit-entry-title"/);
  assert.match(html, /id="transfer-entry-dialog"[^>]*aria-labelledby="transfer-entry-title"/);
  assert.match(html, /<button[^>]*id="edit-entry"[^>]*>Edit entry<\/button>/);
  assert.match(html, /<button[^>]*id="transfer-entry"[^>]*>Transfer entry<\/button>/);
  assert.match(html, /Transfer this race place to another runner\./);
  assert.doesNotMatch(html, /id="edit-entry"[^>]*>Transfer entry/);

  assert.match(script, /Payment required/);
  assert.match(html, /Continue to payment/);
  assert.match(script, /Declaration required/);
  assert.match(html, /Sign your race declaration/);
  assert.match(script, /Declaration complete/);
  assert.match(script, /showModal\(\)/);
  assert.match(script, /returnFocusTo\?\.focus\(\)/);
  assert.match(script, /confirm\("Transfer this race place/);
  assert.match(script, /✓/);
  assert.match(script, /!/);

  assert.match(css, /\.status-badge--positive/);
  assert.match(css, /\.status-badge--required/);
  assert.match(css, /\.status-badge--info/);
  assert.match(css, /@media \(max-width: 30rem\)/);
  assert.match(css, /dialog/);
});

test("runner pages use the generic site header", async () => {
  const pages = [
    "registration/index.html",
    "registration/payment-return.html",
    "registration/declaration.html",
    "registration/manage.html",
    "registration/start-list.html"
  ];
  for (const page of pages) assert.match(await read(page), /components\/navbar\/navbar\.html/, page);
});

test("declaration emails use the runner-facing call to action", () => {
  for (const template of ["entry_confirmed_declaration_required", "declaration_reminder", "entry_transferred"]) {
    const rendered = renderRegistrationEmail(template, {
      firstName: "Test",
      declarationUrl: "https://development.example/registration/declaration.html#token=synthetic",
      secureUrl: "https://development.example/registration/manage.html#token=synthetic"
    });
    assert.match(rendered.text, /Sign your race declaration/);
    assert.match(rendered.html, /Sign your race declaration/);
    assert.doesNotMatch(rendered.text, /Complete declaration token|Open declaration link|Manage declaration/i);
  }
});
