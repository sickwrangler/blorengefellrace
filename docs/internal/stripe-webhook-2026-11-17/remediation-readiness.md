# Payment remediation — readiness and approval checkpoint

Date: 17 November 2026. Branch: `codex/stripe-payment-remediation`, isolated worktree `/private/tmp/blorenge-payment-remediation`, based on `01de1d47342b05feeb9f7a7aed49bb5de7a8736c`.

## Scope and current decision

The user clarified that over-offering was organiser error and a separate safeguard already addresses it. That attribution supersedes the earlier investigation's capacity-causation interpretation. This remediation does not reopen that issue. `registration/server/phase3-domain.mjs`, including offer capacity checks, is unchanged from current main; concurrent offer regressions still pass.

Two payment corrections are implemented locally: robust provider matching/idempotency and retention of uncertain direct waiting-list Checkout reservations. No deployment, event replay, payment correction, offer/capacity change, refund, or live email send has occurred. A merge/push to main is a production deployment and remains prohibited until separately approved.

## Final changes

- Normalize PaymentIntent strings/expanded objects; never match absent identifiers. Reject multiple provider matches and contradictory metadata/intent relationships. Metadata for an order refund must name a registration belonging to that order payment.
- Reuse matching for reconciliation and confirmation selection. A newly delivered success event for an already reconciled single payment or order records the event and acknowledges a duplicate without changing entries, payment timestamps, orders, capacity or confirmations. Distinct completed/async success events cannot resurrect a withdrawn order entry.
- At the local Checkout deadline, retain an existing direct-offer `payment_reserved` place when payment is pending/processing. Mark processing with `reservation_review_required`; do not reacquire historical released places.
- Open a durable review owned by the organiser, with opened time, two-hour due time and reason. Show open/overdue reviews on the organiser dashboard. Existing Check Stripe payment remains the provider-verified resolution action; checks record actor/time/result, including API outages. Successful payment or a genuine terminal nonpayment webhook resolves the review with an audit. Overdue reviews escalate; time passing never frees the place. Providers are not queried inside the scheduler state transaction.
- Log webhook failures and outstanding review counts with the existing `stripe_payment_reconciliation_failed` signal, without payloads, personal data or credentials. Existing deployed critical-failure query matches that signal.
- Add offline AES-256-GCM Table backup/verification tooling and a local staged-artifact smoke script. These scripts contain no production-write command.

The review SLA is explicit and auditable, rather than an indefinite invisible hold. The organiser must inspect the queue at least every two hours while active, check Stripe, and record/resolve exceptions. A Stripe outage can keep a hold overdue; no safe automatic timeout can establish nonpayment. A manually checked unpaid/open/ambiguous session does not release a hold. Resolution without a definitive provider event needs a separately reviewed organiser action, not an ad hoc Table edit.

## Validation evidence

- **352/352 tests passed on Node 20.20.2 and 352/352 on Node 22.23.5.** Node 20 is the API CI runtime; direct Azure ARM inspection confirms the external Flex scheduler runs Node 22. No runtime setting changes are proposed.
- Site, registration, route, photo and public-results validators passed; production simulation and both allowlisted staging commands passed. Dashboard and Azure entry module syntax checks passed.
- Local HTTP smoke on the staged production API and scheduler passed on both runtimes: genuine SDK-signed synthetic webhook 200; invalid signature 400; unauthenticated organiser GET 403; duplicates leave entries/payments/capacity unchanged with zero emails; external scheduler artifact retains a review hold and emits the alert signal. The corrected API also resolves that hold through a synthetic provider-verified manual check, then acknowledges its original event without a second email.
- All test data is synthetic. Smoke uses memory repositories on localhost with zero external provider calls. This is **local development/staged-artifact validation**, not a hosted Azure preview. The production workflow has no PR-preview deployment step.
- Regression coverage includes waiting-list payment, manual-before-original retry, repeat and distinct success events, orders/refund metadata, missing identifiers, expired/paid sessions, failed/delayed webhook, API outage during review, concurrent manual/timer/webhook/offer requests, signed raw-body integrity, capacity conflicts and encrypted-backup corruption/wrong-key rejection.

The actual deployed scheduler ZIP was captured after approved container-only access. Its active deployment ID matches the blob name, ZIP integrity passes, no private settings files are present, and its rollback SHA-256 is `3c8e52bae55141a775457555a067faf8388df8e5af84fdd5881e78a3c2f8967d`. The narrowed replacement changes exactly `src/shared/server/phase3-integrations.mjs`, `src/shared/server/phase3-service.mjs` and `src/production-scheduler.mjs`.

Evidence: `validation-summary.json` (full local log paths and hashes), `remediation-validation.txt`, `staged-smoke-node20.json`, `staged-smoke-node22.json`, and `release-artifact-manifest.json`.

## Backup and baseline

Approved temporary Table reader assignment `ca6e427a-f142-4f33-bb76-b593f2bfd94f` was granted only on `RegistrationProduction`, then removed; the table-scoped role list was verified empty. No storage key was used. Direct entity GET avoided the application's initialize-on-missing path.

The encrypted backup was created at **20:54:06.737 UTC**, preserving source entity timestamp **20:30:03.643927 UTC** and its ETag. Authenticated decryption, exact entity/state checksums, schema validation and an isolated memory repository restore all passed. `backup-verification.json` records paths and hashes. The encrypted backup is in the user's workspace `.registration-private-backups` directory, excluded through local Git metadata; the mode-0600 recovery key is stored separately under the writable Codex visualization directory. The key and raw state are not in Git, deployment artifacts or logs. Preserve both before clearing local storage.

Verification command (offline only; prints safe metadata):

```sh
node scripts/production-state-backup.mjs verify \
  '/Users/paddyjarvis/Documents/Blorenge fell race website/blorengefellrace/.registration-private-backups/2026-11-17-pre-remediation.aes256gcm.json' \
  '/Users/paddyjarvis/.codex/visualizations/2026/11/17/01a1eb17-2568-7b31-b041-188fd375dae4/blorenge-production-backup-recovery.key'
```

This is a verified offline restore, not permission to restore live state. The older production backup service only restores CLOSED snapshots; this live snapshot must not be passed to it or have its state altered to bypass its guard. Any disaster restore needs separate approved write suspension, current-state preservation, Stripe reconciliation and an ETag-guarded exact-entity recovery. Routine code rollback never restores data.

Fresh baseline: **118 confirmed, 0 payment reservations, 2 outstanding offers, capacity 120, 39 waiting**; 132 registrations, 119 payments, 118 orders. Six pending Stripe events across five waiting-list payments remain. Five events belong to four already paid/confirmed records; one £6 payment remains paid at Stripe but expired/unconfirmed locally and is explicitly excepted. `predeployment-baseline.json` contains every event's current local/provider state and replay disposition, with no personal data. At **21:03 UTC**, public homepage and both status endpoints returned 200; state remained PRIVATE_LIVE, Stripe live and payments available.

## Could deployment change existing entries/offers?

There is no migration, restore, reset, bootstrap-state replacement, startup reconciliation or configuration/capacity change in these corrections. Constructors/imports leave seeded state intact in smoke validation. Existing expired records are not re-reserved or confirmed by the new expiry logic. Existing offers and the over-offering guard are unchanged.

The scheduler continues normal timer work after deployment: heartbeat metadata and due reminders/offer expiry can change as before. Stripe may retry pending events automatically; corrected handling can add processed-event/audit records for already reconciled payments. No blanket promise of a byte-identical whole Table entity is possible while those services run. Compare business fields/counts separately from legitimate heartbeat/audit changes. The £6 event must remain a capacity conflict at the captured baseline.

## Exact release workflow and rollback

1. Review the final remediation commit and passing CI. Do not merge main before approval. The existing `.github/workflows/azure-static-web-apps-ambitious-bay-0339ed203.yml` tests/stages both packages on Node 20 but deploys only the Static Web App/managed API on push to main. It is unchanged.
2. Revalidate main and the baseline immediately before an approved release; refresh the backup if business state changed. Verify current events, offers and capacity. Any temporary read access for that comparison must also be scoped and removed.
3. With explicit deployment approval, release the reviewed scheduler ZIP and API from the same code revision in a coordinated window. Scheduler is a separate Flex Node 22 release; the package preserves deployed dependencies/runtime files byte-for-byte and includes no new native modules. `release-artifact-manifest.json` pins its SHA-256 and all source hashes. The installed Azure CLI implementation explicitly routes the following command through its Flex deployment path. Prepared only; not executed:

   ```sh
   az functionapp deployment source config-zip \
     --resource-group rg-blorenge-registration-prod-weu \
     --name func-blorenge-registration-scheduler-prod-c1b64c \
     --src /private/tmp/blorenge-payment-remediation/.deployment/payment-remediation-release/scheduler.zip \
     --build-remote false
   ```

   Deploying scheduler first preserves uncertain reservations even if API rollout fails. Do not invoke the timer manually. Record deployment IDs/timestamps, package hash and the next natural timer result, without changing settings or identity.
4. Merge/deploy the approved API commit through the existing workflow. Verify health/auth boundaries and the unchanged over-offering guard, then compare registration/payment/offer fields and capacity against the baseline. Stop on unexpected results. Do not replay anything as part of deployment validation.
5. API rollback is a reviewed revert/redeploy to baseline `01de1d4`, preserving the existing over-offering code and all Table data. It restores the known webhook defect, so it is an emergency fallback, not a recovery completion. Additive review fields/processing status are readable by baseline code. Prefer a small forward correction if feasible.
6. Keep the corrected scheduler hold behaviour during an API rollback. Returning to the old scheduler risks releasing new pending reservations; do not blindly restore it. If scheduler rollback is necessary, require explicit approval for a compatible forward rollback retaining the hold rule, or an operational suspension plan. Never silently stop the scheduler, pause registration, remove reviews or restore old Table state. The actual active scheduler package is now preserved and verified; see `scheduler-rollback-evidence.json`. The replacement ZIP is built from that exact archive and changes only the three files in `narrow-scheduler-package-verification.json`. All dependencies, runtime files, domain logic and the over-offering safeguard remain byte-identical to deployed. Rebuild with `python3 scripts/package-payment-scheduler.py <verified-rollback-zip> .deployment/payment-remediation-release/scheduler.zip`; the builder refuses any other baseline hash. The normal workflow stages a broader current-main scheduler package; **do not deploy that generic package for this incident**. Deploy only the narrowly patched ZIP with SHA-256 `184f9e95d3b54db7f55b672b61ac84d27ebc4852375fe2e8cddfc4999a92a547`.

## Monitoring readiness and remaining proof

Read-only Azure inspection found enabled table/API failure metrics and enabled critical-failure, persistent-5xx, scheduler-heartbeat and email-failure query rules. The deployed critical query already includes `stripe_payment_reconciliation_failed`; the new API and scheduler emit that signal, and staged smoke verifies the scheduler path. Review counts are stored in scheduler status and visible in organiser state.

Historical App Insights trace-ingestion gaps are already documented in the scheduler handbook. Existing enabled rules plus locally verified signals do not prove live delivery to an operator. After an approved deployment, verify ingestion and alert routing from natural executions/eligible event handling; do not send synthetic production webhooks or invoke the timer to manufacture proof. No new monitoring resource/configuration was applied. Until ingestion is confirmed, inspect organiser review state and natural timer metrics at each two-hour review interval, and Stripe endpoint delivery state directly.

## Controlled Stripe recovery — separate replay approval required

Pilot candidate: **`evt_1UcjlY2Kxy50V5SgHXcrm1sK`**, already manually reconciled payment `payment_5f0cc0a9-b1bb-4e3d-b461-e865b79f844d`, registration `reg_dda9e5db-a9da-4e27-8605-1c4a91f44a4f`. Refresh its manifest row immediately before replay. Request explicit approval for this event only after deployment succeeds.

Expect 2xx duplicate acknowledgement, one original processed-event record, unchanged paid/confirmed registration/payment/capacity, and no new confirmation/outbox attempt. Verify before moving to the other four eligible events, individually and within explicitly approved replay scope. The two pending events for the async session are one payment, not two entries. Obtain per-endpoint delivery responses from Stripe; `pending_webhooks` is not a delivery-attempt log.

Do **not** replay `evt_1UcOTu2Kxy50V5SgD10PSAOk` while its capacity decision is unresolved. Its manifest row says `HOLD_FOR_ORGANISER_CAPACITY_DECISION`. Deployment approval does not authorize this replay or any payment/capacity repair. Automatic retries may still encounter the deliberate 409 conflict; record that exception rather than acknowledging it falsely.

## Separate £6 recommendation — organiser decision required

The original registration/payment and its valid reservation/payment timeline must remain intact. Payment succeeded before its deadline. Never ask for a second payment or create a replacement registration.

- **Hold for a legitimate place to become available.** Keep the case explicitly listed as paid at Stripe / awaiting capacity decision. Existing offers remain valid and capacity stays 120. After a genuine withdrawal or natural unaccepted-offer expiry, verify availability and provider payment/charge/refund/dispute evidence, then request approval to reconcile the original record through the existing audited manual path or genuine event. It must atomically consume only real available capacity and send one confirmation.
- **Approve a separate financial-status correction while leaving the place unconfirmed.** A reviewed supported repair could record actual payment 600p, provider identifiers/evidence and a `paid_capacity_conflict`/manual-review state, while retaining `placeStatus:none` and not cleared to start. This would improve the organiser's financial ledger but would not grant a race place or resolve capacity. It requires an exact correction specification and separate approval; no such change has been applied or bundled as a migration here.

No automatic confirmation, capacity increase, offer cancellation, deletion or refund is proposed. The organiser's overcommitment decision remains separate from payment-code remediation.

## Approval gates

- **Deployment:** approve the exact reviewed commit plus scheduler package hash and coordinated API/scheduler release; no merge/upload before that approval.
- **Replay:** after successful deployment verification, approve the named pilot live Stripe event separately; extend scope explicitly for subsequent events.
- **Correction:** separately approve any financial-status repair or later confirmation of the £6 case after a legitimate capacity decision. Deployment/replay approval is not authority to change capacity/offers, refund, or restore data.
- **Access:** any additional temporary data access must be explicitly approved, scoped, removed and verified. The approved Table grant for this baseline is already removed. Approved container-only Blob reader assignment `6802603b-3f02-448d-8988-29e64382520e` was used to retrieve the ZIP whose name matches active deployment `2260a9ac-e444-415a-ad43-adbb52eed86a`, then removed. Both Table- and Blob-scoped assignment lists were verified empty.

Phases 3–6 are deliberately unexecuted at this checkpoint. Final delivery/notification verification can only be completed after the respective approvals.
