# Current system audit

Audit date: 31 August 2026 (Europe/London)

Scope: read-only inspection of the repository, public GitHub metadata, deployment configuration, production HTTP responses, and public external-service endpoints. The only files created by the audit are the four documents in `docs/` requested by the owner. No application code, Git history, branch, remote, deployment, or Azure setting was changed. A `git fetch --prune origin` refreshed remote-tracking metadata without changing the worktree.

## Executive status

| Comparison or check | Status | Evidence |
|---|---|---|
| Repository validity | Valid | Repository root resolves to this folder and `git rev-parse --is-inside-work-tree` returned `true`. |
| Local `main` vs GitHub `origin/main` | **Synchronized** | Both resolve to `25e996d4d64d730a79fc40512a8a01274c75f530`; ahead/behind is `0/0` after fetch. |
| GitHub `main` vs Azure production | **Synchronized** | The latest `main` Azure Static Web Apps workflow succeeded for the same SHA; production application files sampled are byte-for-byte equal to the local files. |
| Local vs Azure production | **Synchronized** | Local and production application files sampled match, and local/GitHub SHAs match. |
| Production availability | Healthy with caveats | All six public pages returned HTTP 200 over HTTPS; core assets and public data endpoints returned 200. Visual/browser-console testing was unavailable. |

## Git and GitHub

- Repository root: `/Users/paddyjarvis/Documents/Blorenge fell race website/blorengefellrace`
- Current branch: `main`
- Current local commit: `25e996d4d64d730a79fc40512a8a01274c75f530`
- Upstream: `origin/main`
- GitHub remote: `https://github.com/sickwrangler/blorengefellrace.git`
- GitHub default branch: `main`
- GitHub `main`: `25e996d4d64d730a79fc40512a8a01274c75f530`
- Pre-documentation worktree: clean, with no modified, staged, untracked, or ignored files reported.
- Current branch unpushed work: none.
- Local branches: only `main`.
- Remote branches: `origin/main`, `origin/Test`, and `origin/codex/development`.
- Open pull request: PR #1, `codex/development` into `main`, at `593433482757c7acd25174f3e77e76e87e1dd17e`. It contains documentation work and is not deployed to production.
- Branch protection: GitHub's public branches response reports `main` as unprotected. The detailed protection endpoint required authentication, so individual rule settings could not be queried; the unprotected flag is nevertheless an important risk.
- Tag/release: tag `V1` at `4bfd4eaf55ba5e6ffba07ebecf80523cc2766bfc`; one GitHub release, “Read only site ready!”, published 7 April 2024.
- Latest `main` workflow: Azure Static Web Apps CI/CD succeeded on 26 June 2026 for `25e996d`; all deploy steps succeeded.
- GitHub Pages also ran successfully for the same `main` commits. Its configuration API was not publicly readable, and production DNS points to Azure, not GitHub Pages. This appears redundant and should be reviewed before disabling anything.

## Worktree and repository hygiene

Before the requested documentation was added, the worktree was clean. After this audit, only these requested documentation paths should be new or modified:

- `docs/current-system-audit.md`
- `docs/architecture.md`
- `docs/deployment.md`
- `docs/local-development.md`

No `.gitignore` exists. Tracked generated/editor files include five `.DS_Store` files and one editable XCF image source. The repository contains about 51 MiB of tracked files, with several individual images between roughly 3.4 and 7.2 MiB. These are performance and repository-hygiene concerns, not evidence of lost work.

A filename-pattern and content-reference review found no tracked `.env`, private key, token file, connection-string file, or server credential. The Azure workflow refers to secret **names**, not values. Public identifiers such as the Google Analytics measurement ID, public Google Form/Sheet URLs, and Font Awesome kit URL are present in client-side files by design. This was not a full historical secret scan because no dedicated secret-scanning tool was installed.

## Application and data

This is a static site: HTML, CSS, browser JavaScript, and images. There is no package manifest, compiled framework, backend, API, database, or server-side runtime in the repository.

- Pages: `index.html`, `info.html`, `route.html`, `enter.html`, `result.html`, and `privacy.html`.
- Shared UI: navbar and footer HTML/CSS under `components/`, embedded as iframes.
- Event copy and current information: directly in the HTML files.
- Images: tracked under `images/`; 2025 winner images are under `images/winnersphotos/2025/`.
- Registration data entry: an embedded public Google Form in `enter.html`. No submission was made during this audit.
- Results: published Google Sheets CSV/JSON endpoints loaded by `result.html`; historical results also use OpenSheet.
- Statistics: public Tableau embeds in `info.html`.
- Analytics: Google Analytics (`gtag.js`).
- Other embeds: Google Fonts, Font Awesome, weatherwidget.io, YouTube, Google Docs, what3words, and external travel/race links.
- Payments: the privacy text mentions payments/payment processors, but no payment integration or SDK is present in this code. Any payment handling may occur in the external registration process and needs owner confirmation.
- Email: only public `mailto:` contact links; there is no email-sending service in the repository.
- Storage/database: none referenced apart from static Azure hosting and public Google-hosted data/documents.

Runtime environment-variable names: none. CI secret names: `AZURE_STATIC_WEB_APPS_API_TOKEN_AMBITIOUS_BAY_0339ED203` and GitHub-provided `GITHUB_TOKEN`. Values were not read or displayed.

## Deployment and Azure

- Hosting type: Azure Static Web Apps.
- Azure-generated hostname: `ambitious-bay-0339ed203.5.azurestaticapps.net` (from the production DNS CNAME).
- Custom production URL: `https://www.blorengefellrace.cymru/`.
- Static app name: likely `ambitious-bay-0339ed203`, inferred from DNS/workflow naming; the Azure resource display name was not confirmed through Azure Resource Manager.
- Production trigger: push to `main`.
- Pull-request trigger: opened, synchronized, reopened, and closed PRs targeting `main`; Azure Static Web Apps creates/closes preview environments through the workflow. PR #1 had a successful Azure workflow, but its preview URL was not available from public metadata.
- App source: repository root (`/`).
- API location: empty.
- Output location: empty; files are served directly.
- Build/runtime/startup command: none.
- Deployment mode: automatic GitHub Actions workflow using `Azure/static-web-apps-deploy@v1`.
- Conventional App Service slot or separate development Azure resource: not found. PR preview environments are configured; they are not the same as a permanent development application or App Service deployment slot.
- Health endpoint: none. HTTP page checks are the available health signal.
- Azure logs/resource configuration: unavailable because Azure CLI/access was not present.

Azure portal checks still required are listed in `deployment.md`.

## Production smoke test

Confirmed URL before testing: `https://www.blorengefellrace.cymru/`, backed by the Azure Static Web Apps hostname above.

HTTP 200 was returned by:

- `/`
- `/info.html`
- `/route.html`
- `/enter.html`
- `/result.html`
- `/privacy.html`
- representative images and shared navbar/footer styles
- the embedded Google Form
- all three results data endpoints
- the Tableau JavaScript API

All eight local HTML/component files reference local assets that exist with matching case/path. Core deployed HTML, JavaScript, CSS, navbar, and footer files match the local files byte-for-byte.

Important caveats:

- `routes.json` rewrites every path to `/index.html` with status 200. A deliberately nonexistent path therefore returned the homepage as HTTP 200. This masks broken URLs, harms monitoring/SEO, and makes automated broken-link detection less reliable.
- Interactive browser control was unavailable. Desktop/mobile visual layout, console errors, and failed browser network requests are **unknown**, not passed. Responsive viewport metadata and several CSS media queries are present, but code inspection is not visual validation.
- External links can change independently. Critical Google/OpenSheet/Tableau endpoints were checked, but every third-party informational link was not exhaustively browser-clicked.
- Production has no explicit build identifier or commit endpoint. The deployed SHA conclusion is supported by the successful deployment workflow, matching timestamp, DNS, and byte-equal files rather than a runtime-reported SHA.

## Validation results

- Build: no build command exists; Azure serves the source directly. Production/local file comparison passed for all application samples.
- Tests: no automated test suite exists.
- Type check: not applicable; no TypeScript or typed build system.
- Lint: no configured linter.
- JavaScript syntax: passed for `script.js` and every inline script block.
- Local link/asset existence: passed; no missing local target found.
- HTML diagnostic: the system `tidy` tool reported warnings/errors on all HTML files. Many are false positives from its older HTML vocabulary, but genuine structural warnings include duplicated document/body metadata in `privacy.html`, unmatched closing tags in `enter.html`/`result.html`, and stray `</i>` tags in the footer. No fixes were made.
- Dependency age/vulnerabilities: not applicable to a package dependency tree because none exists. GitHub Actions uses `actions/checkout@v3`, which is not current and should be reviewed separately. No upgrade was made.

## Risks

1. `main` appears unprotected while every push to it automatically deploys production.
2. No CI quality gate exists before deployment: no tests, HTML validation, link checking, or visual checks.
3. Catch-all routing returns 200 for missing pages, masking errors.
4. Production depends on several public third-party endpoints; results and registration can fail without a code/deployment failure.
5. No explicit deployed-SHA/health endpoint exists, so production identity is inferred.
6. The repository has no `.gitignore` and tracks OS metadata plus very large image/source files.
7. A second GitHub Pages workflow/deployment appears enabled, creating ambiguity and unnecessary deployment surface.
8. HTML structural issues may produce browser-specific layout or accessibility problems.
9. Registration/privacy/payment data ownership and retention cannot be verified from this frontend repository.
10. Azure resource settings, custom-domain certificate status, logs, roles, and resource-level environment configuration remain unverified without Azure access.

## Safest next actions

1. Review these documentation-only changes; do not merge or deploy them until the open documentation PR and desired workflow are reconciled.
2. In Azure, verify the exact Static Web App resource, production environment SHA/deployment time, custom domain/TLS, preview environments, access roles, logs, and resource inventory using the checklist in `deployment.md`.
3. Decide whether PR #1's documentation should be merged, superseded, or closed before creating overlapping documentation commits.
4. Protect `main` with required pull requests and the Azure workflow check, after confirming the owner's preferred governance.
5. Add non-deploying CI checks for HTML structure, internal/external links, JavaScript syntax, and responsive smoke tests.
6. Decide whether the catch-all 200 rewrite is intentional; if not, plan a separately reviewed routing change.
7. Confirm where registration submissions, any payments, email communication, and retention/deletion processes are administered.
8. Review the redundant GitHub Pages deployment and disable it only after confirming it is unused.
9. Plan repository hygiene and image optimization in a separate change, preserving source assets safely.

## Owner questions

1. Is PR #1 (`codex/development`) intended to become the documentation baseline, or should these audit documents supersede it?
2. Can you confirm the Azure Static Web App resource name/subscription/resource group and provide read-only Azure access or the portal evidence requested in `deployment.md`?
3. Is GitHub Pages intentionally enabled as a fallback, or is Azure Static Web Apps the sole intended host?
4. Does the Google Form itself process payments or trigger emails, and who controls the Form, Sheets, Tableau workbook, analytics property, and their data-retention permissions?
5. Is returning the homepage with status 200 for every unknown URL intentional?

