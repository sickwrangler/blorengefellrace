# Local development

## Prerequisites

No framework, package manager, dependency installation, compilation, or environment file is required. A modern browser is sufficient. Node.js is optional for JavaScript syntax checking, and any simple static HTTP server can serve the site locally.

Runtime environment variables: none.

CI secret names, which are not needed for local development:

- `AZURE_STATIC_WEB_APPS_API_TOKEN_AMBITIOUS_BAY_0339ED203`
- `GITHUB_TOKEN`

## Run locally

From the repository root, start a static server. One example, if Python 3 is already installed, is:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Use an HTTP server rather than opening files directly so absolute paths, iframes, and browser fetch behaviour resemble production.

No local server command is defined by the repository itself. Do not add dependencies merely to view the site.

## Existing checks

There is no configured test, lint, type-check, or build command. The following read-only checks are suitable today:

```sh
git status --short --branch
node --check script.js
tidy -errors -quiet index.html
tidy -errors -quiet info.html
tidy -errors -quiet route.html
tidy -errors -quiet enter.html
tidy -errors -quiet result.html
tidy -errors -quiet privacy.html
```

The installed macOS `tidy` used in the audit has incomplete HTML5 awareness, so errors about elements such as `main`, `section`, `figure`, `nav`, and `footer` are not reliable. Structural messages about duplicate document/body elements, unmatched closing tags, or stray closing tags should still be investigated with a current HTML5 validator.

For manual checks, verify:

- home, information, route, entry, results, and privacy pages;
- navbar/footer links from both top-level pages and component iframes;
- images at case-sensitive paths;
- desktop and mobile widths;
- registration form display without submission;
- current and historical results loading;
- browser console and network failures;
- Tableau, weather, video, fonts, and analytics behaviour as appropriate; and
- an unknown path, noting that current routing returns the homepage with status 200.

## External dependencies during development

The site makes live public requests even when served locally:

- Google Form for registration;
- Google Sheets CSV publications and OpenSheet for results;
- Tableau Public for statistics;
- Google Analytics, Google Fonts, Font Awesome, weatherwidget.io, YouTube, Google Docs, and what3words.

Do not submit the registration form, use real personal data, or trigger any external transaction during a smoke test. Browser privacy/ad-blocking settings may cause third-party failures that do not reproduce for every visitor.

## Git safety

- `main` deploys automatically when pushed; treat it as production.
- Fetch before comparing, but do not pull, merge, reset, or switch branches until worktree status and intent are understood.
- There is currently no `.gitignore`; check carefully for `.DS_Store`, environment files, exports, credentials, and registration data before staging.
- Never add Google Form/Sheet exports containing personal registration data.
- The remote `codex/development` branch and open PR #1 already contain documentation work. Reconcile it before making overlapping documentation changes.
- Keep changes on a development branch and review the Azure PR preview before any approved merge.

