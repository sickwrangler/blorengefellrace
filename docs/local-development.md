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

The repository does not require a build. Run the dependency-free site validator
from the repository root:

```sh
git status --short --branch
node scripts/validate-site.mjs
```

The validator checks every HTML document for balanced structural elements,
duplicate IDs, required document metadata, image alternative text, iframe
titles, accessible link names, safe new-window links, local links and assets
(including CSS assets and filename case), JavaScript and JSON syntax, and the custom 404
configuration. It uses only the Node.js standard library.

The automated checks complement manual browser review, which should cover:

- home, information, route, entry, results, and privacy pages;
- navbar and footer links;
- images and case-sensitive paths;
- approximately 320, 375, 430, 768 and 1440 pixel widths, checking for horizontal overflow;
- the mobile navigation open and closed states, including 44px touch targets;
- information tabs with touch, Tab and arrow-key input;
- results tables using keyboard and horizontal scrolling;
- entry publication state (the previous registration form remains commented reference only);
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
