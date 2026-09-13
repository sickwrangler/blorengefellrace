#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jpegDimensions, readManifest, root, validateManifest } from "./photo-manifest.mjs";

const defaultOutput = path.join(root, "docs/internal/image-catalogue.html");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function generateImageCatalogue({ output = defaultOutput } = {}) {
  const manifest = readManifest();
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(errors.join("\n"));

  const cards = manifest.photos.map((photo) => {
    const absolute = path.join(root, photo.optimizedFilename);
    const { width, height } = jpegDimensions(fs.readFileSync(absolute));
    const relativeImage = path.relative(path.dirname(output), absolute).split(path.sep).join("/");
    const pages = photo.usedOn.map((page) => manifest.pages[page]).join(", ");
    const aspect = `${width}:${height} (${(width / height).toFixed(2)}:1)`;
    const sizeKb = Math.round(fs.statSync(absolute).size / 1024);
    return `
      <article class="image-card">
        <div class="preview preview--${escapeHtml(photo.role)}"><img src="${escapeHtml(relativeImage)}" alt="" style="object-position:${escapeHtml(photo.focalPoint)}"></div>
        <div class="details">
          <h2>${escapeHtml(photo.id)}</h2>
          <dl>
            <div><dt>File</dt><dd><code>${escapeHtml(photo.optimizedFilename)}</code></dd></div>
            <div><dt>Dimensions</dt><dd>${width} × ${height}; ${escapeHtml(aspect)}; ${sizeKb} KB</dd></div>
            <div><dt>Used on</dt><dd>${escapeHtml(pages || "No public usage")}</dd></div>
            <div><dt>Role</dt><dd>${escapeHtml(photo.role)}</dd></div>
            <div><dt>Focal point</dt><dd>${escapeHtml(photo.focalPoint)}</dd></div>
            <div><dt>Alt text</dt><dd>${escapeHtml(photo.alt)}</dd></div>
            <div><dt>Status</dt><dd>${photo.active ? "Active" : "Inactive"}</dd></div>
          </dl>
        </div>
      </article>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Internal image catalogue | Blorenge Fell Race</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#20251f;background:#f5f1e8}*{box-sizing:border-box}body{margin:0}main{width:min(100% - 2rem,90rem);margin:auto;padding:2rem 0 4rem}h1{margin-bottom:.4rem}.intro{max-width:60rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));gap:1rem}.image-card{overflow:hidden;border:1px solid #a79d8b;background:#fffdf8}.preview{background:#d8d0c1}.preview img{display:block;width:100%;height:100%;object-fit:cover}.preview--hero{aspect-ratio:16/9}.preview--feature{aspect-ratio:3/2}.preview--card{aspect-ratio:4/3}.details{padding:1rem}.details h2{margin-top:0;font-size:1.2rem}.details dl{margin:0}.details div{display:grid;grid-template-columns:6.5rem 1fr;gap:.5rem;padding:.35rem 0;border-top:1px solid #d8d0c1}.details dt{font-weight:700}.details dd{min-width:0;margin:0;overflow-wrap:anywhere}code{font-size:.82rem}
  </style>
</head>
<body>
  <main>
    <h1>Blorenge Fell Race image catalogue</h1>
    <p class="intro">Internal visual inventory generated from <code>data/photos/manifest.json</code>. This file is excluded from production deployment.</p>
    <div class="grid">${cards}
    </div>
  </main>
</body>
</html>
`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  return { output, count: manifest.photos.length };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const result = generateImageCatalogue();
  console.log(`Generated ${path.relative(root, result.output)} with ${result.count} managed images.`);
}
