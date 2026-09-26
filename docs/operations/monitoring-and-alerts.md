# Monitoring and alerts

## Current services

- Application Insights: `appi-blorenge-registration-prod-c1b64c`
- Log Analytics: `log-blorenge-registration-prod-c1b64c`, 30-day retention
- Action group: `ag-blorenge-registration-prod-c1b64c`, enabled with one configured email receiver
- ACS diagnostics: `registration-email-delivery`
- Function metric: `OnDemandFunctionExecutionCount`
- Application Insights smart detector: `Failure Anomalies - appi-blorenge-registration-prod-c1b64c`

Do not paste runner fields, secure URLs, tokens or message bodies into traces. ACS operational tables can contain recipient/delivery metadata; access them only for support and avoid broad export.

## Deployed alert rules

All four rules are enabled, severity 1, evaluated every five minutes over a 15-minute window.

| Rule | Plain-English meaning | Immediate response |
|---|---|---|
| `registration-critical-failures-c1b64c` | Looks for Stripe reconciliation, refund, capacity, waiting-list, backup or invalid-state failure markers | Pause if payment/capacity/state integrity may be affected; reconcile provider and state |
| `registration-persistent-5xx-c1b64c` | Three or more registration API 5xx responses in a five-minute bucket | Check API/storage/providers; pause if ongoing |
| `registration-email-failures-c1b64c` | Looks for transactional email failure-after-retry marker | Diagnose ACS; payment/entry remains authoritative |
| `registration-scheduler-heartbeat-c1b64c` | Intended to alert when last success is older than 75 minutes | Check execution metric and Function state immediately |

Application Insights also has enabled smart detector `FailureAnomaliesDetector` (`Failure Anomalies - appi-blorenge-registration-prod-c1b64c`), evaluated every minute at severity Sev3. Treat it as a general unusual-failure signal rather than a registration-domain invariant check.

### Verified limitation

On 26 September, scheduler execution-count metrics showed two executions per hour, but the expected completion trace was absent from a three-hour Application Insights query. The heartbeat rule is based on that trace and its query may not fire when there are no trace rows at all. Treat this alert as **configured but not independently proven end-to-end**. Until corrected in a separately reviewed infrastructure change, check Function metrics/invocations directly.

## What normal looks like

- Static site returns 200 and status endpoints return JSON.
- Operational state is the deliberately selected state.
- API 5xx count is zero/isolated, not repeated.
- Stripe webhooks receive successful responses.
- ACS send/status records show accepted then delivered (or an explainable terminal result).
- Scheduler shows roughly two on-demand executions per completed hour.
- No new critical-failure trace markers.
- Alert rules and action group remain enabled.

## Priority

Act immediately on state validation failure, capacity invariant failure, paid-but-unreconciled clusters, duplicate-charge/refund evidence, sustained API 5xx, storage unavailability or a scheduler outage during active capacity pressure. Email delivery degradation, a single card decline, an expired secure link, or an isolated validation 4xx can usually be diagnosed without shutting the site, unless volume or uncertainty grows.

## Inspection locations

Azure Portal → production resource group → Application Insights for requests/exceptions/traces; Log Analytics for KQL and ACS tables; Function App → Monitoring/Metrics for executions; Monitor → Alerts for fired/resolved instances and action-group delivery. Stripe Dashboard is an independent payment/webhook signal and should be checked even when Azure looks healthy.
