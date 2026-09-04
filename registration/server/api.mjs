import { actorForRequest } from "./auth.mjs";

const response = (status, body, headers = {}) => ({ status, body, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const resultResponse = (result, success = 200) => response(result.ok ? success : result.code === "FORBIDDEN" ? 403 : result.code === "NOT_FOUND" ? 404 : 409, result);

export function createApi({ service, environment = "local" }) {
  const attempts = new Map();
  return async function handle({ method, pathname, headers = {}, body = {}, hostname = "127.0.0.1", query = {} }) {
    if (!pathname.startsWith("/api/v2/")) return response(404, { ok: false, code: "NOT_FOUND" });
    const actor = actorForRequest({ environment, hostname, headers });
    if (method === "POST" && !pathname.startsWith("/api/v2/organiser/")) { const key = `${hostname}:${pathname}`; const current = attempts.get(key) ?? { startedAt: Date.now(), count: 0 }; if (Date.now() - current.startedAt > 60_000) { current.startedAt = Date.now(); current.count = 0; } current.count += 1; attempts.set(key, current); if (current.count > 30) return response(429, { ok: false, code: "RATE_LIMITED" }, { "retry-after": "60" }); }
    if (method === "GET" && pathname === "/api/v2/registration/status") return response(200, { ok: true, ...(await service.status()) });
    if (method === "POST" && pathname === "/api/v2/registrations") return resultResponse(await service.create(body, { idempotencyKey: headers["idempotency-key"] }), 201);
    const confirmation = pathname.match(/^\/api\/v2\/registrations\/confirmation\/([^/]+)$/);
    if (method === "GET" && confirmation) return resultResponse(await service.confirmation(decodeURIComponent(confirmation[1])));
    const mockPayment = pathname.match(/^\/api\/v2\/registrations\/([^/]+)\/mock-payment$/);
    if (method === "POST" && mockPayment) return resultResponse(await service.mockPayment(decodeURIComponent(mockPayment[1]), body.outcome, headers["idempotency-key"]));
    const amendment = pathname.match(/^\/api\/v2\/registrations\/([^/]+)\/amendment-requests$/);
    if (method === "POST" && amendment) return resultResponse(await service.requestAmendment(decodeURIComponent(amendment[1]), body), 201);
    if (method === "GET" && pathname === "/api/v2/organiser/snapshot") return resultResponse(await service.snapshot(actor, query));
    if (method === "POST" && pathname === "/api/v2/organiser/state") return resultResponse(await service.setState(actor, body.state));
    if (method === "POST" && pathname === "/api/v2/organiser/import/synthetic") return resultResponse(await service.importSynthetic(actor, body.rows));
    if (method === "POST" && pathname === "/api/v2/organiser/import/synthetic-csv") return resultResponse(await service.importSyntheticCsv(actor, body.csv));
    if (method === "GET" && pathname === "/api/v2/organiser/export/public") return resultResponse(await service.exportPublic(actor));
    if (method === "GET" && pathname === "/api/v2/organiser/export/private") return resultResponse(await service.exportPrivate(actor));
    if (method === "POST" && pathname === "/api/v2/organiser/reset") return resultResponse(await service.resetDevelopment(actor));
    const viewed = pathname.match(/^\/api\/v2\/organiser\/registrations\/reference\/([^/]+)\/viewed$/);
    if (method === "POST" && viewed) return resultResponse(await service.markViewed(actor, decodeURIComponent(viewed[1])));
    const audit = pathname.match(/^\/api\/v2\/organiser\/registrations\/([^/]+)\/audit$/);
    if (method === "GET" && audit) return resultResponse(await service.auditHistory(actor, decodeURIComponent(audit[1])));
    const entry = pathname.match(/^\/api\/v2\/organiser\/registrations\/([^/]+)$/);
    if (method === "GET" && entry) return resultResponse(await service.entry(actor, decodeURIComponent(entry[1])));
    const erase = pathname.match(/^\/api\/v2\/organiser\/registrations\/([^/]+)\/(anonymise|delete)$/);
    if (method === "POST" && erase) return resultResponse(await service.erase(actor, decodeURIComponent(erase[1]), erase[2]));
    const action = pathname.match(/^\/api\/v2\/organiser\/registrations\/([^/]+)\/(race-number|remove-race-number|entry-status|cancel|refund|promote|correct)$/);
    if (method === "POST" && action) return resultResponse(await service.manage(actor, decodeURIComponent(action[1]), action[2].replaceAll("-", "_"), body));
    return response(404, { ok: false, code: "NOT_FOUND" });
  };
}
