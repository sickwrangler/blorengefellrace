import { app } from "@azure/functions";
import { createApi } from "../shared/server/api.mjs";
import { createAzureTableRepository } from "../shared/server/repositories.mjs";
import { createMockPaymentAdapter, createCapturedEmailAdapter, assertSafeAdapters } from "../shared/server/adapters.mjs";
import { RegistrationService } from "../shared/server/service.mjs";
import { Phase3IntegrationService } from "../shared/server/phase3-service.mjs";
import { createAzureTableTransport } from "../storage.mjs";
import { createDevelopmentEmailAdapter, createDevelopmentStripeGateway } from "../providers.mjs";
import { createControlledDevelopmentEmail } from "../shared/server/development-email.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Required registration setting is missing: ${name}`);
  return value;
};

if (required("REGISTRATION_ENVIRONMENT") !== "development" || required("REGISTRATION_STATE") !== "test") {
  throw new Error("The registration API is restricted to development test mode.");
}
if (/^(?:sk|rk)_live_/i.test(String(process.env.STRIPE_SECRET_KEY ?? ""))) throw new Error("Stripe live credentials are forbidden in development.");

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
const stripeEnabled = process.env.STRIPE_ENABLED === "true";
const emailEnabled = process.env.ACS_EMAIL_ENABLED === "true";
const phase3Integrations = new Phase3IntegrationService({
  repository,
  stripeGateway: stripeEnabled ? createDevelopmentStripeGateway() : null,
  emailAdapter: emailEnabled ? createDevelopmentEmailAdapter() : createControlledDevelopmentEmail(),
  publicBaseUrl: stripeEnabled ? required("REGISTRATION_PUBLIC_BASE_URL") : ""
});
const handle = createApi({ service: new RegistrationService({ repository, paymentAdapter, emailAdapter }), phase3Integrations, environment: "development" });

const handler = async (request, context) => {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 65_536) return { status: 413, jsonBody: { ok: false, code: "PAYLOAD_TOO_LARGE" } };
    const headers = Object.fromEntries(request.headers.entries());
    const url = new URL(request.url);
    let body = {};
    if (request.method === "POST") {
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, "utf8") > 65_536) return { status: 413, jsonBody: { ok: false, code: "PAYLOAD_TOO_LARGE" } };
      if (url.pathname === "/api/v3/stripe/webhook") body = { rawBody };
      else {
        try { body = rawBody ? JSON.parse(rawBody) : {}; }
        catch { return { status: 400, jsonBody: { ok: false, code: "INVALID_JSON" } }; }
      }
    }
    const result = await handle({ method: request.method, pathname: url.pathname, headers, body, hostname: url.hostname, query: Object.fromEntries(url.searchParams) });
    return { status: result.status, headers: result.headers, body: JSON.stringify(result.body) };
  } catch (error) {
    context.error("Registration request failed", { category: error?.name ?? "Error" });
    return { status: 500, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify({ ok: false, code: "INTERNAL_ERROR" }) };
  }
};

for (const version of ["v2", "v3"]) app.http(`registration-${version}`, {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: `${version}/{*path}`,
  handler
});
