# Production registration infrastructure — review only

These Phase 3C.1A files describe isolated production registration resources in West Europe. They have not been deployed. Do not run an Azure deployment until the Phase 3C.1B gates and manual inputs in the deployment runbook are approved.

## Proposed names

Choose a short lowercase `nameSuffix` at deployment time. Bicep then proposes:

- resource group: `rg-blorenge-registration-prod-weu` (created outside this resource-group template);
- storage: `stblorengeregprod<suffix>`;
- table: `RegistrationProduction`;
- event partition: `blorenge-2026-live`;
- backup container: `registration-backups`;
- ACS: `acs-blorenge-registration-prod-<suffix>`;
- Email Communication Service: `ecs-blorenge-registration-prod-<suffix>`;
- scheduler: `func-blorenge-registration-scheduler-prod-<suffix>`;
- Flex plan: `asp-blorenge-registration-scheduler-prod-<suffix>`;
- logs: `log-blorenge-registration-prod-<suffix>`;
- Application Insights: `appi-blorenge-registration-prod-<suffix>`;
- action group: `ag-blorenge-registration-prod-<suffix>`.

The production Static Web App remains the existing Free-plan application. This template does not modify it, its custom domain or its current deployment.

## Separation and defaults

Storage, partitions, ACS, scheduler, identities and monitoring are production-only. The scheduler has zero always-ready instances, runs every 30 minutes from its code timer, and starts with external email disabled. The runner API is a managed Static Web Apps API and will use a revocable, table-scoped SAS supplied later through application settings because managed identity is unavailable to managed Functions. The scheduler uses its own system-assigned managed identity.

The template does not contain provider secrets, organiser identities or alert addresses. `parameters.example.json` contains placeholders only. The budget is a separate subscription-scope deployment so provisioning cannot also open registration.

## Validation only

Before approval, compile without deploying:

```sh
az bicep build --file infrastructure/registration-production/main.bicep
az bicep build --file infrastructure/registration-production/budget.bicep
```

Do not run `az deployment` during Phase 3C.1A.
