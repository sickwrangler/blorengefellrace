const enabled = (value) => String(value ?? "").toLowerCase() === "true";
const required = (environment, name) => {
  const value = String(environment[name] ?? "").trim();
  if (!value) throw new Error(`Required production registration setting is missing: ${name}`);
  return value;
};

export function loadProductionConfiguration(environment = process.env) {
  if (environment.REGISTRATION_ENVIRONMENT !== "production") throw new Error("The production registration adapter requires the production environment.");
  if (environment.REGISTRATION_STATE && environment.REGISTRATION_STATE !== "CLOSED") throw new Error("A deployment setting cannot open production registration.");
  for (const name of ["REGISTRATION_EMAIL_SAFE_RECIPIENTS", "REGISTRATION_SCHEDULER_TEST_NOW", "REGISTRATION_SCHEDULER_ALLOW_TEST_TIME", "REGISTRATION_LOCAL_ORGANISER_BYPASS"]) {
    if (String(environment[name] ?? "").trim()) throw new Error(`Development-only setting is forbidden in production: ${name}`);
  }
  const storageAccount = required(environment, "REGISTRATION_STORAGE_ACCOUNT");
  const tableName = required(environment, "REGISTRATION_TABLE");
  const eventPartition = required(environment, "REGISTRATION_EVENT_PARTITION");
  if (/dev|test/i.test(storageAccount) || /development|test/i.test(tableName) || /dev|test/i.test(eventPartition)) throw new Error("Production configuration cannot reference development storage.");
  const publicBaseUrl = required(environment, "REGISTRATION_PUBLIC_BASE_URL");
  if (!/^https:\/\/www\.blorengefellrace\.cymru$/i.test(publicBaseUrl)) throw new Error("Production public base URL is invalid.");
  const stripeEnabled = enabled(environment.STRIPE_ENABLED);
  const emailEnabled = enabled(environment.ACS_EMAIL_ENABLED);
  if (!stripeEnabled && (environment.STRIPE_SECRET_KEY || environment.STRIPE_WEBHOOK_SIGNING_SECRET)) throw new Error("Stripe credentials must not be supplied while production Stripe is disabled.");
  if (!emailEnabled && (environment.ACS_EMAIL_CONNECTION_STRING || environment.REGISTRATION_EMAIL_SENDER)) throw new Error("Email credentials must not be supplied while production email is disabled.");
  return Object.freeze({
    storageAccount, tableName, eventPartition, publicBaseUrl,
    tableSasToken: required(environment, "REGISTRATION_TABLE_SAS_TOKEN"),
    stripeEnabled, emailEnabled,
    under18EntriesEnabled: enabled(environment.REGISTRATION_UNDER18_ENABLED),
    maxRunnersPerOrder: Number(environment.REGISTRATION_MAX_RUNNERS_PER_ORDER || 5),
    stripeSecretKey: stripeEnabled ? required(environment, "STRIPE_SECRET_KEY") : null,
    stripeWebhookSecret: stripeEnabled ? required(environment, "STRIPE_WEBHOOK_SIGNING_SECRET") : null,
    emailEndpoint: emailEnabled ? required(environment, "ACS_EMAIL_ENDPOINT") : null,
    emailConnectionString: emailEnabled ? String(environment.ACS_EMAIL_CONNECTION_STRING ?? "").trim() || null : null,
    emailSender: emailEnabled ? required(environment, "REGISTRATION_EMAIL_SENDER") : null
  });
}
