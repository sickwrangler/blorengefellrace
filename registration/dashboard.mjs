import { prototype, canTest, supportsManagedApi } from "./prototype-client.mjs";
import { queryRegistrations } from "./preview-repository.mjs";
import { availableOrganiserActions } from "./organiser-view.mjs";

let currentState;
let selectedReference = new URLSearchParams(window.location.search).get("ref");
let markingViewed = false;
let pendingCancellation = null;
let pendingTransfer = null;
let pendingRaceNumber = null;
let currentIntegrations = { paymentsAvailable: false, email: "captured-only" };
if (canTest) await render();

function showNotice(message, error = false) {
  const notice = document.querySelector("#organiser-alert"); notice.textContent = message; notice.hidden = false;
  notice.classList.toggle("form-alert--success", !error); notice.focus();
}
async function render() {
  const [snapshot, integrations] = await Promise.all([prototype.all(), prototype.integrationStatus()]); currentState = snapshot.state; currentIntegrations = integrations;
  const active = currentState.registrations.filter((item) => item.entryStatus !== "cancelled");
  const accepted = active.filter((item) => item.placeStatus === "confirmed").length;
  const reserved = active.filter((item) => item.placeStatus === "payment_reserved").length;
  const waiting = active.filter((item) => item.entryStatus === "waiting_list").length;
  const attention = active.filter((item) => ["created", "not_configured", "declined", "abandoned", "failed", "expired"].includes(item.paymentStatus)).length;
  const declarations = active.filter((item) => item.placeStatus === "confirmed" && item.declarationStatus === "pending").length;
  document.querySelector("#summary-accepted").textContent = accepted;
  document.querySelector("#summary-waiting").textContent = waiting;
  document.querySelector("#summary-payments").textContent = attention;
  document.querySelector("#summary-declarations").textContent = declarations;
  document.querySelector("#summary-remaining").textContent = Math.max(0, currentState.event.capacity - accepted - reserved);
  const environment = currentState.environment === "production" ? "Production" : "Development";
  const currentOperationalState = currentState.phase3RegistrationState ?? "CLOSED";
  const stateLabel = currentOperationalState === "PRIVATE_LIVE" ? "Private" : currentOperationalState === "CLOSED_FINAL" ? "Closed" : `${currentOperationalState[0]}${currentOperationalState.slice(1).toLowerCase()}`;
  document.querySelector("#environment-status").textContent = `${environment} · ${stateLabel} · ${integrations.paymentsAvailable ? "Stripe sandbox" : "Payments unavailable"}`;
  document.querySelector("#integration-status").textContent = `${integrations.paymentsAvailable ? "Stripe sandbox" : "Payments unavailable"} · ${integrations.externalEmailAvailable ? "Controlled email" : "Email captured only"}`;
  document.querySelector("#technical-environment").textContent = snapshot.diagnostics.environment;
  document.querySelector("#technical-storage").textContent = snapshot.diagnostics.storageType;
  document.querySelector("#technical-schema").textContent = snapshot.diagnostics.schemaVersion;
  if (snapshot.recovery) showNotice(snapshot.recovery.message, true);
  renderList(); renderProgress(); await renderPrivateInvitations();
  const selected = currentState.registrations.find((item) => item.testReference === selectedReference);
  if (selected) {
    renderDetail(selected);
    await renderAudit(selected);
    if (!currentState.testProgress.organiserViewed && !markingViewed) {
      markingViewed = true; await prototype.markViewed(selectedReference); markingViewed = false;
      currentState.testProgress.organiserViewed = true; renderProgress();
    }
  } else {
    document.querySelector("#entry-detail").hidden = true;
    if (selectedReference) { selectedReference = null; history.replaceState(null, "", "dashboard.html"); }
  }
}
async function renderPrivateInvitations() {
  const section = document.querySelector("#private-access");
  section.hidden = !supportsManagedApi;
  if (!supportsManagedApi) return;
  const result = await prototype.privateInvitations();
  const list = document.querySelector("#private-invitation-list"); list.replaceChildren();
  if (!result.ok || !result.invitations.length) { const li = document.createElement("li"); li.textContent = result.ok ? "No private links created." : "Private links are unavailable."; list.append(li); return; }
  for (const invitation of result.invitations) {
    const li = document.createElement("li");
    const status = invitation.status ?? (invitation.revokedAt ? "Revoked" : "Active");
    const text = document.createElement("span"); text.textContent = `${invitation.kind.replaceAll("_", " ")} · ${status} · expires ${new Date(invitation.expiresAt).toLocaleString()}`;
    li.append(text);
    if (status === "Active") {
      li.append(actionButton("Expire now", async () => { const expired = await prototype.expirePrivateInvitation(invitation.id); showNotice(expired.ok ? "Private link expired." : `Link could not be expired: ${expired.code}`, !expired.ok); await renderPrivateInvitations(); }, "text-button"));
      li.append(actionButton("Revoke", async () => { const revoked = await prototype.revokePrivateInvitation(invitation.id); showNotice(revoked.ok ? "Private link revoked." : `Link could not be revoked: ${revoked.code}`, !revoked.ok); await renderPrivateInvitations(); }, "text-button danger-link"));
    }
    list.append(li);
  }
}
async function renderAudit(item) {
  const list = document.querySelector("#entry-audit");
  const result = await prototype.audit(item.id);
  list.replaceChildren();
  if (!result.ok) { const li = document.createElement("li"); li.textContent = "Audit history is unavailable."; list.append(li); return; }
  for (const event of result.events) {
    const li = document.createElement("li");
    const action = String(event.action ?? "activity").replaceAll("_", " ");
    li.textContent = `${new Date(event.timestamp).toLocaleString()} — ${action}`;
    list.append(li);
  }
  if (!result.events.length) { const li = document.createElement("li"); li.textContent = "No audit events recorded for this test entry."; list.append(li); }
}
function filteredEntries() {
  const entries = queryRegistrations(currentState, { search: document.querySelector("#search").value, entry: document.querySelector("#entry-filter").value, payment: document.querySelector("#payment-filter").value });
  const declaration = document.querySelector("#declaration-filter").value;
  return declaration ? entries.filter((item) => item.declarationStatus === declaration) : entries;
}
function renderList() {
  const entries = filteredEntries(); const list = document.querySelector("#entrant-list"); list.replaceChildren();
  for (const item of entries) {
    const card = document.createElement("article"); card.className = "entrant-card";
    if (item.testReference === selectedReference) card.classList.add("entrant-card--selected");
    const heading = document.createElement("h3"); heading.textContent = `${item.runner.firstName} ${item.runner.lastName}`;
    const reference = document.createElement("p"); reference.className = "entrant-reference"; reference.textContent = item.testReference;
    const facts = document.createElement("dl"); facts.className = "entrant-facts";
    for (const [label, value] of [["Club", item.runner.club], ["Entry", item.entryStatus.replace("_", " ")], ["Payment", item.paymentStatus.replaceAll("_", " ")], ["Declaration", item.declarationStatus === "complete" ? "Complete" : "Required"], ["Race number", item.raceNumber ?? "Not assigned"]]) {
      const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; facts.append(dt, dd);
    }
    const button = document.createElement("button"); button.className = "button button--quiet"; button.type = "button"; button.textContent = "View entry";
    button.addEventListener("click", () => selectEntry(item.testReference));
    card.append(heading, reference, facts, button); list.append(card);
  }
  document.querySelector("#empty-state").hidden = entries.length > 0;
}
async function selectEntry(reference) {
  selectedReference = reference; history.replaceState(null, "", `dashboard.html?ref=${encodeURIComponent(reference)}`);
  await render(); document.querySelector("#entry-detail").scrollIntoView({ behavior: "smooth", block: "start" }); document.querySelector("#entry-detail").focus();
}
function renderDetail(item) {
  const panel = document.querySelector("#entry-detail"); panel.hidden = false;
  document.querySelector("#detail-title").textContent = `${item.runner.firstName} ${item.runner.lastName}`;
  document.querySelector("#detail-reference").textContent = item.testReference;
  const money = (value, currency = "gbp") => value == null ? "Not recorded" : `${new Intl.NumberFormat("en-GB", { style: "currency", currency: String(currency).toUpperCase() }).format(value / 100)} ${String(currency).toUpperCase()}`;
  const fields = { "Email address": item.runner.email, "Phone number": item.runner.phone, "Club": item.runner.club, "Race category": item.runner.genderCategory, "WFRA member?": item.runner.wfraMember ? "Yes (self-declared, not verified)" : "No", "WFRA membership number": item.runner.wfraMembershipNumber ?? "Not supplied", "Entry status": item.entryStatus.replace("_", " "), "Place status": item.placeStatus.replaceAll("_", " "), "Payment status": item.paymentStatus.replaceAll("_", " "), "Declaration": item.declarationStatus === "complete" ? `Complete · ${String(item.declarationCompletionMethod ?? "digital").replaceAll("_", " ")}` : "Required before the runner can start", "Cleared to start": item.clearedToStart ? "Yes" : "No", "Expected charge": money(item.pricing?.priceActuallyChargedPence ?? item.payment?.expectedAmountPence, item.payment?.currency), "Actual charge": money(item.payment?.actualPaidAmountPence, item.payment?.currency), "Waiting-list position": item.waitingListPosition ?? "Not applicable", "Race number": item.raceNumber ?? "Not assigned", "Emergency contact name": item.runner.emergencyName, "Emergency contact phone number": item.runner.emergencyPhone, "Price calculated by server": item.pricing?.priceActuallyChargedPence == null ? "Not recorded" : `£${(item.pricing.priceActuallyChargedPence / 100).toFixed(2)} · ${item.pricing.adjustmentReason}` };
  document.querySelector("#entry-details").replaceChildren(...Object.entries(fields).flatMap(([label, value]) => { const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; return [dt, dd]; }));
  renderActions(item); renderMessages(item);
}
function actionButton(label, handler, className = "button button--quiet") {
  const button = document.createElement("button"); button.type = "button"; button.className = className; button.textContent = label; button.addEventListener("click", handler); return button;
}
function renderActions(item) {
  const actions = document.querySelector("#entry-actions"); actions.replaceChildren();
  const available = availableOrganiserActions(item);
  const refundRequest = currentState.refundRequests?.find((request) => request.registrationId === item.id && ["requested", "approved"].includes(request.status));
  if (item.placeStatus === "confirmed" && item.declarationStatus === "pending") {
    actions.append(actionButton("Resend declaration email", async () => { const result = await prototype.resendDeclaration(item.id); showNotice(result.ok ? "Declaration email resent through the controlled development channel." : `Declaration email unavailable: ${result.code}`, !result.ok); await render(); }));
    actions.append(actionButton("Record paper declaration", async () => { if (!window.confirm("Confirm that the named runner signed the current paper declaration in person? This records an audited organiser action, not a digital signature.")) return; const result = await prototype.recordPaperDeclaration(item.id); showNotice(result.ok ? "Paper declaration recorded. Runner is cleared from the declaration perspective." : `Declaration could not be recorded: ${result.code}`, !result.ok); await render(); }));
  }
  if (item.placeStatus === "confirmed") {
    actions.append(actionButton("Edit phone / club", async () => {
      const phone = window.prompt("Correct the runner's phone number", item.runner.phone ?? ""); if (phone === null) return;
      const club = window.prompt("Correct the runner's club", item.runner.club ?? ""); if (club === null) return;
      const result = await prototype.correctEntry(item.id, { phone, club }); showNotice(result.ok ? "Phone and club details updated without transferring the entry." : `Details could not be updated: ${result.code}`, !result.ok); await render();
    }));
    actions.append(actionButton("Transfer entry", () => openTransferDialog(item)));
    actions.append(actionButton("Resend management link", async () => { const result = await prototype.resendManagementLink(item.id); showNotice(result.ok ? "A new management link was sent through the controlled development channel." : `Management link unavailable: ${result.code}`, !result.ok); await render(); }));
  }
  if (available.includes("race_number")) actions.append(actionButton(item.raceNumber ? "Change race number" : "Assign race number", () => {
    pendingRaceNumber = item.id;
    document.querySelector("#race-number-title").textContent = item.raceNumber ? "Change race number" : "Assign race number";
    document.querySelector("#race-number-reference").textContent = item.testReference;
    const input = document.querySelector("#race-number-value");
    input.value = item.raceNumber ?? "";
    document.querySelector("#race-number-dialog").showModal();
    input.focus();
  }));
  if (available.includes("remove_race_number")) actions.append(actionButton("Remove race number", async () => {
    if (!window.confirm(`Remove race number ${item.raceNumber} from ${item.testReference}? The released number becomes available for another entrant.`)) return;
    const result = await prototype.removeRaceNumber(item.id);
    showNotice(result.ok ? `Race number ${result.releasedRaceNumber} removed and available for another entrant.` : `Race number not removed: ${result.code}`, !result.ok);
    await render();
  }));
  if (available.includes("promote")) actions.append(actionButton("Promote from waiting list", async () => { const result = await prototype.promote(item.id); showNotice(result.ok ? `${item.testReference} promoted.` : `Promotion unavailable: ${result.code}`, !result.ok); await render(); }));
  if (refundRequest?.status === "requested") {
    actions.append(actionButton("Approve full test refund", async () => { const result = await prototype.decideRefund(refundRequest.id, "approve"); showNotice(result.ok ? "Full test refund approved. It has not been sent to Stripe yet." : `Refund could not be approved: ${result.code}`, !result.ok); await render(); }));
    actions.append(actionButton("Reject refund request", async () => { const result = await prototype.decideRefund(refundRequest.id, "reject"); showNotice(result.ok ? "Refund request rejected." : `Refund could not be rejected: ${result.code}`, !result.ok); await render(); }, "button button--quiet danger-button"));
  }
  if (refundRequest?.status === "approved" && currentIntegrations.paymentsAvailable) actions.append(actionButton("Execute approved full test refund", async () => { if (!window.confirm(`Send a full Stripe sandbox refund for ${item.testReference}?`)) return; const result = await prototype.executeRefund(refundRequest.id); showNotice(result.ok ? "Full Stripe sandbox refund completed and the place released." : `The refund could not be processed: ${result.code}`, !result.ok); await render(); }));
  if (available.includes("cancel")) actions.append(actionButton("Cancel entry", async () => {
    if (item.raceNumber) {
      pendingCancellation = item.id;
      document.querySelector("#cancel-entry-reference").textContent = `${item.testReference} currently has race number ${item.raceNumber}.`;
      document.querySelector("#release-race-number").checked = true;
      document.querySelector("#cancel-entry-dialog").showModal();
      return;
    }
    if (!window.confirm(`Cancel synthetic entry ${item.testReference}?`)) return;
    await cancelEntry(item.id, false);
  }, "button button--quiet danger-button"));
  if (available.includes("messages")) actions.append(actionButton("Preview captured messages", () => { const preview = document.querySelector("#message-preview"); preview.hidden = false; preview.scrollIntoView({ behavior: "smooth", block: "nearest" }); }));
}

function openTransferDialog(item) {
  pendingTransfer = item.id; const form = document.querySelector("#organiser-transfer-form");
  const runner = item.runner; const values = { firstName: runner.firstName, lastName: runner.lastName, email: runner.email, phone: runner.phone, addressLine1: runner.addressLine1, addressLine2: runner.addressLine2, city: runner.city, postcode: runner.postcode, dateOfBirth: runner.dateOfBirth, raceCategory: runner.genderCategory, club: runner.club, wfraMember: runner.wfraMember ? "yes" : "no", wfraMembershipNumber: runner.wfraMembershipNumber, emergencyContactName: runner.emergencyName, emergencyContactPhone: runner.emergencyPhone };
  for (const [name, value] of Object.entries(values)) if (form.elements[name]) form.elements[name].value = value ?? "";
  form.elements.overrideCutoff.checked = false; document.querySelector("#transfer-entry-dialog").showModal();
}
async function cancelEntry(id, releaseRaceNumber) {
  const result = await prototype.cancel(id, releaseRaceNumber);
  const message = result.ok
    ? result.releasedRaceNumber ? `Synthetic entry cancelled. Race number ${result.releasedRaceNumber} released for another entrant.` : result.registration.raceNumber ? `Synthetic entry cancelled. Race number ${result.registration.raceNumber} retained.` : "Synthetic entry cancelled."
    : `Cancellation unavailable: ${result.code}`;
  showNotice(message, !result.ok); await render();
}
function renderMessages(item) {
  const messages = currentState.communications.filter((message) => message.registrationId === item.id); const list = document.querySelector("#entry-messages"); list.replaceChildren(); document.querySelector("#message-preview").hidden = true;
  for (const message of messages) { const li = document.createElement("li"); const strong = document.createElement("strong"); strong.textContent = message.subject; const copy = document.createElement("p"); copy.textContent = message.body; li.append(strong, copy); list.append(li); }
  if (!messages.length) { const li = document.createElement("li"); li.textContent = "No messages have been captured for this test entry."; list.append(li); }
}
function renderProgress() {
  const reference = currentState.testProgress.submittedReference;
  const entry = currentState.registrations.find((item) => item.testReference === reference);
  const checks = {
    submitted: Boolean(entry), payment: entry?.paymentStatus === "successful", visible: Boolean(entry && currentState.testProgress.organiserViewed),
    raceNumber: Boolean(entry?.raceNumber), managed: Boolean(entry && (entry.entryStatus === "cancelled" || (entry.entryStatus === "accepted" && entry.raceNumber))), reset: Boolean(currentState.testProgress.resetCompleted)
  };
  for (const item of document.querySelectorAll("#testing-progress [data-check]")) { const done = checks[item.dataset.check]; item.classList.toggle("is-complete", done); item.setAttribute("aria-label", `${done ? "Complete" : "Not complete"}: ${item.textContent}`); }
  const complete = Object.values(checks).every(Boolean); document.querySelector("#journey-complete").hidden = !complete;
}

for (const selector of ["#search", "#entry-filter", "#payment-filter", "#declaration-filter"]) document.querySelector(selector)?.addEventListener("input", renderList);
document.querySelector("#close-detail")?.addEventListener("click", () => { selectedReference = null; history.replaceState(null, "", "dashboard.html"); document.querySelector("#entry-detail").hidden = true; renderList(); });
document.querySelector("#reset-test")?.addEventListener("click", async () => { if (!window.confirm("Delete every synthetic test entry and reset the guided test?")) return; const result = await prototype.reset(); if (!result.ok) showNotice(result.message || "Reset failed.", true); else { selectedReference = null; history.replaceState(null, "", "dashboard.html"); showNotice("Test reset. There are now zero test entries."); } await render(); });
document.querySelector("#export-csv")?.addEventListener("click", async () => { const csv = await prototype.csv(); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const link = document.createElement("a"); link.href = url; link.download = "synthetic-registration-export.csv"; link.click(); URL.revokeObjectURL(url); });
document.querySelector("#create-invitation")?.addEventListener("click", async () => {
  const expires = document.querySelector("#invitation-expiry");
  if (!expires.value) expires.value = new Date(Date.now() + 48 * 3_600_000).toISOString().slice(0, 16);
  const result = await prototype.createPrivateInvitation({ kind: document.querySelector("#invitation-kind").value, expiresAt: new Date(expires.value).toISOString(), maximumUses: 1 });
  if (!result.ok) { showNotice(`Private link could not be created: ${result.code}`, true); return; }
  const url = new URL("./", window.location.href); url.searchParams.set("invite", result.token);
  document.querySelector("#created-invitation-url").textContent = url.href;
  document.querySelector("#created-invitation").hidden = false;
  await renderPrivateInvitations();
});
document.querySelector("#keep-entry")?.addEventListener("click", () => { pendingCancellation = null; document.querySelector("#cancel-entry-dialog").close(); });
document.querySelector("#confirm-cancel-entry")?.addEventListener("click", async () => {
  if (!pendingCancellation) return;
  const id = pendingCancellation; const release = document.querySelector("#release-race-number").checked;
  pendingCancellation = null; document.querySelector("#cancel-entry-dialog").close(); await cancelEntry(id, release);
});
document.querySelector("#close-transfer-entry")?.addEventListener("click", () => { pendingTransfer = null; document.querySelector("#transfer-entry-dialog").close(); });
document.querySelector("#close-race-number")?.addEventListener("click", () => { pendingRaceNumber = null; document.querySelector("#race-number-dialog").close(); });
document.querySelector("#race-number-form")?.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!pendingRaceNumber) return;
  const registrationId = pendingRaceNumber; const value = event.currentTarget.elements.raceNumber.value;
  const result = await prototype.assign(registrationId, value);
  if (result.ok) { pendingRaceNumber = null; document.querySelector("#race-number-dialog").close(); }
  showNotice(result.ok ? `Race number ${value} assigned.` : `Race number not changed: ${result.code}`, !result.ok);
  await render();
});
document.querySelector("#organiser-transfer-form")?.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!pendingTransfer || !window.confirm("Transfer this paid race place to the replacement runner? The previous runner's secure links and declaration will be revoked.")) return;
  const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); data.wfraMember = data.wfraMember === "yes"; const overrideCutoff = form.elements.overrideCutoff.checked; delete data.overrideCutoff;
  const registrationId = pendingTransfer; pendingTransfer = null; const result = await prototype.organiserTransfer(registrationId, { runner: data, overrideCutoff });
  if (result.ok) document.querySelector("#transfer-entry-dialog").close();
  showNotice(result.ok ? `Entry transferred. The paid place was retained and the replacement runner now requires their own declaration.${overrideCutoff ? " The organiser cutoff override was audited." : ""}` : result.code === "ORGANISER_OVERRIDE_REQUIRED" ? "The normal transfer cutoff has passed. Review the details and explicitly select the organiser cutoff override to proceed." : `Transfer unavailable: ${result.code}`, !result.ok); await render();
});
prototype.subscribe(() => render());
