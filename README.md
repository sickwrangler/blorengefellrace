# Blorenge Fell Race website

Public information website for the Blorenge Fell Race, hosted as an Azure Static Web App.

## Safe development

Make changes on a non-production branch and open a pull request for review. Check the separate preview deployment before approving a production change.

## Run locally

There is no build step. Serve the repository root with a local static HTTP server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Do not open the HTML files directly with `file://`; root-relative paths and embedded components may not behave correctly.

## Documentation

- [System architecture](docs/architecture.md)
- [Page and component guide](docs/components.md)
- [Deployment](docs/deployment.md)
- [Local development](docs/local-development.md)
