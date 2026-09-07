# Registration prototype: five-minute organiser test

Use the runner and organiser pages in the same normal browser profile. A private window, another browser or another device has separate test data.

1. Open the organiser test area and select **Reset test**. Confirm the summary shows zero accepted entries, zero waiting-list entries and 120 remaining places.
2. Open the runner page and select **Start a test registration**.
3. Continue through the pre-filled synthetic details and consent. Only the controls for the current stage should be visible.
4. Review the complete entry and select **Submit test entry** once. Record the displayed `TEST-…` reference.
5. Confirm the final stage says payments are unavailable, the payment button is disabled and the synthetic entry details were retained.
6. Open **View payment status** and confirm the page reads the server-side state without displaying provider or API identifiers.
7. Return to the organiser area and confirm the same reference and runner details are present with payment not configured.
8. Assign a synthetic race number.
9. Select **Preview captured messages** and confirm the preview says no message was sent externally.
10. Select **Reset test** and confirm the entry disappears and all counts return to zero.

For the race-number correction, assign a number, then select **Remove race number**, accept the confirmation, and confirm the list, detail panel and a newly generated CSV show no number. Reassign the released number to confirm it is available. Finally, cancel a numbered entry once with **Also release race number?** selected and once with it cleared to verify both choices. Refund-provider testing remains disabled until the separate Stripe sandbox step is approved.

The complete journey should take no more than approximately five minutes. No developer tools, fixtures, storage controls or manual refresh controls are required.

## Quick responsive and keyboard review

If time permits, repeat the runner stages at approximately 320 and 768 pixels. Check that the page does not scroll horizontally, focus is visible, validation errors identify their fields, and the organiser entries display as readable cards. Use Tab, Shift+Tab, Enter and Space to confirm every visible action is operable.

Edge cases—including capacity 119/120/121, concurrent final-place attempts, corrupt storage, duplicate submission, unsuccessful/expired payments and privacy boundaries—remain covered by the automated suite rather than the main organiser journey.
