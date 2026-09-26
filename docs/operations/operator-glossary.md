# Operator glossary

| Term | Practical meaning here |
|---|---|
| Static Web App | Azure service serving the site/registration pages and hosting the managed HTTP API. |
| API | Server endpoints that validate requests and perform registration operations; the browser must not be treated as authority. |
| Azure Table | Private key/value-style storage containing the compressed/chunked authoritative event state. |
| Partition | The isolated event key (`blorenge-2026-live`) inside the production Table. |
| Stripe Checkout | Stripe-hosted payment page created with server-authoritative runner count and price. |
| Webhook | Signed provider-to-server event that tells the API what actually happened to a payment/refund. |
| Webhook signing secret | Secret used to prove an event came from Stripe; it is different from the Stripe API key. |
| ACS | Azure Communication Services, used for transactional registration email. |
| Managed identity | Azure-issued identity used by the scheduler to access storage, email and telemetry without a copied password/key. |
| Environment variable / app setting | Named runtime configuration. Some values are safe flags; others are secrets. |
| Function App | Azure host for the external 30-minute scheduler. |
| Scheduler | Background timer that expires reservations/offers and sends due reminders/offers. |
| RBAC | Azure role-based access control: who/what can do which operation at what resource scope. |
| SAS | Time/permission-scoped Azure Storage token used by the managed production API for Table access. Treat as secret. |
| ETag | Storage version marker. A transaction fails if someone else changed state since it was read, preventing silent overwrite. |
| Idempotency | Repeating the same provider/business request does not repeat its financial or communication effect. |
| Application Insights | Azure request, exception, trace and metric view for the API/scheduler. |
| Log Analytics | Queryable workspace holding operational logs including selected ACS send/status diagnostics. |
| Operational state | Server-side gate: `CLOSED`, `PRIVATE_LIVE`, `OPEN`, `PAUSED` or terminal `CLOSED_FINAL`. |
| Reservation | Temporary capacity claim while Stripe Checkout or a waiting-list offer is active. |
| Reconciliation | Comparing provider truth (especially Stripe) with application state and safely bringing them into agreement. |
| Start-list projection | Read-only public fields derived from current confirmed registrations; not a separately edited database. |
| PR | Pull request: proposed branch diff, validation and review before `main`. |
| Merge | Adds an approved PR to `main`; this triggers the production workflow. |
| Deployment | Publication of the allowlisted app/API artifact to Azure; not a data restore or state transition. |
| Rollback | Reviewed forward Git revert/deployment to known-compatible code; it does not reverse data or payments. |
| Audit event | Privacy-minimal record of a supported state/organiser action and its subject/time. |
| Provider reference | Stripe/ACS identifier used for diagnosis without storing secret credentials. |
| Secure link | Opaque order, management, declaration or invitation credential. Possession may grant narrow access; never paste it into support channels. |
