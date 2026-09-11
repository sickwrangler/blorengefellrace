# Phase 3B development provider setup

This runbook is for the isolated development environment only. Do not reuse production/live provider credentials and do not paste secret values into issues, pull requests, logs or repository files.

## Stripe test mode

1. In a Stripe account controlled by the organiser, obtain a test-mode server key.
2. Register the development endpoint `/api/v3/stripe/webhook` for the reviewed event types in `docs/registration-phase3b.md`.
3. Place the server key and endpoint signing secret in Azure runtime configuration.
4. Leave `STRIPE_ENABLED=false` until the Phase 3 deployment and disabled-provider checks have passed. Keep `ACS_EMAIL_ENABLED=false` until controlled email is configured and separately approved.
5. Use Stripe test card data only on Stripe-hosted Checkout.

The API rejects live secret/restricted-key prefixes in development. Do not place a publishable key or mode selector in the browser.

## Azure Communication Services Email

1. Sign in to the approved Azure development subscription and inventory existing Communication Services/Email resources before creating anything.
2. If none exists, review current regional availability and pricing, then create only isolated development resources after approval.
3. Prefer an Azure-managed sending domain for this phase.
4. Configure either a supported managed identity endpoint or a runtime-only connection string; do not upgrade hosting solely for managed identity without approval.
5. Configure one or more organiser-approved safe recipients in runtime settings. Do not commit the addresses.
6. Send a single synthetic confirmation and verify the actual recipient is the safe address, never the form-entered address.

If the sender, authentication or safe-recipient configuration is incomplete, delivery remains captured-only.

## Stable deployment prerequisites

- Azure CLI sign-in and access to the existing isolated development resources.
- Stripe test-mode account access and webhook configuration.
- Approved ACS sender and safe test recipient.
- Reviewed Phase 3 state initialization/migration that cannot import production or genuine runner information.
- Passing tests, dependency audit, secret scan and production artifact boundary.
