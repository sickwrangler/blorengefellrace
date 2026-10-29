# Emergency cheat sheet

> **If something is seriously wrong, stop new registrations first and diagnose before editing data.**

## Stop new registrations

Use the authenticated, audited state operation:

- from `OPEN`, change to `PAUSED` for a temporary incident;
- from `PRIVATE_LIVE`, change to `PAUSED` or `CLOSED` as appropriate;
- do not use `CLOSED_FINAL` unless entries are permanently finished—it cannot transition back.

The current dashboard shows state but does not provide a state-change button. The supported endpoint is `POST /api/v4/organiser/state`; it requires an authenticated user with literal role `organiser`, the current `expectedState`, and exact confirmation text `CHANGE <current> TO <new>`. Use it only from a signed-in production session or a reviewed operator command. Verify the result with `GET /api/v2/registration/status` and reload the public entry page.

Stopping registration rejects new orders. It does **not** delete runners, cancel paid entries, refund payments, disable Stripe, or redeploy code. Those are separate actions.

## Two-minute health check

1. Open the homepage and `/registration/` in a private browser.
2. Read `/api/v2/registration/status`; confirm `environment`, `operationalState`, capacity and counts.
3. Sign in to the organiser dashboard; confirm its count agrees with the public start-list count where expected.
4. Read `/api/v3/registration/status`; confirm Stripe and ACS modes.
5. In Stripe, check recent Checkout sessions, webhook deliveries and refunds.
6. In Azure, check the scheduler Function is Running and `OnDemandFunctionExecutionCount` is normally two per hour.
7. Check Application Insights, Log Analytics, the four alert rules and the action group.
8. Check `/registration/start-list.html` and `/api/v4/start-list` without exposing private data.

## Where to look first

| Symptom | First inspection |
|---|---|
| Website down | GitHub Actions production run, then Static Web App `BlorengeFellRace` |
| Form unavailable | Public status endpoint and operational state; then managed API health |
| Submission fails | Browser-visible validation, API response code, Application Insights request failure |
| Checkout fails | `/api/v3/registration/status`, Stripe availability and application logs |
| Paid but unconfirmed | Stripe Payment/Checkout, webhook delivery, then application audit/state |
| Email missing | Communication receipt, ACS send/status diagnostics, recipient/junk/bounce |
| Management link fails | Link age/revocation, exact email recovery flow, API response; never ask for the token |
| Dashboard fails | Entra sign-in, literal `organiser` role, anonymous API redirect/denial, managed API |
| Scheduler fails | Function state, execution-count metric, Function/App Insights logs |
| Start list wrong | Private dashboard record first, then `/api/v4/start-list` projection |
| Capacity wrong | Confirmed + payment reservations + live offer reservations; pause before repair |

## Never do these first

- Do not directly edit `RegistrationProduction` rows.
- Do not repeat a Stripe refund because the first application request appeared to fail. Check Stripe first.
- Do not ask a runner to pay twice until Checkout and webhook state are reconciled.
- Do not rotate or delete credentials casually during diagnosis.
- Do not run a development reset against production.
- Do not restore a backup while registration accepts writes.
- Do not infer payment success from the browser return page; Stripe webhooks and server state are authoritative.
- Do not redeploy merely to stop entries; deployment does not change operational state.
- Do not force-push `main` or replace production history.

If supported operations cannot repair the condition: remain `PAUSED`/`CLOSED` and state plainly, **No supported manual repair operation currently exists. Stop registrations and implement/review a controlled repair before modifying production state.**
