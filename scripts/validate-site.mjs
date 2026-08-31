#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const errors = [];
const warnings = [];
const ignoredDirectories = new Set([".git", "node_modules"]);
const voidElements = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);
const checkedNesting = new Set([
  "html", "head", "body", "main", "header", "footer", "nav", "section",
  "article", "aside", "figure", "figcaption", "div", "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "form", "button", "a", "p",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function countElements(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b`, "gi"))].length;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function exactPathExists(target) {
  const absolute = path.resolve(target);
  const relativeTarget = path.relative(root, absolute);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) return false;

  let current = root;
  for (const segment of relativeTarget.split(path.sep).filter(Boolean)) {
    const names = fs.readdirSync(current);
    if (!names.includes(segment)) return false;
    current = path.join(current, segment);
  }
  return fs.existsSync(current);
}

function localTarget(sourceFile, reference) {
  const [pathname] = reference.split("?")[0].split("#");
  if (!pathname) return sourceFile;

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  let target = decoded.startsWith("/")
    ? path.join(root, decoded.slice(1))
    : path.resolve(path.dirname(sourceFile), decoded);
  if (decoded.endsWith("/")) target = path.join(target, "index.html");
  return target;
}

const allFiles = walk(root);
const htmlFiles = allFiles.filter((file) => file.endsWith(".html"));
const idsByFile = new Map();

for (const file of htmlFiles) {
  const name = relative(file);
  const source = fs.readFileSync(file, "utf8");
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  const structural = withoutComments
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");

  if (!/^\s*<!doctype html>/i.test(source)) errors.push(`${name}: missing HTML doctype`);
  for (const element of ["html", "head", "body", "title"]) {
    const found = countElements(structural, element);
    if (found !== 1) errors.push(`${name}: expected 1 <${element}> element, found ${found}`);
  }
  if (!/<html\b[^>]*\blang\s*=/i.test(structural)) errors.push(`${name}: <html> is missing a lang attribute`);
  if (!/<meta\b[^>]*charset\s*=/i.test(structural)) errors.push(`${name}: missing character encoding metadata`);
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(structural)) errors.push(`${name}: missing viewport metadata`);
  if (name !== "components/footer/footer.html" && countElements(structural, "h1") !== 1) {
    errors.push(`${name}: expected exactly one <h1>`);
  }

  const idMatches = [...structural.matchAll(/\sid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)];
  const ids = new Set();
  for (const match of idMatches) {
    const id = match[1] ?? match[2];
    if (ids.has(id)) errors.push(`${name}: duplicate id "${id}"`);
    ids.add(id);
  }
  idsByFile.set(file, ids);

  const stack = [];
  for (const match of structural.matchAll(/<(\/)?([a-z][\w:-]*)\b[^>]*>/gi)) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (!checkedNesting.has(tag) || voidElements.has(tag)) continue;
    if (!closing) {
      stack.push(tag);
      continue;
    }
    if (stack.at(-1) !== tag) {
      errors.push(`${name}: closing </${tag}> does not match open <${stack.at(-1) ?? "none"}>`);
      const matchingIndex = stack.lastIndexOf(tag);
      if (matchingIndex >= 0) stack.splice(matchingIndex);
    } else {
      stack.pop();
    }
  }
  if (stack.length) errors.push(`${name}: unclosed structural elements: ${stack.join(", ")}`);

  for (const match of structural.matchAll(/<img\b[^>]*>/gi)) {
    if (attribute(match[0], "alt") === null) errors.push(`${name}: image is missing alt text`);
  }
  for (const match of structural.matchAll(/<iframe\b[^>]*>/gi)) {
    if (!attribute(match[0], "title")?.trim()) errors.push(`${name}: iframe is missing a useful title`);
  }
  for (const match of structural.matchAll(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi)) {
    const rel = attribute(match[0], "rel") ?? "";
    if (!rel.split(/\s+/).includes("noopener")) errors.push(`${name}: target="_blank" link is missing rel="noopener"`);
  }
  for (const match of structural.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const openingTag = match[0].slice(0, match[0].indexOf(">") + 1);
    const ariaLabel = attribute(openingTag, "aria-label");
    const imageAlt = [...match[1].matchAll(/<img\b[^>]*>/gi)]
      .map((image) => attribute(image[0], "alt") ?? "")
      .join(" ")
      .trim();
    if (!text && !ariaLabel?.trim() && !imageAlt) errors.push(`${name}: link has no accessible name`);
  }

  for (const match of source.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      new vm.Script(match[1], { filename: name });
    } catch (error) {
      errors.push(`${name}: inline JavaScript syntax error: ${error.message}`);
    }
  }
}

const skippedSchemes = /^(?:https?:|mailto:|tel:|data:|javascript:)/i;
for (const file of htmlFiles) {
  const name = relative(file);
  const source = fs.readFileSync(file, "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  for (const match of source.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const reference = match[1] ?? match[2];
    if (!reference || skippedSchemes.test(reference) || reference.startsWith("//")) continue;
    const target = localTarget(file, reference);
    if (!target || !exactPathExists(target)) {
      errors.push(`${name}: local reference does not exist with exact case: ${reference}`);
      continue;
    }
    const fragment = reference.includes("#") ? reference.split("#").at(-1) : "";
    if (fragment && target.endsWith(".html")) {
      let decodedFragment = fragment;
      try { decodedFragment = decodeURIComponent(fragment); } catch { /* invalid target is reported below */ }
      const targetIds = idsByFile.get(target);
      if (targetIds && !targetIds.has(decodedFragment)) errors.push(`${name}: missing fragment target: ${reference}`);
    }
  }
}

for (const file of allFiles.filter((candidate) => candidate.endsWith(".css"))) {
  const name = relative(file);
  const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi)) {
    const reference = match[1] ?? match[2] ?? match[3];
    if (!reference || skippedSchemes.test(reference) || reference.startsWith("//")) continue;
    const target = localTarget(file, reference);
    if (!target || !exactPathExists(target)) {
      errors.push(`${name}: local CSS asset does not exist with exact case: ${reference}`);
    }
  }
}

for (const file of allFiles.filter((candidate) => candidate.endsWith(".js"))) {
  try {
    new vm.Script(fs.readFileSync(file, "utf8"), { filename: relative(file) });
  } catch (error) {
    errors.push(`${relative(file)}: JavaScript syntax error: ${error.message}`);
  }
}

for (const file of allFiles.filter((candidate) => candidate.endsWith(".json"))) {
  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${relative(file)}: JSON syntax error: ${error.message}`);
  }
}

const configPath = path.join(root, "staticwebapp.config.json");
if (!fs.existsSync(configPath)) {
  errors.push("staticwebapp.config.json: missing Azure Static Web Apps configuration");
} else {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.responseOverrides?.["404"]?.rewrite !== "/404.html") {
    errors.push("staticwebapp.config.json: 404 responses must rewrite to /404.html");
  }
}

if (fs.existsSync(path.join(root, "routes.json"))) {
  warnings.push("routes.json is deprecated by Azure Static Web Apps; use staticwebapp.config.json");
}

for (const warning of warnings) console.warn(`WARNING: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.error(`\nValidation failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} HTML files, JavaScript syntax, local links/assets, IDs, and basic accessibility.`);
