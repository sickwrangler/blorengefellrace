# Manual intervention model

Choose the lowest level that can solve the problem. Escalating a level increases blast radius and approval requirements.

## Level 0 — Observe

Examples: public/status pages, organiser dashboard, start list, Azure metrics/logs/alerts, Stripe Dashboard, ACS diagnostics.

- Precautions: use read-only views; avoid exporting PII.
- Audit: record incident time and evidence, not secrets/runner payloads.
- Backup: not required.
- Pause/close: only if observations show integrity or sustained service risk.

## Level 1 — Normal organiser action

Examples: supported state transition, entry correction/cancellation, transfer, declaration action, refund request/decision/execution, race number, invitation management and approved export.

- Precautions: verify production banner, selected entry, intended action and confirmation text.
- Audit: application should record the action; add an incident note for exceptional overrides.
- Backup: recommended before bulk/high-risk actions; normally unnecessary for one validated edit.
- Pause/close: before uncertain capacity/payment repairs; not normally for routine single-entry work.

The dashboard does not currently expose operational state transition controls. The confirmation-protected authenticated endpoint is supported, but execution should use a reviewed operator command from a signed-in session.

## Level 2 — Provider/admin portal action

Examples: inspect Stripe Checkout/payment/refund/webhook; inspect ACS delivery; inspect Function status, Azure alerts and role assignment.

- Precautions: read first; understand application/provider ownership before retrying.
- Audit: retain provider IDs/status and operator decision privately.
- Backup: not normally for inspection; required before a provider action that needs data repair.
- Pause/close: if provider and application disagree or failures are accumulating.

## Level 3 — Controlled infrastructure intervention

Examples: app-setting change, credential rotation, temporary RBAC, validated snapshot, scheduler package release, reviewed code rollback.

- Precautions: explicit scope/approval, current backup where relevant, two-person review for secrets/state, planned verification and reversal.
- Audit: record who approved, resource/scope, time, result and cleanup.
- Backup: generally required for data-affecting or compatibility-sensitive work.
- Pause/close: generally yes when registration correctness could be affected.

## Level 4 — Break glass

Examples: direct storage investigation, guarded restore, controlled reconciliation repair after provider/data divergence.

- Precautions: `CLOSED`, scheduler suspended if necessary, current snapshot, payment reconciliation, minimal RBAC, tested repair, explicit approval.
- Audit: complete incident record and immutable before/after evidence without publishing PII.
- Backup: mandatory where technically safe.
- Pause/close: mandatory.

> **Direct editing of `RegistrationProduction` is not a normal organiser operation.**

Do not open Storage Explorer and change a field. The state is compressed/chunked, ETag-guarded and validated as a whole; raw edits can corrupt concurrency, capacity, audit, token and payment relationships. If the application lacks a safe operation, prefer adding and reviewing a controlled repair command/tool.

**No supported manual repair operation currently exists. Stop registrations and implement/review a controlled repair before modifying production state.**
