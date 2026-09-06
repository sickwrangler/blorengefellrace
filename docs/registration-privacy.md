# Registration privacy design

The registration development system must use invented test entrants only. The Azure preview stores disposable test data in the reviewer’s browser. Phase 2 local development stores synthetic data in an ignored, permission-restricted server file until explicit reset. Neither mode sends data to a payment or email service.

## Field inventory

| Field | Purpose | Visibility |
|---|---|---|
| First and last name | Identify the entrant and prepare race/result records | Private during registration; may later appear in approved public results |
| Email and phone | Registration contact | Private |
| Postal address | Entry administration and any confirmed eligibility/operational need | Private; final necessity and retention require organiser approval |
| Date of birth | Verify minimum age and calculate the appropriate results category | Private; derived category may be public |
| Gender/category | Produce result categories | Private during registration; approved category may be public |
| Running club | Race administration and results | May be public in results |
| Affiliation and membership number | Future eligibility/fee checks, subject to organiser confirmation | Private |
| Emergency-contact name and phone | Race-day incident contact | Private; race-day use only |
| Travel method | Event travel planning | Private/aggregate use only |
| Terms and privacy versions/timestamp | Evidence of the agreed versions | Private |
| WFRA declaration identifier, version, typed name and timestamp | Evidence of the exact declaration accepted | Private; retention requires organiser approval |
| Entry, mock-payment and waiting-list status | Administer the test workflow | Private |
| Waiting-list name and email | Operate the queue while minimizing data before a place is offered | Private; remove promptly when no longer needed |
| Private-invitation and management-token hashes | Authorize purpose-bound private and self-service access | Private security data; revoke/expire promptly |
| Refund request/decision and payment references | Administer refunds and reconcile finance | Private; accounting retention must be decided separately |
| Race number | Race administration and results | May be public in results |

Medical information remains excluded; collecting it would require a specific race-day need, lawful basis, restricted access and retention decision.

## Retention and rights

Prototype data should be reset after each review session and is not backed up. Final periods are deliberately not invented. The organiser must approve a production schedule covering incomplete attempts, waiting-list records, private invitations, active/cancelled entries, addresses and contact details, declarations/consent, audit records, payment/accounting metadata and public results before real collection starts. Emergency-contact data is short-lived operational information and should be deleted or anonymised soon after the event once incident needs have ended. Durable financial/accounting evidence must be separated from race-operation data and retained only for its approved purpose.

The production design must provide documented processes to:

- correct an entrant’s details while preserving an audit history;
- export an individual’s data securely;
- cancel and delete or restrict data where applicable;
- create reviewed public-result exports using an explicit allowlist;
- restrict organiser access by role and remove access promptly;
- test backups and recovery;
- keep payment-card data entirely within the chosen payment provider;
- remove all development/test data independently of production.

The Phase 1 CSV contains synthetic race-administration/result fields only. It excludes email, phone, date of birth, emergency contact, membership and consent information.

Detailed operational and security review information is maintained separately from the public website.
