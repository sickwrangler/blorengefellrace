const summary = document.querySelector("#start-list-summary");
const updated = document.querySelector("#start-list-updated");
const error = document.querySelector("#start-list-error");
const empty = document.querySelector("#start-list-empty");
const tableWrap = document.querySelector("#start-list-table-wrap");
const tableBody = document.querySelector("#start-list-body");
const full = document.querySelector("#start-list-full");

function cell(value) {
  const element = document.createElement("td");
  element.textContent = value ?? "—";
  return element;
}

function render(result) {
  const entries = Array.isArray(result.entries) ? result.entries : [];
  summary.textContent = `${result.confirmedCount} of ${result.capacity} places confirmed`;
  updated.textContent = result.lastUpdatedAt
    ? `Last updated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(result.lastUpdatedAt))}`
    : "The list updates automatically when entries are confirmed or changed.";
  tableBody.replaceChildren(...entries.map((entry) => {
    const row = document.createElement("tr");
    row.append(cell(entry.runnerName), cell(entry.club), cell(entry.category), cell(entry.raceNumber));
    return row;
  }));
  empty.hidden = entries.length > 0;
  tableWrap.hidden = entries.length === 0;
  full.hidden = result.raceFull !== true;
  error.hidden = true;
}

async function refresh() {
  try {
    const response = await fetch("/api/v4/start-list", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) throw new Error("Start list unavailable");
    const result = await response.json();
    if (!result.ok) throw new Error("Start list unavailable");
    render(result);
  } catch {
    error.hidden = false;
    summary.textContent = "Start list temporarily unavailable";
    updated.textContent = "";
    empty.hidden = true;
    tableWrap.hidden = true;
    full.hidden = true;
  }
}

await refresh();
window.setInterval(refresh, 30_000);
