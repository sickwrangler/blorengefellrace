#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { publicImageMetadata, readManifest, root } from "./photo-manifest.mjs";

const manifest = readManifest();
let gpsFiles = 0;
let metadataFiles = 0;
for (const photo of manifest.photos) {
  const source = path.join(root, photo.sourceFilename);
  const categories = publicImageMetadata(fs.readFileSync(source));
  if (categories.length) {
    metadataFiles += 1;
    if (categories.includes("GPS location")) gpsFiles += 1;
    console.log(`${photo.sourceFilename}: ${categories.join(", ")}`);
  }
}
console.log(`Inspected ${manifest.photos.length} public photo sources: ${metadataFiles} contain metadata categories; ${gpsFiles} contain GPS location metadata.`);
if (gpsFiles) process.exitCode = 1;
