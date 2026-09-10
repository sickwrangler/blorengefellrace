# Phase 3 production artifact manifest

Status: Phase 3C.1A review manifest. It has been constructed and simulated but not deployed.

The Static Web Apps artifact contains 84 files: 66 web files and 18 managed-API files. The separate production scheduler package contains 17 files. An unexpected file makes staging fail.

## Existing public website — 45 web files

The existing production boundary is preserved as these 28 fixed files, 16 active manifest-approved generated photos and generated route configuration:

```text
404.html
components/footer/footer.css
components/footer/footer.html
components/navbar/navbar.css
components/navbar/navbar.html
data/photos/manifest.json
data/public/results/2025.json
data/public/results/2025.schema.json
downloads/blorenge-fell-race-2026.gpx
enter.html
images/OS Map blorenge.png
images/WFRAbanner.png
images/blorenge_contour_lines.png
images/blorenge_fellrace_logo.svg
images/blorenge_fellrace_logo_white.svg
images/generated/photos/home-community-runner-dog.jpg
images/generated/photos/home-community-start.jpg
images/generated/photos/home-descent.jpg
images/generated/photos/home-hero.jpg
images/generated/photos/home-wildfire-response.jpg
images/generated/photos/home-wildfire-smoke.jpg
images/generated/photos/info-finishers.jpg
images/generated/photos/info-third-jonathan.jpg
images/generated/photos/info-winner-bethan.jpg
images/generated/photos/route-ascent.jpg
images/generated/photos/route-finish.jpg
images/generated/photos/route-start.jpg
images/generated/photos/route-steep-climb.jpg
images/generated/photos/route-tramroad.jpg
images/generated/photos/route-trig.jpg
images/generated/photos/route-tunnel.jpg
index.html
info.html
photo-manager.js
privacy.html
result.html
route-map.js
route.html
script.js
staticwebapp.config.json
style.css
style_info.css
style_results.css
style_route.css
style_winners.css
```

## Production registration browser — 21 additional web files

```text
registration/dashboard.html
registration/dashboard.mjs
registration/declaration.html
registration/declaration.mjs
registration/declarations.mjs
registration/index.html
registration/manage.html
registration/manage.mjs
registration/organiser-view.mjs
registration/payment-return.html
registration/payment-return.mjs
registration/payment-state.mjs
registration/production-client.mjs
registration/production-query.mjs
registration/production-validation.mjs
registration/prototype.css
registration/runner-errors.mjs
registration/runner-flow.mjs
registration/runner.mjs
registration/start-list.html
registration/start-list.mjs
```

These files are copied through a production build transform. Imports point only to the production client, validation and query modules. Development persistence, fixtures, reset, mock-payment and safe-recipient controls are absent.

## Managed production API — 18 files

```text
package-lock.json
package.json
src/functions/registration-production.mjs
src/production-config.mjs
src/production-providers.mjs
src/production-storage.mjs
src/shared/declarations.mjs
src/shared/server/auth.mjs
src/shared/server/communications.mjs
src/shared/server/email-templates.mjs
src/shared/server/order-service.mjs
src/shared/server/phase3-domain.mjs
src/shared/server/phase3-integrations.mjs
src/shared/server/phase3-service.mjs
src/shared/server/production-api.mjs
src/shared/server/production-bootstrap.mjs
src/shared/server/production-service.mjs
src/shared/server/repositories.mjs
```

The development Function entry, development providers/storage, generic development API router, local adapters, development email redirect and legacy development service are excluded.

## Separate production scheduler — 17 files

```text
host.json
package-lock.json
package.json
src/functions/registration-production-scheduler.mjs
src/production-email.mjs
src/production-scheduler.mjs
src/production-storage.mjs
src/shared/declarations.mjs
src/shared/server/auth.mjs
src/shared/server/communications.mjs
src/shared/server/email-templates.mjs
src/shared/server/order-service.mjs
src/shared/server/phase3-domain.mjs
src/shared/server/phase3-integrations.mjs
src/shared/server/phase3-service.mjs
src/shared/server/production-bootstrap.mjs
src/shared/server/repositories.mjs
```

The development timer entry, controlled clock, development email redirect and development storage module are excluded.

## Always excluded

Repository-root deployment, `.github`, `.DS_Store`, documentation, infrastructure source, scripts, tests, fixtures, spreadsheets, environment files, exports, backups, logs, source maps, development browser/server modules and unused files remain outside every runtime artifact.

Regenerate and validate the manifests with:

```sh
node scripts/stage-deployment-artifacts.mjs production-registration
node scripts/stage-registration-production-scheduler.mjs
node scripts/simulate-registration-production.mjs
```
