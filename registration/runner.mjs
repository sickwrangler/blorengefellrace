import { prototype, canTest } from "./prototype-client.mjs";
import { validateRunner } from "./registration-core.mjs";

const closedPanel = document.querySelector("#closed-panel");
const experience = document.querySelector("#test-experience");
const form = document.querySelector("#registration-form");
const alert = document.querySelector("#form-alert");
const steps = [...document.querySelectorAll("[data-step]")];
let step = 1;

if (!canTest) {
  closedPanel.hidden = false;
} else {
  experience.hidden = false;
  await refreshStatus();
}

function payload() {
  const data = new FormData(form);
  return Object.fromEntries([...data.entries()].map(([key, value]) => [key, value]));
}

function completePayload() {
  const data = payload();
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
    error.className = "field-error";
    error.textContent = message;
    control.closest("label")?.append(error);
  }
  alert.textContent = "Please correct the highlighted test details.";
  alert.hidden = false;
  alert.focus();
}

function validateStep() {
  const errors = validateRunner(completePayload());
  const fields = step === 1
    ? ["firstName", "lastName", "email", "phone", "dateOfBirth", "genderCategory", "membershipNumber"]
    : ["emergencyName", "emergencyPhone", "travelMethod", "acceptTerms", "acceptPrivacy"];
  const relevant = Object.fromEntries(Object.entries(errors).filter(([key]) => fields.includes(key)));
  if (Object.keys(relevant).length) { showErrors(relevant); return false; }
  clearErrors();
  return true;
}

function renderStep() {
  steps.forEach((section) => { section.hidden = Number(section.dataset.step) !== step; });
  document.querySelector("#step-label").textContent = `Step ${step} of 3`;
  document.querySelector("#step-progress").value = step;
  document.querySelector("#back-button").hidden = step === 1;
  document.querySelector("#next-button").hidden = step === 3;
  document.querySelector("#submit-button").hidden = step !== 3;
  if (step === 3) renderReview();
  steps[step - 1].querySelector("h2")?.focus?.();
}

function renderReview() {
  const data = completePayload();
  const labels = { firstName: "First name", lastName: "Last name", email: "Test email", dateOfBirth: "Date of birth", genderCategory: "Category", club: "Club", emergencyName: "Emergency contact", travelMethod: "Travel" };
  document.querySelector("#review-list").replaceChildren(...Object.entries(labels).flatMap(([key, label]) => {
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = data[key] || "Not provided";
    return [dt, dd];
  }));
}

async function refreshStatus() {
  const status = await prototype.status();
  document.querySelector("#status-mode").textContent = status.state.toUpperCase();
  document.querySelector("#status-places").textContent = `${status.accepted} / ${status.capacity} test places`;
  document.querySelector("#status-waiting").textContent = status.waiting;
}

document.querySelector("#next-button")?.addEventListener("click", () => { if (validateStep()) { step += 1; renderStep(); } });
document.querySelector("#back-button")?.addEventListener("click", () => { clearErrors(); step -= 1; renderStep(); });
document.querySelector("#another-button")?.addEventListener("click", () => {
  form.reset(); form.elements.firstName.value = "Alex"; form.elements.lastName.value = "Example";
  form.elements.email.value = `runner${Date.now()}@example.com`; form.elements.phone.value = "07700 900123";
  form.elements.dateOfBirth.value = "1990-06-15"; form.elements.emergencyName.value = "Sam Example";
  form.elements.emergencyPhone.value = "07700 900456"; form.elements.travelMethod.value = "Shared car";
  document.querySelector("#confirmation").hidden = true; form.hidden = false; step = 1; renderStep();
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateStep()) return;
  const data = completePayload();
  if (data.paymentOutcome === "temporary_error") {
    alert.textContent = "Simulated temporary service error. No test entry was stored. Choose another outcome and retry.";
    alert.hidden = false; alert.focus(); return;
  }
  const result = await prototype.submit(data);
  if (!result.ok) {
    if (result.errors) showErrors(result.errors);
    else { alert.textContent = result.message || `Test submission failed: ${result.code}`; alert.hidden = false; alert.focus(); }
    return;
  }
  const payment = await prototype.payment(result.registration.id, data.paymentOutcome);
  form.hidden = true;
  const confirmation = document.querySelector("#confirmation");
  const waiting = result.registration.entryStatus === "waiting_list";
  document.querySelector("#confirmation-title").textContent = waiting ? "Added to the test waiting list" : "Test entry recorded";
  document.querySelector("#confirmation-copy").textContent = `${result.registration.runner.firstName} has a ${result.registration.entryStatus.replace("_", " ")} test entry. Mock payment status: ${payment.registration?.paymentStatus ?? data.paymentOutcome}.`;
  confirmation.hidden = false; confirmation.focus();
  await refreshStatus();
});
