# ADR 0001: Phase 2 registration hosting and storage

Status: accepted for the isolated synthetic development environment; production use is not approved.

## Decision

For the isolated synthetic development environment, use a separate Azure Static Web App on the Free plan, its managed HTTP Functions under `/api/v2`, and a separate Standard LRS Azure Table Storage account. Store the normalized in-service model for the 2026 test event as one compressed snapshot entity in its own partition. Guard every replacement with the entity ETag and bounded conflict retries so capacity, waiting-list and race-number rules remain atomic.

This supersedes the earlier standalone-Functions proposal. Managed Functions satisfy the current HTTP-only workload with lower operational overhead and no recurring compute charge. A standalone Function App remains a future option only if a documented requirement cannot be met by managed Functions.

## Options considered

| Option | Fit | Decision |
|---|---|---|
| Static Web Apps managed Functions plus Table Storage | Integrated `/api` routing and identity claims; one ETag-guarded event snapshot supports this small transactional workload. Managed Functions lack managed identity, so a scoped storage SAS must be held in encrypted app settings and rotated. | Selected for synthetic development. |
| Standalone Functions plus Table Storage | Supports managed identity and independent API lifecycle, but adds a resource, deployment and operational surface not currently needed. | Deferred unless managed Functions prove insufficient. |
| Cosmos DB serverless | Flexible and transactional within a logical partition, but request-unit planning and extra concepts are disproportionate here. | Rejected for this phase. |
| Relational database | Strong constraints and reporting, but introduces a recurring/database operational burden. | Rejected for this phase. |
| Hosted SQLite | Simple application model, but durable cloud filesystem and scale-out complicate hosting. | Local development only. |

## Consistency design

- Local JSON uses one serialized transaction queue and atomic file replacement.
- Tests use a fresh in-memory repository.
- Azure Table uses one `blorenge-2026-test` partition and one compressed state entity. A registration action conditionally replaces that entity.
- Capacity, waiting-list and number uniqueness changes are committed together or not at all.
- ETag conflicts receive bounded retries; idempotency entities return the original result for repeated submissions.

The compressed snapshot is deliberately limited to 200 chunks within one Table entity. This is appropriate for the small synthetic test but must be replaced or re-evaluated before production scale or real data.

## Authentication and storage credential

Use the Static Web Apps preconfigured Microsoft Entra provider. Runner submission routes remain public but enforce test state and synthetic-address validation in server code. The dashboard and every private API route require the single custom `Organiser` role; the API also checks the platform principal rather than relying only on page routing.

Managed Static Web Apps Functions do not support managed identity. The minimal design therefore gives the API a revocable SAS limited to the one development Table and read/add/update/delete operations. The SAS is stored only in the Static Web App's encrypted application settings, never in GitHub or browser code. This is a conscious development-only trade-off and must be reconsidered before real personal data is accepted.

## Region and cost

Co-locate the Static Web App and Storage account in West Europe to avoid cross-region data transfer. The Static Web App uses the Free plan. At September 2026 public GBP retail rates, Standard LRS Table capacity is £0.0331/GB-month and each 10,000 read, write, list, scan, batch-write or delete operations costs £0.0003. Expected synthetic use is fractions of a penny; detailed assumptions and calculations are in the internal approval pack.

## Consequences

The Free plan has no SLA, no private endpoint and invitation-based custom roles are limited. Those constraints are acceptable for synthetic development, not a claim of production readiness. The Table adapter remains Azure-specific, while domain code continues to use the repository transaction contract. Backup and production retention remain deliberately out of scope.
