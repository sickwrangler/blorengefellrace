# Payments and Stripe

## Architecture

Production uses Stripe live mode and Stripe-hosted Checkout. Prices are calculated by the server from persisted event configuration:

- standard entry: **£6** (`600` pence);
- self-declared WFRA member with a membership number: **£4** (`400` pence).

Browser-supplied amounts are ignored. When Checkout is requested, the server revalidates runner data, duplicate policy, price and all-or-nothing capacity, creates a 30-minute reservation, and asks Stripe for one Checkout session. Repeated requests reuse the active attempt where safe. Group orders create one combined payment for one to five individual registrations.

Stripe posts signed events to:

```text
POST https://www.blorengefellrace.cymru/api/v3/stripe/webhook
```

Handled event types are `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded` and `refund.failed`. The webhook signature and raw request body are verified before processing. Event IDs and business idempotency keys prevent duplicate effects.

The browser return page is not payment authority. It only asks the API for current server state. A successful redirect with an unreconciled webhook can still show processing/unavailable; a closed browser does not cancel Stripe or the reservation.

## Reconciliation outcomes

- Paid amount and currency must match the server expectation.
- A valid successful event marks payment paid and confirms each reserved place.
- An asynchronous failure or expiry releases unpaid reservations.
- An amount/currency mismatch or paid-capacity conflict enters manual review; do not fabricate confirmation.
- Duplicate webhook delivery is safe and must not create duplicate entries or emails.

## Refunds

Runner request, organiser approval/rejection, provider execution and final application reconciliation are separate. Single-runner orders can receive a full payment refund. In a group order, the server requests a registration-specific partial refund for that runner's authoritative price and retains the other registrations. Stripe refund calls use stable idempotency keys.

The transfer/refund cutoff is 28 October 2026 at 23:59 Europe/London. An exceptional organiser override is separately explicit and audited. A failed provider refund must not release a valid place; a completed supported refund releases the affected place while retaining financial/audit evidence.

> **If a refund appears to fail, check Stripe before attempting it again.** Stripe may have completed the refund even if a later application write or response failed. A second refund attempt without reconciliation can create financial harm.

## Runner says “I paid, but the dashboard says unpaid”

1. If new cases are accumulating, move `OPEN` to `PAUSED`.
2. Search Stripe using the Checkout/payment identifiers visible through supported organiser/provider views—not runner card details.
3. Confirm whether Stripe says paid, processing, failed, expired or refunded and verify the amount/currency.
4. Inspect Stripe webhook delivery for the relevant supported event and its HTTP response.
5. Inspect Application Insights requests/traces and the entry audit/payment reconciliation state.
6. Retry webhook delivery from Stripe only if the application endpoint is healthy and the original event is understood; idempotency makes a genuine duplicate safe.
7. Do **not** manually mark paid or ask the runner to pay again while Stripe shows success/processing.
8. If no supported repair exists, remain paused and implement/review a controlled reconciliation tool.

## “Refund says it failed”

1. Do not click execute again.
2. Inspect the Stripe payment and refund object; record whether a provider refund exists and its status.
3. Compare the organiser audit/refund request and application payment state.
4. Inspect webhook delivery and application errors.
5. If Stripe completed it but application state did not, keep registration paused if capacity could be wrong and use a reviewed reconciliation repair. Do not create a second provider refund.
6. If Stripe definitively rejected it and no refund exists, correct the cause before retrying the supported action.

Never paste Stripe IDs together with runner PII into a public issue. Never expose `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SIGNING_SECRET`; the signing secret is distinct from the API key.
