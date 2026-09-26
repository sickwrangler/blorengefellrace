# Registration lifecycle

## Operational states

The state is stored server-side and changed only by an authenticated organiser operation. A deployment, date, URL or browser setting cannot open registration.

| State | Who can start a new entry? | Existing runner access | Providers |
|---|---|---|---|
| `CLOSED` | Nobody (apart from the narrowly designed historic provider-proof mechanism) | Existing secure links may be limited by the relevant endpoint | Stripe/ACS may remain configured; state prevents ordinary entry |
| `PRIVATE_LIVE` | Holders of a valid, unexpired, purpose-bound private invitation | Paid runners can use management/declaration links | Live Stripe and ACS operate normally |
| `OPEN` | Public visitors | Management/declaration links continue | Live Stripe and ACS operate normally |
| `PAUSED` | Nobody new | Existing records are retained; supported management remains available | Providers remain configured; pausing is not provider shutdown |
| `CLOSED_FINAL` | Nobody, permanently for this state graph | Records remain | No transition back is supported |

Allowed transitions are deliberately restricted: `CLOSED → PRIVATE_LIVE|OPEN|CLOSED_FINAL`; `PRIVATE_LIVE → CLOSED|OPEN|PAUSED|CLOSED_FINAL`; `OPEN → PAUSED|CLOSED_FINAL`; `PAUSED → CLOSED|PRIVATE_LIVE|OPEN|CLOSED_FINAL`. `CLOSED_FINAL` is terminal.

## Order and entry terms

- **Draft order:** a purchaser has begun an order. It reserves no place.
- **Registration:** one runner inside an order. A group order has several registrations.
- **Payment reservation:** Checkout has been created. Each runner temporarily consumes one place until payment succeeds or the reservation expires/fails.
- **Paid/confirmed:** a verified Stripe event has reconciled the payment and confirmed the place.
- **Declaration required:** payment/place is valid, but the runner has not completed the applicable versioned declaration.
- **Declaration complete:** digital declaration is complete, or an organiser has recorded a signed paper declaration with an audit event.
- **Refund requested/approved/refunded:** the request, organiser decision and provider execution are separate stages.
- **Place released/cancelled:** the runner no longer consumes capacity. Financial evidence remains.
- **Waiting list:** minimum contact data is held in sequence after capacity is full.
- **Waiting-list offer:** one waiting runner has a time-limited reserved place and secure offer link.
- **Transfer:** a paid place moves to a replacement runner; old secure links are revoked and the replacement must make their own declaration.

## Capacity equation

```text
confirmed registrations
+ active Stripe payment reservations
+ active waiting-list offer reservations
<= event capacity (120)
```

A draft order does not reserve capacity. Checkout reserves all runners in an order atomically or none. This prevents two browsers taking the final place. An expired/failed Checkout releases its reservation. A successful refund/cancellation releases the affected place according to the supported workflow. The public status `remaining` should be understood in this context; investigate all reservation types before declaring the count wrong.

## Payment and declaration are separate

A runner can be paid and confirmed while still showing **Declaration required**. This does not mean Stripe failed and must never trigger a second charge. Declaration completion changes declaration clearance, not payment history or capacity.

For adults, the entrant completes the declaration. Junior entries are currently disabled in production; if enabled later, a 16/17-year-old requires a parent or legal guardian declaration. Entrants under 16 are not permitted.

## Multi-runner orders

One purchaser may add one to five runners. The order receives one combined Stripe Checkout/payment, but each runner has an individual registration, public projection, management token, declaration state and refund eligibility. A group refund can therefore be partial: refunding one registration does not invalidate the other paid registrations. The sum of refunds cannot exceed the original provider payment.

## State versus entry operations

Pausing or closing registration blocks new orders but leaves existing entries intact. Cancelling an entry is not the same as refunding it. Refunding is not the same as removing a race number. Race numbers are unique while active, can be removed explicitly, and may be released during cancellation. All supported organiser changes are audited.
