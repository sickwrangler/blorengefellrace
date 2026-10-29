import { prototype } from "./prototype-client.mjs";
import { runnerMessageForCode } from "./runner-errors.mjs";

const accessPanel = document.querySelector("#access-panel");
const accessMessage = document.querySelector("#access-message");
const entryPanel = document.querySelector("#entry-panel");
const entrySummary = document.querySelector("#entry-summary");
const contactSummary = document.querySelector("#contact-summary");
const continuePayment = document.querySelector("#continue-payment");
const signDeclaration = document.querySelector("#sign-declaration");
const editEntry = document.querySelector("#edit-entry");
const transferEntry = document.querySelector("#transfer-entry");
const requestRefund = document.querySelector("#request-refund");
const actionMessage = document.querySelector("#action-message");
const unavailableActions = document.querySelector("#unavailable-actions");
const actionReasons = document.querySelector("#action-reasons");
const editDialog = document.querySelector("#edit-entry-dialog");
const transferDialog = document.querySelector("#transfer-entry-dialog");
const amendForm = document.querySelector("#amend-form");
const transferForm = document.querySelector("#transfer-form");
let current = null;

const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
if (fragment.get("token")) prototype.rememberManagementToken(fragment.get("token"));
if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);

function rows(target, items) {
  target.replaceChildren(...items.flatMap(([term, value]) => {
    const dt = document.createElement("dt"); dt.textContent = term;
    const dd = document.createElement("dd"); dd.textContent = value || "Not supplied";
    return [dt, dd];
  }));
}

function setBadge(id, label, tone, icon) {
  const badge = document.querySelector(id);
  badge.className = `status-badge status-badge--${tone}`;
  badge.replaceChildren();
  const symbol = document.createElement("span"); symbol.setAttribute("aria-hidden", "true"); symbol.textContent = icon;
  const text = document.createElement("span"); text.textContent = label;
  badge.append(symbol, text);
}

function paymentPresentation(payment) {
  if (payment.state === "paid") return { label: "Paid", tone: "positive", icon: "✓", summary: "Payment has been confirmed." };
  if (["created", "not_configured", "failed", "expired", "checkout_pending"].includes(payment.state)) return { label: "Payment required", tone: "required", icon: "!", summary: "Payment is required to confirm this race place." };
  if (payment.state === "processing") return { label: "Payment processing", tone: "info", icon: "…", summary: "Payment is being confirmed." };
  if (payment.state === "refund_requested") return { label: "Refund requested", tone: "info", icon: "…", summary: "Your refund request is awaiting organiser review." };
  if (payment.state === "refund_approved") return { label: "Refund approved", tone: "info", icon: "…", summary: "Your approved refund is awaiting processing." };
  if (payment.state === "refunded") return { label: "Refund completed", tone: "neutral", icon: "○", summary: "The payment has been refunded." };
  return { label: payment.label || "Payment status", tone: "neutral", icon: "○", summary: payment.label || "Payment status is available." };
}

function deadlineText(value) {
  if (!value) return "the published deadline";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(value));
}

function actionReason(label, action) {
  const deadline = deadlineText(action.deadline ?? current?.policy?.transferRefundCutoffUtc);
  const reasons = {
    ENTRY_INACTIVE: "This entry is no longer active.",
    PAYMENTS_UNAVAILABLE: "Online payment is temporarily unavailable.",
    REGISTRATION_NOT_ACCEPTING: "Registration is not currently accepting payments.",
    PAYMENT_ALREADY_COMPLETE: "Payment is already complete.",
    PAYMENT_PROCESSING: "Payment is still being confirmed.",
    PAYMENT_REFUNDED: "The payment for this entry has been refunded.",
    PAYMENT_NOT_AVAILABLE: "Payment cannot be continued from the entry’s current state.",
    DECLARATION_COMPLETE: "The race declaration is already complete.",
    DECLARATION_AFTER_PAYMENT: "The declaration link becomes available after payment confirms the place.",
    TRANSFER_CUTOFF_PASSED: `Runner transfers closed on ${deadline}. Contact the organiser if an exceptional change is needed.`,
    REFUND_CUTOFF_PASSED: `Online refund requests closed on ${deadline}. Contact the organiser if you need help.`,
    REFUND_NOT_READY: "A refund can only be requested after payment is confirmed.",
    REFUND_ALREADY_IN_PROGRESS: "A refund request is already being reviewed or processed."
  };
  return `${label}: ${reasons[action.code] ?? "This action is not available for the entry’s current state."}`;
}

function renderActions() {
  const actions = current.actions ?? {
    continuePayment: { available: current.payment.canContinue },
    signDeclaration: { available: current.declaration?.status !== "complete" },
    amend: { available: current.amendmentEligible },
    transfer: { available: current.transferEligible },
    requestRefund: { available: current.refundEligible }
  };
  const controls = [
    ["Continue payment", continuePayment, actions.continuePayment],
    ["Sign declaration", signDeclaration, actions.signDeclaration],
    ["Edit entry", editEntry, actions.amend],
    ["Transfer entry", transferEntry, actions.transfer],
    ["Request refund", requestRefund, actions.requestRefund]
  ];
  for (const [, button, action] of controls) button.hidden = action?.available !== true;
  const unavailable = controls.filter(([, , action]) => action?.available === false).map(([label, , action]) => {
    const item = document.createElement("li"); item.textContent = actionReason(label, action); return item;
  });
  actionReasons.replaceChildren(...unavailable);
  unavailableActions.hidden = unavailable.length === 0;
  const availableChanges = [actions.continuePayment, actions.signDeclaration, actions.amend, actions.transfer, actions.requestRefund].some((action) => action?.available);
  actionMessage.textContent = availableChanges ? "" : "There are no self-service changes available for this entry at present.";
}

function populateEditForm() {
  const values = {
    phone: current.runner.phone, addressLine1: current.runner.addressLine1, addressLine2: current.runner.addressLine2,
    city: current.runner.city, postcode: current.runner.postcode, raceCategory: current.runner.raceCategory,
    club: current.runner.club, emergencyContactName: current.emergencyContact?.name, emergencyContactPhone: current.emergencyContact?.phone
  };
  for (const [name, value] of Object.entries(values)) if (amendForm.elements[name]) amendForm.elements[name].value = value ?? "";
}

function openDialog(dialog, opener) {
  dialog.returnFocusTo = opener;
  dialog.showModal();
  window.requestAnimationFrame(() => dialog.querySelector("input, select, button")?.focus());
}

async function render() {
  const result = await prototype.managementEntry();
  if (!result.ok) { accessPanel.hidden = false; entryPanel.hidden = true; accessMessage.textContent = runnerMessageForCode(result.code); return; }
  current = result.registration; accessPanel.hidden = true; entryPanel.hidden = false;

  const entryConfirmed = current.placeStatus === "confirmed" && !["cancelled", "place_released"].includes(current.entryStatus);
  setBadge("#entry-status-badge", entryConfirmed ? "Entry confirmed" : "Entry pending", entryConfirmed ? "positive" : "info", entryConfirmed ? "✓" : "…");
  const payment = paymentPresentation(current.payment); setBadge("#payment-status-badge", payment.label, payment.tone, payment.icon);
  const declarationComplete = current.declaration?.status === "complete";
  setBadge("#declaration-status-badge", declarationComplete ? "Declaration complete" : "Declaration required", declarationComplete ? "positive" : "required", declarationComplete ? "✓" : "!");

  rows(entrySummary, [["Runner", `${current.runner.firstName} ${current.runner.lastName}`], ["Entry reference", current.reference], ["Category", current.runner.raceCategory], ["Club", current.runner.club || "Unattached"], ["Race number", current.raceNumber == null ? "Not assigned" : String(current.raceNumber)]]);
  const address = [current.runner.addressLine1, current.runner.addressLine2, current.runner.city, current.runner.postcode].filter(Boolean).join(", ");
  rows(contactSummary, [["Email", current.runner.email], ["Phone", current.runner.phone], ["Address", address], ["Emergency contact", current.emergencyContact?.name], ["Emergency phone", current.emergencyContact?.phone]]);
  document.querySelector("#payment-summary").textContent = payment.summary;
  document.querySelector("#declaration-summary").textContent = declarationComplete ? "The race declaration is complete." : "The runner must sign the race declaration before race day.";

  renderActions();
  populateEditForm();

  if (new URLSearchParams(location.search).get("declaration") === "complete") {
    actionMessage.textContent = "Declaration complete. Your entry status has been updated.";
    history.replaceState(null, "", location.pathname);
  }
}

document.querySelector("#recovery-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const result = await prototype.recoverManagementLink(new FormData(event.currentTarget).get("email"));
  accessMessage.textContent = result.ok ? result.message : "The request could not be completed. Please try again later."; button.disabled = false;
});

document.querySelector("#refresh-entry").addEventListener("click", render);
continuePayment.addEventListener("click", async () => { continuePayment.disabled = true; const result = await prototype.checkout(); if (result.ok && result.checkoutUrl) return location.assign(result.checkoutUrl); actionMessage.textContent = runnerMessageForCode(result.code); continuePayment.disabled = false; });
signDeclaration.addEventListener("click", async () => { signDeclaration.disabled = true; const result = await prototype.recoverDeclarationLink(current.runner.email); actionMessage.textContent = result.ok ? "We’ve emailed the runner a secure link to sign their race declaration." : "The declaration link could not be sent. Please try again later."; signDeclaration.disabled = false; });
requestRefund.addEventListener("click", async () => { if (!confirm("Request a refund for this entry? The organiser must approve it.")) return; const result = await prototype.requestRefund(); actionMessage.textContent = result.ok ? "Refund requested. The organiser will review it." : runnerMessageForCode(result.code); if (result.ok) await render(); });

editEntry.addEventListener("click", () => { populateEditForm(); document.querySelector("#amend-message").hidden = true; openDialog(editDialog, editEntry); });
transferEntry.addEventListener("click", () => { transferForm.reset(); document.querySelector("#transfer-message").hidden = true; openDialog(transferDialog, transferEntry); });

for (const dialog of [editDialog, transferDialog]) {
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.returnFocusTo?.focus());
}

amendForm.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!amendForm.checkValidity()) return amendForm.reportValidity();
  const message = document.querySelector("#amend-message"); message.hidden = true;
  const data = Object.fromEntries(new FormData(amendForm)); const result = await prototype.amendEntry(data);
  if (!result.ok) { message.textContent = Object.values(result.errors ?? {})[0] ?? runnerMessageForCode(result.code); message.hidden = false; message.focus(); return; }
  editDialog.close(); actionMessage.textContent = "Your changes were saved."; await render();
});

transferForm.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!transferForm.checkValidity()) return transferForm.reportValidity();
  if (!confirm("Transfer this race place to the new runner? Your current secure link will stop working.")) return;
  const message = document.querySelector("#transfer-message"); message.hidden = true;
  const data = Object.fromEntries(new FormData(transferForm)); const result = await prototype.transferEntry({ runner: { ...data } });
  if (!result.ok) { message.textContent = Object.values(result.errors ?? {})[0] ?? runnerMessageForCode(result.code); message.hidden = false; message.focus(); return; }
  transferDialog.close(); prototype.forgetManagementToken(); history.replaceState(null, "", "manage.html"); entryPanel.hidden = true; accessPanel.hidden = false; accessMessage.textContent = "Entry transferred. This previous secure link has been revoked and the new runner has been sent their own links.";
});

await render();
