# Architecture

## Overview

The Blorenge Fell Race website is a static, browser-rendered site. Azure Static Web Apps serves HTML, CSS, JavaScript, and images directly. There is no application server, API, or database in this repository.

```mermaid
flowchart LR
    U[User / browser]
    SITE[Public static website<br/>HTML / CSS / JavaScript / images]
    AZ[Azure Static Web Apps]
    GH[GitHub repository]
    GA[GitHub Actions deployment]
    FORM[Google Form<br/>registration]
    RESULTS[Google Sheets and OpenSheet<br/>race results]
    DOCS[Google Docs<br/>published race documents]
    TAB[Tableau Public<br/>race statistics]
    ANALYTICS[Google Analytics]
    MEDIA[Fonts, icons, weather,<br/>video and location services]

    U --> AZ --> SITE
    GH --> GA --> AZ
    SITE --> FORM
    SITE --> RESULTS
    SITE --> DOCS
    SITE --> TAB
    SITE --> ANALYTICS
    SITE --> MEDIA
```

## Components

| Component | Location | Responsibility |
|---|---|---|
| Home | `index.html` | Event summary, location, and community and environmental content |
| Information | `info.html` | Travel, kit, race information, images, and statistics |
| Route | `route.html` | Route narrative, map, images, and published assessment |
| Entry | `enter.html` | Embeds the external registration form |
| Results | `result.html` | Loads and presents current and historical published results |
| Privacy | `privacy.html` | Public privacy information and contact details |
| Shared navigation and footer | `components/` | Common page navigation and footer content |
| Styling | `style*.css` and component CSS | Layout, responsive presentation, tables, route, and winner styling |
| Behaviour | `script.js` and inline scripts | Page interaction, results rendering, analytics, and public embeds |
| Media | `images/` | Logos, maps, event photographs, and winner photographs |

## Data flow

- General event content and images are committed as static files.
- Registration is completed through an embedded Google Form.
- Results are loaded in the visitor's browser from published Google Sheets and OpenSheet endpoints.
- Tableau Public provides race statistics.
- Google Analytics receives website usage events from the browser.
- Public contact links open the visitor's email application; the website does not send email itself.

The repository contains no server-side payment, email, database, or storage implementation.

## Deployment flow

GitHub stores the source. GitHub Actions publishes reviewed website versions to Azure Static Web Apps. Pull-request previews provide a separate URL for checking proposed changes before production approval.

Detailed operational and security review information is maintained separately from the public website.

