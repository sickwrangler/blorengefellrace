# Current system overview

Last verified: 27 September 2026. This supersedes the September 2026 static-only audit. Detailed operation is documented in [docs/operations/](operations/README.md).

## Production baseline

- GitHub `main`: `268b1a7fa5814b29f2b1cfb3ce174b7bb280034f`
- Latest production GitHub Actions deployment: successful
- Public site: <https://www.blorengefellrace.cymru/>
- Operational state: `PRIVATE_LIVE`
- Capacity: 120
- Stripe: live/enabled
- ACS Email: production/enabled
- Junior entry: disabled
- Public opening messaging: derived from the authoritative registration state

## Current architecture

Azure Static Web Apps hosts public static content, production registration pages and a managed registration API. Private registration state is stored in Azure Table `RegistrationProduction`, partition `blorenge-2026-live`. Stripe handles hosted Checkout/webhooks/refunds. ACS Email sends transactional messages. A separate Node 22 Flex Consumption Function runs scheduled work every 30 minutes. Microsoft Entra/Static Web Apps role `organiser` protects the dashboard and organiser APIs. Application Insights, Log Analytics, ACS diagnostics, an action group and four scheduled-query alerts provide monitoring.

The public start list is a minimised API projection of confirmed registration data. It is not a spreadsheet or manually edited copy. Results archives and registration state remain separate.

## Verified production resources

Resource group `rg-blorenge-registration-prod-weu` contains storage `stblorengeregprodc1b64c`, table `RegistrationProduction`, private backup and scheduler-package containers, ACS/ECS resources with suffix `c1b64c`, scheduler `func-blorenge-registration-scheduler-prod-c1b64c`, Flex plan, Log Analytics, Application Insights, action group, four registration alert rules and the Application Insights failure-anomaly detector. See the [resource inventory](operations/resource-inventory.md).

Storage public blob access is disabled; versioning and 35-day soft deletion are enabled. The `www` hostname is Ready. Azure records the bare apex hostname as Failed; no DNS change was made during this audit.

## Deployment

GitHub Actions validates the full site/registration suite and exact allowlists. A push to `main` deploys 71 application files and 18 managed API files. Documentation, infrastructure, tests, fixtures and development/private files are excluded. The 17-file scheduler artifact is staged/validated but is not automatically deployed by the current production workflow.

A code deployment does not normally change registrations, provider transactions or operational state. Production data lives separately. Pull requests currently validate but do not receive an Azure preview from the production workflow.

## Known operational limitations

- The organiser dashboard has no state-transition button; the authenticated confirmation-protected API is supported.
- Automatic daily backup creation is policy/code but not wired/verified in the deployed scheduler artifact; controlled snapshots are manual.
- Scheduler execution metrics were healthy, but no completion trace was returned in a three-hour query. The trace-based heartbeat alert is configured but not independently proven to alert on total trace absence.
- GitHub ruleset `Protect main` requires a pull request and the production `Build and Deploy Job`; force pushes and deletion are blocked.

These findings were documented only. No application, infrastructure, provider, configuration, state or production data was changed.
