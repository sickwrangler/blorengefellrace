# Incident runbook

For serious or unclear incidents: **PAUSE/CLOSE new registrations before repairing data.** Preserve evidence, use the lowest intervention level, and never paste secrets or runner data into public channels.

## 1. Public website unavailable

- **Symptoms:** custom domain times out, 5xx, blank pages or assets fail broadly.
- **Contain:** if API still works and registration exposure is uncertain, move `OPEN` to `PAUSED` through the authenticated state endpoint.
- **Inspect:** DNS/custom-domain status, generated Static Web App hostname, GitHub Actions, Static Web App health.
- **Diagnose/recover:** distinguish DNS from Azure/deployment failure; revert a bad release normally or restore DNS through its controlled owner.
- **Do not:** redeploy repeatedly or alter registration data.
- **Escalate:** Azure/DNS owner when generated hostname and custom hostname differ or outage persists.

## 2. Registration form unavailable

- **Symptoms:** unavailable panel, API error, form never initializes.
- **Contain:** confirm whether the current state intentionally blocks public access; pause if behaviour is inconsistent.
- **Inspect:** `/api/v2/registration/status`, managed API requests, operational state, private invitation validity in `PRIVATE_LIVE`.
- **Diagnose/recover:** repair API/config/deployment or use a valid invitation; only transition state with explicit approval.
- **Do not:** weaken invitation/state checks or use a URL parameter as an opening switch.
- **Escalate:** application owner if status and UI disagree.

## 3. Form loads but submission fails

- **Symptoms:** validation banner, 4xx/5xx, no order created.
- **Contain:** pause if multiple valid runners fail or records may be partially created.
- **Inspect:** visible field errors, API code, request failure, capacity/reservations and duplicate-email policy.
- **Diagnose/recover:** correct runner input for 4xx; repair server/storage for 5xx; verify one order before retry.
- **Do not:** bypass server validation or submit repeatedly.
- **Escalate:** controlled repair if a partial record prevents retry and no supported operation exists.

## 4. Stripe Checkout cannot be created

- **Symptoms:** Checkout button errors; no Stripe-hosted page.
- **Contain:** pause if widespread; one isolated invalid order can remain open for correction.
- **Inspect:** integration status, Stripe service/dashboard, API logs, price/capacity validation, active Checkout attempt.
- **Diagnose/recover:** resolve provider/config/API issue; use secure order recovery to reuse/replace a valid or expired attempt.
- **Do not:** create manual Payment Links that bypass registration state.
- **Escalate:** Stripe/application owner if provider accepts a session but application did not store it.

## 5. Runner paid but entry is not confirmed

- **Symptoms:** Stripe says paid; dashboard says unpaid/processing; runner absent from start list.
- **Contain:** pause if more than one case or capacity could oversubscribe.
- **Inspect:** Stripe payment and amount/currency, webhook deliveries/responses, payment reconciliation state and audit.
- **Diagnose/recover:** redeliver the authentic webhook only after endpoint health is restored; otherwise use a reviewed reconciliation repair.
- **Do not:** mark paid manually, refund automatically or ask for another payment.
- **Escalate:** immediately when paid-capacity conflict or amount mismatch appears.

## 6. Runner charged twice / suspected duplicate

- **Symptoms:** two Stripe charges/Checkout completions or runner reports duplicate debit.
- **Contain:** pause if duplicate creation is systemic.
- **Inspect:** provider PaymentIntents, order/session IDs, application order/payment records and webhook event IDs.
- **Diagnose/recover:** identify whether both charges settled and which registration each owns; refund only the confirmed duplicate through an approved, idempotent path.
- **Do not:** issue refunds based only on a screenshot or retry refund blindly.
- **Escalate:** payment incident owner; preserve financial/audit evidence.

## 7. Refund appears to fail

- **Symptoms:** error after execute; application still says approved/pending.
- **Contain:** do not execute again; pause if place/capacity outcome is uncertain.
- **Inspect:** Stripe refund object first, then application audit/payment/refund state and webhook.
- **Diagnose/recover:** if Stripe did not refund, correct cause and retry supported action; if it did, reconcile application state with a reviewed repair.
- **Do not:** issue a second refund before checking Stripe.
- **Escalate:** any provider/application disagreement.

## 8. Confirmation email missing

- **Symptoms:** paid runner receives no confirmation/management link.
- **Contain:** payment and place remain valid; pause only for widespread ACS failure.
- **Inspect:** application communication receipt, ACS send/status tables, recipient correctness, bounce/junk.
- **Diagnose/recover:** use supported management-link recovery/resend after the original attempt is understood.
- **Do not:** refund or resend repeatedly; never request their token.
- **Escalate:** ACS/provider owner for accepted-but-undelivered clusters.

## 9. Declaration email missing

- **Symptoms:** paid entry says Declaration required; no secure declaration message.
- **Contain:** no payment rollback; monitor race-day clearance.
- **Inspect:** declaration status/token metadata, communication receipt, ACS diagnostics and reminder timing.
- **Diagnose/recover:** organiser resend or runner recovery rotates/issues a secure link; paper declaration is an explicit audited alternative.
- **Do not:** mark complete without actual digital or paper declaration.
- **Escalate:** application owner if resend reports success but no communication receipt/provider call.

## 10. Management link fails

- **Symptoms:** secure-entry-link error, expired/revoked token or wrong browser session.
- **Contain:** none unless widespread.
- **Inspect:** correct production URL, recovery request, active registration status and API response category without exposing token.
- **Diagnose/recover:** use email-based management recovery or organiser resend; old link may intentionally stop working.
- **Do not:** paste the fragment/token into support tools or make tokens long-lived.
- **Escalate:** if recovery email succeeds but every new token fails.

## 11. Organiser dashboard unavailable

- **Symptoms:** redirect loop, 401/403, blank data or “unavailable”.
- **Contain:** use the supported state endpoint only if a signed-in organiser session remains; otherwise escalate rather than edit data.
- **Inspect:** Static Web App health, Entra sign-in, role, managed API, browser console/network.
- **Diagnose/recover:** sign out/in, verify literal role `organiser`, repair service/deployment or role assignment.
- **Do not:** make dashboard/API anonymous.
- **Escalate:** identity owner if no approved organiser can access emergency controls.

## 12. Organiser authentication/role failure

- **Symptoms:** login succeeds but organiser routes redirect/deny.
- **Contain:** if registrations are open and no organiser can respond, treat as urgent identity incident.
- **Inspect:** Static Web App Role Management, role spelling/case, principal claims and recent access changes.
- **Diagnose/recover:** grant/reissue only the named user's `organiser` invitation/assignment; allow propagation and sign in afresh.
- **Do not:** share accounts, tokens or add broad anonymous access.
- **Escalate:** Azure subscription/identity administrator.

## 13. Capacity count looks wrong

- **Symptoms:** remaining places disagree with confirmed entries.
- **Contain:** pause immediately if over/under-allocation is possible.
- **Inspect:** confirmed, payment-reserved and offer-reserved counts; expired Checkout/offers; scheduler health.
- **Diagnose/recover:** let supported expiry/reconciliation run; implement reviewed invariant repair if state is genuinely inconsistent.
- **Do not:** edit capacity counters/Table chunks or cancel runners to “make totals fit”.
- **Escalate:** application/data owner with Stripe reconciliation if payments are involved.

## 14. Public start list looks wrong

- **Symptoms:** paid runner missing, cancelled/refunded runner present, private field concern or stale name/number.
- **Contain:** if privacy leakage is suspected, pause and treat as security incident; otherwise registrations may continue during diagnosis.
- **Inspect:** organiser record, payment/place status, transfer/refund/cancel audit, `/api/v4/start-list` projection.
- **Diagnose/recover:** correct the authoritative entry through supported action; projection should update immediately.
- **Do not:** hand-edit a public list as an alternative source of truth.
- **Escalate:** immediately for any private-field exposure.

## 15. Scheduler stops running

- **Symptoms:** execution metric below two/hour, Function stopped, delayed work.
- **Contain:** pause if outage exceeds a few hours or capacity/waiting list is affected.
- **Inspect:** Function state/function enabled, execution metric, host logs, storage/ACS identity access and plan health.
- **Diagnose/recover:** restart/repair only through controlled Azure operation; verify a normal timer run and state results.
- **Do not:** manually mutate expiries/offers or invoke unreviewed internals.
- **Escalate:** Azure/application owner; a day-long outage is high priority.

## 16. Waiting-list processing stops

- **Symptoms:** offer/reminder overdue, expired offer still reserves capacity, next runner not offered.
- **Contain:** pause if capacity is being advertised incorrectly.
- **Inspect:** scheduler, offer/reminder/expiry timestamps, ACS receipt and waiting sequence.
- **Diagnose/recover:** restore scheduler and allow supported idempotent processing; use organiser offer action only when domain state permits.
- **Do not:** skip queue order or create ad-hoc invitation links.
- **Escalate:** controlled repair if offer state is internally inconsistent.

## 17. Azure Table unavailable

- **Symptoms:** status/API 503, dashboard unavailable, production-state-unavailable.
- **Contain:** registration should fail closed; explicitly pause/close if the state endpoint is reachable, otherwise post an external incident notice only through reviewed content deployment.
- **Inspect:** storage health, account/network settings, Table service and API credentials/SAS expiry.
- **Diagnose/recover:** restore access/configuration; validate state and ETag reads before reopening.
- **Do not:** bootstrap a new empty production state over missing data.
- **Escalate:** Azure/storage owner immediately.

## 18. ACS unavailable

- **Symptoms:** send failures, no delivery records or provider incident.
- **Contain:** pause if runners cannot safely receive required links at scale.
- **Inspect:** ACS/ECS/domain provisioning, setting/identity, diagnostics and Azure status.
- **Diagnose/recover:** restore provider/config; then use supported recovery/resend selectively.
- **Do not:** roll back payments or mass-resend blindly.
- **Escalate:** Azure Communication Services support for provider outage.

### Managed-domain throttling or confirmation backlog

- **Symptoms:** accepted registrations materially exceed successful initial-confirmation receipts; ACS accepted-send records stop at the managed-domain quota; application retry telemetry reports `throttled`.
- **Contain:** use `OPEN → PAUSED` when continuing traffic is likely to create more missing required email. Never use `CLOSED_FINAL` for temporary containment.
- **Inspect:** aggregate Email Health counts, dry-run recovery count, ACS send/status buckets and the documented domain quota. Do not query or export recipient fields for general reconciliation.
- **Recover:** migrate to a verified custom domain and prove delivery first; then obtain explicit approval for the guarded one-at-a-time recovery operation. Refresh the dry run after every attempt.
- **Do not:** resend successful confirmations, use `sentAt` alone as proof, invalidate links outside the supported recovery transaction, or treat an email failure as a failed registration/payment.

## 19. Stripe unavailable

- **Symptoms:** session/refund/API failures or Stripe incident.
- **Contain:** pause new registration; do not disable credentials as first response.
- **Inspect:** Stripe status/dashboard, integration status, application errors and outstanding reservations.
- **Diagnose/recover:** wait/restore provider; reconcile active sessions/webhooks before reopening.
- **Do not:** substitute an untracked payment method or ask for repeated Checkout attempts.
- **Escalate:** Stripe support/application payment owner.

## 20. GitHub deployment fails

- **Symptoms:** Actions validation/deploy red; production may still be previous version.
- **Contain:** do not rerun blindly; registration state/data are separate and normally unchanged.
- **Inspect:** exact failed step, commit/diff, tests, artifact allowlist and Azure deploy response.
- **Diagnose/recover:** fix on the branch/new PR; rerun only understood transient failures.
- **Do not:** bypass tests, broaden artifact or force-push `main`.
- **Escalate:** repository/Azure owner for deployment-token/provider errors.

## 21. Bad production deployment

- **Symptoms:** regression immediately after successful main deployment.
- **Contain:** pause if runner/payment correctness is affected.
- **Inspect:** deployment SHA, change diff, API/data compatibility, provider events since deploy.
- **Diagnose/recover:** reviewed revert/forward fix and normal deployment; smoke-test while paused.
- **Do not:** roll back data with code or redeploy an old artifact outside Git.
- **Escalate:** if schema/payment behaviour advanced beyond known-good code.

## 22. Suspected production data corruption

- **Symptoms:** invalid-state 503, impossible relationships/counts, checksum/invariant failure.
- **Contain:** `CLOSED`, stop writes, suspend scheduler if needed.
- **Inspect:** read-only state validation, current ETag, audit/provider evidence and validated snapshots.
- **Diagnose/recover:** take current evidence snapshot, reconcile Stripe, use reviewed repair or guarded restore.
- **Do not:** edit Table rows/chunks or restore over active writes.
- **Escalate:** Level 4 break glass with explicit approval.

## 23. Suspected leaked secret/token/key

- **Symptoms:** secret pasted/logged, unusual API/provider access, token in public location.
- **Contain:** revoke/rotate the specific credential; pause if integrity is uncertain.
- **Inspect:** exposure scope/time, provider audit, Git history/artifacts/logs and dependent services.
- **Diagnose/recover:** follow [credential rotation](security-and-secrets.md), update the intended environment only, prove old credential invalid and new path healthy.
- **Do not:** paste the value again, rotate unrelated credentials or rewrite history without a reviewed plan.
- **Escalate:** security/provider owner; notify affected people if data exposure is possible.

## 24. Backup failure

- **Symptoms:** upload/download/checksum/format/RBAC cleanup fails.
- **Contain:** postpone significant change; registration can continue only if risk is accepted and other valid snapshots exist.
- **Inspect:** private container, temporary role scope, network, source ETag, checksum and disk permissions.
- **Diagnose/recover:** correct least-privilege access, repeat full upload-download validation, revoke roles and delete local files.
- **Do not:** use account key, leave RBAC/local state behind, or call an unvalidated blob a backup.
- **Escalate:** storage/security owner; remain closed before restore-dependent work.

## 25. Monitoring/alerting failure

- **Symptoms:** rules disabled, action email absent, telemetry gap or heartbeat not firing.
- **Contain:** use manual status/provider/Function checks; pause if the team cannot safely observe active payments/capacity.
- **Inspect:** rule/action-group enabled state, receiver, workspace ingestion, App Insights and known heartbeat trace limitation.
- **Diagnose/recover:** repair through reviewed infrastructure change and run a controlled non-sensitive proof.
- **Do not:** generate real charges/emails solely to test without approval or assume silence means health.
- **Escalate:** Azure monitoring owner; document temporary manual monitoring cadence.

## 26. Reads healthy but production writes return 503

- **Symptoms:** public/static pages and status reads succeed, valid order creation returns 503, and Azure Storage records failed `UpdateEntity` operations.
- **Contain:** if failures repeat or state integrity is uncertain, transition `OPEN` to `PAUSED`; do not restore a backup merely because writes fail.
- **Inspect:** `registration_state_write_failed`, the aggregate storage-headroom diagnostic, Table `Transactions` split by `ApiName=UpdateEntity`/response type, managed API `FunctionErrors`, and deployed API **and scheduler** serializer versions.
- **Known 27 September 2026 cause:** 60,000-character Base64 chunks exceeded the safe Azure Table UTF-16 string-property boundary. The resolution was 30,000-character chunks in the shared codec.
- **Diagnose/recover:** distinguish service/auth/ETag/size errors; deploy reviewed code through the protected workflow; deploy the external scheduler separately when its package changed; prove natural writes/timer health.
- **Do not:** directly edit chunks, bypass the pre-write size guard, expose compressed state, restore data without corruption evidence, or manufacture production registrations.
