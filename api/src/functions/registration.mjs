import { app } from "@azure/functions";
import { createApi } from "../shared/server/api.mjs";
import { createAzureTableRepository } from "../shared/server/repositories.mjs";
import { createMockPaymentAdapter, createCapturedEmailAdapter, assertSafeAdapters } from "../shared/server/adapters.mjs";
import { RegistrationService } from "../shared/server/service.mjs";
import { createAzureTableTransport } from "../storage.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Required registration setting is missing: ${name}`);
  return value;
};

if (required("REGISTRATION_ENVIRONMENT") !== "development" || required("REGISTRATION_STATE") !== "test") {
  throw new Error("The registration API is restricted to development test mode.");
}

const transport = createAzureTableTransport({
  accountName: required("REGISTRATION_STORAGE_ACCOUNT"),
  tableName: required("REGISTRATION_TABLE"),
  sasToken: required("REGISTRATION_TABLE_SAS_TOKEN"),
  partitionKey: required("REGISTRATION_EVENT_PARTITION")
});
const repository = createAzureTableRepository(transport);
const paymentAdapter = createMockPaymentAdapter();
const emailAdapter = createCapturedEmailAdapter();
assertSafeAdapters({ payment: paymentAdapter, email: emailAdapter }, "development");
const handle = createApi({ service: new RegistrationService({ repository, paymentAdapter, emailAdapter }), environment: "development" });

app.http("registration-v2", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "v2/{*path}",
  handler: async (request, context) => {
    try {
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > 65_536) return { status: 413, jsonBody: { ok: false, code: "PAYLOAD_TOO_LARGE" } };
      const headers = Object.fromEntries(request.headers.entries());
      let body = {};
      if (request.method === "POST") {
        const raw = await request.text();
        if (Buffer.byteLength(raw, "utf8") > 65_536) return { status: 413, jsonBody: { ok: false, code: "PAYLOAD_TOO_LARGE" } };
        try { body = raw ? JSON.parse(raw) : {}; }
        catch { return { status: 400, jsonBody: { ok: false, code: "INVALID_JSON" } }; }
      }
      const url = new URL(request.url);
      const result = await handle({ method: request.method, pathname: url.pathname, headers, body, hostname: url.hostname, query: Object.fromEntries(url.searchParams) });
      return { status: result.status, headers: result.headers, body: JSON.stringify(result.body) };
    } catch (error) {
      context.error("Registration request failed", { category: error?.name ?? "Error" });
      return { status: 500, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify({ ok: false, code: "INTERNAL_ERROR" }) };
    }
  }
});
