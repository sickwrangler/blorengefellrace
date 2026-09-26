# Backup and recovery

## Current architecture

Authoritative state is stored in Azure Table `RegistrationProduction`, partition `blorenge-2026-live`. Private snapshot blobs belong in `registration-backups` within `stblorengeregprodc1b64c`. The container is not public. Blob versioning and 35-day blob/container soft deletion are enabled.

The repository defines backup format `blorenge-registration-backup-v1`: creation time, reason, source ETag, schema version, SHA-256 checksum and complete validated state. Names use an ISO-like timestamp (colons replaced with hyphens), a UUID and `.json`.

The code declares manual pre-launch/significant-change/pre-race backups and a daily 02:00 UTC policy while active. However, the backup service module is not in the current managed API or 17-file scheduler deployment allowlist. Therefore **automatic daily production snapshot creation is not currently verified**. The private container and previously controlled snapshots are not proof of a recurring job. Blob contents were intentionally not listed during this documentation audit because the operator identity has no standing data-plane access.

## Controlled snapshot procedure

Prerequisites: explicit approval, production identity confirmed, private temporary directory, no output/logging of state, and a reason for the snapshot. Closing registration is prudent before high-risk/bulk work; a read-only snapshot during stable operation need not mutate state.

Use temporary RBAC only:

- `Storage Table Data Reader`, scoped as narrowly as Azure supports to the production `RegistrationProduction` table;
- `Storage Blob Data Contributor`, scoped only to `registration-backups`.

Then:

1. Create a mode `0700` temporary directory outside the repository; files are mode `0600`.
2. Read the one production state partition without printing it.
3. Validate environment, schema, state and invariants.
4. Create the versioned snapshot envelope and SHA-256 checksum.
5. Upload with create-only semantics to the private container.
6. Download the blob again to the protected directory.
7. Recalculate checksum, parse/validate format and confirm invariants.
8. Securely remove every local copy and the temporary directory.
9. Revoke both temporary assignments immediately.
10. List assignments to prove no residual access from those grants.

Do not use storage account keys as a workaround. Record snapshot name, time, reason, checksum result and role revocation—not state contents.

## Restore is break glass

Before restore:

- move production to `CLOSED`; stop new writes;
- suspend the scheduler if it could mutate the state;
- open an incident record and obtain explicit organiser approval;
- reconcile all newer Stripe payments/refunds and webhook events;
- select and checksum-validate a compatible **CLOSED** snapshot;
- take a snapshot of the current damaged state first where safe;
- prove schema/code compatibility and define rollback verification.

The guarded restore design requires exact confirmation `RESTORE <snapshot-name>`, `writesSuspended=true`, `schedulerSuspended=true`, current state `CLOSED`, backup state `CLOSED`, valid checksum/state and explicit payment reconciliation approval. It uses the current ETag so concurrent change fails rather than overwrites.

Restoring a snapshot while Stripe contains newer payment activity can resurrect released places, lose confirmations, duplicate operational actions or separate application state from money movement. Do not restore until reconciliation is complete.

After restore, validate counts/capacity, every invariant, public start-list projection, organiser reads and Stripe/refund consistency. Resume the scheduler, remain `CLOSED`, and reopen only with separate approval.

If the current deployed tooling cannot perform the required guarded restore: **No supported manual repair operation currently exists. Stop registrations and implement/review a controlled repair before modifying production state.**
