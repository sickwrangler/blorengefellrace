import { app } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import { createAzureTableRepository } from "../shared/server/repositories.mjs";
import { Phase3IntegrationService } from "../shared/server/phase3-service.mjs";
import { createProductionAzureTableTransport } from "../production-storage.mjs";
import { createProductionSchedulerEmailAdapter } from "../production-email.mjs";
import { createProductionSchedulerHandler, validateProductionSchedulerEnvironment } from "../production-scheduler.mjs";

validateProductionSchedulerEnvironment(process.env);
const credential = new DefaultAzureCredential();
const transport = createProductionAzureTableTransport({ accountName: process.env.REGISTRATION_STORAGE_ACCOUNT, tableName: process.env.REGISTRATION_TABLE, partitionKey: process.env.REGISTRATION_EVENT_PARTITION, credential, under18EntriesEnabled: process.env.REGISTRATION_UNDER18_ENABLED === "true" });
const repository = createAzureTableRepository(transport);
const service = new Phase3IntegrationService({ repository, emailAdapter: createProductionSchedulerEmailAdapter(process.env, credential), publicBaseUrl: process.env.REGISTRATION_PUBLIC_BASE_URL, environment: "production" });

app.timer("registration-production-scheduled-work", { schedule: "0 */30 * * * *", runOnStartup: false, useMonitor: true, handler: createProductionSchedulerHandler({ service, environment: process.env }) });
