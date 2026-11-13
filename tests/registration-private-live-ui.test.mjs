import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { privateAccessPurposeCandidates, runnerAccessDecision, runnerEntryAvailability } from "../registration/runner-access.mjs";

const production = (operationalState) => ({ environment: "production", operationalState });
const unavailable = (code) => ({ ok: false, code });

test("PRIVATE_LIVE exposes registration only to valid registration access or an existing secure order", () => {
  const status = production("PRIVATE_LIVE");
  assert.equal(runnerAccessDecision({ canTest: true, status }), "unavailable");
  for (const code of ["INVITATION_NOT_FOUND", "INVITATION_EXPIRED", "INVITATION_REVOKED", "INVITATION_USED", "LINK_UNAVAILABLE"]) {
    assert.equal(runnerAccessDecision({ canTest: true, status, privateAccess: unavailable(code) }), "unavailable");
  }
  assert.equal(runnerAccessDecision({ canTest: true, status, privateAccess: { ok: true, purpose: "registration" } }), "available");
  assert.equal(runnerAccessDecision({ canTest: true, status, privateAccess: { ok: true, purpose: "waiting_list_offer" } }), "available");
  assert.equal(runnerAccessDecision({ canTest: true, status, privateAccess: unavailable("INVITATION_USED"), recovered: { ok: true, order: { status: "draft" } } }), "available");
});

test("CLOSED stays unavailable and OPEN stays publicly available", () => {
  assert.equal(runnerAccessDecision({ canTest: true, status: production("CLOSED") }), "unavailable");
  assert.equal(runnerAccessDecision({ canTest: true, status: production("OPEN") }), "available");
  assert.equal(runnerAccessDecision({ canTest: true, status: { ...production("OPEN"), unavailable: true } }), "unavailable");
});

test("waiting-list invitation purpose is resolved authoritatively even without the offer URL hint", () => {
  assert.deepEqual(privateAccessPurposeCandidates({ offerHint: true }), ["waiting_list_offer"]);
  assert.deepEqual(privateAccessPurposeCandidates(), ["registration", "waiting_list_offer"]);
  assert.deepEqual(privateAccessPurposeCandidates({ proofHint: true }), ["stripe_provider_proof"]);
});

test("a validated offer exposes its reserved place at 120 allocated while public entry remains blocked", () => {
  const status = { environment: "development", operationalState: "test", capacity: 120, accepted: 119, remaining: 0, waiting: 1, publicRegistrationAvailable: false };
  const offered = runnerEntryAvailability({ status, hasPrivateInvitation: true, privateAccess: { ok: true, purpose: "waiting_list_offer" } });
  assert.deepEqual(offered, { publicRegistrationAvailable: false, waitingListOffer: true, invalidPrivateLink: false, entryFormAvailable: true, waitingListAvailable: false });
  const ordinary = runnerEntryAvailability({ status });
  assert.equal(ordinary.entryFormAvailable, false);
  assert.equal(ordinary.waitingListAvailable, true);
});

test("invalid, expired, cancelled and used invitation responses fail closed", () => {
  const status = { environment: "development", operationalState: "test", remaining: 0, waiting: 1, publicRegistrationAvailable: false };
  for (const code of ["LINK_UNAVAILABLE", "INVITATION_EXPIRED", "INVITATION_REVOKED", "OFFER_NOT_ACTIVE", "INVITATION_USED"]) {
    const privateAccess = unavailable(code);
    const availability = runnerEntryAvailability({ status, hasPrivateInvitation: true, privateAccess });
    assert.equal(availability.invalidPrivateLink, true);
    assert.equal(availability.entryFormAvailable, false);
    assert.equal(availability.waitingListAvailable, false);
    assert.equal(runnerAccessDecision({ canTest: true, status, hasPrivateInvitation: true, privateAccess }), "unavailable");
  }
});

test("the CLOSED provider proof recovery remains narrowly available", () => {
  const status = production("CLOSED");
  assert.equal(runnerAccessDecision({ canTest: true, status, privateAccess: { ok: true, purpose: "stripe_provider_proof" } }), "available");
  assert.equal(runnerAccessDecision({ canTest: true, status, recovered: { ok: true, order: { status: "checkout_pending", providerProof: true } } }), "available");
  assert.equal(runnerAccessDecision({ canTest: true, status, recovered: { ok: true, order: { status: "checkout_pending" } } }), "unavailable");
});

test("unavailable invitation links use helpful generic wording without becoming an invitation oracle", () => {
  const html = fs.readFileSync(new URL("../registration/index.html", import.meta.url), "utf8");
  const runner = fs.readFileSync(new URL("../registration/runner.mjs", import.meta.url), "utf8");
  assert.match(html, /id="closed-panel"[\s\S]*2026 entries are not yet open/);
  assert.match(runner, /This secure invitation link is no longer available/);
  assert.match(runner, /expired, been cancelled or already been used/);
  assert.doesNotMatch(html, /id="invalid-link-panel"|access token|invitation missing/i);
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
