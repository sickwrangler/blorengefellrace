const schedulerActor = Object.freeze({ authenticated: true, role: "production_scheduler", actorType: "scheduler", id: "azure-production-timer" });

export function validateProductionSchedulerEnvironment(environment) {
  if (environment.REGISTRATION_ENVIRONMENT !== "production") throw new Error("The production scheduler requires the production environment.");
  for (const name of ["REGISTRATION_STATE", "REGISTRATION_SCHEDULER_TEST_NOW", "REGISTRATION_SCHEDULER_ALLOW_TEST_TIME", "REGISTRATION_EMAIL_SAFE_RECIPIENTS"]) {
    if (String(environment[name] ?? "").trim()) throw new Error(`Development or deployment state setting is forbidden in the production scheduler: ${name}`);
  }
  for (const name of ["REGISTRATION_STORAGE_ACCOUNT", "REGISTRATION_TABLE", "REGISTRATION_EVENT_PARTITION", "REGISTRATION_PUBLIC_BASE_URL"]) if (!String(environment[name] ?? "").trim()) throw new Error(`Required production scheduler setting is missing: ${name}`);
  if (/dev|test/i.test(`${environment.REGISTRATION_STORAGE_ACCOUNT}/${environment.REGISTRATION_TABLE}/${environment.REGISTRATION_EVENT_PARTITION}`)) throw new Error("Production scheduler cannot reference development storage.");
  return true;
}

export function createProductionSchedulerHandler({ service, environment = process.env, clock = () => new Date(), logger = console }) {
  validateProductionSchedulerEnvironment(environment);
  return async function productionScheduledWork() {
    const scheduledAt = clock();
    try {
      const result = await service.runScheduledWork(schedulerActor, scheduledAt);
      if (!result?.ok) throw new Error("Production scheduled registration work was rejected.");
      logger.log("Production registration scheduled work completed", { scheduledAt: scheduledAt.toISOString(), reminders: result.reminders, expiredOffers: result.expiredOffers, expiredPayments: result.expiredPayments, nextOfferCreated: result.nextOfferCreated });
      return result;
    } catch (error) {
      logger.error("Production registration scheduled work failed", { scheduledAt: scheduledAt.toISOString(), category: error?.name ?? "Error" });
      throw error;
    }
  };
}
