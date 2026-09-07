import { prototype, canTest } from "./prototype-client.mjs";
import { validateRunner } from "./registration-core.mjs";
import { isRunnerActionAvailable } from "./runner-flow.mjs";
import { WFRA_SENIOR_ENTRY_DECLARATION } from "./declarations.mjs";
import { normalizeRunnerErrors, RUNNER_FIELD_STAGES, runnerMessageForCode } from "./runner-errors.mjs";

const form = document.querySelector("#registration-form");
const alert = document.querySelector("#form-alert");
const stages = [...document.querySelectorAll("[data-stage]")];
const stageNames = ["Your details", "Race details and consent", "Review and submit", "Payment and confirmation"];
let stage = 1;
let currentRegistration = null;
let submitting = false;

const declarationContainer = document.querySelector("#declaration-content");
declarationContainer.replaceChildren(...WFRA_SENIOR_ENTRY_DECLARATION.paragraphs.map((text) => { const paragraph = document.createElement("p"); paragraph.textContent = text; return paragraph; }));
document.querySelector("#safety-requirements-link").href = WFRA_SENIOR_ENTRY_DECLARATION.safetyRequirementsUrl;

if (!canTest) document.querySelector("#closed-panel").hidden = false;
else if (prototype.hasPrivateInvitation && !(await prototype.inspectPrivateAccess("registration")).ok) document.querySelector("#invalid-link-panel").hidden = false;
else { document.querySelector("#test-experience").hidden = false; await refreshStatus(); }

function payload() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.wfraMember = form.elements.wfraMember.value === "yes";
  data.acceptTerms = form.elements.acceptTerms.checked;
  data.acceptPrivacy = form.elements.acceptPrivacy.checked;
  data.acceptDeclaration = form.elements.acceptDeclaration.checked;
  return data;
}
function clearErrors() {
  form.querySelectorAll(".field-error").forEach((node) => node.remove());
  form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  alert.hidden = true;
}
function showErrors(errors) {
  clearErrors();
  const normalized = normalizeRunnerErrors(errors);
  const firstName = Object.keys(normalized.mapped).sort((left, right) => RUNNER_FIELD_STAGES[left] - RUNNER_FIELD_STAGES[right])[0];
  const targetStage = firstName ? RUNNER_FIELD_STAGES[firstName] : stage;
  if (targetStage < stage) showStage(targetStage);
  for (const [name, message] of Object.entries(normalized.mapped)) {
    const control = form.elements[name]; if (!control) continue;
    control.setAttribute("aria-invalid", "true");
    const error = document.createElement("p"); error.className = "field-error"; error.textContent = message;
    control.closest("label")?.append(error);
  }
  alert.textContent = normalized.unmapped[0] ?? "Please correct the highlighted details."; alert.hidden = false;
  const firstControl = firstName ? form.elements[firstName] : null;
  if (firstControl) firstControl.focus(); else alert.focus();
}
function validateStage(target) {
  const errors = validateRunner(payload());
  const relevantFields = target === 1
    ? ["firstName", "lastName", "email", "phone", "addressLine1", "city", "postcode", "dateOfBirth", "genderCategory", "wfraMembershipNumber"]
    : target === 2 ? ["emergencyName", "emergencyPhone", "declarationName", "declarationSignatoryRole", "acceptDeclaration", "acceptTerms", "acceptPrivacy"] : Object.keys(errors);
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
  const fields = { "Name": `${data.firstName} ${data.lastName}`, "Email": data.email, "Phone": data.phone, "Address": [data.addressLine1, data.addressLine2, data.city, data.postcode].filter(Boolean).join(", "), "Date of birth": data.dateOfBirth, "Category": data.genderCategory, "Club": data.club || "Unattached", "WFRA member": data.wfraMember ? `Yes — ${data.wfraMembershipNumber}` : "No", "Emergency contact": `${data.emergencyName} — ${data.emergencyPhone}`, "Declaration": `${data.declarationName} — ${data.declarationSignatoryRole}` };
  document.querySelector("#review-list").replaceChildren(...Object.entries(fields).flatMap(([label, value]) => {
    const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; return [dt, dd];
  }));
}
async function refreshStatus() {
  const status = await prototype.status();
  document.querySelector("#status-places").textContent = `${status.accepted} / ${status.capacity}`;
  document.querySelector("#status-waiting").textContent = status.waiting;
  document.querySelector("#status-price").textContent = `£${((status.pricing?.standardPricePence ?? 600) / 100).toFixed(2)}`;
  const environment = status.environment === "production" ? "Production" : "Development";
  const operational = status.operationalState === "PRIVATE_LIVE" ? "Private" : status.operationalState === "OPEN" ? "Open" : status.operationalState === "PAUSED" ? "Paused" : "Closed";
  document.querySelector("#environment-status").textContent = environment === "Production" && operational === "Open" ? "" : `${environment} · ${operational}`;
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
  clearErrors(); updateMembershipFields(); await refreshStatus();
}

function updateMembershipFields() {
  const wfraMember = form.elements.wfraMember.value === "yes";
  document.querySelector("#wfra-number-field").hidden = !wfraMember;
  form.elements.wfraMembershipNumber.required = wfraMember;
}

document.querySelector("#start-test")?.addEventListener("click", () => { document.querySelector("#test-landing").hidden = true; document.querySelector("#runner-flow").hidden = false; showStage(1); });
document.querySelector("#reset-test")?.addEventListener("click", resetTest);
form.elements.wfraMember?.addEventListener("change", updateMembershipFields);
updateMembershipFields();
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
    if (result.errors) showErrors(result.errors); else { alert.textContent = runnerMessageForCode(result.code); alert.hidden = false; alert.focus(); }
    return;
  }
  currentRegistration = result.registration;
  document.querySelector("#payment-reference").textContent = currentRegistration.testReference;
  showStage(4); await refreshStatus(); await renderPaymentAvailability();
});

async function renderPaymentAvailability() {
  const integrations = await prototype.integrationStatus();
  const button = document.querySelector("#continue-payment");
  button.disabled = integrations.paymentsAvailable !== true;
  document.querySelector("#payment-availability").textContent = integrations.paymentsAvailable
    ? "You will continue to Stripe's secure test checkout. No real payment will be taken."
    : "Online payment is not available yet in this development environment. Your synthetic entry details have been retained.";
  document.querySelector("#environment-status").textContent = integrations.paymentsAvailable ? "Development · Private · Stripe sandbox" : "Development · Closed · Payments unavailable";
}

document.querySelector("#continue-payment")?.addEventListener("click", async () => {
  const button = document.querySelector("#continue-payment"); button.disabled = true;
  const result = await prototype.checkout();
  if (result.ok && result.checkoutUrl) { location.assign(result.checkoutUrl); return; }
  alert.textContent = runnerMessageForCode(result.code); alert.hidden = false; alert.focus();
  await renderPaymentAvailability();
});
