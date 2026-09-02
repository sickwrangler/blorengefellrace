#!/usr/bin/env node

import fs from "node:fs";

const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:4173/");
const checks = [
  ["", "text/html"],
  ["index.html", "text/html"],
  ["info.html", "text/html"],
  ["route.html", "text/html"],
  ["enter.html", "text/html"],
  ["result.html", "text/html"],
  ["privacy.html", "text/html"],
  ["404.html", "text/html"],
  ["components/navbar/navbar.html", "text/html"],
  ["components/footer/footer.html", "text/html"],
  ["downloads/blorenge-fell-race-2026.gpx", null],
  ["data/photos/manifest.json", "application/json"],
  ["route-map.js", "javascript"],
  ["photo-manager.js", "javascript"],
  ["style.css", "text/css"],
  ["style_info.css", "text/css"],
  ["style_route.css", "text/css"],
  ["docs/2026-content-plan.md", null],
  ["docs/architecture.md", null],
  ["docs/components.md", null],
  ["docs/current-system-audit.md", null],
  ["docs/local-development.md", null],
  ["docs/photo-management.md", null],
  ["docs/registration-architecture.md", null],
  ["docs/registration-privacy.md", null],
  ["docs/registration-test-checklist.md", null],
  ["docs/registration-opening-runbook.md", null],
  ["registration/index.html", "text/html"],
  ["registration/dashboard.html", "text/html"],
  ["registration/prototype.css", "text/css"],
  ["registration/runner.mjs", "javascript"],
  ["registration/dashboard.mjs", "javascript"],
  ["registration/prototype-client.mjs", "javascript"],
  ["registration/preview-repository.mjs", "javascript"],
  ["registration/registration-core.mjs", "javascript"],
  ["registration/fixtures.json", "application/json"],
];
const photoManifest = JSON.parse(fs.readFileSync("data/photos/manifest.json", "utf8"));
for (const photo of photoManifest.photos) checks.push([photo.optimizedFilename, "image/jpeg"]);
const errors = [];

for (const [pathname, expectedType] of checks) {
  const url = new URL(pathname, baseUrl);
  try {
    const response = await fetch(url, { redirect: "follow" });
    const body = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) errors.push(`${url}: HTTP ${response.status}`);
    if (!body.byteLength) errors.push(`${url}: empty response`);
    if (expectedType && !contentType.includes(expectedType)) errors.push(`${url}: expected ${expectedType}, received ${contentType || "no content type"}`);
    console.log(`${response.status} ${contentType || "unknown"} ${body.byteLength} ${url}`);
  } catch (error) {
    errors.push(`${url}: ${error.message}`);
  }
}

if (errors.length) {
  errors.forEach((error) => console.error(`ERROR: ${error}`));
  process.exit(1);
}
console.log(`Smoke-tested ${checks.length} public pages and assets at ${baseUrl}`);
