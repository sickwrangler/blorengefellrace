import { prototype } from "./prototype-client.mjs";
import { paymentPresentation } from "./payment-state.mjs";
import { runnerMessageForCode } from "./runner-errors.mjs";

const title = document.querySelector("#payment-status-title");
const message = document.querySelector("#payment-status-message");
const actions = document.querySelector("#payment-actions");
const retry = document.querySelector("#retry-payment");
const refresh = document.querySelector("#refresh-payment");
const help = document.querySelector("#payment-help");

const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
if (fragment.get("manage")) prototype.rememberManagementToken(fragment.get("manage"));
if (location.hash) history.replaceState(null, "", `${location.pathname}${location.search}`);

async function render() {
  const token = prototype.managementToken();
  if (!token) {
    title.textContent = "Secure entry link required";
    message.textContent = "Use the secure link supplied when the entry was created.";
    actions.hidden = true; help.hidden = false; return;
  }
  const [status, integrations] = await Promise.all([prototype.paymentStatus(token), prototype.integrationStatus()]);
  if (!status.ok) {
    title.textContent = "Payment status unavailable";
    message.textContent = runnerMessageForCode(status.code);
    actions.hidden = true; help.hidden = false; return;
  }
  const presentation = paymentPresentation(status.state, { paymentsAvailable: integrations.paymentsAvailable === true });
  title.textContent = presentation.title; message.textContent = presentation.message;
  retry.hidden = !presentation.canRetry && !presentation.unavailable;
  retry.disabled = !integrations.paymentsAvailable;
  actions.hidden = false; help.hidden = !presentation.unavailable;
}

retry.addEventListener("click", async () => {
  retry.disabled = true;
  const result = await prototype.checkout(prototype.managementToken());
  if (result.ok && result.checkoutUrl) location.assign(result.checkoutUrl);
  else { title.textContent = "Payments unavailable"; message.textContent = runnerMessageForCode(result.code); retry.disabled = true; help.hidden = false; }
});
refresh.addEventListener("click", render);
await render();
