import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readManifest, validateManifest } from "../scripts/photo-manifest.mjs";
import { generateImageCatalogue } from "../scripts/generate-image-catalogue.mjs";

test("central image manifest uses stable IDs, standard roles and valid focal points", () => {
  const manifest = readManifest();
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual(Object.keys(manifest.roles).sort(), ["card", "feature", "hero"]);
  assert.equal(manifest.photos.find((photo) => photo.id === "route-ascent").usedOn.includes("recce"), true);
  assert.equal(manifest.photos.find((photo) => photo.id === "kit-swap-2024").sourceFilename, "images/source-approved/kit-swap-2024.jpg");
});

test("internal visual catalogue is generated from every managed image", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blorenge-image-catalogue-"));
  try {
    const output = path.join(directory, "image-catalogue.html");
    const result = generateImageCatalogue({ output });
    const html = fs.readFileSync(output, "utf8");
    assert.equal(result.count, readManifest().photos.length);
    for (const id of ["route-steep-climb", "route-tramroad", "kit-swap-2024", "route-ascent"]) assert.ok(html.includes(id));
    for (const label of ["Dimensions", "Used on", "Role", "Focal point", "Alt text", "Status"]) assert.ok(html.includes(label));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
