# Production scheduler

## What runs

Function App `func-blorenge-registration-scheduler-prod-c1b64c` runs Node 22 on Flex Consumption plan `asp-blorenge-registration-scheduler-prod-c1b64c`. The timer function is `registration-production-scheduled-work` with schedule:

```text
0 */30 * * * *
```

That is every 30 minutes, on the hour and half-hour. `useMonitor` is enabled and `runOnStartup` is false. The Function was verified Running and enabled; aggregate metrics showed the expected two executions per hour through the verification time on 26 September 2026.

## Scheduled work

Each run uses a system-assigned managed identity to:

- read and transactionally update the production Table;
- send due waiting-list reminder messages;
- expire waiting-list offers and create/email the next offer;
- expire stale unpaid Checkout reservations;
- send the single configured declaration reminder when due;
- expire unpaid group Checkouts and release their reservations;
- abandon old drafts only if draft retention is explicitly configured;
- persist last-success/result metadata.

Checkout creation, payment webhook reconciliation, refund execution, runner submission and organiser edits are synchronous API work. They do not wait for the scheduler.

## Health check

1. Azure Portal → resource group `rg-blorenge-registration-prod-weu` → Function App.
2. Confirm state **Running** and function `registration-production-scheduled-work` enabled.
3. Metrics → `OnDemandFunctionExecutionCount`; normal is about two per completed hour.
4. Check Function/Application Insights failures and recent invocations.
5. Check stored scheduler status through the organiser snapshot when available.
6. Check alert `registration-scheduler-heartbeat-c1b64c`.

At verification, aggregate execution metrics were healthy, but the expected completion trace was not returned by a three-hour Application Insights query. Therefore, treat execution-count metrics and Function invocation logs as primary evidence until trace ingestion and the heartbeat query are separately proven. The deployed heartbeat query may not detect a total absence of traces; this is a monitoring limitation to review, not a reason to change production during an incident.

## Downtime impact

| Outage | Likely effect | Response |
|---|---|---|
| 30 minutes | Usually one delayed run; synchronous entry/payment remains available | Observe next run and alerts |
| A few hours | Expired Checkout reservations may occupy capacity longer; reminders/offers delayed | Investigate promptly; pause if capacity/waiting-list behaviour becomes misleading |
| A day | Material reservation/waiting-list/declaration backlog and unreliable capacity timing | Pause new registrations, repair scheduler, reconcile before reopening |

Do not manually invoke scheduled domain operations unless a reviewed, supported production mechanism exists. The current handbook does not designate arbitrary Function invocation as a normal organiser action. If catch-up cannot occur safely on the next timer run, remain paused and implement/review a controlled repair.

## Deployment boundary

The production GitHub workflow validates and stages the scheduler package but its current deploy step publishes only the Static Web App and managed API. Scheduler package deployment is therefore a separate controlled infrastructure release, not an automatic consequence of merging ordinary website/API changes. Confirm deployed scheduler compatibility whenever scheduler/shared-domain code changes.

After the 27 September 2026 Table-property incident, the previously deployed scheduler was found to predate the serializer fix. A scheduler-only ZIP made from reviewed commit `72bd238` was validated against its exact allowlist, verified to contain 30,000-character chunking, hashed before upload, and deployed separately. Azure recorded successful deployment `a4e11ff0-db4c-4f1c-96fc-bec98ef30415` at 17:08 UTC; settings and system-assigned identity hashes were unchanged. Future releases must record source commit, artifact checksum, Azure deployment ID/timestamp and a natural timer execution.
