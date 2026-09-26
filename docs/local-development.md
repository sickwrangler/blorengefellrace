# Local development

## Prerequisites

No framework or compilation is required for the static public pages. A modern browser and simple HTTP server are sufficient for those pages. Node.js is required for repository checks and registration development; the API and scheduler use locked npm dependencies. Regenerating editorial photographs additionally requires the macOS `sips` command.

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
node scripts/validate-registration.mjs
node --test tests/registration.test.mjs
node scripts/validate-route.mjs
node scripts/validate-photos.mjs
node scripts/inspect-photo-metadata.mjs
node scripts/generate-image-catalogue.mjs
node scripts/smoke-site.mjs
```

The validator checks every HTML document for balanced structural elements,
duplicate IDs, required document metadata, image alternative text, iframe
titles, accessible link names, safe new-window links, local links and assets
(including CSS assets and filename case), JavaScript and JSON syntax, and the custom 404
configuration. It uses only the Node.js standard library.

The route validator checks the confirmed coordinate fingerprint, start/finish,
metadata boundary, official published figures and interactive-map failure
states. The photo validator checks the manifest, source and generated files,
page assignments, roles, focal points, permissions metadata, collisions,
public file size and stripped display metadata. It also prints zero-use,
single-use and reused-image assignments. To regenerate one browser-ready
photograph without changing its source file, run:

```sh
node scripts/build-photos.mjs <image-id>
node scripts/generate-image-catalogue.mjs
```

Omit the image ID only when every derivative genuinely needs rebuilding. The
generated visual inventory is `docs/internal/image-catalogue.html` and remains
outside production. See `docs/photo-management.md` for the organiser workflow
and privacy boundary.

To validate the normalized public 2025 result data against its authoritative
workbook, keep the workbook outside the repository and run:

```sh
node scripts/validate-public-results.mjs <path-to-results-workbook.xlsx>
```

See `data/public/results/README.md` for the public field allowlist and
private-data boundary.

The automated checks complement manual browser review, which should cover:

- home, information, route, Recce, Kit Swap, entry, results, and privacy pages;
- navbar and footer links;
- images and case-sensitive paths;
- approximately 320, 375, 430, 768 and 1440 pixel widths, checking for horizontal overflow;
- the mobile navigation open and closed states, including 44px touch targets;
- information tabs with touch, Tab and arrow-key input;
- results tables using keyboard and horizontal scrolling;
- entry publication wording and the current production registration page without submitting real data;
- current and historical results;
- browser console and network errors;
- public embeds such as statistics, weather, video, fonts, and documents;
- the route map with pointer, keyboard and touch input, plus its GPX download and no-tile/no-script fallback; and
- manifest-managed image crops, captions and credits.

## External services

When the site is served locally, it still contacts public external services used for registration, results, statistics, analytics, and embedded content.

Do not submit registration forms, enter personal data, or trigger external transactions during routine smoke testing.

## Git workflow

- Make changes on a non-production branch.
- Review the worktree before switching branches or synchronizing changes.
- Use a pull request and passing validation for review. The current production workflow does not deploy PR previews; the stable development app is separate.
- Do not commit credentials, private entrant details, or unpublished spreadsheet data.
- Obtain explicit approval before merging a production change.

Detailed operational and security review information is maintained separately from the public website.

## Registration development

> The following local tools are development-only and synthetic-only. They do not represent the production data store and must never receive genuine runner details or live Stripe credentials.

Start the complete dependency-free Phase 1 prototype with one command:

```sh
node scripts/start-registration-prototype.mjs
```

Open <http://127.0.0.1:4173/registration/>. The server binds only to the local loopback interface and keeps synthetic registrations in memory. It starts with zero entries and Reset test returns it to zero; stopping it deletes the server-side session. No email or payment provider is configured.

The Phase 1 browser repository remains useful for isolated UI/domain tests in one browser profile. It is historical development tooling, not the current production architecture. See `registration-test-checklist.md` for its synthetic walkthrough.

Phase 2 adds the preferred persistent local API without removing the safe PR-preview fallback:

```sh
node scripts/start-registration-phase2.mjs
```

The runner, organiser area, controlled development email adapter, Stripe test/disabled integration and ignored persistent store are served together at <http://127.0.0.1:4173/registration/>. The payment-return page reads authoritative local server state and cannot mark an entry paid. Stop and restart the process to verify persistence. Reset explicitly with `node scripts/reset-registration-phase2.mjs`; development backup/restore is documented in `registration-phase2.md`.

The local start list is available at <http://127.0.0.1:4173/registration/start-list.html>. It polls the read-only minimised endpoint at `/api/v4/start-list`. Production now deploys its own reviewed registration and start-list files/API; development fixtures and reset/mock routes remain excluded from production.

To validate the managed development API package without using any Azure credential:

```sh
npm ci --prefix api --ignore-scripts
node scripts/prepare-registration-api.mjs
node scripts/validate-registration.mjs
node --test tests/*.test.mjs
```

The preparation step creates ignored copies of the validated server modules inside the deployable API package. Never add `api/src/shared/` or `api/node_modules/` to Git.

The development workflow separately applies `scripts/prepare-registration-development-routes.mjs` in GitHub Actions. Do not run that script for ordinary local or PR-preview testing; it adds the stable environment's Entra route rules to the deployment workspace.
