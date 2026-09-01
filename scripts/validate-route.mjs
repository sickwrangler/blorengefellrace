#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

const errors = [];
const gpx = fs.readFileSync("downloads/blorenge-fell-race-2026.gpx", "utf8");
const routePage = fs.readFileSync("route.html", "utf8");
const mapScript = fs.readFileSync("route-map.js", "utf8");
const points = [...gpx.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"\s*\/>/g)].map((match) => [match[1], match[2]]);
const waypoints = [...gpx.matchAll(/<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"\s*\/>/g)].map((match) => [match[1], match[2]]);
const fingerprint = (coordinates) => crypto.createHash("sha256").update(coordinates.map((point) => point.join(",")).join("\n")).digest("hex");

if (points.length !== 120) errors.push(`GPX should contain 120 track points, found ${points.length}`);
if (waypoints.length !== 15) errors.push(`GPX should contain 15 waypoints, found ${waypoints.length}`);
if ((gpx.match(/<trkseg>/g) ?? []).length !== 1) errors.push("GPX should contain one track segment");
if (fingerprint(points) !== "7a343ffd186b8766be249551b49e0e9d5cc38b85f492c8170d58fb31cc3305ee") errors.push("GPX track geometry differs from the confirmed source");
if (fingerprint(waypoints) !== "20fa3be6e83bc046992e36d2823e9665b6d11b1b771a5ef276ad1b57becda777") errors.push("GPX waypoints differ from the confirmed source");
if (points[0]?.join(",") !== "51.8132300,-3.0369400") errors.push("GPX start coordinate is not the confirmed Church Lane start");
if (points.at(-1)?.join(",") !== "51.8132200,-3.0369400") errors.push("GPX finish coordinate is not the confirmed Church Lane finish");
if (/<(?:ele|time|extensions|author|email)\b/i.test(gpx)) errors.push("GPX contains elevation, time, extension or personal metadata");
if (/2024|5396|501\.25|calculated/i.test(gpx)) errors.push("GPX contains obsolete or conflicting calculated metadata");
for (const fact of ["5.7 km", "485 m ascent", "bottom of Church Lane", "contains no elevation"]) {
  if (!routePage.includes(fact)) errors.push(`route.html is missing official fact or warning: ${fact}`);
}
for (const hook of ["fitBounds", "tileerror", "GPX could not", "route description and GPX download"]) {
  if (!mapScript.includes(hook)) errors.push(`route-map.js is missing expected behaviour: ${hook}`);
}

if (errors.length) {
  errors.forEach((error) => console.error(`ERROR: ${error}`));
  process.exit(1);
}
console.log("Validated confirmed GPX geometry, metadata boundary, official route facts, map bounds and failure states.");
