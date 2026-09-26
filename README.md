# Blorenge Fell Race website

Public information and production registration website for the Blorenge Fell Race, hosted as an Azure Static Web App with a managed API and separate Azure scheduler.

## Safe development

Make changes on a non-production branch and open a pull request for review. Check the separate preview deployment before approving a production change.

## Run locally

Public static pages have no build step. Serve the repository root with a local static HTTP server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Do not open the HTML files directly with `file://`; root-relative paths and embedded components may not behave correctly. This simple server does not provide the managed registration API. Use the documented registration development runner for synthetic local testing.

## Documentation

- [System architecture](docs/architecture.md)
- [Page and component guide](docs/components.md)
- [Deployment](docs/deployment.md)
- [Local development](docs/local-development.md)
- [Registration operations handbook](docs/operations/README.md)
