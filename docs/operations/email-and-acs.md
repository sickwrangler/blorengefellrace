# Email and Azure Communication Services

## Production path

Production email is enabled through:

- Communication Service `acs-blorenge-registration-prod-c1b64c`;
- Email Communication Service `ecs-blorenge-registration-prod-c1b64c`;
- resource `AzureManagedDomain`;
- sender username `donotreply`, display name **Blorenge Fell Race**;
- application adapter `acs-production`.

The exact sender address and endpoint are application settings. They are operational configuration, not credentials, but should still be changed only through review. The ACS connection string, if present, is secret. The scheduler instead uses its managed identity and ACS endpoint.

Application-triggered messages include entry confirmation, purchaser group summary, management/declaration recovery, transfer, refund and cancellation communications. Scheduler-triggered messages cover due declaration reminders and waiting-list reminders/offers. Automatic communication is intentionally limited: routine edits, Checkout expiry and several internal state changes do not generate extra mail.

Every attempted business message uses an idempotency key. The persisted receipt records template, related record, intended recipient, provider reference and delivery outcome; secure URLs are deliberately not stored in the receipt.

`sentAt` means the provider operation returned a successful result. `attemptedAt` records an external attempt. Historical receipts created before the email-recovery change may have `sentAt` populated for a failed attempt, so operators must use `delivery`, the provider reference and ACS diagnostics—not `sentAt` alone.

The application adds a bounded retry layer around the Azure SDK. It retains one deterministic ACS operation ID across attempts, respects `Retry-After`, uses exponential backoff with jitter, retries 429/408/selected 5xx/network failures, and does not retry permanent 4xx or a terminal ACS failed-delivery result. The Azure SDK normally has its own default pipeline retry policy (three retries by default); production disables that inner retry loop so the application limit, delay and safe telemetry are authoritative rather than multiplying two retry budgets.

Email delivery failure does **not** roll back a valid payment, refund, transfer or registration. Diagnose and resend only through a supported recovery/organiser action after understanding the first attempt.

## Diagnostics

ACS diagnostic setting `registration-email-delivery` sends these categories to `log-blorenge-registration-prod-c1b64c`:

- `EmailSendMailOperational`;
- `EmailStatusUpdateOperational`.

User-engagement diagnostics are disabled, and the Azure-managed domain has engagement tracking disabled. The Log Analytics workspace retains data for 30 days.

## Managed-domain limit and custom-domain plan

Microsoft currently documents the Azure-managed domain limit as **5 send operations per minute and 10 per hour**, with no quota increase. Custom domains start at **30 per minute and 100 per hour** and can request higher limits. The Azure-managed domain cannot absorb a busy registration-opening burst, but it can remain appropriate for this capped event when delayed confirmation is acceptable and the recovery backlog is drained below the documented quota.

If higher or immediate throughput becomes necessary, add a customer-managed domain or preferably a dedicated sending subdomain under `blorengefellrace.cymru`, then publish the exact Azure-provided records:

- domain-ownership TXT record;
- SPF TXT record;
- DKIM selector 1 CNAME;
- DKIM selector 2 (`DKIM2`) CNAME;
- DMARC policy/monitoring record as agreed with the domain owner.

Do not copy example record values into live DNS. Verify Domain, SPF, DKIM and DKIM2 in ACS, connect the verified domain to the Communication Service, create the intended MailFrom sender and perform a controlled delivery proof before changing the production sender. `entries@blorengefellrace.cymru` fits the registration purpose, but the organiser/domain owner must confirm that choice and any reply handling; `noreply@…` should be used only if replies are deliberately unsupported.

## Missing-confirmation recovery

The protected organiser API exposes a read-only aggregate health view and a dry-run recovery preview. The preview includes only counts and a fingerprint; it sends nothing. A recovery execution requires that exact current fingerprint plus the literal confirmation `SEND 1 RECOVERY EMAIL`, handles at most one registration, and refuses to run when the hourly external-attempt budget is exhausted. `REGISTRATION_EMAIL_RECOVERY_MAX_PER_HOUR` configures that budget and defaults to 8; keep it below the provider quota with room for normal transactional mail.

Only active, paid, confirmed registrations with no successful `entry_confirmed` or `entry_confirmed_declaration_required` receipt qualify. Successful confirmations are excluded. That state-derived plan acts as the durable recovery queue: an item remains eligible until a successful receipt exists. Recovery creates fresh management/declaration tokens as needed, invalidates superseded tokens, selects the current template from declaration status, stores an audited receipt and never changes payment or place state. Repeat the dry run after every execution. Bulk recovery must not start without an explicit production approval based on the current dry-run count.

## Email not received

1. Confirm the runner email is correct in the organiser dashboard without copying it into tickets/chat.
2. Confirm the application stored one send attempt/receipt and note its delivery/provider status.
3. In Log Analytics, inspect `EmailSendMailOperational` for acceptance/rejection and `EmailStatusUpdateOperational` for delivered, bounced or failed status.
4. Check recipient junk/quarantine and ask the runner to allow the sender.
5. Distinguish an ACS send failure from later mailbox delivery failure.
6. Run the aggregate recovery preview and confirm it excludes successful confirmations.
7. Use the guarded one-at-a-time recovery action only after explicit approval; re-run the preview between sends.

Do not repeatedly resend a secure link. Recovery rotates or replaces links as designed; old links may then be invalid. Never ask a runner to paste a management or declaration token into email/chat.

## Provider outage

If ACS is unavailable, registrations and Stripe payments may still complete, but runners may not receive their links. Consider pausing new registrations if the outage persists or support volume becomes unsafe. Preserve valid payment/entry state, monitor the queue of failed/missing communications, and resend through supported operations after recovery. Do not reverse payments merely because email failed.
