# Production resource inventory

Verified read-only in Azure on 26 September 2026. Do not copy secret values into this file.

## Azure resources

| Purpose | Exact name | Type / group | Private data or secrets | Normal organiser use | Failure effect |
|---|---|---|---|---|---|
| Public site and managed API | `BlorengeFellRace` | Static Web App (Free), `Blorenge` | App settings contain production credentials/configuration; API handles private data | Use site/dashboard only; do not edit settings casually | Public pages and/or registration API unavailable |
| Production storage | `stblorengeregprodc1b64c` | StorageV2 Standard_LRS, `rg-blorenge-registration-prod-weu` | Yes | No direct data interaction | Registration persistence, Functions host/package and backups affected |
| Registration state | `RegistrationProduction` | Azure Table in production storage | Yes—runner, order, status and audit state | Never edit directly | API fails closed or state becomes inconsistent |
| Event partition | `blorenge-2026-live` | Table partition | Yes | Never edit directly | Current event unavailable/corrupt if damaged |
| Backups | `registration-backups` | Private blob container | Yes—complete snapshots | Break-glass/approved backup procedure only | Recovery point unavailable |
| Scheduler package | `scheduler-app-package` | Private blob container | Code package/config reference, not runner source of truth | Infrastructure release only | Scheduler may fail to start/update |
| Functions host containers | `azure-webjobs-hosts`, `azure-webjobs-secrets` | Private blob containers | Runtime metadata/secrets | No | Scheduler host impaired |
| Email transport | `acs-blorenge-registration-prod-c1b64c` | Communication Service, production group | Credentials/configuration; delivery metadata | Inspect status/diagnostics | Transactional sends fail; registrations/payments remain valid |
| Email service | `ecs-blorenge-registration-prod-c1b64c` | Email Communication Service, production group | Sender/domain configuration | Inspect only | ACS sender unavailable |
| Email domain | `AzureManagedDomain` | Azure-managed Email domain | Operational identifier | Inspect only | Sending identity fails |
| Scheduler | `func-blorenge-registration-scheduler-prod-c1b64c` | Node 22 Linux Function App, production group | Reads/writes production state; sends email | Status/log inspection | Expiry/reminders/waiting-list background work delayed |
| Scheduler plan | `asp-blorenge-registration-scheduler-prod-c1b64c` | Flex Consumption FC1, production group | No runner records | Inspect only | Scheduler cannot execute |
| Logs | `log-blorenge-registration-prod-c1b64c` | Log Analytics, production group | Operational telemetry; ACS delivery/status records may identify recipients | Diagnose incidents; avoid exporting PII | Reduced diagnosis/alerting |
| Telemetry | `appi-blorenge-registration-prod-c1b64c` | Application Insights, production group | Operational request/trace metadata | Diagnose incidents | Reduced API/scheduler visibility |
| Notifications | `ag-blorenge-registration-prod-c1b64c` | Action group, production group | One private receiver configuration | Inspect status; change only with approval | Alerts do not reach organiser |
| Alert rules | `registration-critical-failures-c1b64c`, `registration-persistent-5xx-c1b64c`, `registration-email-failures-c1b64c`, `registration-scheduler-heartbeat-c1b64c` | Scheduled query rules, production group | Queries only | Inspect/acknowledge | Specific incident class may go unnoticed |
| Failure anomaly detection | `Failure Anomalies - appi-blorenge-registration-prod-c1b64c` | Application Insights smart detector, production group | Telemetry-derived | Inspect/acknowledge | Unusual failure-rate changes may go unnoticed |
| Cost warning | `budget-blorenge-registration-production` | Subscription budget | Receiver configuration | Inspect | Cost notifications absent; service continues |

Storage is HTTPS-only with TLS 1.2 minimum, public blob access disabled, blob versioning enabled, and blob/container soft deletion set to 35 days. Shared-key access and public network access are currently enabled; this is the deployed state, not a claim that it is the ideal future design.

## Scheduler identity and roles

The Function has a system-assigned managed identity. Verified deployed roles are:

- Storage Table Data Contributor on the production storage account;
- Storage Blob Data Owner on the production storage account;
- Storage Queue Data Contributor on the production storage account;
- Communication and Email Service Owner on the production ACS resource;
- Monitoring Metrics Publisher on production Application Insights.

These are runtime assignments. Do not copy them to a human account. Temporary human backup access uses the narrower procedure in [backup and recovery](backup-and-recovery.md).

## Static Web App identity boundary

The custom production role is the literal lowercase `organiser`. The generated production artifact protects the dashboard and `/api/v2|v3|v4/organiser/*` routes with that role; the API independently validates the platform principal. At least one organiser assignment was verified without recording identities here.

The ready production custom hostname is `www.blorengefellrace.cymru`. Azure currently records `blorengefellrace.cymru` (without `www`) as `Failed`; treat the `www` address as canonical and investigate DNS separately if the apex domain is required.

## External systems

| System | Purpose | Stored/configured material | Failure effect |
|---|---|---|---|
| Stripe live | Hosted Checkout, signed webhooks, full/partial refunds | Live secret key and webhook secret are app settings; values must never be documented | New Checkout/refunds/reconciliation may fail |
| GitHub `sickwrangler/blorengefellrace` | Source, PR review, Actions | Deployment token is a GitHub Actions secret | Releases fail; running production/data remain |
| DNS/custom domain | Routes `www.blorengefellrace.cymru` to Static Web Apps | DNS records outside repository | Custom URL fails; generated hostname may remain |
| Microsoft Entra through Static Web Apps | Organiser sign-in and role claims | Named user assignments in Azure | Organisers cannot administer entries |

## Non-secret production setting names

The managed API uses `REGISTRATION_ENVIRONMENT`, `REGISTRATION_STORAGE_ACCOUNT`, `REGISTRATION_TABLE`, `REGISTRATION_EVENT_PARTITION`, `REGISTRATION_PUBLIC_BASE_URL`, `REGISTRATION_MAX_RUNNERS_PER_ORDER`, `REGISTRATION_UNDER18_ENABLED`, `STRIPE_ENABLED`, `ACS_EMAIL_ENABLED`, `ACS_EMAIL_ENDPOINT` and `REGISTRATION_EMAIL_SENDER`, plus the secret settings documented in [security and secrets](security-and-secrets.md).

Verified safe values: environment `production`, table `RegistrationProduction`, partition `blorenge-2026-live`, base URL `https://www.blorengefellrace.cymru`, maximum five runners per order, Stripe enabled, ACS enabled, and junior entry disabled.
