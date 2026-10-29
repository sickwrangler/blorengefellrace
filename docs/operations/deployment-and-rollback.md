# Deployment and rollback

## Local, GitHub and Azure

```text
local working folder ↔ local Git commits ↔ GitHub branch/PR → merged main
                                                        ↓
                                              GitHub Actions
                                                        ↓
                                    Azure Static Web App + managed API
```

- **Pull/fetch** obtains GitHub history; it does not deploy.
- **Commit** records local changes; it does not reach GitHub or Azure.
- **Push** updates a GitHub branch.
- **Pull request (PR)** presents the branch diff for review and runs validation.
- **Merge** adds approved work to `main`.
- A push to `main` triggers the production Static Web Apps workflow.

The repository currently reports `main` as not branch-protected, so process discipline and PR review are important.

## Exact production workflow

`.github/workflows/azure-static-web-apps-ambitious-bay-0339ed203.yml`:

1. checks out the triggering commit;
2. installs locked API/scheduler dependencies;
3. runs site, registration, route, photo, results and all Node tests;
4. simulates/stages the exact allowlisted production application/API and scheduler packages;
5. on **push to `main` only**, deploys the staged Static Web App and managed API.

Pull requests run validation but the current `if: github.event_name == 'push'` means they do **not** receive an Azure preview from this workflow. Do not promise a preview URL. At the verified baseline the staged boundary contains 71 application files, 18 API files and 17 scheduler files; the scheduler package is validated but not deployed by this workflow.

> **Deploying code does not normally change or delete production registrations.** Registration data is in a separate Azure Table partition.

> **Rolling back code does not roll back Stripe payments or registration data.** Provider and data reconciliation remains necessary.

Operational state is persisted data. A deployment setting, commit or opening date cannot switch it to `OPEN`.

## Safe normal release

1. Fetch current `main`; preserve unrelated local changes.
2. Create a dedicated `codex/...` branch.
3. Make one scoped change; scan for secrets/PII.
4. Run all relevant validators and the complete test suite.
5. Push the branch and open a PR into `main`.
6. Review the full diff and passing required checks; obtain approval.
7. Merge using the established merge-commit method; never force-push.
8. Watch the production Actions run through deployment.
9. Smoke-test pages, status/API boundaries, organiser authorization and changed journeys.
10. Confirm production state/data/providers remain as intended.

Scheduler/shared-domain changes require an additional controlled scheduler release because the normal workflow does not deploy the Function package. Do not assume a successful Static Web Apps run updated it.

## Bad release / rollback

1. If registrations may be harmed, move `OPEN` to `PAUSED` first.
2. Identify the exact failing deployment and a known-good compatible commit.
3. Inspect whether newer code wrote a schema or domain state the old code cannot safely read.
4. Reconcile any Stripe events/refunds that occurred during the incident.
5. Create a reviewed `git revert` of the offending commit(s) on a branch; open a PR.
6. Run the full production artifact/test suite and review the resulting forward commit.
7. Merge normally, watch Actions, and smoke-test while still paused.
8. Reopen only after data/provider compatibility is proven.

Never force-push or reset `main`. Never restore registration data merely to roll back code. A code rollback is dangerous when schema, tokens, payment reconciliation or domain transitions moved forward; in that case keep the service paused and implement a compatible forward fix or controlled migration.
