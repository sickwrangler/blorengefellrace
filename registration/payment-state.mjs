export const PAYMENT_PRESENTATIONS = Object.freeze({
  not_configured: Object.freeze({ title: "Continue to payment", message: "Online payment is not available yet in this development environment.", canRetry: false }),
  checkout_pending: Object.freeze({ title: "Awaiting payment", message: "Your payment session is still open. Complete it in the Stripe checkout window.", canRetry: false }),
  processing: Object.freeze({ title: "Payment processing", message: "Payment is still being confirmed. Refresh this page shortly.", canRetry: false }),
  paid: Object.freeze({ title: "Entry confirmed", message: "Payment has been confirmed and your entry place is secured.", canRetry: false }),
  failed: Object.freeze({ title: "Payment unsuccessful", message: "Payment was not completed. You can try again while your entry remains eligible.", canRetry: true }),
  expired: Object.freeze({ title: "Payment session expired", message: "The payment session expired without confirmation. You can try again if a place remains available.", canRetry: true }),
  refunded: Object.freeze({ title: "Refund completed", message: "The payment has been refunded.", canRetry: false }),
  refund_requested: Object.freeze({ title: "Refund requested", message: "Your refund request is awaiting organiser review.", canRetry: false }),
  refund_approved: Object.freeze({ title: "Refund approved", message: "Your refund has been approved and is awaiting processing.", canRetry: false }),
  refund_rejected: Object.freeze({ title: "Refund request update", message: "Your refund request was not approved. Contact the organiser if you need help.", canRetry: false })
});

export function paymentPresentation(state, { paymentsAvailable = false } = {}) {
  const presentation = PAYMENT_PRESENTATIONS[state] ?? PAYMENT_PRESENTATIONS.processing;
  if (state === "not_configured" && !paymentsAvailable) return { ...presentation, title: "Payments unavailable", unavailable: true };
  return { ...presentation, unavailable: false };
}
