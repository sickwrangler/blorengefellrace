# Registration operations handbook

Last verified against production: 26 September 2026.

This handbook is for a technically capable Blorenge Fell Race organiser who needs to operate, diagnose or recover the live registration service without knowing its source code. It describes the current production system, not the earlier browser prototype or the isolated synthetic development environment.

> **If something is seriously wrong, stop new registrations first and diagnose before editing data.**

Start with the [emergency cheat sheet](emergency-cheat-sheet.md). Normal organiser actions and break-glass intervention are deliberately different:

- **Normal operation** uses the authenticated organiser dashboard and supported API operations. These actions validate rules and write audit records.
- **Break glass** means controlled infrastructure or data recovery after containment, approval and backup. It never means improvising changes in Azure Table Storage.

## Handbook map

1. [Emergency cheat sheet](emergency-cheat-sheet.md) — immediate containment and first checks
2. [System overview](system-overview.md) — what is running and how the parts connect
3. [Resource inventory](resource-inventory.md) — verified Azure and external resources
4. [Registration lifecycle](registration-lifecycle.md) — states, orders, places and declarations
5. [Payments and Stripe](payments-and-stripe.md) — Checkout, webhooks, reconciliation and refunds
6. [Email and ACS](email-and-acs.md) — transactional email and delivery diagnosis
7. [Scheduler](scheduler.md) — 30-minute background work and health checks
8. [Monitoring and alerts](monitoring-and-alerts.md) — logs, metrics and alert rules
9. [Deployment and rollback](deployment-and-rollback.md) — GitHub-to-Azure releases
10. [Backup and recovery](backup-and-recovery.md) — snapshots and guarded restore
11. [Manual intervention](manual-intervention.md) — intervention levels and approvals
12. [Incident runbook](incident-runbook.md) — scenario-by-scenario response
13. [Security and secrets](security-and-secrets.md) — configuration boundaries and rotation
14. [Environments](environments.md) — production versus development
15. [Operator glossary](operator-glossary.md) — practical definitions

## Current baseline

- Production URL: <https://www.blorengefellrace.cymru>
- Organiser dashboard: <https://www.blorengefellrace.cymru/registration/dashboard.html>
- GitHub repository: `sickwrangler/blorengefellrace`
- Verified production commit: `2b4a4d17d6b17d42727650a4855135e78e4349ba`
- Operational state at verification: `PRIVATE_LIVE`
- Public opening announcement: 28 September 2026
- Production data is private and separate from the Git repository and deployment artifact.

The announced date does not automatically open registration. A confirmed, authenticated state transition is still required.
