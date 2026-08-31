# Local development

## Prerequisites

No framework, package manager, dependency installation, compilation, or environment file is required. A modern browser is sufficient. Node.js is optional for JavaScript syntax checking, and any simple static HTTP server can serve the site locally.

## Run locally

From `<repository-root>`, start a static HTTP server. For example, if Python 3 is already installed:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Use an HTTP server instead of opening files directly so absolute paths, embedded components, and browser requests behave more like the deployed website.

## Checks

The repository does not require a build. Useful checks include:

```sh
git status --short --branch
node --check script.js
```

Manual review should cover:

- home, information, route, entry, results, and privacy pages;
- navbar and footer links;
- images and case-sensitive paths;
- desktop and mobile widths;
- registration form display without submitting it;
- current and historical results;
- browser console and network errors; and
- public embeds such as statistics, weather, video, fonts, and documents.

## External services

When the site is served locally, it still contacts public external services used for registration, results, statistics, analytics, and embedded content.

Do not submit registration forms, enter personal data, or trigger external transactions during routine smoke testing.

## Git workflow

- Make changes on a non-production branch.
- Review the worktree before switching branches or synchronizing changes.
- Use a pull request and its preview deployment for review.
- Do not commit credentials, private entrant details, or unpublished spreadsheet data.
- Obtain explicit approval before merging a production change.

Detailed operational and security review information is maintained separately from the public website.

