import { prototype } from "./prototype-client.mjs";
import { WFRA_SENIOR_ENTRY_DECLARATION } from "./declarations.mjs";

const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
const loading = document.querySelector("#declaration-loading");
const unavailable = document.querySelector("#declaration-unavailable");
const form = document.querySelector("#remote-declaration-form");
const complete = document.querySelector("#declaration-complete");
const result = token ? await prototype.declarationEntry(token) : { ok: false };
loading.hidden = true;
if (!result.ok) unavailable.hidden = false;
else if (result.registration.declaration.status === "complete") complete.hidden = false;
else {
  const runner = result.registration.runner; form.hidden = false;
  const guardian = runner.requiresGuardianDeclaration === true;
  document.querySelector("#declaration-runner").textContent = `${runner.firstName} ${runner.lastName}`;
  document.querySelector("#declaration-entry").replaceChildren(...[["Reference", result.registration.reference], ["Category", runner.raceCategory], ["Club", runner.club || "Unattached"]].flatMap(([label, value]) => { const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; return [dt, dd]; }));
  document.querySelector("#remote-declaration-content").replaceChildren(...WFRA_SENIOR_ENTRY_DECLARATION.paragraphs.map((text) => { const paragraph = document.createElement("p"); paragraph.textContent = text; return paragraph; }));
  if (guardian) {
    document.querySelector("#remote-declaration-instruction strong").textContent = "This runner is aged 16 or 17 on race day. Their parent or legal guardian must complete this declaration.";
    document.querySelector("#remote-declaration-name-label").firstChild.textContent = "Parent or legal guardian full name ";
    document.querySelector("#remote-declaration-acceptance").textContent = "I confirm I am the parent or legal guardian of the runner named above and I accept the WFRA declaration.";
  } else form.elements.typedFullName.value = `${runner.firstName} ${runner.lastName}`;
  form.dataset.guardian = String(guardian);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault(); const alert = document.querySelector("#declaration-alert"); alert.hidden = true;
  const guardian = form.dataset.guardian === "true";
  if (!form.elements.accepted.checked || !form.elements.typedFullName.value.trim()) { alert.textContent = guardian ? "A parent or legal guardian must type their full name and accept the declaration." : "The named runner must type their name and accept the declaration."; alert.hidden = false; alert.focus(); return; }
  const response = await prototype.completeDeclaration(token, { accepted: true, typedFullName: form.elements.typedFullName.value, signatoryRole: guardian ? "Parent / Legal Guardian" : "Competitor", completedByNamedRunner: !guardian, completedByParentOrLegalGuardian: guardian });
  if (!response.ok) { alert.textContent = response.code === "DECLARATION_NAME_MISMATCH" ? "The typed name must match the named runner." : "The declaration could not be completed. Ask the organiser to resend the secure link."; alert.hidden = false; alert.focus(); return; }
  form.hidden = true; complete.hidden = false; complete.querySelector("h2").focus();
});

document.querySelector("#declaration-recovery-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; const response = await prototype.recoverDeclarationLink(new FormData(event.currentTarget).get("email"));
  document.querySelector("#declaration-recovery-message").textContent = response.ok ? response.message : "The request could not be completed. Please try again later."; button.disabled = false;
});
