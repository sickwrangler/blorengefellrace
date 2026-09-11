import crypto from "node:crypto";

const schedulerActor = Object.freeze({
  authenticated: true,
  role: "administrator",
  actorType: "scheduler",
  id: "azure-timer"
});

export function resolveSchedulerTime(environment, fallback = new Date()) {
  const controlled = String(environment.REGISTRATION_SCHEDULER_TEST_NOW ?? "").trim();
  if (!controlled) return new Date(fallback);
  if (environment.REGISTRATION_ENVIRONMENT !== "development" || environment.REGISTRATION_SCHEDULER_ALLOW_TEST_TIME !== "true") {
    throw new Error("Controlled scheduler time is unavailable outside approved development testing.");
  }
  const parsed = new Date(controlled);
  if (!Number.isFinite(parsed.valueOf())) throw new Error("Controlled scheduler time is invalid.");
  return parsed;
}

export function emailOperationId(idempotencyKey) {
  const digest = crypto.createHash("sha256").update(String(idempotencyKey)).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function createSchedulerHandler({ service, environment = process.env, clock = () => new Date(), logger = console }) {
  if (environment.REGISTRATION_ENVIRONMENT !== "development" || environment.REGISTRATION_STATE !== "test") {
    throw new Error("The registration scheduler is restricted to development test mode.");
  }
  return async function scheduledRegistrationWork() {
    const scheduledAt = resolveSchedulerTime(environment, clock());
    try {
      const result = await service.runScheduledWork(schedulerActor, scheduledAt);
      if (!result?.ok) throw new Error("Scheduled registration work was rejected.");
      logger.log("Registration scheduled work completed", {
        scheduledAt: scheduledAt.toISOString(),
        reminders: result.reminders,
        expiredOffers: result.expiredOffers,
        expiredPayments: result.expiredPayments,
        nextOfferCreated: result.nextOfferCreated
      });
      return result;
    } catch (error) {
      logger.error("Registration scheduled work failed", {
        scheduledAt: scheduledAt.toISOString(),
        category: error?.name ?? "Error"
      });
      throw error;
    }
  };
}
