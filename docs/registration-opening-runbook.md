# Production registration opening runbook

This is a checklist, not authority to open. Production was verified `PRIVATE_LIVE` on 26 September 2026. The public site announces 28 September 2026, but no opening time has been persisted and `intendedOpeningDate` is null. A date never performs the state transition automatically.

Use the [operations handbook](operations/README.md), especially the [emergency sheet](operations/emergency-cheat-sheet.md), before opening.

## Approval gate

Record explicit approval for:

1. exact opening time and timezone (Europe/London);
2. transition `PRIVATE_LIVE → OPEN`;
3. current permissions/terms/privacy/declaration wording;
4. capacity 120 and prices £6/£4;
5. junior entry remains disabled unless separately approved;
6. Stripe live/webhook and ACS sender/delivery health;
7. organiser access and emergency pause capability;
8. scheduler health and waiting-list policy;
9. current validated backup and provider/data reconciliation;
10. monitoring/alert receiver readiness and manual scheduler check given the heartbeat trace limitation.

If any gate is incomplete, remain `PRIVATE_LIVE`.

## Pre-opening checks

1. Confirm current GitHub `main`/production deployment and green tests.
2. Read `/api/v2/registration/status`; record state, capacity, confirmed/reserved/waiting counts.
3. Read `/api/v3/registration/status`; confirm Stripe live and ACS production enabled.
4. Check Stripe webhook endpoint deliveries and ACS diagnostics.
5. Check Function `OnDemandFunctionExecutionCount` shows normal twice-hourly execution.
6. Confirm organiser dashboard and literal `organiser` role work in a fresh signed-in browser.
7. Confirm public start list contains only intended public fields.
8. Create/download/checksum-validate a controlled production snapshot and revoke temporary RBAC.
9. Prepare the exact emergency `OPEN → PAUSED` action and a named operator.

## Transition

The supported endpoint is `POST /api/v4/organiser/state`. It requires the authenticated organiser principal and body equivalent to:

```json
{
  "expectedState": "PRIVATE_LIVE",
  "state": "OPEN",
  "confirmation": "CHANGE PRIVATE_LIVE TO OPEN"
}
```

The dashboard does not currently provide a button for this operation. Use a reviewed operator command from an authenticated production browser session. Do not store cookies/principal headers, use raw Table edits, change app settings, or deploy merely to open.

## Immediate verification

1. Confirm the endpoint returned success and an audit event exists.
2. Confirm public status is `OPEN`, production, capacity 120 and expected counts.
3. Load `/registration/` in a private browser without an invitation; confirm the entry journey appears.
4. Do not create a test/live charge merely for smoke testing without explicit approval.
5. Watch API 5xx, Stripe webhooks, ACS delivery and scheduler/capacity for the opening period.

If any integrity/payment/capacity condition is unclear, immediately transition `OPEN → PAUSED` with confirmation `CHANGE OPEN TO PAUSED`, diagnose, and do not edit storage.
