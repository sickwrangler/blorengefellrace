#!/usr/bin/env node

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
  ["images/generated/photos/home-hero.jpg", "image/jpeg"],
];
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
