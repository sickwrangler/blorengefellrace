import { prototype, canTest } from "./prototype-client.mjs";
import { validateRunner } from "./registration-core.mjs";
import { isRunnerActionAvailable, organiserHandoverUrl } from "./runner-flow.mjs";
import { WFRA_SENIOR_ENTRY_DECLARATION } from "./declarations.mjs";

const form = document.querySelector("#registration-form");
const alert = document.querySelector("#form-alert");
const stages = [...document.querySelectorAll("[data-stage]")];
const stageNames = ["Your details / Eich manylion", "Race details and consent / Manylion y ras a chaniatâd", "Review and submit / Adolygu a chyflwyno", "Test payment and confirmation / Taliad prawf a chadarnhad"];
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
  data.affiliated = form.elements.affiliated.value === "yes";
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
  for (const [name, message] of Object.entries(errors)) {
    const control = form.elements[name]; if (!control) continue;
    control.setAttribute("aria-invalid", "true");
    const error = document.createElement("p"); error.className = "field-error"; error.textContent = message;
    control.closest("label")?.append(error);
  }
  alert.textContent = "Please correct the highlighted test details. / Cywirwch y manylion prawf sydd wedi'u hamlygu."; alert.hidden = false; alert.focus();
}
function validateStage(target) {
  const errors = validateRunner(payload());
  const relevantFields = target === 1
    ? ["firstName", "lastName", "email", "phone", "addressLine1", "city", "postcode", "dateOfBirth", "genderCategory", "membershipNumber", "wfraMembershipNumber"]
    : target === 2 ? ["emergencyName", "emergencyPhone", "travelMethod", "declarationName", "declarationSignatoryRole", "acceptDeclaration", "acceptTerms", "acceptPrivacy"] : Object.keys(errors);
  const relevant = Object.fromEntries(Object.entries(errors).filter(([name]) => relevantFields.includes(name)));
  if (Object.keys(relevant).length) { showErrors(relevant); return false; }
  clearErrors(); return true;
}
function showStage(number) {
  stage = number;
  stages.forEach((section) => { section.hidden = Number(section.dataset.stage) !== stage; });
  document.querySelector("#step-label").textContent = `Stage / Cam ${stage} of / o 4 — ${stageNames[stage - 1]}`;
  document.querySelector("#step-progress").value = stage;
  document.querySelector("#step-progress").textContent = `${stage} of 4`;
  if (stage === 3) renderReview();
  const heading = stages[stage - 1].querySelector("h2"); heading?.setAttribute("tabindex", "-1"); heading?.focus();
}
function renderReview() {
  const data = payload();
  const fields = { "Name / Enw": `${data.firstName} ${data.lastName}`, "Email / E-bost": data.email, "Phone / Ffôn": data.phone, "Address / Cyfeiriad": [data.addressLine1, data.addressLine2, data.city, data.postcode].filter(Boolean).join(", "), "Date of birth / Dyddiad geni": data.dateOfBirth, "Category / Categori": data.genderCategory === "Female" ? "Female / Benyw" : "Male / Open — Gwryw / Agored", "Club / Clwb": data.club || "Unattached / Digyswllt", "UK Athletics affiliation / Cysylltiad UK Athletics": data.affiliated ? `Yes / Ydw — ${data.membershipNumber}` : "No / Nac ydw", "WFRA member / Aelod WFRA": data.wfraMember ? `Yes / Ydw — ${data.wfraMembershipNumber}` : "No / Nac ydw", "Emergency contact / Cyswllt mewn argyfwng": `${data.emergencyName} — ${data.emergencyPhone}`, "Travel / Teithio": data.travelMethod, "Declaration / Datganiad": `${data.declarationName} — ${data.declarationSignatoryRole}` };
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
  if (!window.confirm("Delete all synthetic test entries and start again? / Dileu pob cofrestriad prawf ffug a dechrau eto?")) return;
  const result = await prototype.reset();
  if (!result.ok) { window.alert(result.message || "The test could not be reset. / Doedd dim modd ailosod y prawf."); return; }
  currentRegistration = null; submitting = false; form.reset();
  document.querySelector("#runner-flow").hidden = true; document.querySelector("#test-landing").hidden = false;
  document.querySelector("#payment-choice").hidden = false; document.querySelector("#payment-result").hidden = true;
  clearErrors(); updateMembershipFields(); await refreshStatus();
}

function updateMembershipFields() {
  const affiliated = form.elements.affiliated.value === "yes";
  const wfraMember = form.elements.wfraMember.value === "yes";
  document.querySelector("#uka-number-field").hidden = !affiliated;
  document.querySelector("#wfra-number-field").hidden = !wfraMember;
  form.elements.membershipNumber.required = affiliated;
  form.elements.wfraMembershipNumber.required = wfraMember;
}

document.querySelector("#start-test")?.addEventListener("click", () => { document.querySelector("#test-landing").hidden = true; document.querySelector("#runner-flow").hidden = false; showStage(1); });
document.querySelector("#reset-test")?.addEventListener("click", resetTest);
form.elements.affiliated?.addEventListener("change", updateMembershipFields);
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
    if (result.errors) showErrors(result.errors); else { alert.textContent = result.code === "LINK_UNAVAILABLE" ? "This link is no longer available. / Dydy'r ddolen hon ddim ar gael bellach." : result.message || "The test entry could not be submitted. / Doedd dim modd cyflwyno'r cofrestriad prawf."; alert.hidden = false; alert.focus(); }
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
  document.querySelector("#result-title").textContent = successful ? "Test entry confirmed / Cofrestriad prawf wedi'i gadarnhau" : outcome === "declined" ? "Mock payment declined / Taliad ffug wedi'i wrthod" : "Mock payment abandoned / Taliad ffug wedi'i adael";
  document.querySelector("#result-copy").textContent = successful ? "The same synthetic registration has been updated. No money was taken and no email was sent. / Mae'r un cofrestriad ffug wedi'i ddiweddaru. Ni chymerwyd arian ac ni anfonwyd e-bost." : "The synthetic registration remains available to the organiser. Retry mock payment when ready. / Mae'r cofrestriad ffug yn dal ar gael i'r trefnydd. Rhowch gynnig arall ar y taliad ffug pan fyddwch yn barod.";
  document.querySelector("#result-reference").textContent = currentRegistration.testReference;
  document.querySelector("#result-entry").textContent = currentRegistration.entryStatus.replace("_", " ");
  document.querySelector("#result-payment").textContent = currentRegistration.paymentStatus;
  document.querySelector("#organiser-handover").href = organiserHandoverUrl(currentRegistration.testReference);
  document.querySelector("#success-action").hidden = !successful; document.querySelector("#retry-action").hidden = successful;
  document.querySelector("#payment-choice").hidden = true; document.querySelector("#payment-result").hidden = false; document.querySelector("#payment-result").focus();
});
document.querySelector("#retry-payment")?.addEventListener("click", () => { document.querySelector("#payment-result").hidden = true; document.querySelector("#payment-choice").hidden = false; document.querySelector("#payment-heading").focus(); });
