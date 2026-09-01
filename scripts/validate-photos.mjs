#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { forbiddenJpegMetadata, publicImageMetadata, readManifest, root, validateManifest } from "./photo-manifest.mjs";

const manifest = readManifest();
const errors = validateManifest(manifest);
const html = ["index.html", "info.html", "route.html"].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");

const invalidProbe = structuredClone(manifest);
invalidProbe.photos[1].id = invalidProbe.photos[0].id;
invalidProbe.photos[1].optimizedFilename = invalidProbe.photos[0].optimizedFilename;
invalidProbe.photos[1].alt = "";
invalidProbe.photos[1].credit = "";
const probeErrors = validateManifest(invalidProbe, { requireOutputs: false });
for (const expected of ["duplicate photo ID", "duplicate optimized filename", "missing alt", "missing credit"]) {
  if (!probeErrors.some((error) => error.includes(expected))) errors.push(`validator self-check did not detect ${expected}`);
}

for (const photo of manifest.photos) {
  const source = path.join(root, photo.sourceFilename);
  if (fs.existsSync(source) && publicImageMetadata(fs.readFileSync(source)).includes("GPS location")) {
    errors.push(`${photo.id}: public source file contains GPS location metadata`);
  }
  const output = path.join(root, photo.optimizedFilename);
  if (fs.existsSync(output)) {
    for (const finding of forbiddenJpegMetadata(fs.readFileSync(output))) errors.push(`${photo.id}: generated file contains ${finding}`);
  }
  if (photo.active && !html.includes(`data-photo-id="${photo.id}"`) && !html.includes(`data-photo-region="${photo.section}"`)) {
    errors.push(`${photo.id}: active photo has no matching page slot or region`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`Validated ${manifest.photos.length} photo records, source/output paths, assignments, permissions and stripped display metadata.`);
