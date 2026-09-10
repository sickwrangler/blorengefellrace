import { app } from "@azure/functions";
import { createAzureTableRepository } from "../shared/server/repositories.mjs";
import { ProductionRegistrationService } from "../shared/server/production-service.mjs";
import { Phase3IntegrationService } from "../shared/server/phase3-service.mjs";
import { createProductionApi } from "../shared/server/production-api.mjs";
import { loadProductionConfiguration } from "../production-config.mjs";
import { createProductionAzureTableTransport } from "../production-storage.mjs";
import { createProductionEmailAdapter, createProductionStripeGateway } from "../production-providers.mjs";

const configuration = loadProductionConfiguration();
const repository = createAzureTableRepository(createProductionAzureTableTransport({
  accountName: configuration.storageAccount,
  tableName: configuration.tableName,
  sasToken: configuration.tableSasToken,
  partitionKey: configuration.eventPartition,
  under18EntriesEnabled: configuration.under18EntriesEnabled
}));
const emailAdapter = createProductionEmailAdapter(configuration);
const stripeGateway = createProductionStripeGateway(configuration);
const phase3Integrations = new Phase3IntegrationService({ repository, stripeGateway, emailAdapter, publicBaseUrl: configuration.publicBaseUrl, environment: "production", orderConfiguration: { maxRunnersPerOrder: configuration.maxRunnersPerOrder } });
const handle = createProductionApi({ service: new ProductionRegistrationService({ repository, emailAdapter }), phase3Integrations, repository });

const handler = async (request, context) => {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 65_536) return { status: 413, jsonBody: { ok: false, code: "PAYLOAD_TOO_LARGE" } };
    const headers = Object.fromEntries(request.headers.entries()); const url = new URL(request.url); let body = {};
    if (request.method === "POST") {
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, "utf8") > 65_536) return { status: 413, jsonBody: { ok: false, code: "PAYLOAD_TOO_LARGE" } };
      if (url.pathname === "/api/v3/stripe/webhook") body = { rawBody };
      else { try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { return { status: 400, jsonBody: { ok: false, code: "INVALID_JSON" } }; } }
    }
    const result = await handle({ method: request.method, pathname: url.pathname, headers, body, hostname: url.hostname, query: Object.fromEntries(url.searchParams) });
    return { status: result.status, headers: result.headers, body: JSON.stringify(result.body) };
  } catch (error) {
    context.error("Production registration request failed", { category: error?.name ?? "Error" });
    return { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify({ ok: false, code: "PRODUCTION_STATE_UNAVAILABLE" }) };
  }
};

for (const version of ["v2", "v3", "v4"]) app.http(`registration-${version}`, { methods: ["GET", "POST"], authLevel: "anonymous", route: `${version}/{*path}`, handler });
