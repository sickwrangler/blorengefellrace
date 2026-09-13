# Photo management

The site uses `data/photos/manifest.json` as the single catalogue for its managed public photography. JSON was chosen instead of CSV because the dependency-free Node.js checks and the browser can read it directly, while captions containing punctuation do not need CSV-specific escaping.

## Directory boundary

- Existing vetted source photographs remain outside `images/generated/photos/`.
- `images/source-approved/` may hold a metadata-stripped working source when an archival original must be retained unchanged. These working sources are not part of the production allowlist.
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
7. Build the new or changed image by stable ID, regenerate the internal catalogue and run the checks:

   ```sh
   node scripts/build-photos.mjs <image-id>
   node scripts/generate-image-catalogue.mjs
   node scripts/validate-photos.mjs
   node scripts/inspect-photo-metadata.mjs
   node scripts/validate-site.mjs
   ```

The image build uses macOS `sips`, limits the longest side to 1600 pixels without upscaling, uses its low-size JPEG preset for public web delivery and removes EXIF/XMP, IPTC/Photoshop and JPEG comment segments. The source is never overwritten.

## Assign, reorder or retire

- `usedOn` and `section` assign a photograph to one or more page regions. Reuse must be explicit in this array.
- `role` is one of `hero`, `feature` or `card`. CSS presents those roles as wide, approximately 3:2 and approximately 4:3 crops respectively.
- `displayOrder` controls ordering in manifest-driven galleries such as the community and 2025 race-report galleries.
- `focalPoint` supplies the focal point used with `object-fit: cover`, for example `50% 35%`. `photo-manager.js` applies it as a CSS custom property so the subject remains visible across breakpoints.
- `aspectRatioRole` documents the intended crop/layout role.
- Set `active` to `false` to retire an image without deleting its record or source.
- `link` may be `null` or a deliberately reviewed public destination.

Single composed page slots use `data-photo-id`; manifest-driven galleries use `data-photo-region`. Changing the file, alternative text, focal point, caption or credit for an existing slot requires only a manifest edit and a new build. Adding to or reordering a gallery also requires only the manifest and build. A new editorial section still needs an intentional HTML container.

## Validation and manual review

`scripts/validate-photos.mjs` detects missing required fields, alternative text, credit, permission status, source/output files, active page assignments, public use of inactive images, duplicate IDs, duplicate generated filenames, invalid roles/focal points, oversized public derivatives and private metadata in display derivatives. It prints every image-to-page assignment plus zero-use and multiple-use summaries. Large archival sources are reported as notices because they are retained for source quality but excluded from deployment.

`scripts/generate-image-catalogue.mjs` rebuilds `docs/internal/image-catalogue.html`, a local visual inventory showing thumbnails, dimensions, aspect, usage, role, focal point, alt text and status. The production allowlist excludes all `docs/` content, and the deployment tests explicitly check that this catalogue cannot enter the public artifact.

`scripts/inspect-photo-metadata.mjs` reports metadata categories for catalogued public source files without printing coordinates or other metadata values, and fails if a GPS-location category is found.

Before a pull request, manually review every new or changed photograph at desktop and mobile widths. Check focal crops, captions, credits, permission records, visible personal information, file size, and whether the photograph still communicates the intended content when images fail to load.
