import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  stageProduction,
  stageDevelopment,
  validateProductionArtifact
} from "../scripts/stage-deployment-artifacts.mjs";

function temporaryDirectory(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `blorenge-${name}-`));
}

function assertLocalReferencesExist(outputRoot, files) {
  const skipped = /^(?:https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i;
  const references = [];
  for (const file of files.filter((name) => /\.(?:html|css)$/.test(name))) {
    const source = fs.readFileSync(path.join(outputRoot, file), "utf8");
    const patterns = file.endsWith(".html")
      ? [/(?:href|src)\s*=\s*["']([^"']+)["']/gi]
      : [/url\(\s*(?:["']([^"']+)["']|([^)'"\s]+))\s*\)/gi];
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) references.push([file, match[1] ?? match[2]]);
  }
  for (const [sourceFile, reference] of references) {
    if (!reference || skipped.test(reference)) continue;
    const pathname = decodeURIComponent(reference.split(/[?#]/)[0]);
    const target = pathname.startsWith("/")
      ? path.join(outputRoot, pathname.slice(1))
      : path.resolve(path.dirname(path.join(outputRoot, sourceFile)), pathname);
    const resolved = pathname.endsWith("/") ? path.join(target, "index.html") : target;
    assert.ok(fs.existsSync(resolved), `${sourceFile} references missing artifact file ${reference}`);
  }
}

test("production staging contains only allowlisted public website files", () => {
  const outputRoot = temporaryDirectory("production-artifact");
  try {
    const files = stageProduction({ outputRoot });
    for (const required of ["index.html", "404.html", "data/public/results/2025.json", "downloads/blorenge-fell-race-2026.gpx", "staticwebapp.config.json"]) {
      assert.ok(files.includes(required), `missing ${required}`);
    }
    for (const forbidden of ["registration/", "api/", "docs/", "infrastructure/", "scripts/", "tests/", ".github/"]) {
      assert.equal(files.some((file) => file.startsWith(forbidden)), false, `unexpected ${forbidden}`);
    }
    assert.equal(files.some((file) => /(?:fixtures|package-lock|\.DS_Store|\.xcf|\.xlsx)$/i.test(file)), false);
    const configuration = JSON.parse(fs.readFileSync(path.join(outputRoot, "staticwebapp.config.json"), "utf8"));
    assert.equal(configuration.routes, undefined);
    assert.equal(configuration.responseOverrides["404"].rewrite, "/404.html");
    assertLocalReferencesExist(outputRoot, files);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("production validation fails closed for an unexpected registration asset", () => {
  const outputRoot = temporaryDirectory("production-deny");
  try {
    const expected = stageProduction({ outputRoot });
    fs.mkdirSync(path.join(outputRoot, "registration"));
    fs.writeFileSync(path.join(outputRoot, "registration/index.html"), "development only");
    assert.throws(() => validateProductionArtifact(outputRoot, expected), /Unexpected: registration\/index\.html/);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("production staging fails when an allowlisted public file is missing", () => {
  const sourceRoot = temporaryDirectory("missing-source");
  const outputRoot = temporaryDirectory("missing-output");
  try {
    fs.mkdirSync(path.join(sourceRoot, "data/photos"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "data/photos/manifest.json"), JSON.stringify({ photos: [] }));
    assert.throws(() => stageProduction({ sourceRoot, outputRoot }), /Required deployment file is missing/);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("development staging separates browser files from managed API source", () => {
  const outputRoot = temporaryDirectory("development-artifact");
  try {
    const { appFiles, apiFiles } = stageDevelopment({ outputRoot });
    assert.ok(appFiles.includes("registration/index.html"));
    assert.ok(appFiles.includes("registration/dashboard.html"));
    assert.equal(appFiles.some((file) => file.startsWith("registration/server/")), false);
    assert.equal(appFiles.includes("registration/fixtures.json"), false);
    assert.ok(apiFiles.includes("src/functions/registration.mjs"));
    assert.ok(apiFiles.includes("src/shared/server/service.mjs"));
    assert.equal(apiFiles.some((file) => file.startsWith("docs/") || file.startsWith("infrastructure/")), false);
    const configuration = JSON.parse(fs.readFileSync(path.join(outputRoot, "app/staticwebapp.config.json"), "utf8"));
    assert.deepEqual(configuration.routes[0].allowedRoles, ["Organiser"]);
    assert.equal(configuration.responseOverrides["401"].statusCode, 302);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
