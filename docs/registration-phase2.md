# Registration Phase 2 development system

Phase 2 remains synthetic, closed and isolated on PR #8. It does not provision Azure, accept real entrants, take payments, send email or provide production authentication.

## Components

- `registration/server/service.mjs`: normalized domain/application service and server validation.
- `registration/server/api.mjs`: versioned public and organiser API routing.
- `registration/server/repositories.mjs`: isolated-memory, persistent-local and proposed Azure Table repository contracts.
- `registration/server/auth.mjs`: role permissions and loopback-only development identity.
- `registration/server/adapters.mjs`: mock payment and captured-email adapters.
- `.local-registration/development.json`: ignored, permission-restricted persistent synthetic store.

The local runner and organiser pages use `/api/v2`. The Azure PR preview deliberately retains the Phase 1 browser repository until persistent Azure storage and identity are approved. Deploying an ephemeral API would misrepresent persistence. Production has neither registration pages nor API routes.

## Versioned endpoints

Public: status, create with idempotency key, opaque-token confirmation, mock-payment retry and amendment/cancellation request.

Organiser: filtered snapshot/totals, single entry, state control, race-number actions, cancel/promote/refund/correct, audit history, public/private export, synthetic import, anonymise/delete and development reset. Every organiser endpoint requires an authorization decision.

## Organiser access

The proposed shared development environment has one custom role, `Organiser`. It covers all prototype dashboard operations and is assigned by a time-limited Microsoft Entra invitation. The API must independently require the platform principal and role on every private endpoint. Additional roles are deferred until real operational responsibilities justify them.

The existing local harness can emulate narrower permission sets for tests. Its bypass requires loopback, environment `local` and an explicit development header; it fails closed everywhere else and is not part of the Azure deployment.

## Data and privacy

The normalized collections are event, runner, emergency contact, registration, payment, consent, communication, audit, idempotency and amendment request. Email is not a key. Confirmation tokens are stored as hashes. Audit records contain identifiers and minimal before/after values, never full form payloads.

Payment states are created, pending, paid, failed, abandoned and refunded. Partial refunds are deliberately excluded at this scale until a real payment/refund policy requires them. Communication records include template, recipient reference/address, captured status, creation/send timestamps, provider reference, failure and retry fields; Phase 2 never sends them externally.

Public-result exports allowlist name, club, category and race-management fields. Private exports are clearly warned and named under the ignored `private-exports/` directory. CSV cells beginning with spreadsheet-formula characters are neutralized. Emergency contacts and selected contact/eligibility fields are flagged as post-event deletion candidates. Payment status/reference metadata may require a separately approved financial-retention period. Postal address and medical information remain excluded.

## Local commands

Start website, API, persistent store, captured-email adapter and mock payment adapter:

```sh
node scripts/start-registration-phase2.mjs
```

Open `http://127.0.0.1:4173/registration/`. Data survives page, browser and server restarts.

Reset only when deliberate:

```sh
node scripts/reset-registration-phase2.mjs
```

Create and restore an ignored synthetic backup:

```sh
node scripts/backup-registration-phase2.mjs
node scripts/restore-registration-phase2.mjs registration-backups/<backup-file>.json
```

The local store, private exports and backups are ignored by Git. Use synthetic data only.
