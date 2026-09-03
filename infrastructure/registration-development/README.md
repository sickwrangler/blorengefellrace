# Registration development infrastructure

The explicitly approved isolated development resources were provisioned on 3 September 2026. They contain synthetic registration test data only and do not reference the production Static Web App.

The resource group contains exactly one Free Azure Static Web App with managed Functions and one Standard LRS StorageV2 account with one Table. It deliberately excludes a standalone Function App, hosting plan, Application Insights, Log Analytics, private endpoints and backup containers. See [`../../docs/internal/registration-azure-approval-pack.md`](../../docs/internal/registration-azure-approval-pack.md) for boundaries, costs, commands and rollback.

`main.bicep` creates the two Azure resources and Table. `budget.bicep` creates the £1 monthly resource-group budget. `azure-static-web-apps-registration-development.proposed.yml` remains the reviewed reference copy of the active development-only workflow.

The Static Web App and Storage account are co-located in West Europe. Deployment is restricted to `codex/development`; the API requires the server environment and registration state to be `development` and `test`.
