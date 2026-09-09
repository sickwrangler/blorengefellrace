# Phase 3 — Production-ready registration system

## Purpose and release principle

Phase 3 will turn the tested registration model into a supportable production service. It must preserve the separation between the public production website, the stable synthetic development environment and private production registration data.

**Deploying registration must not open registration.**

The frontend, API, database, organiser authentication, payment configuration and email configuration must be deployable and testable while the server-side event state remains closed. Opening entries must be a separate, deliberate, authenticated organiser action or approved configuration change, with an audit record and a tested way to close or pause entries again.

Phase 3A implements provider-neutral domain and interface foundations only. It does not deploy a production registration service, open entries, call Stripe or deliver email.

Registration contact details are for administering the current race only. Future marketing consent, promotional retention, marketing email and unsubscribe functionality are outside scope and must not be inferred from race entry.

## Phase 3A implementation status

- The server domain defines `CLOSED`, `PRIVATE_LIVE`, `OPEN`, `PAUSED` and terminal `CLOSED_FINAL`. Capacity and waiting-list availability are derived, not manual states. A production state always initializes as `CLOSED`; state changes require an authenticated organiser, an expected-current-state check and an audit event.
- Private invitations are opaque, purpose-bound (`registration`, `waiting_list_join` or `waiting_list_offer`), expiring, revocable and stored as hashes. Every protected server operation revalidates current state, purpose, expiry, revocation, usage and, for an offer, the linked offer state. A prior browser check is never treated as authorization. Organiser controls create, inspect, revoke and expire links; the original token is returned only once at creation.
- The authoritative Phase 3 server configuration records the 28 November 2026 race, 120-place capacity, £6 fee, Europe/London cutoff at 23:59 on 28 October, 48-hour offers, 24-hour reminders and optional race numbers.
- The runner model includes the agreed name, contact, address, birth, category, club, WFRA-membership and emergency-contact fields. Competition categories are exactly `Female` and `Male / Open`.
- The organiser-supplied WFRA senior-entry declaration is stored once as versioned content (`WFRA_SENIOR_ENTRY`, `21/02/23`). Acceptance records retain that identifier/version, the typed name, signatory role, timestamp and runner/registration references. Entrants aged 16 or 17 remain blocked pending confirmation of the applicable WFRA parental-consent form and process; the system does not infer that typing a name completes parental consent.
- WFRA membership is the only active membership question. It is self-declared, its flexible text membership number is not automatically verified, and it is excluded from public responses/exports. UK Athletics affiliation and membership number are not collected because they are **not required for current race registration or operations**.
- The server owns pricing. Standard entry remains £6.00. A configurable WFRA member price is modelled but intentionally unset, so no discount is applied until the organiser approves the amount; browser-supplied amounts are ignored.
- Opaque management tokens support amendments without runner accounts. Before the cutoff, changing identity or email rotates and invalidates the token. After the cutoff, runner name changes are locked; other permitted details remain amendable, and an organiser override is audited.
- Capacity distinguishes confirmed places, payment reservations and active waiting-list-offer reservations. Waiting-list joins store only name and email; offers include reminder/expiry times and progress in order after decline or expiry.
- Refund requests, organiser approval/rejection, recorded refund and separate place release are distinct audited actions. No runner self-cancellation or live refund is implemented.
- Race numbers remain nullable, unique while assigned, removable and reusable.
- Runner and organiser pages use a small environment/state badge. Development-only explanations are integrated into normal copy; Stripe is disabled by default, payment status is server-authoritative and messages remain captured-only until separately enabled.

### Runner-language direction

Welsh is intentionally not duplicated beside every English field because that made the runner journey visually dense, especially on mobile. There is no English/Welsh language toggle at this stage. The current UI renders in English while the reviewed Welsh copy is retained separately for possible future reuse.

The intended future approach is **selective Welsh exposure** within an otherwise accessible interface—for example occasional Welsh section titles, familiar race terminology, small secondary phrases, greetings or confirmation wording, place and landscape terms, selected high-value bilingual labels, and useful links to Welsh-language information. The final pattern is a future UX decision, not a Phase 3 blocker.

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
14. **Operational controls** — expose only authenticated, authorized controls for closed, private-live, open, paused and closed-final states. Require clear confirmation, current-state display and audit history; dates or client-side settings must never open registration automatically.

## Organiser decisions needed before Phase 3B

These choices affect provider integration, production resources or final policy and should be agreed before Phase 3B:

- payment provider, settlement account owner, supported payment methods and fee handling;
- refund policy, including eligibility, deadlines, partial refunds and who may authorize them;
- transactional email provider, sender address/domain and responsibility for delivery problems;
- the minimum runner, eligibility, emergency-contact and consent information that must be collected;
- retention periods for unsuccessful attempts, active/cancelled entries, emergency details, consent/audit records and payment metadata;
- the WFRA member price or discount amount;
- the WFRA parental-consent form, signatory evidence and process for entrants aged 16 or 17;
- which runner amendments are self-service, organiser-approved or prohibited, and the amendment cutoff;
- waiting-list ordering, whether promotion is automatic or organiser-controlled, response/payment deadline and handling of expired offers;
- cancellation rules, place release, waiting-list promotion and whether any transfer or deferral is permitted;
- organiser roles, named users, least-privilege responsibilities, access approval and emergency access arrangements;
- the intended registration opening and closing process, dates/times, time zone, approval owner and emergency pause procedure;
- whether race numbers are allocated on payment, later in bulk or manually, and how cancelled/refunded entries affect allocation.

## Decisions that can safely be deferred

These can be finalized after the core architecture and policies above are agreed, but must be resolved before the affected capability goes live:

- exact wording and visual presentation of transactional email templates;
- optional communication refinements that remain within the approved single-reminder, operational-only policy;
- organiser dashboard sorting, saved filters and nonessential reporting preferences;
- optional additional export formats beyond the required private administration and reviewed public-results exports;
- longer-term multi-event history and archive presentation after the first production event retention model is proven;
- nonessential analytics, provided registration data is never sent to public analytics services;
- additional fine-grained organiser roles beyond the minimum safe role model, if operational experience shows they are needed.

## Phase gates

Phase 3 should proceed through explicit reviews: decisions agreed; architecture and threat/privacy review approved; isolated production resources approved; provider sandboxes integrated; closed production deployment verified; recovery and launch rehearsal passed; and final go/no-go approval recorded. Deployment completion alone is never approval to open entries.

## Phase 3B provider work

Phase 3B implements controlled Stripe Checkout and Azure Communication Services boundaries with independent fail-closed configuration, signed webhooks, idempotent payment reconciliation, approved full-refund handling, safe-recipient email redirection, templates, runner payment-status UI and scheduled-work domain logic. Real test-mode provider proof remains gated on organiser-controlled configuration. See `registration-phase3b.md`.

Progression remains: `Phase 3B — controlled integrations` → `Phase 3C — production infrastructure/application deployed CLOSED` → `Phase 3D — private live pilot with real Stripe and real email` → `Public OPEN`.

## Approved Phase 3B.3 roadmap item — multi-runner registration

Multi-runner registration is an approved pre-production feature and is the next intended phase after Phase 3B.2. It is not implemented in Phase 3B.2. The intended journey allows a purchaser to add several runners, review them together and pay one server-calculated total in one Stripe Checkout.

The design must keep a registration/runner distinct from an order/checkout. Personal details, category, date of birth, WFRA evidence, server-calculated price, declaration acceptance, amendment/transfer/refund state, race number and secure management identity remain per runner. Each adult entrant supplies their own declaration; a future approved parent/legal-guardian process applies separately to every under-18 entrant. One signature must never cover unrelated adults.

Phase 3B.3 must address these decisions and constraints explicitly:

- the server total is the sum of each runner's authoritative price; the browser never supplies the group total;
- group capacity is allocated atomically, with a product decision required between all-or-nothing race places and an explicit race/waiting-list split;
- one runner can be refunded and have only their capacity released without forcing refunds for the rest of the order;
- one secure management identity per registration remains preferred, although a purchaser summary may link the registrations safely;
- current payment records use one `registrationId` per Checkout and refund idempotency is keyed to that payment; Phase 3B.3 should introduce an order with line items rather than overloading a registration;
- payment emails currently describe one runner. Individual runner messages should remain, while a new purchaser/order summary can be added without replacing them.

## Low-priority maintenance notes

- Remove tracked `.DS_Store` files in a future, separate maintenance change. This is not a Phase 3 blocker.
- Do not rewrite Git history merely to remove previously redacted workstation paths unless a genuine security requirement arises.
- The observed browser `MutationObserver` instrumentation warning is not currently considered a site defect: no repository source corresponds to it and no website behaviour failed.
