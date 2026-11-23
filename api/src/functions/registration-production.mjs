import { app } from "@azure/functions";
import { createAzureTableRepository } from "../shared/server/repositories.mjs";
import { ProductionRegistrationService } from "../shared/server/production-service.mjs";
import { Phase3IntegrationService } from "../shared/server/phase3-service.mjs";
import { createProductionApi } from "../shared/server/production-api.mjs";
import { loadProductionConfiguration } from "../production-config.mjs";
import { createProductionAzureTableTransport } from "../production-storage.mjs";
import { createProductionEmailAdapter, createProductionStripeGateway } from "../production-providers.mjs";

const privateWorkbookExporter = async (model) => {
  const { createPrivateRegistrationWorkbook } = await import("../private-workbook.mjs");
  return createPrivateRegistrationWorkbook(model);
};

const configuration = loadProductionConfiguration();
const sasDaysRemaining = configuration.storageSasExpiryAt ? Math.floor((new Date(configuration.storageSasExpiryAt).valueOf() - Date.now()) / 86_400_000) : null;
if (sasDaysRemaining === null) console.warn("registration_table_sas_expiry_unknown", { environment: "production" });
else if (sasDaysRemaining <= 7) console.error("registration_table_sas_expiry_7_days", { environment: "production", daysRemaining: sasDaysRemaining });
else if (sasDaysRemaining <= 14) console.warn("registration_table_sas_expiry_14_days", { environment: "production", daysRemaining: sasDaysRemaining });
else if (sasDaysRemaining <= 30) console.warn("registration_table_sas_expiry_30_days", { environment: "production", daysRemaining: sasDaysRemaining });
const storageTransport = createProductionAzureTableTransport({
  accountName: configuration.storageAccount,
  tableName: configuration.tableName,
  sasToken: configuration.tableSasToken,
  partitionKey: configuration.eventPartition,
  under18EntriesEnabled: configuration.under18EntriesEnabled
});
const repository = createAzureTableRepository(storageTransport);
const emailAdapter = createProductionEmailAdapter(configuration);
const stripeGateway = createProductionStripeGateway(configuration);
const phase3Integrations = new Phase3IntegrationService({ repository, stripeGateway, emailAdapter, publicBaseUrl: configuration.publicBaseUrl, organiserEmail: configuration.organiserEmail, environment: "production", orderConfiguration: { maxRunnersPerOrder: configuration.maxRunnersPerOrder, emailRecoveryMaxPerHour: configuration.emailRecoveryMaxPerHour } });
const handle = createProductionApi({ service: new ProductionRegistrationService({ repository, emailAdapter, stripeMode: stripeGateway?.mode ?? "disabled" }), phase3Integrations, repository, storageDiagnostics: storageTransport.storageMetadata, privateWorkbookExporter });

const handler = async (request, context) => {
  let pathname = "";
  let operation;
  const started = Date.now();
  const clientRequestId = request.headers.get("x-registration-request-id");
  const requestId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(clientRequestId ?? "")
    ? clientRequestId : context.invocationId;
  function logOutcome(status, result) {
    if (!operation) return;
    context.log("registration_operation_result", {
      operation, status, requestId, durationMs: Date.now() - started,
      code: result?.code ?? "OK", committed: result?.committed ?? (status >= 500 ? "unknown" : false),
      notification: result?.replacementNotification ?? result?.notificationDelivery ?? null
    });
  }
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 65_536) return { status: 413, jsonBody: { ok: false, code: "PAYLOAD_TOO_LARGE" } };
    const headers = Object.fromEntries(request.headers.entries()); const url = new URL(request.url); pathname = url.pathname; let body = {};
    if (request.method === "POST") {
      const runner = pathname.match(/^\/api\/v3\/management\/(transfer|withdraw)$/);
      const organiser = pathname.match(/^\/api\/v[34]\/organiser\/registrations\/[^/]+\/(transfer|withdraw)$/);
      if (runner) operation = `runner_${runner[1]}`;
      if (organiser) operation = `organiser_${organiser[1]}`;
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, "utf8") > 65_536) return { status: 413, jsonBody: { ok: false, code: "PAYLOAD_TOO_LARGE" } };
      if (url.pathname === "/api/v3/stripe/webhook") body = { rawBody };
      else { try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { return { status: 400, jsonBody: { ok: false, code: "INVALID_JSON" } }; } }
    }
    const result = await handle({ method: request.method, pathname: url.pathname, headers, body, hostname: url.hostname, query: Object.fromEntries(url.searchParams) });
    if (pathname === "/api/v3/stripe/webhook" && result.status >= 400) context.warn("stripe_payment_reconciliation_failed", { environment: "production", status: result.status, code: result.body?.code ?? "UNKNOWN" });
    logOutcome(result.status, result.body);
    const responseHeaders = operation ? { ...result.headers, "x-registration-request-id": requestId } : result.headers;
    return { status: result.status, headers: responseHeaders, body: Buffer.isBuffer(result.body) || result.body instanceof Uint8Array ? result.body : JSON.stringify(result.body) };
  } catch (error) {
    if (request.method === "POST" && pathname === "/api/v4/orders") context.error("registration_order_creation_5xx", { environment: "production" });
    const conflict = operation && [409, 412].includes(error?.statusCode);
    const status = conflict ? 409 : 503;
    const code = conflict ? "REGISTRATION_WRITE_CONFLICT" : "PRODUCTION_STATE_UNAVAILABLE";
    logOutcome(status, { code, committed: conflict ? false : "unknown" });
    context.error("Production registration request failed", { category: error?.name ?? "Error" });
    return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
      ...(operation ? { "x-registration-request-id": requestId } : {}) }, body: JSON.stringify({ ok: false, code }) };
  }
};

for (const version of ["v2", "v3", "v4"]) app.http(`registration-${version}`, { methods: ["GET", "POST"], authLevel: "anonymous", route: `${version}/{*path}`, handler });
