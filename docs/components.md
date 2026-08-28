# Page and component guide

## Page map

| File | User-facing purpose | Main dependencies |
|---|---|---|
| `index.html` | Homepage, event summary, community and environmental content | Global CSS, analytics, weather widget, YouTube, images |
| `enter.html` | 2026 entry status; contains a currently commented Google Form embed | Global CSS, analytics, Google Forms when enabled |
| `result.html` | Current and historical race results | Global/results CSS, OpenSheet, published Google Sheet |
| `route.html` | Course explanation, map, photos and assessment | Global/route CSS, published Google Doc |
| `info.html` | Travel, kit, recce, report, statistics and winner information in tabs | Global/info/winners CSS, inline tab JavaScript, images and external links |
| `privacy.html` | Privacy policy | Global/info CSS, inline page CSS |

## Shared components

`components/navbar/navbar.html` contains the logo and primary navigation. Each page embeds it using an iframe with class `nav-iframe`. Its styling is split between `style.css` and `components/navbar/navbar.css`.

`components/footer/footer.html` contains the contact address, privacy link, and WFRA banner. Each page embeds it using an iframe with class `footer-iframe`. Its styling is split between `style.css` and `components/footer/footer.css`.

Because iframe content is a separate document, parent-page CSS and JavaScript do not automatically apply inside it. Links use `target="_top"` where navigation must replace the full page.

## Styling

| File | Responsibility |
|---|---|
| `style.css` | Global typography, spacing, page layout, embedded component sizing, homepage styles and responsive rules |
| `style_info.css` | Additional information/privacy page rules |
| `style_results.css` | Results tables and collapsible controls |
| `style_route.css` | Route page imagery and alternating route sections |
| `style_winners.css` | Winner/podium presentation within the information page |
| `components/navbar/navbar.css` | Navbar layout and responsive navigation |
| `components/footer/footer.css` | Footer layout |

## JavaScript

- `script.js` exports a single global `scrollToSection(sectionId)` helper.
- `info.html` contains inline logic for switching tab sections and reading URL fragments.
- `result.html` contains inline fetch, grouping, CSV parsing and table-rendering logic.
- Analytics initialization is duplicated inline in each top-level page.
- `enter.html` contains logic intended to react to the embedded form loading; the form markup is currently commented out.

## Static assets

The `images/` directory holds logos, maps, banners, route photographs, environmental photographs, and winner photographs. HTML generally references assets with either root-relative (`/images/...`) or page-relative (`images/...`) paths.

When replacing an image, preserve the filename if the page should update without HTML changes. For a new filename, search all HTML and CSS references before deleting the old asset.

## Content ownership

| Content | Source of truth |
|---|---|
| General event wording, dates, times and links | HTML files in this repository |
| Historical results | Public Google Sheet exposed through OpenSheet |
| 2025 results | Published Google Sheet CSV |
| Risk/environmental assessment | Published Google Doc linked from `route.html` |
| Race entry form | Google Form URL currently commented in `enter.html` |
| Deployment configuration | GitHub Actions workflow and GitHub Actions secret |

