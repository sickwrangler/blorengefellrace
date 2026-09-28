# Deployment

Current production deployment details. Operational release/rollback instructions are in [operations/deployment-and-rollback.md](operations/deployment-and-rollback.md).

## Production

- Public URL: <https://www.blorengefellrace.cymru/>
- Azure Static Web App: `BlorengeFellRace` (Free), resource group `Blorenge`
- GitHub repository: `sickwrangler/blorengefellrace`
- Production branch: `main`
- Verified baseline: `2b4a4d17d6b17d42727650a4855135e78e4349ba`

The production application is not merely the repository root. `scripts/stage-deployment-artifacts.mjs production-registration` builds an exact allowlisted artifact containing the static public site, production registration browser files and managed API. It excludes documentation, infrastructure, tests, fixtures, development clients/reset controls and private files.

## GitHub Actions

`.github/workflows/azure-static-web-apps-ambitious-bay-0339ed203.yml` runs on pull requests and pushes affecting `main`. It installs locked API/scheduler packages and runs all validators/tests. Pull requests currently validate only; deployment is guarded by `github.event_name == 'push'`, so no Azure PR preview is created by this workflow.

After an approved merge/push to `main`, it deploys:

- `.deployment/production-registration/app` as the Static Web App;
- `.deployment/production-registration/api` as managed Functions.

At the verified baseline, the allowlists contain 71 application files and 18 API files. The workflow also produces a 17-file production scheduler package for validation, but it does **not** deploy that package to the external Function App. Scheduler changes need a separate controlled Azure release.

## Production data and settings

Deployment does not normally change/delete registrations. Authoritative state is separate in Azure Table `RegistrationProduction`, partition `blorenge-2026-live`. Stripe payment/refund records are external. App settings, secrets, ACS resources, scheduler configuration and operational state are not changed by ordinary content deployment.

The merge-to-`main` Static Web Apps workflow validates and stages the browser site, managed API and external scheduler artifacts, but deploys only the browser site and managed API. Changes under `scheduler/` require a separate controlled deployment to the production Function App. Changes under `infrastructure/registration-production/`, including monitoring alerts, require a separate reviewed Bicep infrastructure deployment. A successful Static Web Apps merge deployment must not be described as having deployed either of those components.

Rolling code back does not roll back Table data or Stripe. Review schema/domain compatibility and reconcile providers before a revert. Never force-push `main`.

## Scheduler deployment

The external scheduler is `func-blorenge-registration-scheduler-prod-c1b64c`. Its package belongs in private container `scheduler-app-package` and its runtime/configuration are infrastructure operations. The repository currently has no active GitHub step that publishes the staged scheduler package. Do not infer scheduler deployment from a green Static Web Apps run.

## Development

The stable synthetic environment uses a separate workflow, Static Web App, managed API, storage, Stripe test mode and scheduler. A push to `codex/development` within configured paths deploys that isolated environment. It must never receive production credentials/data.

## Public boundary

Operational documentation under `docs/`, infrastructure, scripts, tests, package metadata and source server modules are excluded from the production artifact. `/docs/...` and internal operational files must return 404 publicly.
