import { app } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import { createAzureTableRepository } from "../shared/server/repositories.mjs";
import { Phase3IntegrationService } from "../shared/server/phase3-service.mjs";
import { createAzureTableTransport } from "../storage.mjs";
import { createSchedulerEmailAdapter } from "../email.mjs";
import { createSchedulerHandler } from "../scheduler.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Required scheduler setting is missing: ${name}`);
  return value;
};

if (required("REGISTRATION_ENVIRONMENT") !== "development" || required("REGISTRATION_STATE") !== "test") {
  throw new Error("The registration scheduler is restricted to development test mode.");
}

const credential = new DefaultAzureCredential();
const repository = createAzureTableRepository(createAzureTableTransport({
  accountName: required("REGISTRATION_STORAGE_ACCOUNT"),
  tableName: required("REGISTRATION_TABLE"),
  partitionKey: required("REGISTRATION_EVENT_PARTITION"),
  credential
}));
const service = new Phase3IntegrationService({
  repository,
  emailAdapter: createSchedulerEmailAdapter(process.env, credential),
  publicBaseUrl: required("REGISTRATION_PUBLIC_BASE_URL")
});

app.timer("registration-scheduled-work", {
  schedule: "0 */30 * * * *",
  runOnStartup: false,
  useMonitor: true,
  handler: createSchedulerHandler({ service, environment: process.env })
});
