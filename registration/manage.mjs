import { prototype } from "./prototype-client.mjs";
import { WFRA_SENIOR_ENTRY_DECLARATION } from "./declarations.mjs";
import { runnerMessageForCode } from "./runner-errors.mjs";

const accessPanel = document.querySelector("#access-panel");
const accessMessage = document.querySelector("#access-message");
const entryPanel = document.querySelector("#entry-panel");
const amendPanel = document.querySelector("#amend-panel");
const transferPanel = document.querySelector("#transfer-panel");
const summary = document.querySelector("#entry-summary");
const continuePayment = document.querySelector("#continue-payment");
const requestRefund = document.querySelector("#request-refund");
let current = null;

const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
if (fragment.get("token")) prototype.rememberManagementToken(fragment.get("token"));
if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);

function rows(items) {
  summary.replaceChildren(...items.flatMap(([term, value]) => {
    const dt = document.createElement("dt"); dt.textContent = term;
    const dd = document.createElement("dd"); dd.textContent = value || "Not supplied";
    return [dt, dd];
  }));
}

async function render() {
  const result = await prototype.managementEntry();
  if (!result.ok) { accessPanel.hidden = false; entryPanel.hidden = true; amendPanel.hidden = true; transferPanel.hidden = true; accessMessage.textContent = runnerMessageForCode(result.code); return; }
  current = result.registration; accessPanel.hidden = true; entryPanel.hidden = false;
  amendPanel.hidden = !current.amendmentEligible; transferPanel.hidden = !current.transferEligible;
  rows([["Runner", `${current.runner.firstName} ${current.runner.lastName}`], ["Reference", current.reference], ["Entry status", current.entryStatus], ["Payment / refund", current.payment.label], ["Race category", current.runner.raceCategory], ["Club", current.runner.club], ["Race number", current.raceNumber == null ? "Not assigned" : String(current.raceNumber)]]);
  continuePayment.hidden = !current.payment.canContinue; requestRefund.hidden = !current.refundEligible;
  const amend = document.querySelector("#amend-form"); amend.elements.phone.value = current.runner.phone || ""; amend.elements.club.value = current.runner.club || "";
}

document.querySelector("#recovery-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const result = await prototype.recoverManagementLink(new FormData(event.currentTarget).get("email"));
  accessMessage.textContent = result.ok ? result.message : "The request could not be completed. Please try again later."; button.disabled = false;
});
document.querySelector("#refresh-entry").addEventListener("click", render);
continuePayment.addEventListener("click", async () => { const result = await prototype.checkout(); if (result.ok && result.checkoutUrl) location.assign(result.checkoutUrl); });
requestRefund.addEventListener("click", async () => { if (!confirm("Request a full refund for this entry? The organiser must approve it.")) return; const result = await prototype.requestRefund(); if (result.ok) await render(); });
document.querySelector("#amend-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const result = await prototype.amendEntry(data);
  document.querySelector("#amend-message").textContent = result.ok ? "Your changes were saved and a confirmation was sent." : runnerMessageForCode(result.code); if (result.ok) await render();
});
document.querySelector("#transfer-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!confirm("Transfer this entry and invalidate your current secure link?")) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const result = await prototype.transferEntry({ runner: { ...data }, declaration: { declarationIdentifier: WFRA_SENIOR_ENTRY_DECLARATION.identifier, declarationVersion: WFRA_SENIOR_ENTRY_DECLARATION.version, accepted: data.accepted === "on", typedFullName: data.typedFullName, signatoryRole: "Competitor" } });
  document.querySelector("#transfer-message").textContent = result.ok ? "Transfer complete. The new runner has been sent a new secure link." : runnerMessageForCode(result.code);
  if (result.ok) { prototype.rememberManagementToken(result.replacementManagementToken); await render(); }
});

await render();
