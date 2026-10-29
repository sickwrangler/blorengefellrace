# Runner self-service entry management

The private runner URL is `/registration/manage.html#token=<opaque-token>`. Only the token hash is stored. The browser reads the URL fragment, keeps the token in session storage and removes the fragment from the visible URL before calling the API.

The normal runner transfer and refund-request deadline is **28 October 2026 at 23:59 Europe/London** (`2026-10-28T23:59:00.000Z`). This deadline does not prevent safe contact and race-detail corrections. An organiser may make an exceptional post-deadline transfer only through the separately confirmed, audited organiser override.

## Action eligibility

| Action | Available when | Unavailable when / reason |
| --- | --- | --- |
| View or refresh status | The management token is current and its registration still exists. | An unknown token is invalid. A recognised token that was superseded or revoked is expired. A deleted entry is unavailable. |
| Continue payment | Entry is active; registration is accepting payment; Stripe is available; payment is `created`, `not_configured`, `checkout_pending`, `failed`, `expired` or legacy `abandoned`. | Entry inactive; registration not accepting; provider unavailable; payment processing, paid or refunded. An active Checkout is reused rather than duplicated. |
| Sign declaration | Entry is active, place is confirmed and declaration is pending. | Entry inactive; payment/place not confirmed; declaration already complete. There is no transfer/refund-cutoff restriction on signing. |
| Edit entry | Entry is active. | Cancelled/place-released/deleted entry. The runner may change phone, address, category, club, WFRA membership details and emergency contact. Identity and email are deliberately not editable here. Safe edits remain available after the transfer/refund cutoff. |
| Transfer entry | Entry is active and the request is no later than the deadline. | Entry inactive or deadline passed. The current server rule does not additionally require a paid/confirmed place. |
| Request refund | Entry is active; payment is paid; deadline has not passed; no request is currently requested/approved and no refund has completed. | Entry inactive; unpaid; deadline passed; request already in progress; payment already refunded. A rejected request does not permanently block another request under the current server rule. |

All mutating endpoints repeat these checks on the server. Browser visibility is explanatory and is not authorization.

## Transfer invariants

A successful transfer validates a complete replacement runner record, rejects a duplicate active-entry email, preserves the registration, place, price and payment, replaces only the runner ownership, resets declaration status, revokes prior management/declaration links, issues new hashed credentials and records the old/new runner IDs in the audit event. Delivery of the replacement runner's secure links is required before the change is committed; failure leaves ownership and payment unchanged. Failure of the secondary previous-runner notice is recorded without invalidating access already delivered to the replacement runner.

## Product-policy ambiguities

The implementation currently permits transfer of any active entry before the deadline, including an unpaid/payment-reserved entry. It also permits a runner to make a new refund request after an earlier request was rejected. These are existing server behaviours, not new rules introduced by the self-service UI. The organiser should confirm whether both behaviours are intended before a future policy change; until then the UI and API remain aligned with the existing implementation.
