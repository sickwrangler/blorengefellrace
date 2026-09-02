import { prototype, canTest } from "./prototype-client.mjs";
import { queryRegistrations } from "./preview-repository.mjs";

if (!canTest) document.querySelector("#dashboard-closed").hidden = false;
else { document.querySelector("#dashboard").hidden = false; await render(); }

let currentState;
async function render() {
  const snapshot = await prototype.all();
  currentState = snapshot.state;
  const accepted = currentState.registrations.filter((item) => item.entryStatus === "accepted").length;
  const waiting = currentState.registrations.filter((item) => item.entryStatus === "waiting_list").length;
  document.querySelector("#dash-state").textContent = currentState.registrationState.toUpperCase();
  document.querySelector("#dash-accepted").textContent = `${accepted} / ${currentState.event.capacity}`;
  document.querySelector("#dash-waiting").textContent = waiting;
  document.querySelector("#state-control").value = currentState.registrationState;
  document.querySelector("#capacity-control").value = currentState.event.capacity;
  document.querySelector("#diagnostic-environment").textContent = snapshot.diagnostics.environment;
  document.querySelector("#diagnostic-storage").textContent = snapshot.diagnostics.storageType;
  document.querySelector("#diagnostic-schema").textContent = snapshot.diagnostics.schemaVersion;
  document.querySelector("#diagnostic-count").textContent = snapshot.diagnostics.registrationsLoaded;
  document.querySelector("#diagnostic-refresh").textContent = new Date(snapshot.diagnostics.lastRefreshTime).toLocaleString();
  const recovery = document.querySelector("#dashboard-recovery");
  recovery.hidden = !snapshot.recovery;
  recovery.textContent = snapshot.recovery?.message || "";
  renderRows(); renderMessages();
  for (const control of document.querySelectorAll("#save-settings, #export-csv, #entrant-rows button")) control.disabled = Boolean(snapshot.recovery);
}

function renderRows() {
  const search = document.querySelector("#search").value.toLowerCase().trim();
  const entry = document.querySelector("#entry-filter").value;
  const payment = document.querySelector("#payment-filter").value;
  const registrations = queryRegistrations(currentState, { search, entry, payment });
  const body = document.querySelector("#entrant-rows"); body.replaceChildren();
  for (const item of registrations) {
    const row = document.createElement("tr");
    row.innerHTML = `<td></td><td><strong></strong><br><small></small></td><td></td><td></td><td></td><td></td><td></td><td></td>`;
    row.children[0].textContent = item.testReference;
    row.children[1].querySelector("strong").textContent = `${item.runner.firstName} ${item.runner.lastName}`;
    row.children[1].querySelector("small").textContent = item.runner.email;
    row.children[2].textContent = item.source === "seed" ? "Seed fixture" : "Runner form";
    row.children[3].textContent = item.runner.club;
    row.children[4].textContent = item.waitingListPosition ? `${item.entryStatus} #${item.waitingListPosition}` : item.entryStatus;
    row.children[5].textContent = item.paymentStatus;
    row.children[6].textContent = item.raceNumber ?? "—";
    const actions = row.children[7];
    actions.append(actionButton("Details", () => showDetails(item)));
    if (item.entryStatus === "waiting_list") actions.append(actionButton("Promote", () => act(() => prototype.promote(item.id))));
    if (item.entryStatus !== "cancelled") actions.append(actionButton("Cancel", () => act(() => prototype.cancel(item.id))));
    actions.append(actionButton("Race number", async () => {
      const number = window.prompt("Assign a synthetic race number", item.raceNumber ?? "");
      if (number !== null) await act(() => prototype.assign(item.id, number));
    }));
    if (item.paymentStatus === "successful") actions.append(actionButton("Refund", () => act(() => prototype.payment(item.id, "refunded"))));
    body.append(row);
  }
  document.querySelector("#empty-state").hidden = registrations.length > 0;
}

function actionButton(label, handler) {
  const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.addEventListener("click", handler); return button;
}
async function act(operation) {
  const result = await operation();
  if (!result.ok) window.alert(result.message || `Prototype action failed: ${result.code}`);
  await render();
}
function showDetails(item) {
  const fields = {
    "Test reference": item.testReference, Source: item.source === "seed" ? "Seed fixture" : "Runner form",
    Runner: `${item.runner.firstName} ${item.runner.lastName}`, "Synthetic email": item.runner.email,
    "Synthetic phone": item.runner.phone, Club: item.runner.club, Category: item.runner.genderCategory,
    "Registration status": item.entryStatus, "Mock-payment status": item.paymentStatus,
    "Emergency-contact name": item.runner.emergencyName, "Synthetic emergency phone": item.runner.emergencyPhone,
    "Travel method": item.runner.travelMethod, "Race number": item.raceNumber ?? "Not assigned"
  };
  document.querySelector("#entry-details").replaceChildren(...Object.entries(fields).flatMap(([label, value]) => {
    const term = document.createElement("dt"); term.textContent = label;
    const description = document.createElement("dd"); description.textContent = value;
    return [term, description];
  }));
  document.querySelector("#entry-dialog").showModal();
}
function renderMessages() {
  const list = document.querySelector("#message-list"); list.replaceChildren();
  for (const message of [...currentState.communications].reverse()) {
    const item = document.createElement("li");
    const heading = document.createElement("strong"); heading.textContent = message.subject;
    const copy = document.createElement("p"); copy.textContent = `${message.recipient} — ${message.body}`;
    item.append(heading, copy); list.append(item);
  }
  if (!currentState.communications.length) { const item = document.createElement("li"); item.textContent = "No captured messages yet."; list.append(item); }
}

for (const selector of ["#search", "#entry-filter", "#payment-filter"]) document.querySelector(selector)?.addEventListener("input", renderRows);
document.querySelector("#save-settings")?.addEventListener("click", () => act(() => prototype.settings({ registrationState: document.querySelector("#state-control").value, capacity: Number(document.querySelector("#capacity-control").value) })));
document.querySelector("#refresh-data")?.addEventListener("click", render);
document.querySelector("#reset-fixtures")?.addEventListener("click", async () => {
  if (!window.confirm("Replace all browser/server test data with the documented synthetic fixture set?")) return;
  const result = await prototype.reset();
  if (!result.ok) window.alert(result.message || `Fixture reset failed: ${result.code}`);
  await render();
});
document.querySelector("#export-csv")?.addEventListener("click", async () => {
  const csv = await prototype.csv(); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a"); link.href = url; link.download = "synthetic-registration-export.csv"; link.click(); URL.revokeObjectURL(url);
});
prototype.subscribe(() => render());
