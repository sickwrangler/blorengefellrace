# Organiser transfer and withdrawal hotfix

Release the scheduler package from the same reviewed commit as the web app and managed API. The main-branch workflow deploys the web app and API and stages the scheduler package for the separate controlled Function release. Confirm that the scheduler executes its normal retry cycle after release. Transfer notification retries depend on the updated scheduler.

## Verify the release

1. Verify the successful Static Web Apps run and scheduler release against the approved commit. Compare the live dashboard and management modules with the staged production files.
2. Use GET requests to confirm registration status and integration status, the public management page, the organiser sign-in boundary, and tokenless management rejection. With an authorised organiser session, open Places and confirm the relevant actions appear for confirmed paid and fee-waived entries. Close the dialogs without submitting.
3. Use isolated synthetic data for write verification. Exercise paid and waived transfer, reject a stale selection, inject an ETag conflict, and verify that the replacement links are usable when the mail adapter receives them. Exercise withdrawal through the confirmation dialog and inject a failure after the place is released. Verify that the resulting response confirms the release and reports notification uncertainty.
4. For an actual authorised race operation, verify current runner or released place, audit record, and notification outcome after submission. A successful synthetic run and read-only production checks do not verify a production write.

## Reconcile a reported failure

- Record the operation, GMT time, error code and request ID. Check the current entry and its audit history in the organiser dashboard. Use the current runner, reference, race number and place status to reconcile the result.
- When transfer ownership changed, check the replacement notification before taking further action. When a place is withdrawn, handle any approved refund through the existing separate workflow.
- The scheduler retries eligible prepared and retryable failed notifications. An attempt left in `sending` has an uncertain provider outcome. Check the notification record and ACS before authorising any resend. Do not manually edit the lease or re-run the race operation.
- Escalate committed transfers with permanently failed or expired replacement mail. After verifying current ownership and provider outcome, use the existing secure-link recovery workflow for the current runner.

## Roll back

Revert the web/API change using the reviewed deployment workflow and handle the scheduler release separately. Before reverting the scheduler, review outstanding transfer notifications. An older scheduler ignores transfer attempts in the outbox. Preserve committed registrations, audit and outbox records and reconcile them before any resend. Do not restore an old registration storage snapshot.

## Telemetry follow-up

The managed API emits `registration_operation_result` with operation, status, duration, request ID, commit result and notification outcome. Verify ingestion before treating missing events as evidence of healthy writes. Use filtered, redacted output for incident review.

```kusto
traces
| where timestamp > ago(24h)
| where message contains "registration_operation_result"
| summarize events=count(), latest=max(timestamp) by cloud_RoleName
```

Track managed API telemetry ingestion, operation alerts, ACS and outbox reconciliation, scheduler and webhook freshness, and read-only Operations Health in a separate follow-up. Keep authenticated entry diagnostics scoped to the selected entry.
