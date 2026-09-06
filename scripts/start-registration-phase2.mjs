import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, RegistrationService } from "../registration/server/service.mjs";
import { createJsonFileRepository } from "../registration/server/repositories.mjs";
import { createMockPaymentAdapter, createCapturedEmailAdapter, assertSafeAdapters } from "../registration/server/adapters.mjs";
import { createApi } from "../registration/server/api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.REGISTRATION_PHASE2_PORT || 4173);
const dataFile = process.env.REGISTRATION_PHASE2_DATA_FILE || path.join(root, ".local-registration", "development.json");
const environment = "local";
const adapters = { payment: createMockPaymentAdapter(), email: createCapturedEmailAdapter() };
assertSafeAdapters(adapters, environment);
const repository = createJsonFileRepository(dataFile, createDatabase({ environment, registrationState: "test" }));
const service = new RegistrationService({ repository, paymentAdapter: adapters.payment, emailAdapter: adapters.email });
const api = createApi({ service, environment });
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gpx": "application/gpx+xml" };

async function requestBody(request) {
  let text = ""; for await (const chunk of request) { text += chunk; if (text.length > 65_536) throw new Error("Request too large"); }
  return text ? JSON.parse(text) : {};
}

const server = http.createServer(async (request, res) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith("/api/v2/")) {
      const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]));
      const result = await api({ method: request.method, pathname: url.pathname, headers, body: await requestBody(request), hostname: "127.0.0.1", query: Object.fromEntries(url.searchParams) });
      res.writeHead(result.status, result.headers); res.end(JSON.stringify(result.body)); return;
    }
    let pathname = decodeURIComponent(url.pathname); if (pathname === "/") pathname = "/index.html"; if (pathname.endsWith("/")) pathname += "index.html";
    const target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found"); return; }
    res.writeHead(200, { "content-type": mime[path.extname(target).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" }); fs.createReadStream(target).pipe(res);
  } catch { res.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ ok: false, code: "BAD_REQUEST" })); }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Phase 2 synthetic registration: http://127.0.0.1:${port}/registration/`);
  console.log(`Persistent local store: ${path.relative(root, dataFile)}`);
  console.log("No real payments, emails, authentication or Azure resources are configured.");
});
