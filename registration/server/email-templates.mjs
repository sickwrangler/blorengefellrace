const templates = Object.freeze({
  continue_to_payment: ["Continue your Blorenge Fell Race entry", "Your details have been saved. Continue to the secure payment page to complete your entry."],
  entry_confirmed: ["Blorenge Fell Race entry confirmed", "Payment has been received and your race entry is confirmed."],
  payment_unsuccessful: ["Blorenge Fell Race payment unsuccessful", "Your payment was not completed. Your secure entry link explains how to try again."],
  payment_session_expired: ["Blorenge Fell Race payment session expired", "Your payment session expired before payment was confirmed. Your secure entry link explains how to try again."],
  management_link: ["Manage your Blorenge Fell Race entry", "Use the secure link below to review or manage your entry."],
  entry_amended: ["Blorenge Fell Race entry updated", "Your race entry details have been updated."],
  entry_transferred: ["Blorenge Fell Race entry transferred", "The race entry has been transferred to the new runner details supplied."],
  refund_requested: ["Blorenge Fell Race refund request received", "Your refund request has been received for organiser review."],
  refund_approved: ["Blorenge Fell Race refund approved", "Your refund has been approved and will be processed securely."],
  refund_rejected: ["Blorenge Fell Race refund request update", "Your refund request was not approved. Contact the organiser if you need help."],
  refund_completed: ["Blorenge Fell Race refund completed", "Your full refund has been completed and your race place released."],
  waiting_list_joined: ["Blorenge Fell Race waiting list", "You have joined the waiting list. We will contact you if a place becomes available."],
  waiting_list_offer: ["A Blorenge Fell Race place is available", "A race place is reserved for you for 48 hours. Use the secure offer link below if you wish to enter."],
  waiting_list_reminder: ["Blorenge Fell Race place offer reminder", "Your reserved place offer is still available. It expires at the time shown below."],
  waiting_list_declined: ["Blorenge Fell Race place offer declined", "Your place offer has been declined and released to the next person."],
  waiting_list_expired: ["Blorenge Fell Race place offer expired", "Your 48-hour place offer has expired and the place has been released."],
});

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function renderRegistrationEmail(template, data = {}) {
  const selected = templates[template];
  if (!selected) throw new Error("Unknown registration email template.");
  const lines = [selected[1]];
  if (data.intendedRecipientAddress) lines.push(`Intended recipient: ${data.intendedRecipientAddress}`);
  if (data.expiresAt) lines.push(`Expires: ${new Date(data.expiresAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}`);
  if (data.secureUrl) lines.push(`Secure link: ${data.secureUrl}`);
  const text = lines.join("\n\n");
  const html = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  return { subject: selected[0], text, html };
}

export const REGISTRATION_EMAIL_TEMPLATE_NAMES = Object.freeze(Object.keys(templates));
