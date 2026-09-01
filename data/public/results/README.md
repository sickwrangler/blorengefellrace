# Public results data

`2025.json` is a normalized public export generated from the authoritative 2025 results workbook. Each record is limited to the fields defined in `2025.schema.json`.

Permitted public fields are the race year, finishing position, race number, runner name, club, category, category position, gender position, recorded gender category and finish time. Dates of birth, ages, contact details, addresses, emergency information, signatures, payment information and transaction identifiers are not permitted.

Blank club values in the authoritative source are retained as empty strings.
They must not be guessed or filled from registration data.

Generate and validate the export from a workbook kept outside the repository:

```bash
node scripts/generate-public-results-2025.mjs <path-to-results-workbook.xlsx>
node scripts/validate-public-results.mjs <path-to-results-workbook.xlsx>
```

The generator reads the standard XLSX file structure and requires the `unzip` command. The current results page continues to use its existing public feed; it is not connected to this JSON file yet.

## Private-data boundary

Registration source files are private and must never be committed to this repository. Place local organiser source files in the ignored `private-data/` directory, or keep them entirely outside the repository. Public result exports must use the explicit field allowlist above.

Personal and payment information must be stored separately from the public website. Any future organiser application will require authentication and authorization. Original private files should remain outside the deployed repository. Retention periods still require an organiser decision.
