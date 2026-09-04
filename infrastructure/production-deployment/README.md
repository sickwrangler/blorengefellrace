# Proposed production artifact boundary

This directory is review-only. Nothing here is an active GitHub Actions workflow.

The proposal stages an exact public allowlist with `node scripts/stage-deployment-artifacts.mjs production`, validates its complete contents, and gives Azure Static Web Apps only `.deployment/production`. Registration, API, organiser, fixture, documentation, infrastructure, test, development-script, package, workbook, local-store and backup paths are therefore absent rather than merely hidden by routes.

## Proposed rollout

1. Review the generated file list and workflow diff.
2. Obtain explicit approval to modify the active production workflow.
3. Apply only the reviewed workflow change on `codex/development` and let the PR preview validate the public artifact.
4. Reconfirm that registration URLs return 404 and public pages match production before considering merge.

## Rollback

If validation or staging fails, the workflow stops before upload and the current production deployment remains in place. If a successfully uploaded artifact has a defect, restore the last known-good allowlist/staging commit and redeploy that allowlisted artifact. Do not fall back to deploying repository root after registration source exists on `main`, because that would remove the production boundary.
