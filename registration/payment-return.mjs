import { prototype } from "./prototype-client.mjs";
import { paymentPresentation } from "./payment-state.mjs";
import { runnerMessageForCode } from "./runner-errors.mjs";

const title = document.querySelector("#payment-status-title");
const message = document.querySelector("#payment-status-message");
const actions = document.querySelector("#payment-actions");
const retry = document.querySelector("#retry-payment");
const refresh = document.querySelector("#refresh-payment");
const requestRefund = document.querySelector("#request-refund");
const confirmedRunners = document.querySelector("#confirmed-runners");
const environmentStatus = document.querySelector("#payment-environment-status");

const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
if (fragment.get("manage")) prototype.rememberManagementToken(fragment.get("manage"));
if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);

function integrationLabel(integrations) {
  const environment = integrations.environment === "production" ? "Production" : "Development";
  const stripe = integrations.stripe === "live" ? "Stripe live" : integrations.paymentsAvailable ? "Stripe sandbox" : "Payments unavailable";
  return `${environment} · ${stripe}`;
}

async function render() {
  if (new URLSearchParams(location.search).get("order") === "1" && prototype.orderToken()) {
    const [orderResult, integrations] = await Promise.all([prototype.currentOrder(), prototype.integrationStatus()]);
    environmentStatus.textContent = integrationLabel(integrations);
    if (!orderResult.ok) { title.textContent = "Order status unavailable"; message.textContent = "Use the secure order link sent to the purchaser."; actions.hidden = true; return; }
    const order = orderResult.order; const presentation = paymentPresentation(order.paymentStatus, { paymentsAvailable: integrations.paymentsAvailable === true });
    title.textContent = order.paymentStatus === "paid" ? "Entry confirmed" : presentation.title;
    message.textContent = order.paymentStatus === "paid"
      ? integrations.externalEmailAvailable ? "Payment confirmed. We’ve emailed each runner the information they need for their entry." : "Payment confirmed. External email delivery is disabled for this controlled proof; the organiser can review the entry in the dashboard."
      : presentation.message;
    confirmedRunners.replaceChildren(...order.registrations.map((item) => { const row = document.createElement("li"); row.textContent = `${item.runner.firstName} ${item.runner.lastName}${item.declaration.status === "complete" ? "" : " — declaration required"}`; return row; }));
    confirmedRunners.hidden = order.paymentStatus !== "paid";
    retry.hidden = !presentation.canRetry; requestRefund.hidden = true; actions.hidden = order.paymentStatus === "paid"; return;
  }
  const token = prototype.managementToken();
  if (!token) {
    title.textContent = "Secure entry link required";
    message.textContent = "Use the secure link supplied when the entry was created.";
    actions.hidden = true; return;
  }
  const [status, integrations] = await Promise.all([prototype.paymentStatus(token), prototype.integrationStatus()]);
  environmentStatus.textContent = integrationLabel(integrations);
  if (!status.ok) {
    title.textContent = "Payment status unavailable";
    message.textContent = runnerMessageForCode(status.code);
    actions.hidden = true; return;
  }
  const presentation = paymentPresentation(status.state, { paymentsAvailable: integrations.paymentsAvailable === true });
  title.textContent = presentation.title; message.textContent = presentation.message;
  retry.hidden = !presentation.canRetry && !presentation.unavailable;
  requestRefund.hidden = status.state !== "paid";
  retry.disabled = !integrations.paymentsAvailable;
  actions.hidden = status.state === "paid";
}

retry.addEventListener("click", async () => {
  retry.disabled = true;
  const result = new URLSearchParams(location.search).get("order") === "1" ? await prototype.checkoutOrder() : await prototype.checkout(prototype.managementToken());
  if (result.ok && result.checkoutUrl) location.assign(result.checkoutUrl);
  else { title.textContent = "Payments unavailable"; message.textContent = runnerMessageForCode(result.code); retry.disabled = true; }
});
requestRefund.addEventListener("click", async () => {
  if (!window.confirm("Request a full refund for this test entry? The organiser must review and approve it before any refund is made.")) return;
  requestRefund.disabled = true;
  const result = await prototype.requestRefund(prototype.managementToken());
  title.textContent = result.ok ? "Refund requested" : "Refund request unavailable";
  message.textContent = result.ok ? "Your full refund request is awaiting organiser review." : runnerMessageForCode(result.code);
  requestRefund.hidden = result.ok;
  requestRefund.disabled = false;
});
refresh.addEventListener("click", render);
await render();
