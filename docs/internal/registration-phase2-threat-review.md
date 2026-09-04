# Internal Phase 2 threat and privacy review

This file is blocked by the Static Web Apps routing configuration. Do not copy operational findings into public pages.

| Area | Phase 2 mitigation | Work required before production |
|---|---|---|
| Form abuse/automation | Body-size limit, server validation, idempotency, closed state | Edge rate limiting and bot control |
| Enumeration | Long opaque confirmation token, hash-only lookup, uniform not-found response | Monitor repeated failures |
| Organiser authorization | Every organiser route checks permission; local bypass is loopback/local only | Entra groups, assignments and access review |
| Injection/XSS | Normalization, JSON API, UI text nodes, CSV formula neutralization | Dependency scanning and penetration review |
| CSRF/CORS | No production credentials; same-origin design | Platform CSRF strategy and restrictive CORS |
| Sensitive logs | No form-payload logging; minimal audit data | Telemetry redaction tests and retention limits |
| Secrets/backups | No committed credentials; ignored permission-restricted local files | Managed identity, protected backup container and restore drill |
| Payment/email abuse | Mock/captured adapters assert no external call | Signed webhooks, provider rate limits and approved templates |
| Data crossover | Environment marker, separate repository/config, production fail-closed | Separate subscriptions/resource groups and deployment identities |
| Retention/deletion | Anonymise/delete operations and field classification | Approved retention schedule and legal review |

Do not enable production writes until the opening runbook, identity setup, monitoring, backup, privacy notice and provider integrations are separately approved.
