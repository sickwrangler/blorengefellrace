# Page and component guide

## Page map

| File | User-facing purpose | Main dependencies |
|---|---|---|
| `index.html` | Homepage, 2026 event summary, race character and environmental content | Global CSS, analytics, weather script, YouTube, images |
| `enter.html` | Confirmed 2026 entry facts and publication status | Global CSS, analytics |
| `result.html` | Current and historical race results | Global/results CSS, OpenSheet, published Google Sheet |
| `route.html` | Confirmed 2026 facts, interactive/static maps, GPX download and route guide | Global/route CSS, Leaflet, `route-map.js`, GPX and photographs |
| `info.html` | Travel, full kit guidance, historical report, statistics and winner information in tabs | Global/info/winners CSS, tab JavaScript and images |
| `privacy.html` | Privacy policy | Global CSS |
| `404.html` | Branded not-found page | Global CSS |

## Shared components

`components/navbar/navbar.html` contains the logo, primary links and compact mobile menu. Every top-level page embeds it in an iframe with class `nav-iframe`. The component posts its open or closed height to the parent page; `script.js` safely applies that height to the iframe.

`components/footer/footer.html` contains the contact address, privacy link and WFRA banner. Every top-level page embeds it in an iframe with class `footer-iframe`.

Iframe content is a separate document, so parent-page CSS does not automatically apply inside it. Keep component-specific presentation in the CSS file beside the component, and use `target="_top"` for links which must replace the full page.

## Design system

The reusable tokens live at the top of `style.css` as CSS custom properties:

- landscape colours: `--colour-forest`, `--colour-paper`, `--colour-ink`, `--colour-bracken`, `--colour-moss` and stone neutrals;
- type: `--font-display` for editorial headings and `--font-body` for readable text;
- spacing: `--space-1` through `--space-9`;
- widths: `--content-width` and `--reading-width`;
- details: `--border`, `--radius-small` and `--radius`.

New pages should use `page-shell` for their main width and vertical rhythm, `page-heading` for the opening hierarchy, `reading-width` for long prose, `actions` plus `button` for key links, and `notice` for important status text. Use `story-section`, `story-grid` and `story-media` only where an editorial image-and-text sequence is useful; avoid turning ordinary content into collections of cards.

## Styling responsibilities

| File | Responsibility |
|---|---|
| `style.css` | Tokens, global type and elements, shared page patterns, homepage, tabs and responsive rules |
| `style_info.css` | Information header, travel, kit, statistics and report layout |
| `style_results.css` | Collapsible result groups and horizontally scrollable tables |
| `style_route.css` | Route introduction, map and alternating route sequence |
| `route-map.js` | Loads the public GPX into Leaflet and provides route/tile failure states |
| `photo-manager.js` | Applies the photo manifest to composed image slots and ordered galleries |
| `style_winners.css` | Historical podium, category and team presentation |
| `components/navbar/navbar.css` | Desktop and mobile navigation |
| `components/footer/footer.css` | Footer layout |

The principal breakpoints are 48rem for compact/tablet layouts and 64rem for the full homepage hero. All layouts are single-column by default.

## Images

The main editorial catalogue is `data/photos/manifest.json`; metadata-stripped display derivatives are under `images/generated/photos/`. Source photographs remain outside that generated directory and must never be overwritten by the build. See `docs/photo-management.md` before adding, reassigning or retiring a photograph.

Give content photographs meaningful alternative text, use an empty alternative for genuinely decorative images, add intrinsic width and height, and lazy-load below-the-fold media. Use `object-fit: cover` only with a deliberate container height and check faces, runners and landscape landmarks at narrow and wide widths.

## JavaScript

- `script.js` manages only the responsive navigation iframe height.
- `info.html` contains the small tab controller, including URL-fragment and arrow-key support.
- `result.html` retains the existing result sources and contains table rendering and disclosure behaviour.
- Analytics initialization remains inline on the existing public pages.

## Content ownership

| Content | Source of truth |
|---|---|
| General event wording, dates, times and public links | HTML files in this repository |
| Historical results | Public Google Sheet exposed through OpenSheet |
| 2025 results | Published Google Sheet CSV |
| Current entry publication status | `enter.html` |
| 2025 statistics | Published public-result data summarized in `info.html` |
| Confirmed route, map and GPX | `route.html`, `route-map.js` and `downloads/blorenge-fell-race-2026.gpx` |
| Editorial photo catalogue | `data/photos/manifest.json` |
