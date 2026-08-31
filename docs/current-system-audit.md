# Current system overview

Last reviewed: 31 August 2026

## Summary

The Blorenge Fell Race website is a static public information site built with HTML, CSS, browser JavaScript, and images. It is hosted by Azure Static Web Apps and published from the project's GitHub repository through GitHub Actions.

The public production website is:

<https://www.blorengefellrace.cymru/>

## Application

The site does not require a server-side application, package build, database, or application API. Azure serves the files in the repository directly.

Main public pages:

- Home
- Information
- Route
- Entry
- Results
- Privacy

Shared navigation and footer content is stored under `components/`. Site images and other static media are stored under `images/`.

## Public services

The site uses several external public services:

- Google Forms for race registration
- Published Google Sheets and OpenSheet for race results
- Tableau Public for race statistics
- Google Analytics for site usage measurement
- Google Docs for published race documents
- Google Fonts, Font Awesome, YouTube, weatherwidget.io, and what3words for public content and presentation

Registration submissions and published result data are managed by those external services rather than stored by this static website.

## Deployment

GitHub stores the website source and GitHub Actions publishes reviewed changes to Azure Static Web Apps. Pull requests can be used to review proposed changes in a separate preview before they are approved for production.

There is no compilation or server startup step. The repository root is served as the website.

## Public-site checks

At the review date:

- the main public pages responded successfully over HTTPS;
- representative images and shared styles were available;
- the public registration form and results sources were reachable; and
- sampled production application files matched the reviewed repository version.

No registration form was submitted during these checks.

## Further review

Detailed operational and security review information is maintained separately from the public website.

