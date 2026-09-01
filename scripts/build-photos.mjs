#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { forbiddenJpegMetadata, readManifest, root, validateManifest } from "./photo-manifest.mjs";

function jpegWithoutPrivateSegments(buffer) {
  const chunks = [buffer.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= buffer.length && buffer[offset] === 0xff) {
    const marker = buffer[offset + 1];
    if (marker === 0xda) {
      chunks.push(buffer.subarray(offset));
      return Buffer.concat(chunks);
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) throw new Error("Malformed generated JPEG");
    if (![0xe1, 0xed, 0xfe].includes(marker)) chunks.push(buffer.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  throw new Error("Generated JPEG has no image-data marker");
}

function dimensions(file) {
  const result = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Could not inspect ${file}: ${result.stderr.trim()}`);
  const width = Number(result.stdout.match(/pixelWidth: (\d+)/)?.[1]);
  const height = Number(result.stdout.match(/pixelHeight: (\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Could not read dimensions for ${file}`);
  return { width, height };
}

const manifest = readManifest();
const initialErrors = validateManifest(manifest, { requireOutputs: false });
if (initialErrors.length) throw new Error(initialErrors.join("\n"));

for (const photo of manifest.photos) {
  const source = path.join(root, photo.sourceFilename);
  const output = path.join(root, photo.optimizedFilename);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const { width, height } = dimensions(source);
  const maximum = Math.min(1600, Math.max(width, height));
  const result = spawnSync("sips", [
    "--resampleHeightWidthMax", String(maximum),
    "--setProperty", "format", "jpeg",
    "--setProperty", "formatOptions", "low",
    source,
    "--out", output,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Could not generate ${photo.optimizedFilename}: ${result.stderr.trim()}`);
  fs.writeFileSync(output, jpegWithoutPrivateSegments(fs.readFileSync(output)));
  const findings = forbiddenJpegMetadata(fs.readFileSync(output));
  if (findings.length) throw new Error(`${photo.optimizedFilename}: ${findings.join(", ")}`);
  console.log(`Generated ${photo.optimizedFilename}`);
}
