const schedulerActor = Object.freeze({ authenticated: true, role: "production_scheduler", actorType: "scheduler", id: "azure-production-timer" });

export function validateProductionSchedulerEnvironment(environment) {
  if (environment.REGISTRATION_ENVIRONMENT !== "production") throw new Error("The production scheduler requires the production environment.");
  for (const name of ["REGISTRATION_STATE", "REGISTRATION_SCHEDULER_TEST_NOW", "REGISTRATION_SCHEDULER_ALLOW_TEST_TIME", "REGISTRATION_EMAIL_SAFE_RECIPIENTS"]) {
    if (String(environment[name] ?? "").trim()) throw new Error(`Development or deployment state setting is forbidden in the production scheduler: ${name}`);
  }
  for (const name of ["REGISTRATION_STORAGE_ACCOUNT", "REGISTRATION_TABLE", "REGISTRATION_EVENT_PARTITION", "REGISTRATION_PUBLIC_BASE_URL"]) if (!String(environment[name] ?? "").trim()) throw new Error(`Required production scheduler setting is missing: ${name}`);
  if (/dev|test/i.test(`${environment.REGISTRATION_STORAGE_ACCOUNT}/${environment.REGISTRATION_TABLE}/${environment.REGISTRATION_EVENT_PARTITION}`)) throw new Error("Production scheduler cannot reference development storage.");
  const recoveryEnabled = String(environment.REGISTRATION_EMAIL_RECOVERY_ENABLED ?? "false").trim().toLowerCase();
  if (!["true", "false"].includes(recoveryEnabled)) throw new Error("Production email recovery enablement must be explicitly true or false.");
  const recoveryBatchSize = Number.parseInt(String(environment.REGISTRATION_EMAIL_RECOVERY_BATCH_SIZE ?? "4"), 10);
  if (!Number.isInteger(recoveryBatchSize) || recoveryBatchSize < 1 || recoveryBatchSize > 4 || String(recoveryBatchSize) !== String(environment.REGISTRATION_EMAIL_RECOVERY_BATCH_SIZE ?? "4").trim()) throw new Error("Production email recovery batch size must be an integer from 1 to 4.");
  return true;
}

export function productionEmailRecoveryConfiguration(environment) {
  validateProductionSchedulerEnvironment(environment);
  return { enabled: String(environment.REGISTRATION_EMAIL_RECOVERY_ENABLED ?? "false").trim().toLowerCase() === "true", maxMessages: Number.parseInt(String(environment.REGISTRATION_EMAIL_RECOVERY_BATCH_SIZE ?? "4"), 10) };
}

export function createProductionSchedulerHandler({ service, environment = process.env, clock = () => new Date(), logger = console }) {
  validateProductionSchedulerEnvironment(environment);
  const recovery = productionEmailRecoveryConfiguration(environment);
  return async function productionScheduledWork() {
    const scheduledAt = clock();
    try {
      const result = await service.runScheduledWork(schedulerActor, scheduledAt);
      if (!result?.ok) throw new Error("Production scheduled registration work was rejected.");
      if (result.emailHealth?.missing > 0) logger.error("registration_confirmation_missing", { environment: "production", count: result.emailHealth.missing });
      if (result.emailHealth?.backlog > 0) logger.error("registration_email_failed_backlog", { environment: "production", count: result.emailHealth.backlog, oldestAgeMinutes: result.emailHealth.oldestFailedAgeMinutes });
      const emailRecovery = recovery.enabled ? await service.runScheduledConfirmationRecovery(schedulerActor, { maxMessages: recovery.maxMessages }, scheduledAt) : { ok: true, status: "disabled", sent: 0 };
      if (!emailRecovery?.ok) throw new Error(`Production confirmation recovery paused: ${emailRecovery?.code ?? "UNKNOWN"}`);
      logger.log("Production registration scheduled work completed", { scheduledAt: scheduledAt.toISOString(), reminders: result.reminders, expiredOffers: result.expiredOffers, expiredPayments: result.expiredPayments, nextOfferCreated: result.nextOfferCreated, confirmationRecoveryStatus: emailRecovery.status, confirmationRecoverySent: emailRecovery.sent, confirmationRecoveryRemaining: emailRecovery.remaining });
      return { ...result, emailRecovery };
    } catch (error) {
      logger.error("Production registration scheduled work failed", { scheduledAt: scheduledAt.toISOString(), category: error?.name ?? "Error" });
      throw error;
    }
  };
}
