# Registration prototype: five-minute organiser test

Use the runner and organiser pages in the same normal browser profile. A private window, another browser or another device has separate test data.

1. Open the organiser test area and select **Reset test**. Confirm the summary shows zero accepted entries, zero waiting-list entries and 110 remaining places.
2. Open the runner page and select **Start a test registration**.
3. Continue through the pre-filled synthetic details and consent. Only the controls for the current stage should be visible.
4. Review the complete entry and select **Submit test entry** once. Record the displayed `TEST-…` reference.
5. Select **Simulate successful payment**. Confirm the same reference shows an accepted entry and successful mock payment.
6. Select **View this entry as organiser**.
7. Confirm the correct entry is highlighted and its reference, runner details and successful payment status match.
8. Assign a synthetic race number.
9. Select **Preview captured messages** and confirm the preview says no message was sent externally.
10. Confirm the testing-progress panel displays **End-to-end registration test completed successfully.**
11. Select **Reset test** and confirm the entry disappears and all counts return to zero.

The complete journey should take no more than approximately five minutes. No developer tools, fixtures, storage controls or manual refresh controls are required.

## Quick responsive and keyboard review

If time permits, repeat the runner stages at approximately 320 and 768 pixels. Check that the page does not scroll horizontally, focus is visible, validation errors identify their fields, and the organiser entries display as readable cards. Use Tab, Shift+Tab, Enter and Space to confirm every visible action is operable.

Edge cases—including capacity 109/110/111, concurrent final-place attempts, corrupt storage, duplicate submission, declined/abandoned payments and privacy boundaries—remain covered by the automated suite rather than the main organiser journey.
