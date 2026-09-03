# Registration development infrastructure proposal

Review only: no file in this directory is an active deployment workflow and none of these resources has been created by this proposal.

The proposed resource group contains exactly one Free Azure Static Web App with managed Functions and one Standard LRS StorageV2 account with one Table. It deliberately excludes a standalone Function App, hosting plan, Application Insights, Log Analytics, private endpoints and backup containers. See [`../../docs/internal/registration-azure-approval-pack.md`](../../docs/internal/registration-azure-approval-pack.md) for boundaries, costs, commands and rollback.

`main.bicep` creates the two Azure resources and Table. `budget.bicep` creates a separate £1 monthly resource-group budget when the subscription supports budgets. `azure-static-web-apps-registration-development.proposed.yml` is inert at this path; after explicit approval it would be copied unchanged into `.github/workflows/`.

The proposed Static Web App and Storage account are co-located in West Europe. Proposed exact names are subject to the mandatory read-only name-availability and subscription-policy checks in the approval pack.
