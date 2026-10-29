# Monitoring and alerts

## Current services

- Application Insights: `appi-blorenge-registration-prod-c1b64c`
- Log Analytics: `log-blorenge-registration-prod-c1b64c`, 30-day retention
- Action group: `ag-blorenge-registration-prod-c1b64c`, enabled with one configured email receiver
- ACS diagnostics: `registration-email-delivery`
- Function metric: `OnDemandFunctionExecutionCount`
- Application Insights smart detector: `Failure Anomalies - appi-blorenge-registration-prod-c1b64c`

Do not paste runner fields, secure URLs, tokens or message bodies into traces. ACS operational tables can contain recipient/delivery metadata; access them only for support and avoid broad export.

## Alert rules

The original four rules plus the storage-hardening rules are defined at severity 1 and evaluated every five minutes over a 15-minute window. Confirm deployment state in Azure after each infrastructure release.

| Rule | Plain-English meaning | Immediate response |
|---|---|---|
| `registration-critical-failures-c1b64c` | Looks for Stripe reconciliation, refund, capacity, waiting-list, backup or invalid-state failure markers | Pause if payment/capacity/state integrity may be affected; reconcile provider and state |
| `registration-persistent-5xx-c1b64c` | Three or more registration API 5xx responses in a five-minute bucket | Check API/storage/providers; pause if ongoing |
| `registration-email-failures-c1b64c` | Looks for a transactional email failure after bounded retry | Diagnose ACS; payment/entry remains authoritative |
| `registration-email-throttling-c1b64c` | Application observed ACS 429 throttling after SDK handling | Pause if new confirmations are at risk; respect provider limits |
| `registration-confirmation-missing-c1b64c` | Scheduler reconciliation found a paid confirmed entry with no confirmation receipt | Run aggregate dry run; never blindly resend |
| `registration-email-failed-backlog-c1b64c` | Scheduler reconciliation found failed communications, including oldest age | Diagnose provider then use controlled recovery |
| `registration-scheduler-heartbeat-c1b64c` | Intended to alert when last success is older than 75 minutes | Check execution metric and Function state immediately |
| `registration-state-write-failures-c1b64c` | Explicit non-conflict state-write failure marker | Inspect Table status/error and pause if repeated or integrity is uncertain |
| `registration-order-creation-5xx-c1b64c` | Two or more safe order-creation failure markers in five minutes | Check managed API and Table; ordinary validation 4xx does not count |
| `registration-table-sas-expiry-c1b64c` | SAS expiry metadata missing or within 30/14/7 days | Verify stored-policy metadata and renew through the controlled process |
| `registration-table-write-failures-c1b64c` | Three or more failed `UpdateEntity` operations in 15 minutes | Treat as the direct write-path incident signal; check conflicts versus service/size failures |
| `registration-managed-api-failures-c1b64c` | Two or more managed Function errors in 15 minutes | Broad fallback for API errors when route traces are unavailable |

Application Insights also has enabled smart detector `FailureAnomaliesDetector` (`Failure Anomalies - appi-blorenge-registration-prod-c1b64c`), evaluated every minute at severity Sev3. Treat it as a general unusual-failure signal rather than a registration-domain invariant check.

The four new email queries above are defined in the reviewed production Bicep change. They are not live until that infrastructure diff is separately approved and deployed. ACS delivery diagnostics remain live independently.

### Verified limitation

On 26 September, scheduler execution-count metrics showed two executions per hour, but the expected completion trace was absent from a three-hour Application Insights query. The heartbeat rule is based on that trace and its query may not fire when there are no trace rows at all. Treat this alert as **configured but not independently proven end-to-end**. Until corrected in a separately reviewed infrastructure change, check Function metrics/invocations directly.

Managed Static Web Apps exposes `FunctionErrors` without a route dimension. The metric alert is therefore deliberately broader than `/api/v4/orders`. The route-specific trace rule is preferable when trace ingestion is present; the platform metric is the reliable fallback. Neither rule alerts on ordinary validation 4xx.

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
