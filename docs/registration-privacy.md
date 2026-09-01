# Registration privacy design

This Phase 1 prototype must use invented test entrants only. It stores data temporarily in server memory or the reviewer’s browser and can be reset in one action. It does not send data to a payment or email service.

## Field inventory

| Field | Purpose | Visibility |
|---|---|---|
| First and last name | Identify the entrant and prepare race/result records | Private during registration; may later appear in approved public results |
| Email and phone | Registration contact | Private |
| Date of birth | Verify minimum age and calculate the appropriate results category | Private; derived category may be public |
| Gender/category | Produce result categories | Private during registration; approved category may be public |
| Running club | Race administration and results | May be public in results |
| Affiliation and membership number | Future eligibility/fee checks, subject to organiser confirmation | Private |
| Emergency-contact name and phone | Race-day incident contact | Private; race-day use only |
| Travel method | Event travel planning | Private/aggregate use only |
| Terms and privacy versions/timestamp | Evidence of the agreed versions | Private |
| Entry, mock-payment and waiting-list status | Administer the test workflow | Private |
| Race number | Race administration and results | May be public in results |

A full postal address is excluded because no operational need has been established. Medical information is excluded; collecting it would require a specific race-day need, lawful basis, restricted access and retention decision.

## Retention and rights

Prototype data should be reset after each review session and is not backed up. A future retention schedule for production registration, finance/audit records, emergency contacts and result records requires organiser approval before collection starts.

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
