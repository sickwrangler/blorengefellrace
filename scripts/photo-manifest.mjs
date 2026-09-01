import fs from "node:fs";
import path from "node:path";

export const root = process.cwd();
export const manifestPath = path.join(root, "data/photos/manifest.json");

export function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function validateManifest(manifest, { requireOutputs = true } = {}) {
  const errors = [];
  const ids = new Set();
  const outputs = new Set();
  const requiredStrings = [
    "id", "sourceFilename", "optimizedFilename", "page", "section", "role",
    "alt", "credit", "objectPosition", "aspectRatioRole", "provenanceNote", "permissionStatus",
  ];
  const permissionStatuses = new Set(["approved", "existing-public-use", "review-required", "do-not-publish"]);

  if (manifest.version !== 1 || !Array.isArray(manifest.photos)) {
    return ["data/photos/manifest.json: expected version 1 and a photos array"];
  }

  for (const [index, photo] of manifest.photos.entries()) {
    const label = photo.id || `entry ${index + 1}`;
    for (const field of requiredStrings) {
      if (typeof photo[field] !== "string" || !photo[field].trim()) errors.push(`${label}: missing ${field}`);
    }
    if (ids.has(photo.id)) errors.push(`${label}: duplicate photo ID`);
    ids.add(photo.id);
    if (outputs.has(photo.optimizedFilename)) errors.push(`${label}: duplicate optimized filename`);
    outputs.add(photo.optimizedFilename);
    if (!Number.isInteger(photo.displayOrder)) errors.push(`${label}: displayOrder must be an integer`);
    if (typeof photo.active !== "boolean") errors.push(`${label}: active must be true or false`);
    if (photo.year !== null && (!Number.isInteger(photo.year) || photo.year < 1900 || photo.year > 2100)) errors.push(`${label}: year must be null or a four-digit year`);
    if (photo.link !== null && typeof photo.link !== "string") errors.push(`${label}: link must be null or a string`);
    if (!permissionStatuses.has(photo.permissionStatus)) errors.push(`${label}: unsupported permissionStatus`);
    if (photo.active && photo.permissionStatus === "do-not-publish") errors.push(`${label}: do-not-publish photo cannot be active`);
    if (!/^\d{1,3}% \d{1,3}%$/.test(photo.objectPosition)) errors.push(`${label}: objectPosition must look like "50% 50%"`);
    if (!fs.existsSync(path.join(root, photo.sourceFilename))) errors.push(`${label}: source file does not exist`);
    if (!photo.optimizedFilename.startsWith(`${manifest.generatedDirectory}/`)) errors.push(`${label}: optimized file must be inside ${manifest.generatedDirectory}`);
    if (requireOutputs && !fs.existsSync(path.join(root, photo.optimizedFilename))) errors.push(`${label}: optimized file does not exist; run node scripts/build-photos.mjs`);
  }
  return errors;
}

export function forbiddenJpegMetadata(buffer) {
  const findings = [];
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return ["not a JPEG file"];
  for (let offset = 2; offset + 4 <= buffer.length;) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if (marker === 0xe1) findings.push("EXIF/XMP metadata");
    if (marker === 0xed) findings.push("IPTC/Photoshop metadata");
    if (marker === 0xfe) findings.push("JPEG comment metadata");
    offset += 2 + length;
  }
  return [...new Set(findings)];
}

function exifHasGps(payload) {
  if (payload.subarray(0, 6).toString("binary") !== "Exif\0\0") return false;
  const tiff = payload.subarray(6);
  const order = tiff.subarray(0, 2).toString("ascii");
  if (order !== "II" && order !== "MM") return false;
  const littleEndian = order === "II";
  const read16 = (offset) => littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const read32 = (offset) => littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  try {
    const ifdOffset = read32(4);
    const count = read16(ifdOffset);
    for (let index = 0; index < count; index += 1) {
      const entry = ifdOffset + 2 + (index * 12);
      if (read16(entry) === 0x8825 && read32(entry + 8) !== 0) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function publicImageMetadata(buffer) {
  const findings = new Set();
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    for (let offset = 2; offset + 4 <= buffer.length && buffer[offset] === 0xff;) {
      const marker = buffer[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      const payload = buffer.subarray(offset + 4, offset + 2 + length);
      if (marker === 0xe1 && payload.subarray(0, 6).toString("binary") === "Exif\0\0") {
        findings.add("EXIF");
        if (exifHasGps(payload)) findings.add("GPS location");
      }
      if (marker === 0xe1 && payload.toString("utf8").includes("xap/1.0")) {
        findings.add("XMP");
        if (/GPS(?:Latitude|Longitude|Altitude)/i.test(payload.toString("utf8"))) findings.add("GPS location");
      }
      if (marker === 0xed) findings.add("IPTC/Photoshop");
      if (marker === 0xfe) findings.add("JPEG comment");
      offset += 2 + length;
    }
  } else if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    if (buffer.includes(Buffer.from("EXIF"))) findings.add("EXIF");
    if (buffer.includes(Buffer.from("XMP "))) findings.add("XMP");
    if (/GPS(?:Latitude|Longitude|Altitude)/i.test(buffer.toString("binary"))) findings.add("GPS location");
  }
  return [...findings];
}
