export const RUNNER_STAGE_ACTIONS = Object.freeze({
  1: Object.freeze(["details-continue"]),
  2: Object.freeze(["race-back", "race-continue"]),
  3: Object.freeze(["review-back", "submit-test"]),
  4: Object.freeze(["payment-successful", "payment-declined", "payment-abandoned"])
});

export function isRunnerActionAvailable(stage, actionId, hasRegistration = false) {
  if (!RUNNER_STAGE_ACTIONS[stage]?.includes(actionId)) return false;
  return stage !== 4 || hasRegistration;
}

export function organiserHandoverUrl(testReference) {
  return `dashboard.html?ref=${encodeURIComponent(testReference)}`;
}
