#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { forbiddenJpegMetadata, publicImageMetadata, readManifest, root, validateManifest } from "./photo-manifest.mjs";

const manifest = readManifest();
const errors = validateManifest(manifest);
const warnings = [];
const pageHtml = new Map(Object.entries(manifest.pages).map(([page, file]) => [page, fs.readFileSync(path.join(root, file), "utf8")]));
const usage = new Map(manifest.photos.map((photo) => [photo.id, []]));

const invalidProbe = structuredClone(manifest);
invalidProbe.photos[1].id = invalidProbe.photos[0].id;
invalidProbe.photos[1].optimizedFilename = invalidProbe.photos[0].optimizedFilename;
invalidProbe.photos[1].alt = "";
invalidProbe.photos[1].credit = "";
invalidProbe.photos[1].focalPoint = "101% 50%";
const probeErrors = validateManifest(invalidProbe, { requireOutputs: false });
for (const expected of ["duplicate photo ID", "duplicate optimized filename", "missing alt", "missing credit", "focalPoint"]) {
  if (!probeErrors.some((error) => error.includes(expected))) errors.push(`validator self-check did not detect ${expected}`);
}

for (const photo of manifest.photos) {
  const source = path.join(root, photo.sourceFilename);
  if (fs.existsSync(source) && fs.statSync(source).size > 5_000_000) warnings.push(`${photo.id}: archival source is over 5 MB (not publicly deployed)`);
  if (fs.existsSync(source) && publicImageMetadata(fs.readFileSync(source)).includes("GPS location")) {
    errors.push(`${photo.id}: public source file contains GPS location metadata`);
  }
  const output = path.join(root, photo.optimizedFilename);
  if (fs.existsSync(output)) {
    if (fs.statSync(output).size > 500_000) errors.push(`${photo.id}: public derivative exceeds 500 KB`);
    for (const finding of forbiddenJpegMetadata(fs.readFileSync(output))) errors.push(`${photo.id}: generated file contains ${finding}`);
  }

  for (const [page, html] of pageHtml) {
    if (html.includes(`data-photo-id="${photo.id}"`) || (photo.usedOn.includes(page) && html.includes(`data-photo-region="${photo.section}"`))) {
      usage.get(photo.id).push(manifest.pages[page]);
      if (!photo.usedOn.includes(page)) errors.push(`${photo.id}: used on ${page} but that page is missing from usedOn`);
      if (!photo.active) errors.push(`${photo.id}: inactive photo is used on ${page}`);
    }
  }
  if (photo.active) {
    for (const page of photo.usedOn) {
      if (!usage.get(photo.id).includes(manifest.pages[page])) errors.push(`${photo.id}: active photo has no slot or region on ${page}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
for (const warning of warnings) console.warn(`NOTICE: ${warning}`);
console.log(`Validated ${manifest.photos.length} image records, source/output paths, assignments, roles, focal points, permissions, public size and stripped display metadata.`);
console.log("Managed image usage:");
for (const photo of manifest.photos) console.log(`${photo.id}\n  → ${usage.get(photo.id).join("\n  → ") || "no public usage"}`);
const unused = manifest.photos.filter((photo) => usage.get(photo.id).length === 0).map((photo) => photo.id);
const reused = manifest.photos.filter((photo) => usage.get(photo.id).length > 1).map((photo) => photo.id);
console.log(`Zero usages: ${unused.join(", ") || "none"}`);
console.log(`Multiple usages: ${reused.join(", ") || "none"}`);
