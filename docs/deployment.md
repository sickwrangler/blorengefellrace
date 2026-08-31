# Deployment

## Production path

Production is an Azure Static Web App reached at `https://www.blorengefellrace.cymru/`. DNS CNAME evidence maps `www.blorengefellrace.cymru` to `ambitious-bay-0339ed203.5.azurestaticapps.net`.

The workflow `.github/workflows/azure-static-web-apps-ambitious-bay-0339ed203.yml` automatically deploys:

- every push to `main` to the production environment;
- pull requests targeting `main` to Azure preview environments; and
- a PR-close event to remove its preview environment.

The workflow checks out the triggering commit and calls `Azure/static-web-apps-deploy@v1` with:

- `app_location: "/"`
- `api_location: ""`
- `output_location: ""`

There is no dependency installation, build command, runtime, startup command, API deployment, or database migration. Azure serves the source files directly.

## Current production identity

As audited on 31 August 2026:

- deployment branch: `main`;
- GitHub/local SHA: `25e996d4d64d730a79fc40512a8a01274c75f530`;
- Azure workflow run: successful, 26 June 2026;
- deploy job and every deploy step: successful;
- production `Last-Modified`: 26 June 2026 immediately after the workflow;
- sampled production application files: byte-for-byte equal to the same local/GitHub commit.

Conclusion: production is synchronized with `main` at `25e996d`. This is high-confidence evidence, although the application does not expose its own runtime SHA.

## Required secrets and permissions

Names only:

- `AZURE_STATIC_WEB_APPS_API_TOKEN_AMBITIOUS_BAY_0339ED203`
- `GITHUB_TOKEN` (automatically provided by GitHub Actions)

Do not copy token values into documentation, source files, logs, or support messages.

## Environments

- Production: Azure Static Web Apps custom domain above.
- PR preview: configured automatically for PRs into `main`; PR #1's Azure workflow succeeded. The preview URL was not visible in unauthenticated public metadata.
- Permanent development app: not found.
- Azure App Service deployment slot: not found and not normally applicable to Static Web Apps.
- GitHub Pages: its deployment workflow also runs on `main`, but production DNS does not point to it. Its purpose is unconfirmed.

## Azure portal verification checklist

Azure CLI and an authenticated Azure session were unavailable during the audit. In the Azure portal, open **Static Web Apps** and verify the following without changing settings:

1. Resource display name, subscription, resource group, region, SKU, and resource tags.
2. **Overview**: default hostname equals `ambitious-bay-0339ed203.5.azurestaticapps.net` and the connected GitHub repository is `sickwrangler/blorengefellrace`.
3. **Deployment history / GitHub Actions**: production environment branch is `main`; latest production deployment SHA is `25e996d4d64d730a79fc40512a8a01274c75f530`; timestamp and status match the successful 26 June 2026 workflow.
4. **Environments**: list active preview environments, including any created for PR #1; note their commit, URL, age, and whether stale environments exist.
5. **Custom domains**: `www.blorengefellrace.cymru` is validated, its TLS certificate is active, renewal is healthy, and determine whether the apex domain redirects or is separately configured.
6. **Configuration**: record application settings by **name only**; do not export or reveal values. None are required by the repository as written.
7. **Role assignments**: confirm least-privilege owners/contributors and remove no one during the audit.
8. **Monitoring/logs**: review recent availability, 4xx/5xx rates, bandwidth, deployment failures, and custom-domain/TLS warnings.
9. **Linked resources**: confirm whether any Function API, database, storage account, Application Insights resource, or other service is linked. None is referenced by the code.
10. **Deployment token**: confirm it is stored only as the expected GitHub Actions secret and note its rotation policy; do not display it.

## Safe deployment procedure for future changes

This describes the existing mechanism; it is not authorization to deploy.

1. Start from a freshly fetched, clean worktree and a non-production branch.
2. Run the checks in `local-development.md`.
3. Open a pull request targeting `main` and inspect the Azure preview environment without submitting forms.
4. Require review and successful checks.
5. Merge only with explicit approval; the merge/push to `main` automatically deploys production.
6. Confirm the workflow SHA and production files, then perform non-destructive smoke tests.
7. If unhealthy, prefer reverting the faulty commit through a reviewed pull request rather than manually changing Azure content.

## Known deployment risks

- Unprotected `main` plus automatic deployment makes an accidental push a production event.
- `routes.json` converts unknown paths into homepage HTTP 200 responses.
- No automated test/validation gate exists.
- `actions/checkout@v3` should be reviewed for a future, separately approved workflow update.
- The GitHub Pages deployment creates ambiguity and should be understood before it is changed.

