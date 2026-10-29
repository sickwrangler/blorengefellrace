# Security and secrets

## Where configuration lives

Production managed-API settings are in Azure Static Web Apps application settings. Scheduler settings are in the production Function App, with managed identity used for Table/host storage and ACS where applicable. GitHub Actions holds the Static Web Apps deployment token as a repository secret. Stripe also stores the configured webhook endpoint/signing secret relationship.

Document names and purpose, never values:

| Name | Purpose | Secret? |
|---|---|---|
| `REGISTRATION_ENVIRONMENT` | Must be `production` or `development` for the respective adapter | No |
| `REGISTRATION_STORAGE_ACCOUNT` | Storage account name | No, but operational |
| `REGISTRATION_TABLE` | Table name | No |
| `REGISTRATION_EVENT_PARTITION` | Isolated event partition | No, but operational |
| `REGISTRATION_TABLE_SAS_TOKEN` | Managed API's scoped Table credential | **Yes** |
| `REGISTRATION_TABLE_SAS_EXPIRES_AT` | Non-secret UTC expiry metadata used for 30/14/7-day warnings | No |
| `REGISTRATION_PUBLIC_BASE_URL` | Canonical public URL used in secure links | No |
| `REGISTRATION_MAX_RUNNERS_PER_ORDER` | Server order limit | No |
| `REGISTRATION_UNDER18_ENABLED` | Junior-entry launch gate | No |
| `STRIPE_ENABLED` | Enables production Stripe adapter | No |
| `STRIPE_SECRET_KEY` | Server live/test API key appropriate to environment | **Yes** |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Verifies Stripe event signatures; not an API key | **Yes** |
| `ACS_EMAIL_ENABLED` | Enables external ACS send | No |
| `ACS_EMAIL_ENDPOINT` | ACS service endpoint | No, but operational |
| `ACS_EMAIL_CONNECTION_STRING` | ACS access credential when used by managed API | **Yes** |
| `REGISTRATION_EMAIL_SENDER` | Approved From address | No, but controlled |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Telemetry routing; treat as sensitive configuration | Sensitive configuration |

GitHub secret name `AZURE_STATIC_WEB_APPS_API_TOKEN_AMBITIOUS_BAY_0339ED203` authorises deployment; never copy its value. Secure management, declaration, order and invitation tokens belong only in their intended URL/browser/email flow and must not appear in docs, logs or issues.

## Core rules

- Never paste secrets into documentation, chat, screenshots, issues, PR descriptions or shell history.
- Never commit `.env` files, exported app settings, storage state, private CSVs or provider payloads.
- Production Stripe requires `sk_live_…`; development accepts test credentials and rejects live credentials. Never cross them.
- A publishable Stripe key is not a server secret, but this application does not need it for Checkout creation.
- The webhook signing secret verifies incoming events; it cannot replace the Stripe API key.
- Scheduler managed identity removes the need to copy Table/ACS credentials into its code.
- Human data-plane access should be temporary, narrowly scoped and revoked/verified after use.

## Credential rotation checklist

1. Identify the exact exposed/expiring credential, environment, dependencies and blast radius.
2. If payment/data integrity might be affected, pause registration.
3. Record approval and recovery plan; take a validated snapshot for data-affecting work.
4. Create/regenerate the new credential in its provider without publishing it.
5. Update only the correct Azure/GitHub secret setting; do not echo/list the value.
6. Restart/redeploy only if that setting requires it.
7. Verify a safe health path: storage status read, Stripe signed webhook/provider status, ACS controlled send, or deployment as appropriate.
8. Revoke the old credential and prove it no longer authorises the intended operation.
9. Check logs/provider audit for misuse and remove temporary files/shell variables.
10. Record names, timestamps and result—not values—and reopen only after verification.

For a leaked secure runner URL, rotate/recover that link through the application rather than rotating infrastructure credentials. For a leaked function/deployment/storage key, treat it as Level 3/4 and review logs and scope.

## Production Table SAS review and renewal

The production managed API uses an HTTPS service SAS scoped to the production table and associated with a stored access policy. The policy currently expires **31 January 2027 at 23:59:59 UTC** and grants `raud` (read/query, add, update and delete). The token is table-scoped but not restricted to the one event partition or row. Read/add/update are required by the bootstrap and `Replace` model; delete is not used by normal application code and is a least-privilege improvement to consider at the next controlled rotation. Do not rotate the healthy live credential solely to remove it during active registration.

Because a stored-policy SAS inherits expiry and permissions from the server-side policy, those fields are intentionally absent from the token itself. Review policy metadata through the Azure management-plane table resource or a principal with the narrow `getAcl` action; never use or display the storage account key merely to inspect it. Set `REGISTRATION_TABLE_SAS_EXPIRES_AT` to the matching UTC timestamp. The managed API emits safe markers at 30, 14 and 7 days and an explicit unknown-metadata marker if the setting is absent. The production alert routes these markers to the existing action group.

Renewal must begin before the 30-day warning. Create/update the stored policy with a reviewed finite expiry and only required permissions, mint the replacement SAS without displaying it, update the encrypted Static Web App setting, verify read plus a natural legitimate write, then invalidate the old policy/signature. Update the non-secret expiry setting and recheck the 30/14/7-day monitor. A policy change may take up to 30 seconds to propagate; do not repeatedly rewrite application state during that interval.
