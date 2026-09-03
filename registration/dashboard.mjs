import { prototype, canTest } from "./prototype-client.mjs";
import { queryRegistrations } from "./preview-repository.mjs";
import { availableOrganiserActions } from "./organiser-view.mjs";

let currentState;
let selectedReference = new URLSearchParams(window.location.search).get("ref");
let markingViewed = false;
let pendingCancellation = null;
if (canTest) await render();

function showNotice(message, error = false) {
  const notice = document.querySelector("#organiser-alert"); notice.textContent = message; notice.hidden = false;
  notice.classList.toggle("form-alert--success", !error); notice.focus();
}
async function render() {
  const snapshot = await prototype.all(); currentState = snapshot.state;
  const active = currentState.registrations.filter((item) => item.entryStatus !== "cancelled");
  const accepted = active.filter((item) => item.entryStatus === "accepted").length;
  const waiting = active.filter((item) => item.entryStatus === "waiting_list").length;
  const attention = active.filter((item) => ["not_started", "declined", "abandoned"].includes(item.paymentStatus)).length;
  document.querySelector("#summary-accepted").textContent = accepted;
  document.querySelector("#summary-waiting").textContent = waiting;
  document.querySelector("#summary-payments").textContent = attention;
  document.querySelector("#summary-remaining").textContent = Math.max(0, currentState.event.capacity - accepted);
  document.querySelector("#technical-environment").textContent = snapshot.diagnostics.environment;
  document.querySelector("#technical-storage").textContent = snapshot.diagnostics.storageType;
  document.querySelector("#technical-schema").textContent = snapshot.diagnostics.schemaVersion;
  if (snapshot.recovery) showNotice(snapshot.recovery.message, true);
  renderList(); renderProgress();
  const selected = currentState.registrations.find((item) => item.testReference === selectedReference);
  if (selected) {
    renderDetail(selected);
    if (!currentState.testProgress.organiserViewed && !markingViewed) {
      markingViewed = true; await prototype.markViewed(selectedReference); markingViewed = false;
      currentState.testProgress.organiserViewed = true; renderProgress();
    }
  } else {
    document.querySelector("#entry-detail").hidden = true;
    if (selectedReference) { selectedReference = null; history.replaceState(null, "", "dashboard.html"); }
  }
}
function filteredEntries() {
  return queryRegistrations(currentState, { search: document.querySelector("#search").value, entry: document.querySelector("#entry-filter").value, payment: document.querySelector("#payment-filter").value });
}
function renderList() {
  const entries = filteredEntries(); const list = document.querySelector("#entrant-list"); list.replaceChildren();
  for (const item of entries) {
    const card = document.createElement("article"); card.className = "entrant-card";
    if (item.testReference === selectedReference) card.classList.add("entrant-card--selected");
    const heading = document.createElement("h3"); heading.textContent = `${item.runner.firstName} ${item.runner.lastName}`;
    const reference = document.createElement("p"); reference.className = "entrant-reference"; reference.textContent = item.testReference;
    const facts = document.createElement("dl"); facts.className = "entrant-facts";
    for (const [label, value] of [["Club", item.runner.club], ["Entry", item.entryStatus.replace("_", " ")], ["Mock payment", item.paymentStatus.replace("_", " ")], ["Race number", item.raceNumber ?? "Not assigned"]]) {
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
  const fields = { "Synthetic email": item.runner.email, "Synthetic phone": item.runner.phone, Club: item.runner.club, Category: item.runner.genderCategory, "Entry status": item.entryStatus.replace("_", " "), "Mock-payment status": item.paymentStatus.replace("_", " "), "Waiting-list position": item.waitingListPosition ?? "Not applicable", "Race number": item.raceNumber ?? "Not assigned", "Emergency contact": `${item.runner.emergencyName} — ${item.runner.emergencyPhone}`, Travel: item.runner.travelMethod };
  document.querySelector("#entry-details").replaceChildren(...Object.entries(fields).flatMap(([label, value]) => { const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; return [dt, dd]; }));
  renderActions(item); renderMessages(item);
}
function actionButton(label, handler, className = "button button--quiet") {
  const button = document.createElement("button"); button.type = "button"; button.className = className; button.textContent = label; button.addEventListener("click", handler); return button;
}
function renderActions(item) {
  const actions = document.querySelector("#entry-actions"); actions.replaceChildren();
  const available = availableOrganiserActions(item);
  if (available.includes("race_number")) actions.append(actionButton(item.raceNumber ? "Change race number" : "Assign race number", async () => {
    const value = window.prompt("Enter a synthetic race number", item.raceNumber ?? ""); if (value === null) return;
    const result = await prototype.assign(item.id, value); if (!result.ok) showNotice(`Race number not changed: ${result.code}`, true); else showNotice(`Race number ${value} assigned to ${item.testReference}.`); await render();
  }));
  if (available.includes("remove_race_number")) actions.append(actionButton("Remove race number", async () => {
    if (!window.confirm(`Remove race number ${item.raceNumber} from ${item.testReference}? The released number becomes available for another entrant.`)) return;
    const result = await prototype.removeRaceNumber(item.id);
    showNotice(result.ok ? `Race number ${result.releasedRaceNumber} removed and available for another entrant.` : `Race number not removed: ${result.code}`, !result.ok);
    await render();
  }));
  if (available.includes("promote")) actions.append(actionButton("Promote from waiting list", async () => { const result = await prototype.promote(item.id); showNotice(result.ok ? `${item.testReference} promoted.` : `Promotion unavailable: ${result.code}`, !result.ok); await render(); }));
  if (available.includes("refund")) actions.append(actionButton("Refund mock payment", async () => { if (!window.confirm(`Refund the mock payment for ${item.testReference}?`)) return; const result = await prototype.refund(item.id); showNotice(result.ok ? "Mock payment marked refunded." : `Refund unavailable: ${result.code}`, !result.ok); await render(); }));
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

for (const selector of ["#search", "#entry-filter", "#payment-filter"]) document.querySelector(selector)?.addEventListener("input", renderList);
document.querySelector("#close-detail")?.addEventListener("click", () => { selectedReference = null; history.replaceState(null, "", "dashboard.html"); document.querySelector("#entry-detail").hidden = true; renderList(); });
document.querySelector("#reset-test")?.addEventListener("click", async () => { if (!window.confirm("Delete every synthetic test entry and reset the guided test?")) return; const result = await prototype.reset(); if (!result.ok) showNotice(result.message || "Reset failed.", true); else { selectedReference = null; history.replaceState(null, "", "dashboard.html"); showNotice("Test reset. There are now zero test entries."); } await render(); });
document.querySelector("#export-csv")?.addEventListener("click", async () => { const csv = await prototype.csv(); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const link = document.createElement("a"); link.href = url; link.download = "synthetic-registration-export.csv"; link.click(); URL.revokeObjectURL(url); });
document.querySelector("#keep-entry")?.addEventListener("click", () => { pendingCancellation = null; document.querySelector("#cancel-entry-dialog").close(); });
document.querySelector("#confirm-cancel-entry")?.addEventListener("click", async () => {
  if (!pendingCancellation) return;
  const id = pendingCancellation; const release = document.querySelector("#release-race-number").checked;
  pendingCancellation = null; document.querySelector("#cancel-entry-dialog").close(); await cancelEntry(id, release);
});
prototype.subscribe(() => render());
