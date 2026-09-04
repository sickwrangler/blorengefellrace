import { prototype, canTest } from "./prototype-client.mjs";
import { validateRunner } from "./registration-core.mjs";
import { isRunnerActionAvailable, organiserHandoverUrl } from "./runner-flow.mjs";

const form = document.querySelector("#registration-form");
const alert = document.querySelector("#form-alert");
const stages = [...document.querySelectorAll("[data-stage]")];
const stageNames = ["Your details", "Race details and consent", "Review and submit", "Test payment and confirmation"];
let stage = 1;
let currentRegistration = null;
let submitting = false;

if (!canTest) document.querySelector("#closed-panel").hidden = false;
else { document.querySelector("#test-experience").hidden = false; await refreshStatus(); }

function payload() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.affiliated = form.elements.affiliated.checked;
  data.acceptTerms = form.elements.acceptTerms.checked;
  data.acceptPrivacy = form.elements.acceptPrivacy.checked;
  return data;
}
function clearErrors() {
  form.querySelectorAll(".field-error").forEach((node) => node.remove());
  form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  alert.hidden = true;
}
function showErrors(errors) {
  clearErrors();
  for (const [name, message] of Object.entries(errors)) {
    const control = form.elements[name]; if (!control) continue;
    control.setAttribute("aria-invalid", "true");
    const error = document.createElement("p"); error.className = "field-error"; error.textContent = message;
    control.closest("label")?.append(error);
  }
  alert.textContent = "Please correct the highlighted test details."; alert.hidden = false; alert.focus();
}
function validateStage(target) {
  const errors = validateRunner(payload());
  const relevantFields = target === 1
    ? ["firstName", "lastName", "email", "phone", "dateOfBirth", "genderCategory", "membershipNumber"]
    : target === 2 ? ["emergencyName", "emergencyPhone", "travelMethod", "acceptTerms", "acceptPrivacy"] : Object.keys(errors);
  const relevant = Object.fromEntries(Object.entries(errors).filter(([name]) => relevantFields.includes(name)));
  if (Object.keys(relevant).length) { showErrors(relevant); return false; }
  clearErrors(); return true;
}
function showStage(number) {
  stage = number;
  stages.forEach((section) => { section.hidden = Number(section.dataset.stage) !== stage; });
  document.querySelector("#step-label").textContent = `Stage ${stage} of 4 — ${stageNames[stage - 1]}`;
  document.querySelector("#step-progress").value = stage;
  document.querySelector("#step-progress").textContent = `${stage} of 4`;
  if (stage === 3) renderReview();
  const heading = stages[stage - 1].querySelector("h2"); heading?.setAttribute("tabindex", "-1"); heading?.focus();
}
function renderReview() {
  const data = payload();
  const fields = { Name: `${data.firstName} ${data.lastName}`, "Test email": data.email, "Test phone": data.phone, "Date of birth": data.dateOfBirth, Category: data.genderCategory, Club: data.club || "Unattached", Affiliation: data.affiliated ? `Affiliated — ${data.membershipNumber}` : "Not affiliated", "Emergency contact": `${data.emergencyName} — ${data.emergencyPhone}`, Travel: data.travelMethod, Consent: "Prototype terms and privacy acknowledged" };
  document.querySelector("#review-list").replaceChildren(...Object.entries(fields).flatMap(([label, value]) => {
    const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; return [dt, dd];
  }));
}
async function refreshStatus() {
  const status = await prototype.status();
  document.querySelector("#status-places").textContent = `${status.accepted} of ${status.capacity} test places`;
  document.querySelector("#status-waiting").textContent = status.waiting;
  const recovery = document.querySelector("#runner-recovery"); recovery.hidden = !status.recovery; recovery.textContent = status.recovery?.message || "";
  document.querySelector("#start-test").disabled = Boolean(status.recovery);
}
async function resetTest() {
  if (!window.confirm("Delete all synthetic test entries and start again?")) return;
  const result = await prototype.reset();
  if (!result.ok) { window.alert(result.message || "The test could not be reset."); return; }
  currentRegistration = null; submitting = false; form.reset();
  document.querySelector("#runner-flow").hidden = true; document.querySelector("#test-landing").hidden = false;
  document.querySelector("#payment-choice").hidden = false; document.querySelector("#payment-result").hidden = true;
  clearErrors(); await refreshStatus();
}

document.querySelector("#start-test")?.addEventListener("click", () => { document.querySelector("#test-landing").hidden = true; document.querySelector("#runner-flow").hidden = false; showStage(1); });
document.querySelector("#reset-test")?.addEventListener("click", resetTest);
document.querySelector("#details-continue")?.addEventListener("click", () => { if (isRunnerActionAvailable(stage, "details-continue") && validateStage(1)) showStage(2); });
document.querySelector("#race-back")?.addEventListener("click", () => { if (isRunnerActionAvailable(stage, "race-back")) showStage(1); });
document.querySelector("#race-continue")?.addEventListener("click", () => { if (isRunnerActionAvailable(stage, "race-continue") && validateStage(2)) showStage(3); });
document.querySelector("#review-back")?.addEventListener("click", () => { if (isRunnerActionAvailable(stage, "review-back")) showStage(2); });

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isRunnerActionAvailable(stage, "submit-test") || currentRegistration || submitting || !validateStage(3)) return;
  submitting = true; const button = document.querySelector("#submit-test"); button.disabled = true;
  const result = await prototype.submit(payload());
  submitting = false;
  if (!result.ok) {
    button.disabled = false;
    if (result.errors) showErrors(result.errors); else { alert.textContent = result.message || `Test submission failed: ${result.code}`; alert.hidden = false; alert.focus(); }
    return;
  }
  currentRegistration = result.registration;
  document.querySelector("#payment-reference").textContent = currentRegistration.testReference;
  showStage(4); await refreshStatus();
});

for (const button of document.querySelectorAll("[data-payment]")) button.addEventListener("click", async () => {
  if (!currentRegistration) return;
  if (!isRunnerActionAvailable(stage, button.id, true)) return;
  const outcome = button.dataset.payment;
  for (const choice of document.querySelectorAll("[data-payment]")) choice.disabled = true;
  const result = await prototype.payment(currentRegistration.id, outcome);
  for (const choice of document.querySelectorAll("[data-payment]")) choice.disabled = false;
  if (!result.ok) { alert.textContent = result.message || "Mock payment could not be saved."; alert.hidden = false; alert.focus(); return; }
  currentRegistration = result.registration;
  const successful = outcome === "successful";
  document.querySelector("#result-title").textContent = successful ? "Test entry confirmed" : outcome === "declined" ? "Mock payment declined" : "Mock payment abandoned";
  document.querySelector("#result-copy").textContent = successful ? "The same synthetic registration has been updated. No money was taken and no email was sent." : "The synthetic registration remains available to the organiser. Retry mock payment when ready.";
  document.querySelector("#result-reference").textContent = currentRegistration.testReference;
  document.querySelector("#result-entry").textContent = currentRegistration.entryStatus.replace("_", " ");
  document.querySelector("#result-payment").textContent = currentRegistration.paymentStatus;
  document.querySelector("#organiser-handover").href = organiserHandoverUrl(currentRegistration.testReference);
  document.querySelector("#success-action").hidden = !successful; document.querySelector("#retry-action").hidden = successful;
  document.querySelector("#payment-choice").hidden = true; document.querySelector("#payment-result").hidden = false; document.querySelector("#payment-result").focus();
});
document.querySelector("#retry-payment")?.addEventListener("click", () => { document.querySelector("#payment-result").hidden = true; document.querySelector("#payment-choice").hidden = false; document.querySelector("#payment-heading").focus(); });
