# Registration development operational reminder

The isolated registration-development environment contains synthetic information only and must remain in server-side `development` / `test` mode.

The Table access policy expires on 31 December 2026 at 23:59 UTC. Before that time, either rotate the development-only Table SAS through the approved operational process or remove the isolated development environment if it is no longer required. Never record the SAS token, storage key, account details or personal organiser identity in this repository.

The organiser **Reset test** action resets the synthetic data model, including runners, emergency contacts, registrations, mock payments, consents, captured communications, audit events, idempotency records and amendment requests. It recreates the existing event configuration in `test` mode and does not delete the Table, Storage account, Static Web App or resource group.

Detailed credentials, access records and account-specific operational evidence are maintained outside the public website and repository.
