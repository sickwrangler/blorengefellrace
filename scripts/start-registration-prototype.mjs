import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { submitRegistration, applyMockPayment, cancelRegistration, promoteRegistration, updateTestSettings, assignRaceNumber, statusSummary } from "../registration/registration-core.mjs";
import { createFixtureState } from "../registration/preview-repository.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.REGISTRATION_PROTOTYPE_PORT || 4173);
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "registration/fixtures.json"), "utf8"));
let state = createFixtureState(fixtures, "local");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gpx": "application/gpx+xml" };

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 32_768) throw new Error("Request too large");
  }
  return text ? JSON.parse(text) : {};
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/registration/status") return json(response, 200, statusSummary(state));
  if (request.method === "GET" && pathname === "/api/registration/organiser") return json(response, 200, { state });
  if (request.method === "POST" && pathname === "/api/registration/entries") {
    const result = submitRegistration(state, await body(request)); return json(response, result.ok ? 201 : 409, result);
  }
  if (request.method === "POST" && pathname === "/api/registration/settings") return json(response, 200, updateTestSettings(state, await body(request)));
  if (request.method === "POST" && pathname === "/api/registration/reset") { state = createFixtureState(fixtures, "local"); return json(response, 200, { ok: true, state }); }
  const match = pathname.match(/^\/api\/registration\/entries\/([^/]+)\/(payment|cancel|promote|race-number)$/);
  if (request.method === "POST" && match) {
    const [, id, action] = match; const payload = await body(request);
    const result = action === "payment" ? applyMockPayment(state, id, payload.outcome)
      : action === "cancel" ? cancelRegistration(state, id)
      : action === "promote" ? promoteRegistration(state, id)
      : assignRaceNumber(state, id, payload.raceNumber);
    return json(response, result.ok ? 200 : 409, result);
  }
  return json(response, 404, { ok: false, code: "NOT_FOUND" });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/registration")) return await handleApi(request, response, url.pathname);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    if (pathname.endsWith("/")) pathname += "index.html";
    const target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); response.end("Not found"); return;
    }
    response.writeHead(200, { "content-type": mime[path.extname(target).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(target).pipe(response);
  } catch (error) { json(response, 400, { ok: false, code: "BAD_REQUEST", message: error.message }); }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Synthetic registration prototype: http://127.0.0.1:${port}/registration/`);
  console.log("TEST REGISTRATION ONLY — no external email, payment or persistent storage is configured.");
});
