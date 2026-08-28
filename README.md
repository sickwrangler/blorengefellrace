# Blorenge Fell Race website

Public information website for the Blorenge Fell Race, hosted as an Azure Static Web App.

## Safe development

- `main` is the production branch. A push to it triggers the live Azure deployment.
- `codex/development` is the working branch for Codex changes. Work here does not alter the live site.
- Open a pull request into `main` when a change is ready for review. Azure Static Web Apps will create a temporary preview environment for the pull request.
- Merge only after checking the preview. Closing the pull request removes its preview environment.

## Run locally

There is no build step. Serve the repository root with a local static HTTP server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Do not open the HTML files directly with `file://`; root-relative paths and embedded components may not behave correctly.

## Documentation

- [System architecture](docs/architecture.md)
- [Page and component guide](docs/components.md)
- [Development and deployment runbook](docs/development-runbook.md)
