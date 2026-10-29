# Environments

## Production

| Item | Current production |
|---|---|
| Purpose | Real 2026 registrations and public website |
| URL | <https://www.blorengefellrace.cymru> |
| Static Web App | `BlorengeFellRace` in resource group `Blorenge` |
| Storage | `stblorengeregprodc1b64c` |
| Table / partition | `RegistrationProduction` / `blorenge-2026-live` |
| Stripe | Live, enabled |
| Email | ACS production, enabled |
| Scheduler | `func-blorenge-registration-scheduler-prod-c1b64c` |
| Data | Real private runner/payment-operational data |
| State at 26 September verification | `PRIVATE_LIVE` |
| Juniors | Disabled |

Production `main` commit at verification was `2b4a4d17d6b17d42727650a4855135e78e4349ba`. Read the live status endpoint rather than assuming a count or state from this document.

## Development

| Item | Isolated development |
|---|---|
| Purpose | Synthetic testing only |
| URL | <https://black-tree-04204eb03.3.azurestaticapps.net> |
| Static Web App | `swa-blorenge-registration-dev` in `rg-blorenge-registration-dev-weu` |
| Storage | `stblorengeregdev2026` |
| Table / partition | `RegistrationDevelopment` / `blorenge-2026-test` |
| Stripe | Test mode; test credentials only |
| Email | Controlled development adapter: configured safe-recipient redirection or captured-only, never unrestricted runner delivery |
| Scheduler | `func-blorenge-registration-scheduler-dev` |
| Data | Synthetic data only; reset is permitted through development controls |

Development also has separate ACS/ECS, Log Analytics, Application Insights and Flex plan resources named with `-dev`/`development` identifiers. It must never use production storage, live Stripe keys or genuine runner details.

## How not to confuse them

- Read the hostname and visible environment banner before every organiser/test action.
- Production APIs validate environment and reject names containing development/test identifiers; development rejects live Stripe keys.
- Production artifacts omit fixture, reset, mock-payment, local-bypass and synthetic browser storage controls.
- Development reset deletes synthetic test state only. There is no production reset route.
- A development invitation/link does not authorise production and vice versa.
- Never copy app settings wholesale between environments.
- Do not test production with made-up runner data once it is live unless a specifically approved, fully reconciled provider proof is planned.

The public production custom hostname is canonical. The Azure-generated production hostname is operational fallback information, not a runner-facing URL. The stable development hostname must never be presented as the real entry site.
