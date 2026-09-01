# Photo management

The site uses `data/photos/manifest.json` as the catalogue for its main editorial photographs. JSON was chosen instead of CSV because the dependency-free Node.js checks and the browser can read it directly, while captions containing punctuation do not need CSV-specific escaping.

## Directory boundary

- Existing vetted source photographs remain outside `images/generated/photos/`.
- Browser-ready derivatives are generated into `images/generated/photos/`. Do not hand-edit these files.
- A source photograph may be kept in the repository only when its public use is appropriate and its metadata has been reviewed.
- Use the ignored local `photo-source/` directory for an unreviewed master or a file that must not be deployed. That directory is not a backup; keep the authoritative original in the organiser’s managed storage.

Never place entrant spreadsheets, payment or registration screenshots, private correspondence, model-release records, personal contact details, precise private-location information, unreviewed camera originals, or photographs without an appropriate usage basis in a public image directory.

## Add or replace a photograph

1. Establish that the photograph may be published and record its creator/source. Do not infer permission from possession of the file.
2. Inspect the image for faces, bib details, background documents and other personal information. Check embedded metadata, especially GPS coordinates.
3. Put a vetted source in an appropriate source location. Keep an unreviewed master in `photo-source/`, outside Git.
4. Add or update one entry in `data/photos/manifest.json`. Use a stable, descriptive ID and a unique output filename under `images/generated/photos/`.
5. Write alternative text for the image’s purpose on the assigned page. Use an empty caption only when no visible caption is useful. Record `Not recorded` instead of inventing a photographer credit.
6. Set `permissionStatus` honestly: `approved`, `existing-public-use`, `review-required` or `do-not-publish`. A `do-not-publish` item cannot be active.
7. Run the build and checks:

   ```sh
   node scripts/build-photos.mjs
   node scripts/validate-photos.mjs
   node scripts/inspect-photo-metadata.mjs
   node scripts/validate-site.mjs
   ```

The image build uses macOS `sips`, limits the longest side to 1600 pixels without upscaling, uses its low-size JPEG preset for public web delivery and removes EXIF/XMP, IPTC/Photoshop and JPEG comment segments. The source is never overwritten.

## Assign, reorder or retire

- `page` and `section` assign a photograph to a page region.
- `role` records its purpose within that section.
- `displayOrder` controls ordering in manifest-driven galleries such as the community and 2025 race-report galleries.
- `objectPosition` supplies the focal point used with cropped layouts, for example `50% 35%`.
- `aspectRatioRole` documents the intended crop/layout role.
- Set `active` to `false` to retire an image without deleting its record or source.
- `link` may be `null` or a deliberately reviewed public destination.

Single composed page slots use `data-photo-id`; manifest-driven galleries use `data-photo-region`. Changing the file, alternative text, focal point, caption or credit for an existing slot requires only a manifest edit and a new build. Adding to or reordering a gallery also requires only the manifest and build. A new editorial section still needs an intentional HTML container.

## Validation and manual review

`scripts/validate-photos.mjs` detects missing required fields, alternative text, credit, permission status, source/output files, active page assignments, duplicate IDs, duplicate generated filenames and private metadata in display derivatives. It cannot establish copyright permission or decide whether a visible person or location should be published.

`scripts/inspect-photo-metadata.mjs` reports metadata categories for catalogued public source files without printing coordinates or other metadata values, and fails if a GPS-location category is found.

Before a pull request, manually review every new or changed photograph at desktop and mobile widths. Check focal crops, captions, credits, permission records, visible personal information, file size, and whether the photograph still communicates the intended content when images fail to load.
