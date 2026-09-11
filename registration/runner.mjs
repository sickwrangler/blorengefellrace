import { prototype, canTest } from "./prototype-client.mjs";
import { validateRunner } from "./registration-core.mjs";
import { WFRA_SENIOR_ENTRY_DECLARATION } from "./declarations.mjs";
import { normalizeRunnerErrors, RUNNER_FIELD_STAGES, runnerMessageForCode } from "./runner-errors.mjs";

const form = document.querySelector("#registration-form");
const alert = document.querySelector("#form-alert");
const stages = [...document.querySelectorAll("[data-stage]")];
const stageNames = ["Runner details", "Race details and declaration", "Review your entries", "Payment and confirmation"];
let stage = 1;
let currentOrder = null;
let submitting = false;
let editingRegistrationId = null;

function runnerAgeOnRaceDay(dateOfBirth) {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`); const race = new Date("2026-11-28T00:00:00Z");
  if (Number.isNaN(birth.valueOf())) return NaN;
  let age = race.getUTCFullYear() - birth.getUTCFullYear();
  if (race.getUTCMonth() < birth.getUTCMonth() || (race.getUTCMonth() === birth.getUTCMonth() && race.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

function guardianRequired() { const age = runnerAgeOnRaceDay(form.elements.dateOfBirth.value); return Number.isFinite(age) && age < 18; }

const declarationContainer = document.querySelector("#declaration-content");
declarationContainer.replaceChildren(...WFRA_SENIOR_ENTRY_DECLARATION.paragraphs.map((text) => { const paragraph = document.createElement("p"); paragraph.textContent = text; return paragraph; }));
document.querySelector("#safety-requirements-link").href = WFRA_SENIOR_ENTRY_DECLARATION.safetyRequirementsUrl;

function payload() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.wfraMember = form.elements.wfraMember.value === "yes";
  data.acceptTerms = form.elements.acceptTerms.checked;
  data.acceptPrivacy = form.elements.acceptPrivacy.checked;
  data.acceptDeclaration = form.elements.acceptDeclaration.checked;
  data.completedByNamedRunner = form.elements.completedByNamedRunner.checked;
  data.completedByParentOrLegalGuardian = form.elements.completedByParentOrLegalGuardian.checked;
  if (guardianRequired()) { data.declarationName = form.elements.guardianDeclarationName.value; data.declarationSignatoryRole = "Parent / Legal Guardian"; }
  else data.declarationSignatoryRole = "Competitor";
  return data;
}

function apiRunnerInput() {
  const data = payload();
  return {
    runner: { ...data, raceCategory: data.genderCategory, emergencyContactName: data.emergencyName, emergencyContactPhone: data.emergencyPhone },
    declarationMode: data.declarationTiming,
    declaration: data.declarationTiming === "now" ? { declarationIdentifier: WFRA_SENIOR_ENTRY_DECLARATION.identifier, declarationVersion: WFRA_SENIOR_ENTRY_DECLARATION.version, accepted: data.acceptDeclaration, typedFullName: data.declarationName, signatoryRole: data.declarationSignatoryRole, completedByNamedRunner: data.completedByNamedRunner, completedByParentOrLegalGuardian: data.completedByParentOrLegalGuardian } : null
  };
}

function clearErrors() {
  form.querySelectorAll(".field-error").forEach((node) => node.remove());
  form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  alert.hidden = true;
}

function showErrors(errors) {
  clearErrors(); const normalized = normalizeRunnerErrors(errors);
  const firstName = Object.keys(normalized.mapped).sort((left, right) => (RUNNER_FIELD_STAGES[left] ?? 2) - (RUNNER_FIELD_STAGES[right] ?? 2))[0];
  const targetStage = firstName ? RUNNER_FIELD_STAGES[firstName] ?? 2 : stage; if (targetStage < stage) showStage(targetStage);
  for (const [name, message] of Object.entries(normalized.mapped)) {
    const control = form.elements[name]; if (!control) continue;
    control.setAttribute("aria-invalid", "true"); const error = document.createElement("p"); error.className = "field-error"; error.textContent = message; control.closest("label")?.append(error);
  }
  alert.textContent = normalized.unmapped[0] ?? "Please correct the highlighted details."; alert.hidden = false; alert.focus(); form.elements[firstName]?.focus();
}

function validationErrors() {
  const data = payload(); const errors = validateRunner(data);
  if (data.declarationTiming === "later") for (const key of ["declarationName", "declarationSignatoryRole", "acceptDeclaration", "completedByNamedRunner", "completedByParentOrLegalGuardian"]) delete errors[key];
  if (data.declarationTiming === "now" && guardianRequired()) {
    if (errors.declarationName) { errors.guardianDeclarationName = errors.declarationName; delete errors.declarationName; }
    if (!data.completedByParentOrLegalGuardian) errors.completedByParentOrLegalGuardian = "A parent or legal guardian must confirm they are completing this declaration.";
  } else if (data.declarationTiming === "now" && !data.completedByNamedRunner) errors.completedByNamedRunner = "The named runner must confirm they are completing this declaration themselves.";
  return errors;
}

function validateStage(target) {
  const errors = validationErrors();
  const fields = target === 1 ? ["firstName", "lastName", "email", "phone", "addressLine1", "city", "postcode", "dateOfBirth", "genderCategory", "wfraMembershipNumber"] : ["emergencyName", "emergencyPhone", "declarationName", "guardianDeclarationName", "acceptDeclaration", "completedByNamedRunner", "completedByParentOrLegalGuardian", "acceptTerms", "acceptPrivacy"];
  const relevant = Object.fromEntries(Object.entries(errors).filter(([name]) => fields.includes(name)));
  if (Object.keys(relevant).length) { showErrors(relevant); return false; } clearErrors(); return true;
}

function showStage(number) {
  stage = number; stages.forEach((section) => { section.hidden = Number(section.dataset.stage) !== stage; });
  document.querySelector("#step-label").textContent = `Stage ${stage} of 4 — ${stageNames[stage - 1]}`; document.querySelector("#step-progress").value = stage; document.querySelector("#step-progress").textContent = `${stage} of 4`;
  if (stage === 3) renderReview(); const heading = stages[stage - 1].querySelector("h2"); heading?.setAttribute("tabindex", "-1"); heading?.focus();
}

function renderReview() {
  const data = payload(); const declaration = data.declarationTiming === "later" ? "Declaration to be completed after entry" : `Complete — ${data.declarationName} (${data.declarationSignatoryRole})`;
  const fields = { Name: `${data.firstName} ${data.lastName}`, Email: data.email, Category: data.genderCategory, Club: data.club || "Unattached", "WFRA member": data.wfraMember ? "Yes" : "No", Price: data.wfraMember ? "£4.00" : "£6.00", Declaration: declaration };
  document.querySelector("#review-list").replaceChildren(...Object.entries(fields).flatMap(([label, value]) => { const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value; return [dt, dd]; }));
}

function setFormFromRunner(item) {
  const runner = item.runner;
  const mapping = { firstName: runner.firstName, lastName: runner.lastName, email: runner.email, phone: runner.phone, addressLine1: runner.addressLine1, addressLine2: runner.addressLine2, city: runner.city, postcode: runner.postcode, genderCategory: runner.raceCategory, dateOfBirth: runner.dateOfBirth, club: runner.club, wfraMembershipNumber: runner.wfraMembershipNumber, emergencyName: runner.emergencyContactName, emergencyPhone: runner.emergencyContactPhone };
  for (const [name, value] of Object.entries(mapping)) if (form.elements[name]) form.elements[name].value = value ?? "";
  form.elements.wfraMember.value = runner.wfraMember ? "yes" : "no"; form.elements.declarationTiming.value = item.declaration.status === "complete" ? "now" : "later"; updateMembershipFields(); updateDeclarationFields();
}

function renderOrder() {
  if (!currentOrder) return; const list = document.querySelector("#order-runner-list"); list.replaceChildren();
  for (const item of currentOrder.registrations) {
    const card = document.createElement("article"); card.className = "entrant-card"; const heading = document.createElement("h4"); heading.textContent = `${item.runner.firstName} ${item.runner.lastName}`;
    const facts = document.createElement("p"); facts.textContent = `${item.runner.raceCategory}${item.runner.club ? ` · ${item.runner.club}` : ""} · £${(item.pricePence / 100).toFixed(2)} · ${item.declaration.status === "complete" ? "Declaration complete" : "Declaration required after payment"}`;
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "text-button"; edit.textContent = "Edit";
    edit.addEventListener("click", () => { editingRegistrationId = item.id; setFormFromRunner(item); document.querySelector("#order-review").hidden = true; document.querySelector("#submit-test").textContent = "Save runner changes"; document.querySelector("#submit-test").closest(".form-actions").hidden = false; showStage(1); });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button danger-link"; remove.textContent = "Remove";
    remove.addEventListener("click", async () => { if (!window.confirm(`Remove ${heading.textContent} from this unpaid order?`)) return; const result = await prototype.removeOrderRunner(item.id); if (!result.ok) return showApiError(result); currentOrder = result.order; renderOrder(); });
    card.append(heading, facts, edit, remove); list.append(card);
  }
  document.querySelector("#order-total").textContent = `£${(currentOrder.totalPence / 100).toFixed(2)}`; document.querySelector("#add-another-runner").disabled = currentOrder.runnerCount >= 5; document.querySelector("#continue-order-payment").disabled = currentOrder.runnerCount < 1; document.querySelector("#order-review").hidden = false;
}

function showApiError(result) {
  const messages = { DUPLICATE_ORDER_EMAIL: "Each runner needs a unique email address so we can send their declaration and entry-management link directly.", DUPLICATE_ACTIVE_ENTRY: "An active entry may already exist for this email address.", ORDER_RUNNER_LIMIT: "An order can contain up to five runners.", GROUP_CAPACITY_UNAVAILABLE: `This whole group cannot currently fit. ${result.availablePlaces ?? 0} place(s) remain; remove runner(s) to continue.`, RUNNER_MUST_COMPLETE_DECLARATION: "The named runner must personally complete the declaration, or choose to complete it later." };
  alert.textContent = result.message ?? messages[result.code] ?? runnerMessageForCode(result.code); alert.hidden = false; alert.focus(); if (result.errors) showErrors(result.errors);
}

async function refreshStatus() {
  const status = await prototype.status(); document.querySelector("#status-places").textContent = `${status.accepted} / ${status.capacity}`; document.querySelector("#status-waiting").textContent = status.waiting; const standard = (status.pricing?.standardPricePence ?? 600) / 100; const member = (status.pricing?.wfraMemberPricePence ?? 400) / 100; document.querySelector("#status-price").textContent = `£${standard.toFixed(0)} standard · £${member.toFixed(0)} WFRA`;
  const recovery = document.querySelector("#runner-recovery"); recovery.hidden = !status.recovery; recovery.textContent = status.recovery?.message || ""; document.querySelector("#start-test").disabled = Boolean(status.recovery);
  return status;
}

function updateMembershipFields() { const member = form.elements.wfraMember.value === "yes"; document.querySelector("#wfra-number-field").hidden = !member; form.elements.wfraMembershipNumber.required = member; }
function updateDeclarationFields() {
  const now = form.elements.declarationTiming.value === "now"; const guardian = guardianRequired();
  document.querySelector("#declaration-fields").hidden = !now; document.querySelector("#adult-declaration-fields").hidden = guardian; document.querySelector("#guardian-declaration-fields").hidden = !guardian;
  form.elements.declarationName.required = now && !guardian; form.elements.completedByNamedRunner.required = now && !guardian;
  form.elements.guardianDeclarationName.required = now && guardian; form.elements.completedByParentOrLegalGuardian.required = now && guardian; form.elements.acceptDeclaration.required = now;
}

async function beginOrRecover() {
  const recovered = await prototype.currentOrder();
  if (recovered.ok && ["draft", "checkout_expired", "checkout_pending"].includes(recovered.order.status)) { currentOrder = recovered.order; document.querySelector("#test-landing").hidden = true; document.querySelector("#runner-flow").hidden = false; showStage(3); document.querySelector("#submit-test").closest(".form-actions").hidden = true; renderOrder(); if (recovered.order.paymentRequired) { alert.textContent = recovered.order.status === "checkout_pending" ? "Payment required. Continue to payment to return to your existing secure Checkout." : "Payment required. Places are not held after Checkout expires; capacity and price will be checked again."; alert.hidden = false; } }
}

if (!canTest) document.querySelector("#closed-panel").hidden = false;
else if (prototype.hasPrivateInvitation && !(await prototype.inspectPrivateAccess("registration")).ok) document.querySelector("#invalid-link-panel").hidden = false;
else { const status = await refreshStatus(); if (status.environment === "production" && !["OPEN", "PRIVATE_LIVE"].includes(status.operationalState)) document.querySelector("#closed-panel").hidden = false; else { document.querySelector("#test-experience").hidden = false; await beginOrRecover(); } }

document.querySelector("#start-test")?.addEventListener("click", () => { const purchaser = document.querySelector("#purchaser-email"); if (!purchaser.checkValidity()) return purchaser.reportValidity(); document.querySelector("#test-landing").hidden = true; document.querySelector("#runner-flow").hidden = false; showStage(1); });
document.querySelector("#details-continue")?.addEventListener("click", () => { if (validateStage(1)) showStage(2); });
document.querySelector("#race-back")?.addEventListener("click", () => showStage(1));
document.querySelector("#race-continue")?.addEventListener("click", () => { if (validateStage(2)) showStage(3); });
document.querySelector("#review-back")?.addEventListener("click", () => showStage(2));
form.elements.wfraMember.addEventListener("change", updateMembershipFields); form.elements.dateOfBirth.addEventListener("change", updateDeclarationFields); for (const choice of form.elements.declarationTiming) choice.addEventListener("change", updateDeclarationFields); updateMembershipFields(); updateDeclarationFields();

form.addEventListener("submit", async (event) => {
  event.preventDefault(); if (submitting || !validateStage(2)) return; submitting = true; let result;
  if (!currentOrder) { result = await prototype.createOrder(document.querySelector("#purchaser-email").value); if (!result.ok) { submitting = false; return showApiError(result); } currentOrder = result.order; }
  result = editingRegistrationId ? await prototype.updateOrderRunner(editingRegistrationId, apiRunnerInput()) : await prototype.addOrderRunner(apiRunnerInput()); submitting = false; if (!result.ok) return showApiError(result);
  editingRegistrationId = null; document.querySelector("#submit-test").textContent = "Add runner to order";
  currentOrder = result.order; document.querySelector("#submit-test").closest(".form-actions").hidden = true; renderOrder(); await refreshStatus();
});

document.querySelector("#add-another-runner")?.addEventListener("click", () => { const next = currentOrder.runnerCount + 1; editingRegistrationId = null; document.querySelector("#submit-test").textContent = "Add runner to order"; form.reset(); form.elements.email.value = `runner-${next}@example.com`; form.elements.firstName.value = `Runner ${next}`; form.elements.lastName.value = "Example"; form.elements.declarationName.value = `Runner ${next} Example`; updateMembershipFields(); updateDeclarationFields(); document.querySelector("#order-review").hidden = true; document.querySelector("#submit-test").closest(".form-actions").hidden = false; showStage(1); });
document.querySelector("#continue-order-payment")?.addEventListener("click", async () => { document.querySelector("#payment-runner-count").textContent = currentOrder.runnerCount; document.querySelector("#payment-order-total").textContent = `£${(currentOrder.totalPence / 100).toFixed(2)}`; showStage(4); await renderPaymentAvailability(); });

async function renderPaymentAvailability() { const integrations = await prototype.integrationStatus(); const button = document.querySelector("#continue-payment"); button.disabled = integrations.paymentsAvailable !== true; document.querySelector("#payment-availability").textContent = integrations.paymentsAvailable ? "You will pay for every runner in one Stripe test Checkout. Outstanding declarations do not prevent payment." : "Online payment is not available in this development environment."; }
document.querySelector("#continue-payment")?.addEventListener("click", async () => { const button = document.querySelector("#continue-payment"); button.disabled = true; const result = await prototype.checkoutOrder(); if (result.ok && result.checkoutUrl) return location.assign(result.checkoutUrl); showApiError(result); await renderPaymentAvailability(); });
document.querySelector("#reset-test")?.addEventListener("click", async () => { if (!window.confirm("Delete all synthetic test entries and start again?")) return; const result = await prototype.reset(); if (result.ok) location.reload(); else showApiError(result); });
