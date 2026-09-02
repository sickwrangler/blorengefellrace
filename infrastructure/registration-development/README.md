# Registration development infrastructure proposal

Review only: nothing in this directory has been applied.

Proposed UK South resources are a dedicated development resource group, locally redundant general-purpose storage account with one Table, Azure Functions consumption/Flex application with managed identity, Microsoft Entra application/role assignments, Application Insights/Log Analytics, protected backup export, and a £10 monthly budget alert. Development and production must use separate resource groups, identities, settings and stores.

The committed Bicep proposes storage/Table, a private backup container, consumption Function App with system identity, least-privilege Table/Blob data roles, Application Insights and Log Analytics. Entra tenant registration/group assignments and Static Web App/API linkage remain approval-time operations. Public network access is proposed initially for HTTPS Azure service access with Entra authorization and no shared keys; private endpoints would materially increase cost and complexity and should be reconsidered during security review.

Estimated light-development cost is £0–£5/month and could be near zero under applicable consumption allowances. Budget £10/month until measured. Assumptions: approximately 110 annual entries, under 50,000 monthly API calls during testing, under 1 GB storage and low telemetry volume. Verify [Functions](https://azure.microsoft.com/pricing/details/functions/), [Tables](https://azure.microsoft.com/pricing/details/storage/tables/), [Monitor](https://azure.microsoft.com/pricing/details/monitor/) and calculator prices immediately before deployment.

Commands that would create the proposed subset, after replacing placeholders and obtaining explicit approval:

```sh
az group create --name <approved-development-resource-group> --location uksouth --tags workload=registration environment=development
az deployment group what-if --resource-group <approved-development-resource-group> --template-file infrastructure/registration-development/main.bicep --parameters infrastructure/registration-development/parameters.example.json
az deployment group create --resource-group <approved-development-resource-group> --template-file infrastructure/registration-development/main.bicep --parameters infrastructure/registration-development/parameters.example.json
az consumption budget create --budget-name registration-development --amount 10 --category cost --time-grain monthly --resource-group <approved-development-resource-group> --start-date <YYYY-MM-01> --end-date <YYYY-MM-01>
```

The removal command would delete only the explicitly named development resource group, after exporting and verifying any required backup:

```sh
az group delete --name <approved-development-resource-group> --yes --no-wait
```

Rollback: keep production unchanged; disable the development API deployment, export the development Table, remove role assignments, detach the preview API, verify the static preview still works, then delete the named development resource group. Never reuse the development store or identity for production.
