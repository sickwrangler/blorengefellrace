import crypto from "node:crypto";
import fs from "node:fs";
import { createAzureTableTransport } from "../api/src/storage.mjs";
import { createDevelopmentEmailAdapter } from "../api/src/providers.mjs";
import { createAzureTableRepository } from "../registration/server/repositories.mjs";
import { createDatabase } from "../registration/server/service.mjs";
import { deliverRegistrationCommunication } from "../registration/server/communications.mjs";
import { capacitySummary, createNextWaitingListOffer } from "../registration/server/phase3-domain.mjs";

const operation = process.argv[2];
const tokenFile = process.argv[3];
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Required proof setting is missing: ${name}`);
  return value;
};

if (process.env.REGISTRATION_PROOF_ACK !== "synthetic-development-only" ||
    required("REGISTRATION_ENVIRONMENT") !== "development" ||
    required("REGISTRATION_STATE") !== "test" ||
    !required("REGISTRATION_PUBLIC_BASE_URL").includes("black-tree-04204eb03.3.azurestaticapps.net")) {
  throw new Error("Cloud proof is restricted to the approved synthetic development environment.");
}
if (!tokenFile || !tokenFile.startsWith("/tmp/")) throw new Error("Use a temporary token file below /tmp.");

const repository = createAzureTableRepository(createAzureTableTransport({
  accountName: required("REGISTRATION_STORAGE_ACCOUNT"),
  tableName: required("REGISTRATION_TABLE"),
  sasToken: required("REGISTRATION_TABLE_SAS_TOKEN"),
  partitionKey: required("REGISTRATION_EVENT_PARTITION")
}));
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const writeToken = (value) => fs.writeFileSync(tokenFile, value, { encoding: "utf8", mode: 0o600 });
const timestamp = () => new Date().toISOString();

function addConfirmedFixture(state, index, managementToken = null) {
  const suffix = String(index + 1).padStart(3, "0");
  const runnerId = `runner_cloud_fixture_${suffix}`;
  const registrationId = `reg_cloud_fixture_${suffix}`;
  const at = timestamp();
  state.runners.push({
    id: runnerId, firstName: "Synthetic", lastName: `Runner ${suffix}`,
    email: `runner-${suffix}@example.invalid`, phone: "07700 900000",
    addressLine1: "1 Test Street", addressLine2: null, city: "Testville", postcode: "TE1 1ST",
    dateOfBirth: "1990-01-01", genderCategory: index % 2 ? "Female" : "Male / Open",
    raceCategory: index % 2 ? "Female" : "Male / Open", club: "Synthetic Fell Club",
    wfraMember: false, wfraMembershipNumber: null, wfraMembershipVerified: false,
    wfraDiscountApplied: false, anonymisedAt: null
  });
  state.emergencyContacts.push({ id: `emergency_cloud_fixture_${suffix}`, registrationId, name: "Synthetic Contact", phone: "07700 900001", deleteAfterEvent: true });
  state.consents.push({ id: `consent_cloud_fixture_${suffix}`, registrationId, termsVersion: state.event.termsVersion, privacyVersion: state.event.privacyVersion, recordedAt: at, declaration: { identifier: state.event.declarationIdentifier, version: state.event.declarationVersion, accepted: true, typedFullName: `Synthetic Runner ${suffix}`, signatoryRole: "Competitor", acceptedAt: at, contentStatus: state.event.declarationContentStatus } });
  state.registrations.push({ id: registrationId, testReference: index === 0 ? "TEST-CLOUDAMEND" : `TEST-CAP${suffix}`, eventId: state.event.id, runnerId, environment: "development", entryStatus: "accepted", placeStatus: "confirmed", waitingSequence: null, waitingListPosition: null, raceNumber: null, confirmationTokenHash: hash(`confirmation-${registrationId}`), createdAt: at, updatedAt: at, deletedAt: null });
  state.payments.push({ id: `payment_cloud_fixture_${suffix}`, registrationId, status: "paid", provider: "synthetic-proof", providerMode: "test", providerReference: null, checkoutSessionId: null, checkoutUrl: null, checkoutExpiresAt: null, paymentIntentId: null, expectedAmountPence: 600, actualPaidAmountPence: 600, currency: "gbp", refundState: "not_requested", webhookReconciliationState: "synthetic_fixture", externalCall: false, standardPricePence: 600, wfraMemberPricePence: null, priceActuallyChargedPence: 600, adjustmentReason: "STANDARD_ENTRY", wfraDiscountApplied: false, createdAt: at, updatedAt: at });
  if (managementToken) state.managementTokens.push({ id: "management_cloud_amend", registrationId, tokenHash: hash(managementToken), issuedAt: at, invalidatedAt: null });
}

if (operation === "seed-capacity") {
  const state = createDatabase({ environment: "development", registrationState: "test", capacity: 120 });
  state.phase3RegistrationState = "CLOSED";
  const managementToken = crypto.randomBytes(32).toString("base64url");
  for (let index = 0; index < 120; index += 1) addConfirmedFixture(state, index, index === 0 ? managementToken : null);
  await repository.reset(state);
  writeToken(managementToken);
  console.log(JSON.stringify({ ok: true, reference: "TEST-CLOUDAMEND", ...capacitySummary(state), operationalState: state.phase3RegistrationState }));
} else if (operation === "release-and-offer") {
  await repository.transaction((state) => {
    const registration = state.registrations.find((item) => item.id === "reg_cloud_fixture_120");
    if (!registration || registration.placeStatus !== "confirmed") return { ok: false, code: "FIXTURE_NOT_AVAILABLE" };
    registration.entryStatus = "place_released";
    registration.placeStatus = "none";
    registration.updatedAt = timestamp();
    state.auditEvents.push({ id: `audit_${crypto.randomUUID()}`, occurredAt: registration.updatedAt, actorType: "synthetic-proof", actorId: null, action: "synthetic_place_released", subjectId: registration.id, before: { placeStatus: "confirmed" }, after: { placeStatus: "none" }, environment: state.environment });
    return { ok: true };
  });
  let rawToken = null;
  const originalTransaction = repository.transaction.bind(repository);
  const email = createDevelopmentEmailAdapter();
  const result = await originalTransaction(async (state) => {
    const created = createNextWaitingListOffer(state, { authenticated: true, role: "administrator", actorType: "synthetic-proof", id: "phase3b2" }, new Date());
    if (!created.ok) return created;
    rawToken = created.token;
    const waiting = state.waitingList.find((item) => item.id === created.offer.waitingListId);
    await deliverRegistrationCommunication(state, email, { waitingListId: waiting.id, template: "waiting_list_offer", intendedRecipientAddress: waiting.email, data: { runnerName: `${waiting.firstName} ${waiting.lastName}`, expiresAt: created.offer.expiresAt, secureUrl: `${required("REGISTRATION_PUBLIC_BASE_URL")}/registration/?invite=${encodeURIComponent(created.token)}` } }, { idempotencyKey: `waiting-list:${created.offer.id}:offered` });
    return { ok: true, offer: created.offer };
  });
  if (!result.ok || !rawToken) throw new Error("Waiting-list offer creation failed.");
  writeToken(rawToken);
  const state = await repository.read();
  console.log(JSON.stringify({ ok: true, offerId: result.offer.id, createdAt: result.offer.createdAt, reminderAt: result.offer.reminderAt, expiresAt: result.offer.expiresAt, ...capacitySummary(state), offerEmailReceipts: state.communications.filter((item) => item.template === "waiting_list_offer" && item.externalCall).length }));
} else if (operation === "inspect") {
  const state = await repository.read();
  const amendment = state.registrations.find((item) => item.testReference === "TEST-CLOUDAMEND");
  const runner = state.runners.find((item) => item.id === amendment?.runnerId);
  console.log(JSON.stringify({
    ok: true, environment: state.environment, registrationState: state.registrationState,
    operationalState: state.phase3RegistrationState, ...capacitySummary(state),
    amendment: amendment ? { reference: amendment.testReference, phoneEndsWith: String(runner?.phone ?? "").slice(-4), city: runner?.city, persisted: true, auditEvents: state.auditEvents.filter((item) => item.subjectId === amendment.id && item.action === "runner_details_amended").length, emailReceipts: state.communications.filter((item) => item.registrationId === amendment.id && item.template === "entry_amended" && item.externalCall).length } : null,
    waiting: state.waitingList.map((item) => ({ sequence: item.sequence, status: item.status })),
    offers: state.waitingListOffers.map((item) => ({ id: item.id, status: item.status, createdAt: item.createdAt, reminderAt: item.reminderAt, reminderSentAt: item.reminderSentAt ?? null, expiresAt: item.expiresAt })),
    communications: Object.fromEntries(["waiting_list_joined", "waiting_list_offer", "waiting_list_reminder"].map((template) => [template, state.communications.filter((item) => item.template === template && item.externalCall).length])),
    schedulerStatus: state.schedulerStatus
  }));
} else if (operation === "reset") {
  const state = createDatabase({ environment: "development", registrationState: "test", capacity: 120 });
  state.phase3RegistrationState = "CLOSED";
  state.testProgress.resetCompleted = true;
  await repository.reset(state);
  writeToken("");
  console.log(JSON.stringify({ ok: true, environment: state.environment, registrationState: state.registrationState, operationalState: state.phase3RegistrationState, ...capacitySummary(state) }));
} else {
  throw new Error("Use seed-capacity, release-and-offer, inspect or reset.");
}
