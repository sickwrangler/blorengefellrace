# Phase 3 — Production-ready registration system

## Purpose and release principle

Phase 3 will turn the tested registration model into a supportable production service. It must preserve the separation between the public production website, the stable synthetic development environment and private production registration data.

**Deploying registration must not open registration.**

The frontend, API, database, organiser authentication, payment configuration and email configuration must be deployable and testable while the server-side event state remains closed. Opening entries must be a separate, deliberate, authenticated organiser action or approved configuration change, with an audit record and a tested way to close or pause entries again.

No Phase 3 functionality is implemented by this plan.

## Proposed implementation scope

1. **Production architecture and Azure resources** — define separately named production hosting, managed API, private transactional storage and network/data boundaries. Keep the existing development resources and data independent. Provision through reviewed infrastructure definitions with least-privilege identities.
2. **Data model and initialization** — finalize the event, runner, entry, consent, payment, communication, audit and amendment records; add schema/version migration procedures; initialize the production event closed and empty; prohibit copying synthetic development records into production.
3. **Organiser identity and authorization** — use Microsoft Entra authentication with approved organiser accounts, least-privilege roles, server-side authorization on every private operation, access review and auditable administrative actions.
4. **Payments** — integrate the selected provider through the existing adapter boundary. Cover checkout creation, signed webhook verification, idempotency, failed or abandoned payments, reconciliation and approved full/partial refund behaviour without trusting browser-reported payment state.
5. **Transactional email** — integrate the selected provider for confirmations and operational messages. Define verified sender identity, templates, delivery/retry handling, suppression and bounce handling, while keeping sensitive runner data out of logs.
6. **Runner self-service** — provide opaque, expiring or revocable confirmation access for viewing an entry and requesting or making approved amendments and cancellations. Define which fields can change directly and which require organiser review.
7. **Capacity and waiting list** — enforce capacity atomically, preserve idempotency under concurrent submissions, define waiting-list ordering and expiry, and make promotion/payment deadlines explicit and auditable.
8. **Privacy and information governance** — document lawful purpose, transparency wording, required data minimisation, consent/version records, retention periods, deletion/anonymisation, subject-access handling and controlled public-results exports.
9. **Backup and recovery** — implement encrypted backups, retention and restoration procedures; test recovery into a non-production target; define recovery objectives and responsibility for authorising restores.
10. **Monitoring and support** — add health and dependency checks, privacy-safe structured logs, payment/email failure alerts, capacity and error monitoring, an incident path and an organiser-facing operational checklist.
11. **Secrets and configuration** — keep production secrets in approved managed configuration, separate them from development, restrict and review access, document rotation, and ensure missing or invalid configuration fails closed.
12. **Pre-launch testing** — add provider sandbox tests, authorization and negative-path tests, concurrency/load checks, accessibility and device testing, backup restoration, closed-state deployment tests and a final privacy/security review using synthetic data.
13. **Launch and rollback** — rehearse deployment while closed, verify production components, take an approved go/no-go decision, open registration separately, monitor the initial period, and retain documented pause/close and rollback procedures that do not lose confirmed entries or payment evidence.
14. **Operational controls** — expose only authenticated, authorized controls for closed, open, paused and full states. Require clear confirmation, current-state display and audit history; dates or client-side settings must never open registration automatically.

## Organiser decisions needed before implementation

These choices affect architecture, contracts or the data model and should be agreed before Phase 3 code or production resources are created:

- payment provider, settlement account owner, supported payment methods and fee handling;
- refund policy, including eligibility, deadlines, partial refunds and who may authorize them;
- transactional email provider, sender address/domain and responsibility for delivery problems;
- the minimum runner, eligibility, emergency-contact and consent information that must be collected;
- retention periods for unsuccessful attempts, active/cancelled entries, emergency details, consent/audit records and payment metadata;
- which runner amendments are self-service, organiser-approved or prohibited, and the amendment cutoff;
- waiting-list ordering, whether promotion is automatic or organiser-controlled, response/payment deadline and handling of expired offers;
- cancellation rules, place release, waiting-list promotion and whether any transfer or deferral is permitted;
- organiser roles, named users, least-privilege responsibilities, access approval and emergency access arrangements;
- the intended registration opening and closing process, dates/times, time zone, approval owner and emergency pause procedure;
- whether race numbers are allocated on payment, later in bulk or manually, and how cancelled/refunded entries affect allocation.

## Decisions that can safely be deferred

These can be finalized after the core architecture and policies above are agreed, but must be resolved before the affected capability goes live:

- exact wording and visual presentation of transactional email templates;
- optional reminder schedules beyond the essential confirmation and operational messages;
- organiser dashboard sorting, saved filters and nonessential reporting preferences;
- optional additional export formats beyond the required private administration and reviewed public-results exports;
- longer-term multi-event history and archive presentation after the first production event retention model is proven;
- nonessential analytics, provided registration data is never sent to public analytics services;
- additional fine-grained organiser roles beyond the minimum safe role model, if operational experience shows they are needed.

## Phase gates

Phase 3 should proceed through explicit reviews: decisions agreed; architecture and threat/privacy review approved; isolated production resources approved; provider sandboxes integrated; closed production deployment verified; recovery and launch rehearsal passed; and final go/no-go approval recorded. Deployment completion alone is never approval to open entries.

## Low-priority maintenance notes

- Remove tracked `.DS_Store` files in a future, separate maintenance change. This is not a Phase 3 blocker.
- Do not rewrite Git history merely to remove previously redacted workstation paths unless a genuine security requirement arises.
- The observed browser `MutationObserver` instrumentation warning is not currently considered a site defect: no repository source corresponds to it and no website behaviour failed.
