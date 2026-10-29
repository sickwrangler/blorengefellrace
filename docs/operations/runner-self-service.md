# Runner self-service entry management

The private runner URL is `/registration/manage.html#token=<opaque-token>`. Only the token hash is stored. The browser reads the URL fragment, keeps the token in session storage and removes the fragment from the visible URL before calling the API.

The runner transfer deadline is **27 November 2026 at 23:59 Europe/London** (`2026-11-27T23:59:00.000Z`). The refund-request deadline remains **28 October 2026 at 23:59 Europe/London** (`2026-10-28T23:59:00.000Z`). Neither deadline prevents safe contact and race-detail corrections. An organiser may make an exceptional post-deadline transfer only through the separately confirmed, audited organiser override.

## Action eligibility

| Action | Available when | Unavailable when / reason |
| --- | --- | --- |
| View or refresh status | The management token is current and its registration still exists. | An unknown token is invalid. A recognised token that was superseded or revoked is expired. A deleted entry is unavailable. |
| Continue payment | Entry is active; registration is accepting payment; Stripe is available; payment is `created`, `not_configured`, `checkout_pending`, `failed`, `expired` or legacy `abandoned`. | Entry inactive; registration not accepting; provider unavailable; payment processing, paid or refunded. An active Checkout is reused rather than duplicated. |
| Sign declaration | Entry is active, place is confirmed and declaration is pending. | Entry inactive; payment/place not confirmed; declaration already complete. There is no transfer/refund-cutoff restriction on signing. |
| Edit entry | Entry is active. | Cancelled/place-released/deleted entry. The runner may change phone, address, category, club, WFRA membership details and emergency contact. Identity and email are deliberately not editable here. Safe edits remain available after the transfer/refund cutoff. |
| Transfer entry | Entry is active, payment is paid, the place is confirmed and the request is no later than 27 November 2026 at 23:59 Europe/London. | Entry inactive; payment/place not confirmed; transfer deadline passed. |
| Request refund | Entry is active; payment is paid; deadline has not passed; no request is currently requested/approved and no refund has completed. | Entry inactive; unpaid; deadline passed; request already in progress; payment already refunded. A rejected request does not permanently block another request under the current server rule. |

All mutating endpoints repeat these checks on the server. Browser visibility is explanatory and is not authorization.

## Transfer invariants

A successful transfer validates a complete replacement runner record, rejects a duplicate active-entry email, preserves the registration, place, price and payment, replaces only the runner ownership, resets declaration status, revokes prior management/declaration links, issues new hashed credentials and records the old/new runner IDs in the audit event. Delivery of the replacement runner's secure links is required before the change is committed; failure leaves ownership and payment unchanged. Failure of the secondary previous-runner notice is recorded without invalidating access already delivered to the replacement runner.

## Confirmed product policy

Unpaid or payment-reserved entries cannot be transferred. A rejected refund request does not prevent the runner submitting a later request, provided the normal refund eligibility rules and deadline are still satisfied.
