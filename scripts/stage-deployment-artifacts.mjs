#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PRODUCTION_FILES = Object.freeze([
  "404.html",
  "components/footer/footer.css",
  "components/footer/footer.html",
  "components/navbar/navbar.css",
  "components/navbar/navbar.html",
  "data/photos/manifest.json",
  "data/public/results/2025.json",
  "data/public/results/2025.schema.json",
  "downloads/blorenge-fell-race-2026.gpx",
  "enter.html",
  "images/OS Map blorenge.png",
  "images/WFRAbanner.png",
  "images/blorenge_contour_lines.png",
  "images/blorenge_fellrace_logo.svg",
  "images/blorenge_fellrace_logo_white.svg",
  "index.html",
  "info.html",
  "photo-manager.js",
  "privacy.html",
  "result.html",
  "route-map.js",
  "route.html",
  "script.js",
  "style.css",
  "style_info.css",
  "style_results.css",
  "style_route.css",
  "style_winners.css"
]);

export const DEVELOPMENT_REGISTRATION_FILES = Object.freeze([
  "registration/dashboard.html",
  "registration/dashboard.mjs",
  "registration/index.html",
  "registration/organiser-view.mjs",
  "registration/preview-repository.mjs",
  "registration/prototype-client.mjs",
  "registration/prototype.css",
  "registration/registration-core.mjs",
  "registration/runner-flow.mjs",
  "registration/runner.mjs"
]);

const DEVELOPMENT_API_COPIES = Object.freeze([
  ["api/package.json", "package.json"],
  ["api/package-lock.json", "package-lock.json"],
  ["api/src/functions/registration.mjs", "src/functions/registration.mjs"],
  ["api/src/storage.mjs", "src/storage.mjs"],
  ["registration/registration-core.mjs", "src/shared/registration-core.mjs"],
  ["registration/server/adapters.mjs", "src/shared/server/adapters.mjs"],
  ["registration/server/api.mjs", "src/shared/server/api.mjs"],
  ["registration/server/auth.mjs", "src/shared/server/auth.mjs"],
  ["registration/server/repositories.mjs", "src/shared/server/repositories.mjs"],
  ["registration/server/service.mjs", "src/shared/server/service.mjs"]
]);

const forbiddenProductionPrefixes = Object.freeze([
  ".github/", ".local-registration/", "api/", "docs/", "infrastructure/",
  "private-data/", "private-exports/", "registration/", "registration-backups/",
  "scripts/", "tests/"
]);
const credentialPatterns = Object.freeze([
  /DefaultEndpointsProtocol=/i,
  /AccountKey=/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:^|[?&])sig=[^&\s]+/i,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /\/Users\/[^/]+\//
]);
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt", ".xml"]);

const normalize = (value) => value.split(path.sep).join("/");

function assertSafeRelative(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || normalize(relativePath).split("/").includes("..")) {
    throw new Error(`Unsafe artifact path: ${relativePath}`);
  }
}

function copyFile(sourceRoot, outputRoot, sourcePath, outputPath = sourcePath) {
  assertSafeRelative(sourcePath);
  assertSafeRelative(outputPath);
  const source = path.join(sourceRoot, sourcePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Required deployment file is missing: ${sourcePath}`);
  const target = path.join(outputRoot, outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

export function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  function walk(current) {
    return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(current, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  }
  return walk(directory).map((file) => normalize(path.relative(directory, file))).sort();
}

function approvedPhotoFiles(sourceRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, "data/photos/manifest.json"), "utf8"));
  if (!Array.isArray(manifest.photos)) throw new Error("Photo manifest does not contain an approved photo list.");
  return [...new Set(manifest.photos.filter((photo) => photo.active).map((photo) => photo.optimizedFilename))].sort().map((file) => {
    if (!/^images\/generated\/photos\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp)$/i.test(file)) {
      throw new Error(`Photo manifest contains a non-public artifact path: ${file}`);
    }
    return file;
  });
}

function productionConfiguration() {
  return {
    responseOverrides: {
      "404": { rewrite: "/404.html" }
    }
  };
}

function developmentConfiguration() {
  return {
    routes: [
      { route: "/registration/dashboard.html", allowedRoles: ["Organiser"] },
      { route: "/api/v2/organiser/*", allowedRoles: ["Organiser"] }
    ],
    responseOverrides: {
      "401": { redirect: "/.auth/login/aad?post_login_redirect_uri=.referrer", statusCode: 302 },
      "404": { rewrite: "/404.html" }
    }
  };
}

function writeConfiguration(outputRoot, configuration) {
  fs.writeFileSync(path.join(outputRoot, "staticwebapp.config.json"), `${JSON.stringify(configuration, null, 2)}\n`);
}

export function validateProductionArtifact(outputRoot, expectedFiles) {
  const actual = listFiles(outputRoot);
  const expected = [...expectedFiles].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const unexpected = actual.filter((file) => !expected.includes(file));
    const missing = expected.filter((file) => !actual.includes(file));
    throw new Error(`Production artifact mismatch. Unexpected: ${unexpected.join(", ") || "none"}. Missing: ${missing.join(", ") || "none"}.`);
  }
  for (const file of actual) {
    if (forbiddenProductionPrefixes.some((prefix) => file.startsWith(prefix)) || /(?:^|\/)\.DS_Store$/.test(file) || /\.(?:csv|env|log|sql|sqlite|xls|xlsx|xcf)$/i.test(file) || /(?:^|\/)package(?:-lock)?\.json$/.test(file)) {
      throw new Error(`Development, source, or sensitive-shaped file entered the production artifact: ${file}`);
    }
    if (textExtensions.has(path.extname(file).toLowerCase())) {
      const content = fs.readFileSync(path.join(outputRoot, file), "utf8");
      if (credentialPatterns.some((pattern) => pattern.test(content))) throw new Error(`Credential-shaped or workstation-specific content found in production artifact: ${file}`);
    }
  }
  return actual;
}

export function stageProduction({ sourceRoot = repositoryRoot, outputRoot = path.join(repositoryRoot, ".deployment/production") } = {}) {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const approved = [...PRODUCTION_FILES, ...approvedPhotoFiles(sourceRoot)];
  approved.forEach((file) => copyFile(sourceRoot, outputRoot, file));
  writeConfiguration(outputRoot, productionConfiguration());
  return validateProductionArtifact(outputRoot, [...approved, "staticwebapp.config.json"]);
}

export function stageDevelopment({ sourceRoot = repositoryRoot, outputRoot = path.join(repositoryRoot, ".deployment/development") } = {}) {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  const appRoot = path.join(outputRoot, "app");
  const apiRoot = path.join(outputRoot, "api");
  fs.mkdirSync(appRoot, { recursive: true });
  const publicFiles = [...PRODUCTION_FILES, ...approvedPhotoFiles(sourceRoot)];
  [...publicFiles, ...DEVELOPMENT_REGISTRATION_FILES].forEach((file) => copyFile(sourceRoot, appRoot, file));
  writeConfiguration(appRoot, developmentConfiguration());
  DEVELOPMENT_API_COPIES.forEach(([source, target]) => copyFile(sourceRoot, apiRoot, source, target));
  const appFiles = listFiles(appRoot);
  const apiFiles = listFiles(apiRoot);
  if (appFiles.some((file) => file.startsWith("registration/server/") || file === "registration/fixtures.json")) throw new Error("Server source or fixtures entered the development web artifact.");
  if (!appFiles.includes("registration/index.html") || !appFiles.includes("registration/dashboard.html") || !apiFiles.includes("src/functions/registration.mjs")) {
    throw new Error("Development artifact is missing a required registration component.");
  }
  return { appFiles, apiFiles };
}

function outputArgument(target) {
  const supplied = process.argv.find((argument) => argument.startsWith("--output="));
  return supplied ? path.resolve(supplied.slice("--output=".length)) : path.join(repositoryRoot, ".deployment", target);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!['production', 'development'].includes(target)) {
    console.error("Usage: node scripts/stage-deployment-artifacts.mjs <production|development> [--output=<directory>]");
    process.exit(1);
  }
  const result = target === "production" ? stageProduction({ outputRoot: outputArgument(target) }) : stageDevelopment({ outputRoot: outputArgument(target) });
  const files = Array.isArray(result) ? result : [
    ...result.appFiles.map((file) => `app/${file}`),
    ...result.apiFiles.map((file) => `api/${file}`)
  ].sort();
  console.log(`${target} artifact (${files.length} files):`);
  files.forEach((file) => console.log(file));
}
