# Registration prototype test checklist

Start the prototype with:

```sh
node scripts/start-registration-prototype.mjs
```

Open <http://127.0.0.1:4173/registration/>. Use synthetic details only; the provided `example.com` values are safe defaults.

On the Azure preview, keep the runner and dashboard in the same browser and profile. Private windows, other browsers and other devices have separate storage. Clearing site data removes preview entries.

## Runner journey

1. Confirm the red test banner remains visible throughout.
2. Try continuing with a required field empty and check that the error identifies the field.
3. Enter a birth date after 28 November 2010 and confirm it is rejected as underage.
4. Complete the three information/review stages and select “Create test registration and continue to mock payment”. Record the visible test reference.
5. Confirm the registration exists with payment “not started”, then choose each mock-payment outcome in Stage 4.
6. Choose “Temporary error”, confirm the existing record remains stored, then select another outcome and retry.
7. Reuse an existing test email and confirm the duplicate is rejected without adding a record.
8. Check Stage 5 repeats the test reference and clearly says no email was sent and no payment was taken.

## Organiser journey

1. Open the organiser prototype and select “Load/reset synthetic fixtures”. Record the starting registration count.
2. Search by synthetic name, club and email; filter entry and payment states.
3. Change capacity, pause/resume test entry, and confirm new entries are rejected while paused.
4. Cancel an accepted test entry and check the first waiting runner is promoted.
5. Assign a race number and confirm a duplicate race number is rejected.
6. Refund an entry whose mock payment is successful.
7. Review captured message previews; confirm no external delivery is claimed.
8. Export the CSV and confirm it contains no email, phone, date of birth, emergency-contact, membership or consent fields.
9. Reset test data and confirm the documented fixture count and seed labels return.

## Exact preview regression journey

1. Open runner and dashboard pages in the same normal browser profile.
2. Select “Load/reset synthetic fixtures” and confirm the documented starting count is 6.
3. Complete the runner form using a new reserved example-domain email.
4. Select “Create test registration and continue to mock payment”.
5. Confirm the dashboard count increases by one and search for the displayed test reference.
6. Apply successful mock payment and confirm that same record changes to `successful`.
7. Refresh both pages and confirm the record remains.
8. Cancel the record and confirm its registration status changes to `cancelled`.
9. Select “Load/reset synthetic fixtures” and confirm the baseline is restored.

## Additional thorough checks

- Repeat with unique example-domain emails and mock outcomes `declined` and `abandoned`; both records must remain searchable with those statuses.
- Select the temporary-error outcome after creating a registration; the count must not increase and the existing record must remain `not_started` until retry.
- Keep the dashboard open in one tab and submit in another; its count should update automatically. Then use “Refresh test data” as the explicit fallback.
- Reload both tabs and confirm the runner-created records remain.
- Try the same preview in a private window and confirm it has a separate fixture store and cannot see the normal-profile entries.
- Attempt a duplicate synthetic email and confirm the dashboard count does not change.
- Test search independently by test reference, runner name and synthetic email.
- At widths around 320, 375, 768 and 1440 pixels, check all five stages, the dashboard table’s deliberate horizontal scrolling, dialogs, focus indication and error announcements.
- Optional recovery test: in browser developer tools for the preview only, run `localStorage.setItem("blorenge-registration-preview", "not-json")` and reload. Submission must be blocked with a visible recovery message. “Load/reset synthetic fixtures” must restore the six-fixture baseline.

## Responsive and accessibility review

Repeat the runner journey at approximately 320, 375, 768 and 1440 pixels. Check keyboard-only operation, visible focus, error announcements, labels, touch-target size, horizontal overflow and reading order.

The numbered Azure pull-request preview offers a browser-only disposable simulation. The production custom domain must show the closed page instead.
