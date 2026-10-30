const templates = Object.freeze({
  continue_to_payment: ["Continue your Blorenge Fell Race entry", "Your details have been saved. Use your secure entry link to continue to payment and manage this runner's entry."],
  payment_confirmed: ["Blorenge Fell Race payment confirmed", "Payment has been received for this runner."],
  entry_confirmed: ["Blorenge Fell Race entry confirmed", "Payment has been received and this runner's race entry is confirmed. Use Manage your entry below to edit permitted details, transfer the paid place to another runner, withdraw from the race, or make a separate refund request where eligible."],
  payment_unsuccessful: ["Blorenge Fell Race payment unsuccessful", "Your payment was not completed. Your secure entry link explains how to try again."],
  payment_session_expired: ["Blorenge Fell Race payment session expired", "Your payment session expired before payment was confirmed. Your secure entry link explains how to try again."],
  management_link: ["Manage your Blorenge Fell Race entry", "Use the secure link below to review your entry. Transfer entry passes the paid place to another runner. Withdraw from race releases the place without an automatic refund. Request refund is a separate action where eligible."],
  entry_amended: ["Blorenge Fell Race entry updated", "Your race entry details have been updated."],
  entry_transferred: ["Blorenge Fell Race entry transferred", "This paid race place has been transferred to you. Use the links below to manage the entry and complete your own race declaration."],
  entry_transferred_previous_runner: ["Blorenge Fell Race transfer completed", "The race entry has been transferred. Your previous secure management link no longer works."],
  refund_requested: ["Blorenge Fell Race refund request received", "Your refund request has been received for organiser review."],
  refund_approved: ["Blorenge Fell Race refund approved", "Your refund has been approved and will be processed securely."],
  refund_rejected: ["Blorenge Fell Race refund request update", "Your refund request was not approved. Contact the organiser if you need help."],
  refund_completed: ["Blorenge Fell Race refund completed", "Your full refund has been completed and your race place released."],
  waiting_list_joined: ["Blorenge Fell Race waiting list", "You have joined the waiting list. We will contact you if a place becomes available."],
  waiting_list_offer: ["A Blorenge Fell Race place is available", "A race place is reserved for you for 48 hours. Use the secure offer link below if you wish to enter."],
  waiting_list_reminder: ["Blorenge Fell Race place offer reminder", "Your reserved place offer is still available. It expires at the time shown below."],
  waiting_list_declined: ["Blorenge Fell Race place offer declined", "Your place offer has been declined and released to the next person."],
  waiting_list_expired: ["Blorenge Fell Race place offer expired", "Your 48-hour place offer has expired and the place has been released."],
  registration_cancelled: ["Blorenge Fell Race entry cancelled", "This race entry has been cancelled."],
  runner_withdrawn: ["Blorenge Fell Race — withdrawal confirmed", "Your withdrawal is confirmed and your race place has been released. You cannot reinstate this entry yourself. No automatic refund has been issued; any eligible refund request is a separate action in Manage your entry. If you change your mind, you must register again or join the waiting list."],
  organiser_runner_withdrawn: ["Blorenge Fell Race — Runner withdrawn, place available", "A runner has withdrawn and one confirmed race place has been released. Review the waiting list in the organiser dashboard before deciding whether to offer the available place."],
  order_payment_confirmed: ["Blorenge Fell Race group payment confirmed", "Your group payment has been received. Each runner has their own entry and will receive their own secure communication."],
  order_saved: ["Continue your Blorenge Fell Race group entry", "Your unpaid group order has been saved. Use this secure link to add, edit or remove runners and continue to payment."],
  entry_confirmed_declaration_required: ["Blorenge Fell Race entry confirmed — declaration required", "Your race place has been paid for and confirmed. You must personally complete the WFRA declaration before you can start the race. Use Manage your entry below to edit permitted details, transfer the paid place, withdraw from the race, or make a separate refund request where eligible."],
  declaration_reminder: ["Blorenge Fell Race declaration reminder", "Your race place remains confirmed. Please personally complete the WFRA declaration before race day."],
});

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function renderRegistrationEmail(template, data = {}) {
  const selected = templates[template];
  if (!selected) throw new Error("Unknown registration email template.");
  const lines = [selected[1]];
  if (data.intendedRecipientAddress) lines.push(`Intended recipient: ${data.intendedRecipientAddress}`);
  if (data.expiresAt) lines.push(`Expires: ${new Date(data.expiresAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}`);
  if (data.runnerName) lines.push(`Runner: ${data.runnerName}`);
  if (data.entryReference) lines.push(`Entry reference: ${data.entryReference}`);
  if (Number.isInteger(data.raceNumber)) lines.push(`Race number: ${data.raceNumber}`);
  if (data.withdrawnAt) lines.push(`Withdrawn: ${new Date(data.withdrawnAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}`);
  if (Number.isInteger(data.confirmedCount)) lines.push(`Confirmed entries: ${data.confirmedCount}`);
  if (Number.isInteger(data.availableCapacity)) lines.push(`Available capacity: ${data.availableCapacity}`);
  if (Number.isInteger(data.waitingCount)) lines.push(`Waiting list: ${data.waitingCount}`);
  if (data.raceDate) lines.push(`Race date: ${new Date(`${data.raceDate}T12:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "Europe/London" })}`);
  if (data.status) lines.push(`Status: ${data.status}`);
  if (data.transferDeadline) lines.push(`Transfer deadline: ${new Date(data.transferDeadline).toLocaleString("en-GB", { timeZone: "Europe/London" })}`);
  if (data.managementExpiresAt) lines.push(`This management link expires: ${new Date(data.managementExpiresAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}`);
  if (data.runnerCount) lines.push(`Entries: ${data.runnerCount}`);
  if (Number.isInteger(data.amountPence)) lines.push(`Payment: £${(data.amountPence / 100).toFixed(2)}`);
  const declarationAction = ["entry_confirmed_declaration_required", "declaration_reminder", "entry_transferred"].includes(template);
  const managementAction = template === "management_link";
  if (data.secureUrl) lines.push(`${declarationAction ? "Sign your race declaration" : managementAction ? "Manage your entry" : "Secure entry link"}: ${data.secureUrl}`);
  if (data.managementUrl) lines.push(`Manage your entry: ${data.managementUrl}`);
  if (data.managementRecoveryUrl) lines.push(`Expired link? Request a replacement: ${data.managementRecoveryUrl}`);
  if (data.raceInfoUrl) lines.push(`Race information: ${data.raceInfoUrl}`);
  if (data.organiserDashboardUrl) lines.push(`Organiser waiting-list dashboard: ${data.organiserDashboardUrl}`);
  const text = lines.join("\n\n");
  const html = lines.map((line) => line.startsWith("Sign your race declaration: ")
    ? `<p><a href="${escapeHtml(data.secureUrl)}">Sign your race declaration</a></p>`
    : line.startsWith("Manage your entry: ")
      ? `<p><a href="${escapeHtml(data.managementUrl ?? data.secureUrl)}">Manage your entry</a></p>`
      : line.startsWith("Secure entry link: ")
    ? `<p><a href="${escapeHtml(data.secureUrl)}">Open your secure entry page</a></p>`
    : line.startsWith("Expired link? Request a replacement: ")
      ? `<p><a href="${escapeHtml(data.managementRecoveryUrl)}">Request a replacement management link</a></p>`
    : line.startsWith("Race information: ")
      ? `<p><a href="${escapeHtml(data.raceInfoUrl)}">Race information</a></p>`
    : line.startsWith("Organiser waiting-list dashboard: ")
      ? `<p><a href="${escapeHtml(data.organiserDashboardUrl)}">Open the organiser waiting-list dashboard</a></p>`
      : `<p>${escapeHtml(line)}</p>`).join("");
  return { subject: selected[0], text, html };
}

export const REGISTRATION_EMAIL_TEMPLATE_NAMES = Object.freeze(Object.keys(templates));
