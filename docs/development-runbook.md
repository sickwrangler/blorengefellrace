# Development and deployment runbook

## Branch roles

| Branch | Role | Production impact |
|---|---|---|
| `main` | Approved production source | Every push triggers the live Azure deployment |
| `codex/development` | Isolated Codex working branch | None while changes remain on the branch |
| Short-lived feature branches | Optional focused changes | None until a pull request is opened; the PR then gets a temporary preview |

Do not ask Codex to work directly on `main`. Start each change by checking that the current branch is `codex/development` (or a feature branch based on it).

## Before making a change

```bash
git fetch --prune origin
git switch codex/development
git status --short --branch
git rev-list --left-right --count HEAD...origin/codex/development
```

A clean synchronized branch reports no changed files and `0 0`. If local edits exist, review and preserve them before pulling, switching branches, or applying generated changes.

## Local preview

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/` and check:

1. Desktop and mobile widths.
2. Navbar and footer links on every changed page.
3. Images, fonts and embedded content.
4. Tab controls on the Info page.
5. Results tables and their expanded/collapsed states.
6. Browser console and network errors.
7. Wording, dates, times, locations and external URLs.

## Publish a preview safely

1. Commit and push changes to `codex/development` or a feature branch.
2. Open a pull request targeting `main`—do not merge it yet.
3. Wait for the Azure Static Web Apps check to publish its temporary preview URL.
4. Review the preview on desktop and a phone.
5. Correct issues on the same branch; Azure updates the preview on each push.
6. Merge only when the preview is accepted. The merge to `main` triggers production deployment.
7. Check the live site after deployment. Closing/merging the pull request removes its preview environment.

## Rollback

If a production change is faulty, revert the merge commit through GitHub and merge the revert to `main`. This creates a clear audit trail and triggers Azure to redeploy the previous behaviour. Avoid rewriting `main` history.

## Content update checklist

- Search for an old date/time across all HTML; event details may be duplicated.
- Confirm Welsh and English wording together.
- Ensure links use HTTPS and external links use `rel="noopener noreferrer"` when opening a new tab.
- Add useful `alt` text to content images; decorative images should use empty alt text.
- Compress large photographs before adding them.
- Never commit Azure tokens, passwords, private entrant details, or unpublished spreadsheet data.
- Update the privacy policy if data collection, analytics, entry processing, or third-party services change.

## Recommended repository safeguards

These are not currently enforced and require an explicit GitHub settings change:

- Protect `main` and require changes through a pull request.
- Require the Azure preview/build check before merge.
- Disable direct force-pushes and branch deletion on `main`.
- Optionally require one approval if another organiser can review changes.
