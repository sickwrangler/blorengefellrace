# Deployment

## Public website

The production website is hosted by Azure Static Web Apps:

<https://www.blorengefellrace.cymru/>

## Deployment model

The website source is stored in GitHub. GitHub Actions sends reviewed website versions to Azure Static Web Apps.

The site is deployed directly from the repository root:

- there is no package installation;
- there is no compilation step;
- there is no server startup command; and
- there is no application API or database migration.

Pull requests can receive a separate Azure preview URL. A preview allows maintainers to check a proposed version without changing the production website. Preview URLs do not use the production custom domain.

## Safe release process

1. Make changes on a non-production branch.
2. Review the source diff and run the checks in `local-development.md`.
3. Open a pull request and wait for its preview deployment.
4. Check the preview on desktop and mobile without submitting public forms.
5. Obtain approval before merging the pull request.
6. After an approved production deployment, check the main public pages and external integrations.

## Public boundaries

Registration, results, published documents, statistics, and analytics depend on the external public services described in `architecture.md`. A website deployment does not modify registration submissions or published race-result data.

Detailed operational and security review information is maintained separately from the public website.

