import { prototype, canTest } from "./prototype-client.mjs";

if (!canTest) document.querySelector("#dashboard-closed").hidden = false;
else { document.querySelector("#dashboard").hidden = false; await render(); }

let currentState;
async function render() {
  currentState = (await prototype.all()).state;
  const accepted = currentState.registrations.filter((item) => item.entryStatus === "accepted").length;
  const waiting = currentState.registrations.filter((item) => item.entryStatus === "waiting_list").length;
  document.querySelector("#dash-state").textContent = currentState.registrationState.toUpperCase();
  document.querySelector("#dash-accepted").textContent = `${accepted} / ${currentState.event.capacity}`;
  document.querySelector("#dash-waiting").textContent = waiting;
  document.querySelector("#state-control").value = currentState.registrationState;
  document.querySelector("#capacity-control").value = currentState.event.capacity;
  renderRows(); renderMessages();
}

function renderRows() {
  const search = document.querySelector("#search").value.toLowerCase();
  const entry = document.querySelector("#entry-filter").value;
  const payment = document.querySelector("#payment-filter").value;
  const registrations = currentState.registrations.filter((item) => {
    const text = `${item.runner.firstName} ${item.runner.lastName} ${item.runner.club} ${item.runner.email}`.toLowerCase();
    return (!search || text.includes(search)) && (!entry || item.entryStatus === entry) && (!payment || item.paymentStatus === payment);
  });
  const body = document.querySelector("#entrant-rows"); body.replaceChildren();
  for (const item of registrations) {
    const row = document.createElement("tr");
    row.innerHTML = `<td><strong></strong><br><small></small></td><td></td><td></td><td></td><td></td><td></td>`;
    row.children[0].querySelector("strong").textContent = `${item.runner.firstName} ${item.runner.lastName}`;
    row.children[0].querySelector("small").textContent = item.runner.email;
    row.children[1].textContent = item.runner.club;
    row.children[2].textContent = item.waitingListPosition ? `${item.entryStatus} #${item.waitingListPosition}` : item.entryStatus;
    row.children[3].textContent = item.paymentStatus;
    row.children[4].textContent = item.raceNumber ?? "—";
    const actions = row.children[5];
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

function actionButton(label, handler) { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.addEventListener("click", handler); return button; }
async function act(operation) { const result = await operation(); if (!result.ok) window.alert(`Prototype action failed: ${result.code}`); await render(); }
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
document.querySelector("#reset-data")?.addEventListener("click", async () => { if (window.confirm("Delete every synthetic test registration in this browser/server session?")) await act(() => prototype.reset()); });
document.querySelector("#load-fixtures")?.addEventListener("click", async () => {
  if (currentState.registrations.length && !window.confirm("Reset existing synthetic data and load the fixture scenarios?")) return;
  await prototype.reset();
  await prototype.settings({ registrationState: "test", capacity: 3 });
  const fixtures = await (await fetch("fixtures.json")).json();
  for (const fixture of fixtures.filter((item) => item.submit)) {
    const result = await prototype.submit(fixture.runner);
    if (result.ok && fixture.payment) await prototype.payment(result.registration.id, fixture.payment);
    if (result.ok && fixture.refund) await prototype.payment(result.registration.id, "refunded");
    if (result.ok && fixture.cancel) await prototype.cancel(result.registration.id);
  }
  await render();
});
document.querySelector("#export-csv")?.addEventListener("click", async () => {
  const csv = await prototype.csv(); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a"); link.href = url; link.download = "synthetic-registration-export.csv"; link.click(); URL.revokeObjectURL(url);
});
window.addEventListener("registration-prototype-updated", render);
