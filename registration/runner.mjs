import { prototype, canTest } from "./prototype-client.mjs";
import { validateRunner } from "./registration-core.mjs";

const closedPanel = document.querySelector("#closed-panel");
const experience = document.querySelector("#test-experience");
const form = document.querySelector("#registration-form");
const alert = document.querySelector("#form-alert");
const sections = [...document.querySelectorAll("[data-step]")];
const stageNames = ["Runner details", "Race information and consent", "Review", "Test payment", "Confirmation"];
let stage = 1;
let currentRegistration = null;

if (!canTest) closedPanel.hidden = false;
else {
  experience.hidden = false;
  await refreshStatus();
}

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
    const control = form.elements[name];
    if (!control) continue;
    control.setAttribute("aria-invalid", "true");
    const error = document.createElement("p");
    error.className = "field-error"; error.textContent = message;
    control.closest("label")?.append(error);
  }
  alert.textContent = "Please correct the highlighted test details.";
  alert.hidden = false; alert.focus();
}

function errorsForStage(targetStage) {
  const errors = validateRunner(payload());
  const fields = targetStage === 1
    ? ["firstName", "lastName", "email", "phone", "dateOfBirth", "genderCategory", "membershipNumber"]
    : targetStage === 2
      ? ["emergencyName", "emergencyPhone", "travelMethod", "acceptTerms", "acceptPrivacy"]
      : Object.keys(errors);
  return Object.fromEntries(Object.entries(errors).filter(([key]) => fields.includes(key)));
}

function validateStage(targetStage = stage) {
  const errors = errorsForStage(targetStage);
  if (Object.keys(errors).length) { showErrors(errors); return false; }
  clearErrors(); return true;
}

function updateProgress(targetStage) {
  document.querySelector("#step-label").textContent = `Stage ${targetStage} of 5 — ${stageNames[targetStage - 1]}`;
  document.querySelector("#step-progress").value = targetStage;
  document.querySelector("#step-progress").textContent = `${targetStage} of 5`;
}

function renderStage() {
  sections.forEach((section) => { section.hidden = Number(section.dataset.step) !== stage; });
  updateProgress(stage);
  document.querySelector("#back-button").hidden = stage === 1 || stage >= 4;
  document.querySelector("#next-button").hidden = stage >= 3;
  document.querySelector("#submit-button").hidden = stage !== 3;
  document.querySelector("#payment-button").hidden = stage !== 4;
  if (stage === 3) renderReview();
  sections[stage - 1]?.querySelector("h2")?.setAttribute("tabindex", "-1");
  sections[stage - 1]?.querySelector("h2")?.focus();
}

function renderReview() {
  const data = payload();
  const labels = { firstName: "First name", lastName: "Last name", email: "Test email", dateOfBirth: "Date of birth", genderCategory: "Category", club: "Club", emergencyName: "Emergency contact", travelMethod: "Travel" };
  document.querySelector("#review-list").replaceChildren(...Object.entries(labels).flatMap(([key, label]) => {
    const term = document.createElement("dt"); term.textContent = label;
    const description = document.createElement("dd"); description.textContent = data[key] || "Not provided";
    return [term, description];
  }));
}

async function refreshStatus() {
  const status = await prototype.status();
  document.querySelector("#status-mode").textContent = status.state.toUpperCase();
  document.querySelector("#status-places").textContent = `${status.accepted} / ${status.capacity} test places`;
  document.querySelector("#status-waiting").textContent = status.waiting;
  const recovery = document.querySelector("#runner-recovery");
  recovery.hidden = !status.recovery;
  recovery.textContent = status.recovery?.message || "";
  for (const button of form.querySelectorAll("button")) button.disabled = Boolean(status.recovery);
}

document.querySelector("#next-button")?.addEventListener("click", () => { if (validateStage()) { stage += 1; renderStage(); } });
document.querySelector("#back-button")?.addEventListener("click", () => { clearErrors(); stage -= 1; renderStage(); });
document.querySelector("#another-button")?.addEventListener("click", () => {
  form.reset(); form.elements.firstName.value = "Alex"; form.elements.lastName.value = "Example";
  form.elements.email.value = `runner${Date.now()}@example.com`; form.elements.phone.value = "07700 900123";
  form.elements.dateOfBirth.value = "1990-06-15"; form.elements.emergencyName.value = "Sam Example";
  form.elements.emergencyPhone.value = "07700 900456"; form.elements.travelMethod.value = "Shared car";
  currentRegistration = null; document.querySelector("#confirmation").hidden = true; form.hidden = false;
  stage = 1; clearErrors(); renderStage();
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (stage !== 3 || currentRegistration || !validateStage(3)) return;
  const result = await prototype.submit(payload());
  if (!result.ok) {
    if (result.errors) showErrors(result.errors);
    else { alert.textContent = result.message || `Test submission failed: ${result.code}`; alert.hidden = false; alert.focus(); }
    return;
  }
  currentRegistration = result.registration;
  document.querySelector("#payment-reference").textContent = currentRegistration.testReference;
  document.querySelector("#payment-entry-state").textContent = currentRegistration.entryStatus.replace("_", " ");
  document.querySelector("#payment-state").textContent = currentRegistration.paymentStatus.replace("_", " ");
  stage = 4; renderStage(); await refreshStatus();
});

document.querySelector("#payment-button")?.addEventListener("click", async () => {
  if (!currentRegistration) return;
  const outcome = form.elements.paymentOutcome.value;
  if (outcome === "temporary_error") {
    alert.textContent = `Simulated temporary payment error for ${currentRegistration.testReference}. The registration remains stored with payment not started. Choose another outcome and retry.`;
    alert.hidden = false; alert.focus(); return;
  }
  const payment = await prototype.payment(currentRegistration.id, outcome);
  if (!payment.ok) { alert.textContent = payment.message || `Mock payment failed: ${payment.code}`; alert.hidden = false; alert.focus(); return; }
  currentRegistration = payment.registration;
  document.querySelector("#confirmation-reference").textContent = currentRegistration.testReference;
  document.querySelector("#confirmation-title").textContent = currentRegistration.entryStatus === "waiting_list" ? "Test waiting-list record updated" : "Test registration complete";
  document.querySelector("#confirmation-copy").textContent = `${currentRegistration.runner.firstName} has a ${currentRegistration.entryStatus.replace("_", " ")} test registration. Mock-payment status: ${currentRegistration.paymentStatus}.`;
  form.hidden = true; document.querySelector("#confirmation").hidden = false;
  stage = 5; updateProgress(stage); document.querySelector("#confirmation").focus(); await refreshStatus();
});
