export const PRODUCTION_EVENT = Object.freeze({ date: "2026-11-28", minimumAge: 16 });

function ageOnDate(dateOfBirth, eventDate = PRODUCTION_EVENT.date) {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`); const event = new Date(`${eventDate}T00:00:00Z`);
  if (!Number.isFinite(birth.valueOf()) || birth > event) return NaN;
  let age = event.getUTCFullYear() - birth.getUTCFullYear();
  if (event.getUTCMonth() < birth.getUTCMonth() || (event.getUTCMonth() === birth.getUTCMonth() && event.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export function validateRunner(input) {
  const errors = {};
  for (const field of ["firstName", "lastName", "email", "phone", "addressLine1", "city", "postcode", "dateOfBirth", "genderCategory", "emergencyName", "emergencyPhone"]) if (!String(input[field] ?? "").trim()) errors[field] = "This field is required.";
  const email = String(input.email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  for (const field of ["phone", "emergencyPhone"]) if (input[field] && !/^[+()\d\s-]{7,24}$/.test(String(input[field]).trim())) errors[field] = "Enter a valid phone number.";
  const age = ageOnDate(String(input.dateOfBirth ?? ""));
  if (!Number.isFinite(age)) errors.dateOfBirth = "Enter a valid date of birth.";
  else if (age < PRODUCTION_EVENT.minimumAge) errors.dateOfBirth = `Entrants must be at least ${PRODUCTION_EVENT.minimumAge} on ${PRODUCTION_EVENT.date}.`;
  if (input.wfraMember === true && !String(input.wfraMembershipNumber ?? "").trim()) errors.wfraMembershipNumber = "Enter the WFRA membership number.";
  if (input.acceptTerms !== true) errors.acceptTerms = "Accept the race terms.";
  if (input.acceptPrivacy !== true) errors.acceptPrivacy = "Acknowledge the privacy notice.";
  if (input.acceptDeclaration !== true) errors.acceptDeclaration = "Accept the WFRA declaration.";
  if (age >= 18 && input.declarationSignatoryRole !== "Competitor") errors.declarationSignatoryRole = "The adult runner must sign their own declaration.";
  if (age >= 16 && age < 18 && input.declarationSignatoryRole !== "Parent / Legal Guardian") errors.declarationSignatoryRole = "A parent or legal guardian must sign for a runner aged 16 or 17.";
  if (!String(input.declarationName ?? "").trim()) errors.declarationName = age < 18 ? "Enter the parent or legal guardian's full name." : "Enter the runner's full name.";
  return errors;
}
