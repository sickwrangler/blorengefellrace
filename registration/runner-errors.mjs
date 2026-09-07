const aliases = Object.freeze({
  raceCategory: "genderCategory",
  emergencyContactName: "emergencyName",
  emergencyContactPhone: "emergencyPhone",
  typedFullName: "declarationName",
  signatoryRole: "declarationSignatoryRole",
  accepted: "acceptDeclaration"
});

export const RUNNER_FIELD_STAGES = Object.freeze({
  email: 1, firstName: 1, lastName: 1, phone: 1, addressLine1: 1, addressLine2: 1,
  city: 1, postcode: 1, genderCategory: 1, dateOfBirth: 1, club: 1,
  wfraMember: 1, wfraMembershipNumber: 1,
  emergencyName: 2, emergencyPhone: 2, acceptTerms: 2, acceptPrivacy: 2,
  declarationSignatoryRole: 2, declarationName: 2, acceptDeclaration: 2
});

export function normalizeRunnerErrors(errors = {}) {
  const mapped = {};
  const unmapped = [];
  for (const [serverName, message] of Object.entries(errors)) {
    const name = aliases[serverName] ?? serverName;
    if (RUNNER_FIELD_STAGES[name]) mapped[name] = String(message || "Please check this detail.");
    else unmapped.push("Some details could not be accepted. Refresh the page and try again.");
  }
  return { mapped, unmapped: [...new Set(unmapped)] };
}

export function runnerMessageForCode(code) {
  const messages = {
    DUPLICATE: "An active test entry already uses this email address.",
    LINK_UNAVAILABLE: "This private link is no longer available.",
    REGISTRATION_NOT_ACCEPTING: "Registration is not currently accepting entries.",
    PARENTAL_CONSENT_REQUIREMENTS_PENDING: "Entries for runners aged 16 or 17 are paused while the parental-consent process is confirmed.",
    PAYMENTS_UNAVAILABLE: "Online payment is not available yet. Your synthetic entry details have been retained.",
    MANAGEMENT_TOKEN_INVALID: "This secure entry link is no longer available.",
    CAPACITY_FULL: "There are currently no entry places available.",
    REFUND_NOT_READY: "A refund can only be requested after payment is confirmed.",
    REFUND_CUTOFF_PASSED: "The refund-request deadline has passed. Please contact the organiser if you need help.",
    AMENDMENT_CUTOFF_PASSED: "The amendment deadline has passed. Please contact the organiser if you need help.",
    TRANSFER_CUTOFF_PASSED: "The transfer deadline has passed. Please contact the organiser if you need help.",
    MANAGEMENT_UNAVAILABLE: "Entry management is temporarily unavailable. Please try again later."
  };
  return messages[code] ?? "We could not complete that request. Please review your details and try again.";
}
