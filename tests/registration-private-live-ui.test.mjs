import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { runnerAccessDecision } from "../registration/runner-access.mjs";

const production = (operationalState) => ({ environment: "production", operationalState });
const unavailable = (code) => ({ ok: false, code });

test("PRIVATE_LIVE exposes registration only to valid registration access or an existing secure order", () => {
  const status = production("PRIVATE_LIVE");
  assert.equal(runnerAccessDecision({ canTest: true, status }), "unavailable");
  for (const code of ["INVITATION_NOT_FOUND", "INVITATION_EXPIRED", "INVITATION_REVOKED", "INVITATION_USED", "LINK_UNAVAILABLE"]) {
    assert.equal(runnerAccessDecision({ canTest: true, status, privateAccess: unavailable(code) }), "unavailable");
  }
  assert.equal(runnerAccessDecision({ canTest: true, status, privateAccess: { ok: true, purpose: "registration" } }), "available");
  assert.equal(runnerAccessDecision({ canTest: true, status, privateAccess: unavailable("INVITATION_USED"), recovered: { ok: true, order: { status: "draft" } } }), "available");
});

test("CLOSED stays unavailable and OPEN stays publicly available", () => {
  assert.equal(runnerAccessDecision({ canTest: true, status: production("CLOSED") }), "unavailable");
  assert.equal(runnerAccessDecision({ canTest: true, status: production("OPEN") }), "available");
  assert.equal(runnerAccessDecision({ canTest: true, status: { ...production("OPEN"), unavailable: true } }), "unavailable");
});

test("the CLOSED provider proof recovery remains narrowly available", () => {
  const status = production("CLOSED");
  assert.equal(runnerAccessDecision({ canTest: true, status, privateAccess: { ok: true, purpose: "stripe_provider_proof" } }), "available");
  assert.equal(runnerAccessDecision({ canTest: true, status, recovered: { ok: true, order: { status: "checkout_pending", providerProof: true } } }), "available");
  assert.equal(runnerAccessDecision({ canTest: true, status, recovered: { ok: true, order: { status: "checkout_pending" } } }), "unavailable");
});

test("all unavailable cases use one generic runner-facing presentation without an invitation oracle", () => {
  const html = fs.readFileSync(new URL("../registration/index.html", import.meta.url), "utf8");
  const runner = fs.readFileSync(new URL("../registration/runner.mjs", import.meta.url), "utf8");
  assert.match(html, /id="closed-panel"[\s\S]*2026 entries are not yet open/);
  assert.doesNotMatch(html, /id="invalid-link-panel"|private link|required invitation|access token|invitation missing/i);
  assert.doesNotMatch(runner, /invalid-link-panel/);
  assert.match(html, /id="access-check-status"[\s\S]*Checking registration availability/);
  assert.match(html, /id="test-experience" hidden/);
});

test("privacy acknowledgement is one accessible inline-wrapping checkbox control", () => {
  const html = fs.readFileSync(new URL("../registration/index.html", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../registration/prototype.css", import.meta.url), "utf8");
  assert.match(html, /<label class="checkbox-field"><input name="acceptPrivacy" type="checkbox" required><span>I have read the <a href="\.\.\/privacy\.html"[^>]*>Privacy Notice<\/a>\.<\/span><\/label>/);
  assert.match(css, /\.checkbox-field\s*\{[^}]*grid-template-columns:\s*auto 1fr/);
  assert.match(css, /\.checkbox-field > span\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /body\s*\{[^}]*min-width:\s*0/);
});
