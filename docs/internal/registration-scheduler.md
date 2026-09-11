# Registration development scheduler

## Purpose and boundary

The scheduler exists only in the isolated synthetic development environment. Every 30 minutes it invokes the existing shared scheduled-work domain service to:

- send one waiting-list reminder when a 48-hour offer reaches 24 hours;
- expire an unanswered offer after 48 hours and progress exactly one next eligible runner;
- release stale Stripe Checkout capacity reservations and communicate expiry.

It does not open registration, create entries, take payments, approve refunds or allocate race numbers. It has no application HTTP route. Production has no scheduler resource or package.

## Architecture and authentication

Azure Static Web Apps managed Functions cannot host Timer triggers, and calling the Entra-protected organiser HTTP endpoint from a background process would require a separate application-authentication design. The scheduler therefore runs as a dedicated Node 22 Azure Function on Flex Consumption and imports the same domain, repository and communication modules as the managed API.

The Function uses a system-assigned managed identity. It receives these development-resource-scoped roles:

- Storage Blob Data Owner for Function host locks and package deployment;
- Storage Queue Data Contributor for Functions host storage;
- Storage Table Data Contributor for the synthetic registration partition;
- Monitoring Metrics Publisher for Application Insights;
- Communication and Email Service Owner on the isolated development ACS resource, which is the available ACS built-in role supporting Entra-authenticated Email SDK access.

The ACS role is broader than send-only but is restricted to the disposable development Communication Service. No ACS connection string, Table SAS or function key is needed by scheduler application code. The Function administrative key is used only for controlled manual test invocation, passed in a header and never stored in Git or a URL.

## Reliability

The timer expression is `0 */30 * * * *`, has `useMonitor` enabled and does not run at startup. Azure's timer host lock prevents parallel timer listeners. Table updates use ETag-guarded retries. Reminder/expiry flags and persisted communication keys prevent repeated business actions. ACS receives a deterministic operation UUID derived from the communication idempotency key, protecting the external send when an otherwise successful provider call is retried around a storage conflict.

An execution failure is rethrown so Azure records a failed invocation. Due state is not committed when processing fails, allowing the next 30-minute execution to retry. Logs contain only the scheduled timestamp, result counts and error category—not runner payloads, contact details, private links or credentials.

## Monitoring

The registration state records `schedulerStatus.lastSuccessfulRunAt` and the most recent counts for reminders, expired offers, expired payments and next-offer creation. Application Insights and its Log Analytics workspace retain execution successes, failures and safe diagnostic traces for 30 days.

Example read-only checks:

```sh
az functionapp function list \
  --resource-group rg-blorenge-registration-dev-weu \
  --name func-blorenge-registration-scheduler-dev

az monitor app-insights query \
  --resource-group rg-blorenge-registration-dev-weu \
  --app appi-blorenge-registration-scheduler-dev \
  --analytics-query "requests | where timestamp > ago(7d) | where name contains 'registration-scheduled-work' | project timestamp, success, resultCode"
```

## Cost

At one invocation every 30 minutes, the normal maximum is about 1,488 executions in a 31-day month. Flex Consumption has no fixed compute minimum when always-ready instances remain zero. This is far below the subscription-level on-demand free grant of 250,000 executions and 100,000 GB-seconds per month. Storage transactions, package bytes, Application Insights ingestion and ACS messages remain usage-based. At this workload their expected normal development cost is negligible/pennies; the existing £1 resource-group budget remains proportionate. Costs must still be reviewed before reproducing the resources for production.

## Deployment and removal

Supply the existing safe-recipient and Azure-managed sender values securely when deploying the Bicep template. Never place them in a parameter file committed to Git.

```sh
az deployment group create \
  --resource-group rg-blorenge-registration-dev-weu \
  --template-file infrastructure/registration-development/main.bicep \
  --parameters registrationEmailSafeRecipients='<supplied-securely>' registrationEmailSender='<supplied-securely>'

node scripts/stage-registration-scheduler.mjs
npm ci --prefix .deployment/scheduler --ignore-scripts
# Zip the contents of .deployment/scheduler, then deploy with:
az functionapp deployment source config-zip \
  --resource-group rg-blorenge-registration-dev-weu \
  --name func-blorenge-registration-scheduler-dev \
  --src '<temporary-zip-path>'
```

For removal, delete only the development Function App, Flex plan, Application Insights resource, Log Analytics workspace, deployment container and their scheduler identity role assignments. Do not delete the shared registration Table, Static Web App or ACS resources.

## Controlled cloud proof

`REGISTRATION_SCHEDULER_TEST_NOW` is an optional development-only runtime override. It is rejected unless `REGISTRATION_ENVIRONMENT=development` and `REGISTRATION_SCHEDULER_ALLOW_TEST_TIME=true`. It is omitted from normal configuration, must be removed immediately after controlled proof, and no scheduler files or controls enter the production artifact.

## Phase 3B.2 cloud evidence

The controlled stable-development proof passed on 8 September 2026:

- the Azure-hosted management API loaded, amended and freshly reloaded one paid synthetic entry;
- Azure Table persistence contained one privacy-minimal amendment audit event and one external ACS receipt, and the authenticated organiser dashboard reflected the amended values;
- two synthetic waiting-list joins persisted in order and produced two redirected join receipts;
- releasing one synthetic confirmed place created one offer, one capacity reservation and one redirected offer receipt;
- the protected deployed Function ran at the controlled 24-hour point, delivered one reminder and processed zero reminders on an immediate repeat;
- at the controlled 48-hour point it expired the first offer, revoked the old link, reserved the same single place for the next runner and delivered the second offer;
- the old offer endpoint returned the generic unavailable response;
- all fixtures were removed, capacity returned to 120, operational state remained CLOSED, and a normal-time empty run processed zero actions.

After proof, `REGISTRATION_SCHEDULER_TEST_NOW` was removed and `REGISTRATION_SCHEDULER_ALLOW_TEST_TIME` was set to `false`. Production scheduler resources remain outstanding and require separate approval.
