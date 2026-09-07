# Registration development infrastructure

The explicitly approved isolated development resources were provisioned on 3 September 2026. They contain synthetic registration test data only and do not reference the production Static Web App.

The resource group contains one Free Azure Static Web App with managed Functions, one Standard LRS StorageV2 account with one Table, and the development-only Azure Communication Services resources required for controlled email: one Communication Service, one Email Communication Service and its Azure-managed domain. Email is usage-based and is redirected to the runtime allowlist. The group deliberately excludes a standalone Function App, hosting plan, Application Insights, Log Analytics, private endpoints and backup containers. See [`../../docs/internal/registration-azure-approval-pack.md`](../../docs/internal/registration-azure-approval-pack.md) for the original boundaries and rollback.

`main.bicep` creates the two Azure resources and Table. `budget.bicep` creates the £1 monthly resource-group budget. `azure-static-web-apps-registration-development.proposed.yml` remains the reviewed reference copy of the active development-only workflow.

The Static Web App and Storage account are co-located in West Europe. Deployment is restricted to `codex/development`; the API requires the server environment and registration state to be `development` and `test`.

ACS and Email Communication Services use the Europe data location and an Azure-managed sender domain; no public DNS change is required. Managed Static Web Apps Functions do not expose a usable workload identity for this SDK integration, so the development service currently authenticates with a connection string held only in Static Web App secret settings. The code never returns it, and missing sender/authentication/recipient settings fall back to captured-only delivery.
