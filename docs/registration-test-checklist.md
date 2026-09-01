# Registration prototype test checklist

Start the prototype with:

```sh
node scripts/start-registration-prototype.mjs
```

Open <http://127.0.0.1:4173/registration/>. Use synthetic details only; the provided `example.com` values are safe defaults.

## Runner journey

1. Confirm the red test banner remains visible throughout.
2. Try continuing with a required field empty and check that the error identifies the field.
3. Enter a birth date after 28 November 2010 and confirm it is rejected as underage.
4. Complete all three steps, review the details and choose each mock-payment outcome.
5. Choose “Temporary error”, confirm nothing is stored, then select another outcome and retry.
6. Reuse an existing test email and confirm the duplicate is rejected.
7. Check the confirmation clearly says no email was sent and no payment was taken.

## Organiser journey

1. Open the organiser prototype and select “Load synthetic scenarios”.
2. Search by synthetic name, club and email; filter entry and payment states.
3. Change capacity, pause/resume test entry, and confirm new entries are rejected while paused.
4. Cancel an accepted test entry and check the first waiting runner is promoted.
5. Assign a race number and confirm a duplicate race number is rejected.
6. Refund an entry whose mock payment is successful.
7. Review captured message previews; confirm no external delivery is claimed.
8. Export the CSV and confirm it contains no email, phone, date of birth, emergency-contact, membership or consent fields.
9. Reset all test data and confirm entrants and messages are empty.

## Responsive and accessibility review

Repeat the runner journey at approximately 320, 375, 768 and 1440 pixels. Check keyboard-only operation, visible focus, error announcements, labels, touch-target size, horizontal overflow and reading order.

The numbered Azure pull-request preview offers a browser-only disposable simulation. The production custom domain must show the closed page instead.
