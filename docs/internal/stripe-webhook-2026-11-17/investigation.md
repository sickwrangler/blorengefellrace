# Production Stripe webhook investigation — 17 November 2026

**Current remediation update:** See [remediation-readiness.md](remediation-readiness.md) for final code, Node 20/22 test results, verified encrypted backup, current replay manifest and approval gates. The user clarified that over-offering was organiser error and a separate safeguard already addresses it; that supersedes earlier capacity-causation interpretation in this historical report. The over-offering safeguard is preserved unchanged and this remediation does not reopen that issue.

**Lifecycle extension:** Section G confirms premature release of four paid reservations and a one-place aggregate deficit. It adds the exact £6 timeline, offer chronology, safeguards, 344 passing tests and stricter recovery gates. Read Section G alongside the original findings below.

## A. Root cause and evidence

**Confirmed identifier-matching defect, reproduced against production state in memory. No production data was modified.**

Source baseline: `01de1d47342b05feeb9f7a7aed49bb5de7a8736c` (current GitHub main). The user's active checkout is the older September `691334a` on `ui/style-tweak`; it was not replaced. Current source and the proposed correction were tested in `/private/tmp/blorenge-webhook-investigation`.

In baseline `registration/server/phase3-integrations.mjs:129`, the payment matcher includes:

```js
object.payment_intent && item.paymentIntentId === object.payment_intent?.id
```

For a string PaymentIntent, `.id` is undefined. An earlier record with an absent `paymentIntentId` therefore matches, even when neither its session nor intent belongs to the event. This is a false match, not a duplicate identifier.

The production snapshot's first such payment is `payment_6ccebe5b-b00d-4b98-a4db-41e881ac61d5`, an expired order payment created 27 September. It references `order_93c7611c-b024-4338-8457-3321933f624a`, has no `paymentIntentId` field and correctly has no single `registrationId`. The single-payment reconciler then looks for a registration using that absent field (`:139`) and returns `NOT_FOUND` (`:140`). The production API converts that code to HTTP 404 (`registration/server/production-api.mjs:5`). The intended registration exists.

Direct read-only Stripe retrieval confirms `evt_1UcjlY2Kxy50V5SgHXcrm1sK` is `checkout.session.completed`, contains a **string** PaymentIntent, and has one pending webhook. Direct Table retrieval confirms the intended payment `payment_5f0cc0a9-b1bb-4e3d-b461-e865b79f844d` belongs to `reg_dda9e5db-a9da-4e27-8605-1c4a91f44a4f`, is paid/reconciled for 400p, and the registration is accepted/confirmed. Both were last updated at 11:01:03.526 UTC.

The snapshot contains the synthetic `stripe-checkout-review:<sessionId>` event at that time, with organiser-check and email-outbox-sent audits; it does not contain the original event ID. Manual verification retrieves `payment_intent.latest_charge` expanded (`phase3-integrations.mjs:76–77`), validates session metadata, mode, amount, currency, successful captured charge and absence of refund/dispute (`phase3-service.mjs:539–567`), then calls the same reconciler with an expanded intent. That defined `.id` avoids the false match. Baseline successful-payment duplicate detection occurs **after** the incorrect registration lookup, so manual reconciliation does not prevent the subsequent 404.

Synthetic reproduction: string intent -> `NOT_FOUND`; expanded intent -> `{ok:true,duplicate:true}`. In-memory reconstruction using each of the four paid single-payment records from the production snapshot gives baseline `NOT_FOUND` and corrected duplicate acknowledgement, with identical capacity before/after. These reconstructions are not live event replays.

No duplicate nonempty Checkout Session IDs or PaymentIntent IDs exist in the current payment array. No broken single-registration or order links were found. Metadata is ignored by the baseline automatic matcher, but is checked by the manual provider-verification path. There is no evidence of provider identifier reassignment.

### Exact execution and failure boundaries

1. `api/src/functions/registration-production.mjs`: anonymous `v3/{*path}` POST route; retains raw request text for `/api/v3/stripe/webhook`, enforces 64 KiB limit, passes Stripe signature header onward. Exceptions become 503, not 404.
2. `production-api.mjs`: exact webhook route calls `phase3Integrations.webhook`; result mapper gives 404 only for `NOT_FOUND`. The final unmatched-route fallback also returns `NOT_FOUND`/404. The storage-metrics 404 and organiser/management 404 branches cannot execute for this exact webhook route.
3. `phase3-service.mjs:456–465`: verifies Stripe signature using SDK `constructEvent`; invalid signature yields 400. Routes by `metadata.orderId`, or an existing order PaymentIntent match; otherwise uses single-payment reconciliation. The target has single-payment metadata and a unique single-payment intent.
4. `phase3-integrations.mjs:132–181`: event-ID deduplication, defective lookup, registration lookup, success/amount/currency/status/capacity handling, audit and processed-event records. Its missing-registration branch is the reachable source-level `NOT_FOUND` for this event. No payment match gives `PAYMENT_NOT_FOUND`/409, not 404. Existing paid/refunded records short-circuit only after registration lookup.
5. `phase3-service.mjs:468–524`: reconciliation and durable email preparation share a repository transaction; confirmation is keyed by registration, not event, and sent confirmations are checked. Delivery occurs **after commit** through an outbox lease. Duplicate events can retry a prepared/failed outbox linked to that same event. An original retry after manual success creates no new confirmation; a failed synthetic confirmation remains an outbox-recovery concern.
6. `repositories.mjs:61–87`: Azure operations clone current state, discard `ok:false` mutations, commit via ETag, and retry 409/412 conflicts up to eight attempts. Concurrent requests across instances therefore re-evaluate against committed state. No Stripe/email send occurs in this webhook state transaction.
7. `production-storage-codec.mjs`: gzip/base64 chunks reconstruct one JSON state entity; registrations/payments are arrays inside that entity, not separate Table rows. `api/src/production-storage.mjs` uses the same repository for organiser and webhook requests. **Do not use its `loadPartition()` for read-only diagnostics:** its missing-entity fallback creates bootstrap state. This investigation instead used direct entity GET.
8. `order-service.mjs:537+`: separate order lookup/reconciliation/outbox flow. Its baseline matcher can also match absent intent fields when an event has no intent; the proposed shared matcher removes that hazard. Missing orders currently risk exceptions/503 rather than the observed single-payment 404.

## B. Production impact

Snapshot timestamp: **17 November 2026, 20:00:02.603089 UTC**; subsequent live GETs to Stripe confirmed the five session states below. Counts are a snapshot, not a final race ledger.

| Internal payment suffix | Local state | Stripe state | Pending Stripe events |
|---|---|---|---:|
| `3b79054f-ed09-4277-b764-27a3d015e047` | paid / confirmed, manually checked | complete / paid, £6 | 1 |
| `3e6be8de-4f42-4e5d-a7d3-323d5d83a270` | paid / confirmed, manually checked | complete / paid, £4 | 1 |
| `314cc19d-8d82-45cf-bd8c-072f9849bc04` | paid / confirmed, manually checked | complete / paid, £4 | 2 (completed + async succeeded) |
| `0eefc2ed-7155-4a9c-b863-eabc0b588fe7` | expired / no place | **complete / paid, £6** | 1 |
| `5f0cc0a9-b1bb-4e3d-b461-e865b79f844d` | paid / confirmed, manually checked | complete / paid, £4 | 1 |

All five are accepted waiting-list registrations by the domain's waiting-list relationship check. The outstanding registration is `reg_e384535e-57bc-470e-a17e-47ef270b5ad3`; its local reconciliation state is `locally_expired_awaiting_webhook`. It requires urgent organiser review. Do not simply confirm it: capacity is 120, with **118 confirmed + 2 offer reservations = 120 committed, zero remaining**. There are no payment reservations and 39 currently waiting. No stored paid single payment lacks a confirmed place; no confirmed registration lacks a stored paid payment. That local consistency does not detect the £6 paid session still marked expired.

Current arrays contain 132 registrations and 119 payments: 114 paid, one refunded, four expired (three order payments, one waiting-list payment). Different order/runner counts are expected for multi-runner orders. No duplicate provider IDs or broken payment parent links were found. This does not prove that every runner identity is unique or that all historical reservations were correct.

Stripe returned 29 events created since 14 November, with pagination exhausted. **Six distinct pending events, five distinct sessions, five runners** were identified. Pending-webhook counts are not per-endpoint delivery histories; the exact approximately 30 failed attempts and each historical HTTP response were not independently retrieved. Do not equate attempts with payments. The supplied incident supplies the target's 404 evidence; read-only API data plus code/state reproduction establishes its cause. Other expired order sessions were not individually checked at Stripe; an exhaustive account-wide settlement audit remains a recovery task.

## Deployment and environment verification

Azure reports `BlorengeFellRace`, resource group `Blorenge`, repository `sickwrangler/blorengefellrace`, branch `main`, production environment Ready, last updated **17 November 11:16:34 UTC**. GitHub's [production workflow](https://github.com/sickwrangler/blorengefellrace/actions/runs/44072353952) succeeded for baseline `01de1d4` at 11:16:52 UTC. This strongly corroborates current source deployment; no direct deployed backend byte/hash attestation was available.

Allowlisted production settings read directly: environment `production`, storage `stblorengeregprodc1b64c`, table `RegistrationProduction`, partition `blorenge-2026-live`, Stripe enabled. Source wires organiser and webhook to one repository. No evidence of separate partitions for these routes.

Azure activity since 13 November shows app-setting **reads** on 13/14 November in the hosting group. The registration resource group shows scheduler stop/start, configuration write and temporary role assignment activity on 14 November (configuration write at 09:06 UTC; restart 09:38 UTC). These observations do not establish changed setting values or a causal connection to the 404. No production config was changed during this investigation.

## C. Recommended correction

`proposed-fix.patch` targets baseline `01de1d4`, **not** the user's September branch. It changes three server modules and adds eight focused tests:

- Normalize string/expanded intent once; only compare nonempty provider IDs.
- Collect all provider matches, rejecting ambiguous matches with `PAYMENT_MATCH_AMBIGUOUS`; never select the first arbitrarily.
- Corroborate provider matching with supplied payment/registration/order metadata and reject conflicting existing intent linkage. Metadata alone does not authorize a provider identifier reassignment.
- Reuse this matcher for single-payment reconciliation, confirmation-recipient selection and order reconciliation. Missing order returns an explicit failure.
- For an already paid/refunded successful payment event, validate amount/currency, record the newly acknowledged original event ID, and return duplicate success without changing entry/capacity or preparing another confirmation.

No repair is required for the target or the three other manually reconciled payments. Preserve the older expired order payment: it is a legitimate order record, not an orphan to delete. Genuine missing registrations still fail; ambiguous matches are not silently acknowledged. The £6 outstanding payment needs an approved capacity/recovery decision, not direct Table edits. Existing schema and capacity controls remain in force.

Suggested follow-up diagnostics: structured result code, internal event/payment ID, candidate count and route category, excluding raw bodies, addresses, signing material and payment credentials. Do not log full Stripe objects.

## D. Validation

`npm ci --prefix api --ignore-scripts` in the isolated current-source copy, then `node --test tests/*.test.mjs`: **334 passed, zero failed**. Initial run lacked ExcelJS in that isolated copy; installing locked dependencies resolved the two workbook test-loading failures. Host Node was v24.21.0, whereas deployment declares Node 20; CI must repeat under the deployment runtime before approval.

New tests exercise string/expanded intent false matches; duplicate/stale references and metadata/intent conflicts without mutations; genuine missing registration and absent identifiers; invalid signature through the service boundary; manual reconciliation followed by original/repeated webhook with one email/place; concurrent synthetic/original reconciliation; expiration followed by payment and late expiration protection; late payment with full capacity rejected; order session matching without an intent and ambiguous order references. Existing waiting-list tests cover actual provider retrieval, waiting-list payment, manual checks, and capacity conflicts; existing integration tests cover the gateway signature contract and transactional outbox.

Concurrency regression uses the memory repository; existing Azure ETag conflict/outbox tests also pass. This does not constitute live multi-instance/load or real Stripe-signature end-to-end testing. No real event was resent, no checkout created, no charge/refund issued, no production registration changed, and no emails sent by this investigation.

## E. Recovery and rollback plan — requires approval before execution

1. Re-read state and Stripe pending events; record timestamp/ETag, counts and safe identifiers. Take an approved encrypted backup of the exact entity and verify checksum plus decode/restore in isolation. Preserve audit/outbox/event arrays. Do not initialize a missing production entity.
2. Review/apply the patch on a branch based on `01de1d4` or rebase onto newer main, repeat all checks on Node 20, inspect the staged allowlisted API artifact, and obtain approval for that exact commit/artifact. **Merging main deploys production automatically.** Retain the previous artifact.
3. Before replay, explicitly decide how to handle the £6 unconfirmed payment with two outstanding offers. Reverify payment/charge/refund/dispute state and offer expiry. If a place legitimately becomes free, reconcile through the existing audited service. Do not revoke offers, raise capacity, refund or directly edit state without separate approval. At current capacity the corrected reconciler should return `PAID_CAPACITY_CONFLICT`/409, preserving all places.
4. Deploy the approved artifact without changing secrets, route or capacity. Observe a genuine target event replay in Stripe, with explicit replay approval. Expect HTTP 200 duplicate success; preserve registration/payment/completion timestamps, capacity and email counts; add only the original processed-event record.
5. Replay the other manually reconciled events individually, including both events for the async session. Compare state before/after each. Do not mark events processed by hand. Reconcile the outstanding payment only after the approved capacity decision, using a genuine Stripe event or provider-verified existing manual path; avoid creating new entries/sessions.
6. Verify 118 confirmed and two reservations against the latest state, then account for only approved changes. Confirm unique provider IDs, paid-to-entry linkage, no duplicate entries/confirmations, valid offer reservations and remaining capacity. Check confirmation outbox leases/receipts. Existing manually sent confirmations must not resend; a failed synthetic confirmation requires a separately reviewed outbox retry, since original-event acknowledgement does not guarantee synthetic-outbox delivery.
7. Inspect per-endpoint Stripe delivery history and ensure every resolved event returns 2xx. A genuine capacity conflict must remain actionable rather than hidden as success. Monitor retries, 404/409/503, ambiguity/mismatch diagnostics, reservation expiry and email health through the race on 28 November.
8. Roll back **code only** to the retained previous artifact if new regressions appear, using a deployment method that does not reset state. Do not restore an old Table snapshot over new registrations/payments. Successful reconciliation records written before rollback stay intact. The previous matcher will restore the known retry defect, so unresolved events remain pending until a corrected version is approved. Stop manual replays during diagnosis; do not disable or reconfigure the endpoint without approval.

## F. Approval checkpoint and access cleanup

Completed: explicitly approved temporary `Storage Table Data Reader`, scoped solely to `RegistrationProduction`, assignment `481d2eaa-d21d-4858-81c1-d64b60ee56be`; direct entity GET after propagation; assignment removed and table-scoped list verified empty. No storage keys or broader roles were used. Stripe access consisted only of authenticated GETs with credentials held in process memory; output contains internal references and state only.

Still requires explicit approval: exact production deployment/merge commit; genuine Stripe event replay(s); any manual reconciliation of the outstanding payment; any offer/capacity/registration/email/refund action; backup creation in production storage; any further temporary access grant. Approval for read-only investigation did not authorize these operations.

Raw production state was held temporarily in a mode-0600 file for analysis, never added to the repository. Durable evidence here is redacted. The investigation leaves the runner's confirmed registration intact.

## G. Direct waiting-list lifecycle extension

**Confirmed: there is a second defect in reservation expiry, exposed by the webhook matching failure. The £6 runner paid during a valid local reservation. Four paid reservations were subsequently released by local timeout without provider evidence. Reconstructed paid claims plus outstanding offers total 121 against capacity 120.** This extends the earlier impact assessment: a locally consistent count of 120 concealed an additional paid claim. The matching-only patch is insufficient to prevent this class of incident.

### Outstanding £6 runner: confirmed timeline

All times below are UTC (also UK local time on these November dates). Stripe event timestamps have second precision; application timestamps have millisecond precision. Stripe `created` is event creation time, not webhook arrival time.

Registration: `reg_e384535e-57bc-470e-a17e-47ef270b5ad3`; payment: `payment_0eefc2ed-7155-4a9c-b863-eabc0b588fe7`; accepted offer: `offer_845d0fb3-b3be-425f-8f7f-0c8251b8ffca`.

| Date/time | Evidence | Capacity/payment consequence |
|---|---|---|
| 16 Nov 10:19:01.593 | `waiting_list_offer_created` audit and offer row | Offer reserved one place; original offer deadline 18 Nov 10:19:01.593. |
| 16 Nov 11:53:36.158 | `waiting_list_offer_accepted`, `registration_created` audits | Offer became accepted; registration acquired `payment_reserved`. One existing offer reservation was atomically transferred to a Checkout reservation. |
| 16 Nov 11:53:36 | Stripe session `created` | Checkout Session created. |
| 16 Nov 11:53:36.419 | `stripe_checkout_created` audit | Application stored 600p GBP session and deadline 12:23:36.000. |
| 16 Nov 11:53:52 | Stripe PaymentIntent and charge `created` | Payment attempt and charge created. This timestamp alone is not proof of successful payment. |
| 16 Nov 11:53:53 | `payment_intent.succeeded` and `charge.succeeded` event timestamps | Payment succeeded. Current charge remains paid/captured, not refunded or disputed. |
| 16 Nov 11:53:54 | `evt_1UcOTu2Kxy50V5SgD10PSAOk`, `checkout.session.completed` | Checkout completed paid, **29m42s before its deadline**. This event remains pending. |
| 16 Nov 12:23:36.000 | Both Stripe `expires_at` and application `checkoutExpiresAt` | Scheduled deadline passed; this did **not** mean the already-completed session actually expired at Stripe. |
| 16 Nov 12:30:00.063 | `payment_reservation_expired` audit; payment and registration `updatedAt` | Application set payment `expired`, reconciliation `locally_expired_awaiting_webhook`, place `none`, **36m06s after Checkout completed**. |
| 17 Nov 20:00:02.603089 | Direct Table entity timestamp, same retained state as initial investigation | £6 payment still locally expired/unconfirmed. No manual reconciliation or confirmation audit for this registration. |

The acceptance and checkout audits show a valid, unexpired local reservation at payment completion; no intervening release appears. This is not a runner paying after a reservation deadline. However, aggregate commitments were already understated due to earlier paid reservations being released; a valid local reservation does not establish that every aggregate promise remained within 120.

### The two outstanding offers were issued before this payment

| Offer | Issued | Deadline | Current state |
|---|---|---|---|
| `offer_f2051f41-f8fe-4875-9223-b24ff6d12f67` | 16 Nov 10:18:40.883 | 18 Nov 10:18:40.883 | offered |
| `offer_0e48cac6-5c29-40b7-9c04-05ee6adbde68` | 16 Nov 10:19:38.030 | 18 Nov 10:19:38.030 | offered |

Both have creation audits and reminders at 17 Nov 10:30:00.007. Neither was issued after the £6 reservation was released at 12:30. There are no later offer-creation audits in the snapshot. Therefore **the specific claim that these offers reused this £6 runner's released slot is false**. Places are counted in aggregate, with no physical seat identifiers; the evidence cannot assign one offer to one particular released slot.

### Earlier releases explain the aggregate overcommitment

| Payment suffix | Stripe completed/paid | Local Checkout deadline | Application reservation released | Manual confirmation |
|---|---|---|---|---|
| `3b79054f-ed09-4277-b764-27a3d015e047` | 14 Nov 17:19:08 | 14 Nov 17:48:42 | 14 Nov 18:00:00.302 | 16 Nov 16:35:00.400 |
| `3e6be8de-4f42-4e5d-a7d3-323d5d83a270` | 14 Nov 17:25:22 | 14 Nov 17:54:35 | 14 Nov 18:00:00.302 | 16 Nov 16:35:23.243 |
| `314cc19d-8d82-45cf-bd8c-072f9849bc04` | 16 Nov 10:32:59, including async success | 16 Nov 11:01:58 | 16 Nov 11:30:00.007 | 16 Nov 16:35:48.490 |
| `0eefc2ed-7155-4a9c-b863-eabc0b588fe7` | 16 Nov 11:53:54 | 16 Nov 12:23:36 | 16 Nov 12:30:00.063 | not reconciled |
| `5f0cc0a9-b1bb-4e3d-b461-e865b79f844d` | 17 Nov 10:37:32 | 17 Nov 11:07:00 | no release | 17 Nov 11:01:03.526 |

All five paid before their session deadlines. All retrieved charges currently remain paid/captured, not refunded or disputed. Two early paid registrations were missing from local capacity before the five new offers were issued on 16 November. The async runner's later release and the £6 release compounded that missing accounting; they did not create legitimate extra capacity.

`capacity-ledger.json` reconstructs the counts from current state and the complete capacity-changing audit sequence since 14 November. Opening 118 confirmed / zero offer or checkout reservations is inferred by reversing those audited changes from the current state, not asserted as a historical Table snapshot. Four `entry_withdrawn` events release confirmed places during this interval; their before/after statuses were included. Offer acceptance transfers a reservation, and registration creation for the same acceptance is not counted twice.

| Checkpoint | Confirmed | Checkout reservations | Offers | Local committed | Paid claims omitted locally | Including those claims |
|---|---:|---:|---:|---:|---:|---:|
| 16 Nov 10:18:40.883, first new offer | 114 | 0 | 1 | 115 | 2 | 117 |
| 16 Nov 10:19:38.030, fourth new offer | 114 | 0 | 4 | 118 | 2 | 120 |
| 16 Nov 10:19:57.868, fifth new offer | 114 | 0 | 5 | 119 | 2 | **121** |
| £6 acceptance, 11:53:36.158 | 114 | 1 | 3 | 118 | 3 | **121** |
| £6 local release, 12:30:00.063 | 114 | 0 | 3 | 117 | 4 | **121** |
| Three manual confirmations, 16:35:48.490 | 117 | 0 | 3 | 120 | 1 | **121** |
| Target manual confirmation, 17 Nov 11:01:03.526 | 118 | 0 | 2 | 120 | 1 | **121** |

The fifth offer is `offer_e0917962-306d-4a57-98a1-e74650a56a14`, subsequently accepted by the async-payment runner. This is the first reconstructed point in the interval exceeding 120 when valid paid claims are included. That observation does not identify whom an organiser should prioritise or authorize changing any offer. Current confirmed entries do not exceed capacity; **confirmed entries plus valid paid-but-unconfirmed claim plus outstanding offers exceed it by one**. No duplicate runner/registration allocation is needed to produce this oversubscription.

### Scheduler evidence and limits

The timer source schedules `0 */30 * * * *`. Direct non-secret scheduler settings confirm the same storage account/table/partition as the webhook. Application audits show releases exactly at half-hour run times and final `schedulerStatus.lastSuccessfulRunAt` is 17 Nov 20:00:00.014. In baseline `phase3-service.mjs:731+`, scheduled work calls `processScheduledRegistrationWork`, which calls `expireStalePaymentReservations`; that function is the source of the exact release audit.

The release audit itself says `actorType: system`, with no timer invocation ID. Read-only queries to configured App Insights for traces/requests between 11:00 and 13:00 on 16 November returned no rows, including a broad count query. Therefore the committed release times are verified, and scheduler attribution is strongly supported by code/configuration/timing, but independent execution IDs, start/end logs and first webhook-arrival timestamps were not available. No historical state backups were read. Audit reconstruction cannot prove the absence of an unaudited historical mutation.

### Two distinct defects, one incident chain

1. **Identifier bug:** the string PaymentIntent falsely selects an order payment, so the success event fails reconciliation with 404.
2. **Expiry/capacity bug:** baseline `phase3-integrations.mjs:202–211` treats the local deadline as proof of failure. It unconditionally changes pending payment to expired and releases an unconfirmed place without retrieving provider state. This defect can occur with a correct matcher whenever delivery is delayed, invalid, unavailable or otherwise fails. Fixing matching alone does not make timeout-based release safe.

The existing `payment_review` UI/retry gate correctly discourages another Checkout but does not reserve capacity: `capacitySummary` counts only confirmed places, `payment_reserved`, and active offers. A locally expired paid payment with place `none` contributes zero. ETag transactions serialize offer creation correctly against these **incorrect counts**; concurrency protection cannot fix an omitted paid claim. Manual reconciliation recovers only when remaining counted capacity exists, explaining why three historical confirmations filled local capacity while this paid runner remained outside it.

Other lifecycle boundaries: accepting an offer atomically consumes the original reservation; accepted offers are not expired by their original 48-hour offer deadline. A failure before creating Checkout can leave a reservation without a session/deadline, which requires operational review rather than an assumption of unpaid expiry. Existing order timeout paths have a similar provider-uncertainty concern; the proposed direct-offer guard is deliberately scoped and is not a completed order-lifecycle redesign.

### Proposed safeguard and tests

`proposed-reservation-safeguard.patch` applies **after** `proposed-fix.patch` to baseline `01de1d4`. It is local, reviewable implementation, not deployed code:

- For an existing `payment_reserved` direct waiting-list registration whose Checkout deadline passes, retain the place, change payment to `processing` with `reservation_review_required`, and audit once. Repeated timer ticks cannot release it or create repeated review audits.
- Show payment review through the existing status gate. A provider-verified manual check or delayed successful webhook confirms the held place without increasing total committed capacity. A genuine matching, signed expired/failed provider event can release an unpaid place.
- Do not retroactively reacquire reservations already released in production: those remain explicit capacity conflicts until approved recovery.
- Preserve the existing historical-recovery regression by constructing a legacy expired state directly, rather than requiring the corrected scheduler to recreate the defect.

Operational requirements before production adoption: alert on aged review holds, show their age/amount/internal reference in organiser diagnostics, and define an owner and resolution SLA. A provider timeout/error, open session, unpaid-but-completed async session, or unavailable provider is **uncertainty**, not permission to free capacity. Never resolve it by a second time-based automatic release. For automatic recovery, fetch provider state outside the state transaction, then revalidate payment/session/amount/registration under ETag before committing; only terminal provider nonpayment evidence can release. Handle session replacement and terminal-state races explicitly. The narrow patch keeps capacity safely at the cost of potentially retaining unpaid places until evidence arrives; it does not implement scheduled Stripe polling or new alert plumbing.

Extended suite: **344 passed, zero failed**, including ten new lifecycle tests. Coverage includes atomic offer-to-Checkout reservation transfer; failed signature plus repeated scheduler runs; delayed success; actual provider-verified manual path followed by original event; concurrent timer/webhook/offer requests in both queue orders; terminal expiry followed by competing offers with one winner; historical capacity conflict without reacquisition; reproduction of the baseline unsafe release independent of matching; asynchronous processing then delayed success; and concurrent manual verification/timer/webhook with one entry and one confirmation. Concurrency tests use synthetic data and the memory transaction queue; existing ETag tests still pass. Node 20 CI and live multi-instance timing remain release gates. No tests performed production mutations.

### Recovery-plan additions and explicit gates

These additions supersede any interpretation that deployment plus replay alone resolves the incident:

1. Before any recovery operation, reread the current ledger and provider states; offers expire on 18 November and state may change. Preserve encrypted backup/ETag/audits and redacted evidence. Independently verify provider-adjusted commitments, not just `capacitySummary.remaining` (which clamps negatives to zero).
2. Obtain explicit approval for the exact API **and scheduler** artifacts containing the reviewed matching correction and reservation safeguard; the timer uses a separately staged shared-code artifact. Verify both deployed versions after an approved deployment. New holds must not be released by an older scheduler.
3. Resolve the existing **one-place aggregate deficit** by an organiser-approved decision. Do not infer authority to increase capacity, withdraw offers, move a registration, refund, or allocate the £6 runner. Both existing outstanding offers predate the £6 payment; the report makes no forfeiture recommendation. A legitimate later withdrawal or unaccepted offer expiry may create a place, but must be verified at the time.
4. Replaying the four already reconciled payments should remain duplicate acknowledgements without new entry/email/capacity. Replaying the £6 event at current counts should remain `PAID_CAPACITY_CONFLICT` until the approved decision creates legitimate capacity. Do not convert that conflict into HTTP 200 to hide it.
5. Before an approved manual confirmation or replay for the £6 payment, check that the existing payment/session/registration still match, charge remains successful/captured/non-refunded/non-disputed, and a place is genuinely available. Reuse the original registration/payment; do not create a replacement or rerun Checkout. Recheck ETag/capacity atomically and send at most one confirmation after commit.
6. Verify all five paid waiting-list relationships and six pending events, outstanding offer validity, review holds, declarations, confirmations and provider-adjusted headroom. Monitor timer outcomes alongside webhook outcomes. Require an alert when local counts omit a paid claim or reviewed commitments exceed capacity.
7. Rollback must coordinate API and scheduler versions. Rolling back only the guard can release newly uncertain holds. Retain data and processed events; never restore an old snapshot over current entries. An approved code rollback does not authorize clearing holds. If a safe compatible rollback is unavailable, stop and obtain an explicit operational decision rather than silently releasing capacity.

No deployment, live replay, capacity/offer/registration/payment change, refund or email action was performed. The user approved a second temporary table-reader grant (`7fba5559-2da3-445c-81c6-8453b93efff9`), scoped only to the same table. It was removed immediately after retrieval and the table-scoped assignment list verified empty. Production Table state and Stripe objects were read only; credentials/personal details are excluded from retained evidence. Further access grants and all production recovery actions retain their explicit approval gates.
