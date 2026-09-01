#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const source = process.argv[2];
const output = process.argv[3] ?? "downloads/blorenge-fell-race-2026.gpx";

if (!source) {
  console.error("Usage: node scripts/prepare-route-gpx.mjs <source.gpx> [output.gpx]");
  process.exit(1);
}

const xml = fs.readFileSync(source, "utf8");
const waypointTags = [...xml.matchAll(/<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"\s*\/>/g)];
const trackpointTags = [...xml.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"\s*\/>/g)];
const segmentCount = (xml.match(/<trkseg>/g) ?? []).length;

if (waypointTags.length !== 15 || trackpointTags.length !== 120 || segmentCount !== 1) {
  throw new Error(`Unexpected GPX shape: ${waypointTags.length} waypoints, ${trackpointTags.length} track points, ${segmentCount} segments`);
}

const coordinates = [...waypointTags, ...trackpointTags].map((match) => ({
  lat: match[1],
  lon: match[2],
}));
for (const { lat, lon } of coordinates) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error(`Invalid coordinate: ${lat}, ${lon}`);
  }
}

const start = trackpointTags[0].slice(1, 3);
const finish = trackpointTags.at(-1).slice(1, 3);
if (start[0] !== "51.8132300" || start[1] !== "-3.0369400" || finish[0] !== "51.8132200" || finish[1] !== "-3.0369400") {
  throw new Error("The source start or finish coordinate is not the confirmed Church Lane route");
}

const lats = coordinates.map(({ lat }) => Number(lat));
const lons = coordinates.map(({ lon }) => Number(lon));
const bounds = {
  minlat: Math.min(...lats).toFixed(7),
  minlon: Math.min(...lons).toFixed(7),
  maxlat: Math.max(...lats).toFixed(7),
  maxlon: Math.max(...lons).toFixed(7),
};
const waypointXml = waypointTags.map((match) => `  <wpt lat="${match[1]}" lon="${match[2]}"/>`).join("\n");
const trackpointXml = trackpointTags.map((match) => `      <trkpt lat="${match[1]}" lon="${match[2]}"/>`).join("\n");

const sanitized = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Blorenge Fell Race" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Blorenge Fell Race 2026</name>
    <desc>Confirmed 2026 Blorenge Fell Race route.</desc>
    <bounds minlat="${bounds.minlat}" minlon="${bounds.minlon}" maxlat="${bounds.maxlat}" maxlon="${bounds.maxlon}"/>
  </metadata>
${waypointXml}
  <trk>
    <name>Blorenge Fell Race 2026</name>
    <desc>Established race route, starting and finishing at the bottom of Church Lane, Llanfoist.</desc>
    <trkseg>
${trackpointXml}
    </trkseg>
  </trk>
</gpx>
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, sanitized);
console.log(`Wrote ${output} with ${trackpointTags.length} unchanged track coordinates and ${waypointTags.length} unchanged waypoints.`);
