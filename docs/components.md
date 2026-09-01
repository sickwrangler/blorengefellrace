# Page and component guide

## Page map

| File | User-facing purpose | Main dependencies |
|---|---|---|
| `index.html` | Homepage, 2026 event summary, race character and environmental content | Global CSS, analytics, weather script, YouTube, images |
| `enter.html` | Confirmed 2026 entry facts and publication status | Global CSS, analytics |
| `result.html` | Current and historical race results | Global/results CSS, OpenSheet, published Google Sheet |
| `route.html` | Confirmed 2026 facts and clearly labelled previous-route context | Global/route CSS, map and photographs |
| `info.html` | Travel, kit, historical report, statistics and winner information in tabs | Global/info/winners CSS, tab JavaScript, Tableau and images |
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
| `style_info.css` | Information header, quotations and Tableau containment |
| `style_results.css` | Collapsible result groups and horizontally scrollable tables |
| `style_route.css` | Route introduction, map and alternating route sequence |
| `style_winners.css` | Historical podium, category and team presentation |
| `components/navbar/navbar.css` | Desktop and mobile navigation |
| `components/footer/footer.css` | Footer layout |

The principal breakpoints are 48rem for compact/tablet layouts and 64rem for the full homepage hero. All layouts are single-column by default.

## Images

Original photographs remain under `images/`. Display-sized derivatives are under `images/optimized/` and should be preferred when the rendered role does not need the original resolution. Do not overwrite or delete the originals when preparing a new derivative.

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
| Current route and entry publication status | `route.html` and `enter.html` |
| Statistics | Public Tableau views embedded in `info.html` |
