# Production registration infrastructure

> **Current status:** the production infrastructure described by this directory was deployed during Phase 3C. The “review only/proposed” comments retained in the original Bicep/proposed workflow record the pre-deployment gate; they are not a statement that production is absent. Use [the operations resource inventory](../../docs/operations/resource-inventory.md) for verified live names and [the operations handbook](../../docs/operations/README.md) for procedures.

Do not redeploy this template merely to align documentation or repair a runtime incident. Any future infrastructure change requires a reviewed plan/diff, production approval and compatibility checks.

## Verified live resources

In resource group `rg-blorenge-registration-prod-weu`:

- storage: `stblorengeregprodc1b64c`;
- table/partition: `RegistrationProduction` / `blorenge-2026-live`;
- private containers: `registration-backups`, `scheduler-app-package` and Functions host containers;
- ACS: `acs-blorenge-registration-prod-c1b64c`;
- Email Communication Service/domain: `ecs-blorenge-registration-prod-c1b64c` / `AzureManagedDomain`;
- scheduler/plan: `func-blorenge-registration-scheduler-prod-c1b64c` / `asp-blorenge-registration-scheduler-prod-c1b64c`;
- logs/telemetry: `log-blorenge-registration-prod-c1b64c` / `appi-blorenge-registration-prod-c1b64c`;
- action group: `ag-blorenge-registration-prod-c1b64c`;
- four registration scheduled-query alerts.

The existing Static Web App `BlorengeFellRace` remains in resource group `Blorenge`; it was not created by this template.

## Runtime boundaries

The managed Static Web Apps API uses a scoped Table SAS because managed identity is unavailable to managed Functions in this design. The external scheduler uses its own system-assigned managed identity. Storage is production-only; public blob access is disabled, versioning is enabled, and soft-delete retention is 35 days.

The scheduler runs Node 22 on Flex Consumption every 30 minutes. ACS external delivery, Stripe live and the managed API are configured separately in their owning Azure resources; do not put their secret values in parameters or this repository.

## Deployment boundary

The active production GitHub workflow deploys the allowlisted Static Web App and managed API from `main`. It stages/validates the production scheduler artifact but does not publish it to the external Function App. Scheduler release is a separate controlled infrastructure operation.

`parameters.example.json` contains placeholders only. The separate subscription-scope budget is deployed as `budget-blorenge-registration-production`; it alerts but does not cap spending or change registration state.
