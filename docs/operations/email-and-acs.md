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

Email delivery failure does **not** roll back a valid payment, refund, transfer or registration. Diagnose and resend only through a supported recovery/organiser action after understanding the first attempt.

## Diagnostics

ACS diagnostic setting `registration-email-delivery` sends these categories to `log-blorenge-registration-prod-c1b64c`:

- `EmailSendMailOperational`;
- `EmailStatusUpdateOperational`.

User-engagement diagnostics are disabled, and the Azure-managed domain has engagement tracking disabled. The Log Analytics workspace retains data for 30 days.

## Email not received

1. Confirm the runner email is correct in the organiser dashboard without copying it into tickets/chat.
2. Confirm the application stored one send attempt/receipt and note its delivery/provider status.
3. In Log Analytics, inspect `EmailSendMailOperational` for acceptance/rejection and `EmailStatusUpdateOperational` for delivered, bounced or failed status.
4. Check recipient junk/quarantine and ask the runner to allow the sender.
5. Distinguish an ACS send failure from later mailbox delivery failure.
6. Use the appropriate supported recovery/resend action only after the original result is understood.

Do not repeatedly resend a secure link. Recovery rotates or replaces links as designed; old links may then be invalid. Never ask a runner to paste a management or declaration token into email/chat.

## Provider outage

If ACS is unavailable, registrations and Stripe payments may still complete, but runners may not receive their links. Consider pausing new registrations if the outage persists or support volume becomes unsafe. Preserve valid payment/entry state, monitor the queue of failed/missing communications, and resend through supported operations after recovery. Do not reverse payments merely because email failed.
