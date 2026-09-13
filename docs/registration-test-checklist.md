# Registration production-readiness rehearsal

Use the isolated stable development site for this rehearsal. It runs the production-shaped user journey with synthetic data, Stripe in test mode, controlled test email and organiser authentication. Do not change the production site from `CLOSED`, and never enter genuine runner information.

## Before testing

1. Confirm the page identifies the server environment as `development` / `test`.
2. Sign in to the organiser dashboard through Microsoft Entra and confirm the literal `organiser` role works.
3. Confirm Stripe reports sandbox/test mode. Use only a payment method from Stripe's current testing documentation.
4. Confirm test email delivery is restricted to the approved organiser test address. The invented runner address must never receive external mail.
5. In the organiser dashboard, select **Reset test** and confirm 120 places remain, with zero entries, orders, payments, refunds, reservations, waiting-list entries and offers.

## A. Complete runner experience

Use names, telephone numbers and addresses that are obviously invented, with reserved example-domain email addresses.

1. Create a one-runner order, complete the declaration and review every displayed value.
2. Continue to Stripe Checkout, complete a successful test payment and return to the website.
3. Confirm the return page obtains the confirmed status from the server rather than trusting the browser redirect.
4. Follow the test management link and verify the runner can see the entry, payment, declaration and refund-request states without an account.
5. Repeat with a two-runner order. Complete one declaration during entry and defer the other, then verify the second runner's declaration link independently.
6. At 390px and 320px widths, repeat the form stages and check visible errors, focus movement, Back actions and recovery after refresh.

## B. Payment and recovery paths

Run each scenario as a separate synthetic order:

- successful payment;
- declined test payment followed by a successful retry;
- cancelled Checkout followed by return and retry;
- repeated clicks on Continue to payment, confirming only one active reservation/Checkout;
- an expired Checkout followed by safe recovery, price revalidation and a replacement Checkout;
- group payment confirming every runner once, with no duplicated email or audit event.

Check the Stripe test dashboard against the website's internal reference. Do not copy provider secrets or full provider identifiers into screenshots, issues or documentation.

## C. Email experience

For successful payment, deferred declaration, management-link recovery, transfer, refund request/outcome and waiting-list offer/reminder:

1. Confirm one expected message is recorded for each business event.
2. Confirm externally delivered test messages go only to the approved safe recipient.
3. Check subject, runner name, race details, links and plain-text/HTML readability.
4. Open every secure link once and confirm the correct runner/action is shown.
5. Repeat or refresh the triggering action and confirm an email is not duplicated.

## D. Organiser management

From the protected dashboard:

1. Find entries by their synthetic reference and confirm totals match the public start list.
2. Correct an allowed contact/club field and verify the audit history.
3. Assign, change and remove a race number; confirm a released number can be reused and a duplicate is rejected.
4. Transfer one paid entry and confirm the old secure links stop working, the place/payment remain attached and the new declaration is pending.
5. Request a refund as the runner, approve and execute it as organiser, then verify Stripe test-mode reconciliation, released capacity and the final runner message.
6. Cancel a numbered entry once while releasing its number and once while retaining it.
7. Export the race-management CSV and check that formula-like input is neutralised and non-exportable private fields are absent.

## E. Capacity, waiting list and scheduler

Use the existing controlled fixtures or automated suite for high-volume setup rather than manually creating 120 people. Verify the final-place concurrency rule, first-in waiting-list order, one active offer, reminder timing, expiry, decline and progression to the next runner. Confirm repeated scheduler execution does not duplicate work.

## Reset after the rehearsal

1. Save only the privacy-safe test evidence needed for the review.
2. Select **Reset test** in the development organiser dashboard and confirm every development count returns to zero and capacity returns to 120.
3. Reload the runner, organiser and public start-list pages from a second device to confirm the reset persisted.
4. Confirm the scheduler has no due work and the server remains `development` / `test`.
5. Stripe test-mode objects may remain visible in Stripe's sandbox history; the website reset clears the isolated development registration state, not Stripe's provider records.
6. Reconfirm production is `CLOSED`, Stripe and ACS external delivery remain disabled there, and no development records appear in production.

## Pass criteria

The rehearsal passes only when the runner journey, Stripe sandbox reconciliation, controlled emails, secure no-account management links, organiser operations, responsive/keyboard behaviour and reset all pass without genuine personal information. Record any failure before resetting, but do not compensate by editing production data or enabling live providers.
