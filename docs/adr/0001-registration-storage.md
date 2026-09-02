# ADR 0001: Phase 2 registration hosting and storage

Status: proposed; no Azure resources have been created.

## Decision

For an isolated future development environment, use an Azure Functions application with a system-assigned managed identity and Azure Table Storage. Keep the public static site separate. Put all records for one event in one table partition and use ETag-guarded transactional batches for the event counter, registration, waiting-list and race-number-lock entities.

This is the smallest option that fits roughly 110 annual registrations while providing atomic final-place allocation, deterministic waiting-list sequence numbers, replaceable storage, inexpensive point/query access and deletion by opaque identifier. A local JSON repository uses the same transaction contract for development; tests use isolated memory.

## Options considered

| Option | Concurrency and reporting | Operations and cost | Decision |
|---|---|---|---|
| Static Web Apps managed API plus Table Storage | Table transactional batches and ETags can enforce capacity within one event partition. Managed API deployment is simple, but managed identity/storage integration and independent API lifecycle are more constrained. | Low usage cost and low operational burden. | Viable, but not preferred for the protected organiser boundary. |
| Azure Functions plus Cosmos DB serverless | Strong transactional batch within a logical partition, flexible queries and straightforward change handling. | Higher conceptual and vendor complexity for only about 110 entries; request-unit planning and backup choices add overhead. | Rejected for current scale. |
| Azure Functions plus relational database | Excellent constraints, transactions and reporting. | Database baseline cost, migrations and administration are disproportionate to the event. | Rejected for current scale. |
| Azure Functions plus Table Storage | Atomic batches within an event partition, ETag concurrency, simple event queries and inexpensive storage. Backup is an explicit encrypted export/restore process. | Low expected consumption, modest Azure-specific adapter, no database server. | Recommended. |
| Single hosted process with SQLite | Simplest application model and strong local transactions. | Durable Azure filesystem/backup and scale-out require a container/App Service baseline and more operations. | Useful locally, not selected for Azure. |

## Consistency design

- Local JSON: one serialized transaction queue and atomic temporary-file rename.
- Test memory: one serialized transaction queue per isolated repository.
- Azure Table: one event partition; submit event-counter update and registration/idempotency insert in one transactional batch using the current event ETag. Cancellation and promotion update the cancelled entry, promoted entry and event metadata together. Race-number uniqueness uses a number-lock entity inserted/deleted in the same partition transaction.
- A conflicting ETag is retried with bounded jitter. Idempotency records make a repeated request return the original result.

Table entity-group transactions are limited to one partition and up to 100 operations, which is sufficient because each registration action changes only a small bounded set of entities. See [Azure Table transaction requirements](https://learn.microsoft.com/rest/api/storageservices/performing-entity-group-transactions) and [Table design guidance](https://learn.microsoft.com/azure/storage/tables/table-storage-design).

## Authentication

Use Microsoft Entra ID through the hosting boundary; do not store passwords. The API validates platform identity claims and maps assigned roles to application permissions. Local development accepts an explicit organiser header only on loopback in the `local` environment; production code cannot enable that path. See [Static Web Apps authentication and authorization](https://learn.microsoft.com/azure/static-web-apps/authentication-authorization).

## Region and cost assumption

Proposed region: UK South, subject to checking service availability immediately before deployment. Assumptions are one event, about 110 entrants/year, fewer than 50,000 API calls/month, less than 1 GB stored, low log volume and no always-on compute.

Estimated development cost: approximately £0–£5/month during light use, potentially near zero within applicable consumption allowances; budget £10/month initially for alerts and unexpected telemetry. This is an estimate, not a quote. Review current [Functions pricing](https://azure.microsoft.com/pricing/details/functions/), [Table Storage pricing](https://azure.microsoft.com/pricing/details/storage/tables/), [Azure Monitor pricing](https://azure.microsoft.com/pricing/details/monitor/) and the Azure calculator immediately before approval.

## Consequences

The Table adapter is Azure-specific, but domain and API code depend only on the repository transaction contract. Table Storage has limited ad-hoc querying; operational CSV exports and small in-memory filtering are acceptable at this scale. Backup/restore and retention jobs must be explicitly scheduled and tested before real data is collected.
