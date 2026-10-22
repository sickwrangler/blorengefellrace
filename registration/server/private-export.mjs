const TRANSFER_ACTIONS = new Set(["entry_transferred", "organiser_entry_transferred"]);

const asDate = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.valueOf()) ? parsed : null;
};

const eventTime = (event) => event.occurredAt ?? event.timestamp ?? event.at ?? null;
const registrationIdFor = (event) => event.subjectId ?? event.registrationId ?? null;
const runnerName = (runner) => runner ? [runner.firstName, runner.lastName].filter(Boolean).join(" ").trim() : "Historical runner record unavailable";
const runnerEmail = (runner) => runner?.email ?? "";
const yesNo = (value) => value === true ? "Yes" : value === false ? "No" : "";

function transferInitiator(event) {
  if (event.action === "organiser_entry_transferred" || event.actorType === "organiser" || event.actorType === "entra_organiser") return "Organiser";
  if (event.actorType === "system" || event.actorType === "scheduler") return "System";
  if (event.actorType === "runner" || event.action === "entry_transferred") return "Runner";
  return "";
}
export function buildTransferHistory(state) {
  const runners = new Map((state.runners ?? []).map((runner) => [runner.id, runner]));
  const registrations = new Map((state.registrations ?? []).map((registration) => [registration.id, registration]));
  const sequenceByRegistration = new Map();

  return (state.auditEvents ?? [])
    .filter((event) => TRANSFER_ACTIONS.has(event.action) && registrationIdFor(event))
    .map((event, sourceIndex) => ({ event, sourceIndex, occurredAt: asDate(eventTime(event)), registrationId: registrationIdFor(event) }))
    .sort((left, right) => {
      const leftTime = left.occurredAt?.valueOf() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.occurredAt?.valueOf() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.sourceIndex - right.sourceIndex;
    })
    .map(({ event, occurredAt, registrationId }) => {
      const registration = registrations.get(registrationId);
      const sequence = (sequenceByRegistration.get(registrationId) ?? 0) + 1;
      sequenceByRegistration.set(registrationId, sequence);
      const fromRunnerId = event.before?.runnerId ?? null;
      const toRunnerId = event.after?.runnerId ?? null;
      const fromRunner = runners.get(fromRunnerId);
      const toRunner = runners.get(toRunnerId);
      return {
        entryReference: registration?.testReference ?? "",
        registrationId,
        raceNumber: registration?.raceNumber ?? null,
        occurredAt,
        sequence,
        fromRunnerName: runnerName(fromRunner),
        fromRunnerEmail: runnerEmail(fromRunner),
        toRunnerName: runnerName(toRunner),
        toRunnerEmail: runnerEmail(toRunner),
        initiatedBy: transferInitiator(event),
        cutoffOverride: yesNo(event.after?.cutoffOverride),
        auditEventId: event.id ?? "",
        fromRunnerId: fromRunnerId ?? "",
        toRunnerId: toRunnerId ?? ""
      };
    });
}

export function transferSummaryForRegistration(transferHistory, registrationId) {
  const events = transferHistory.filter((event) => event.registrationId === registrationId);
  if (!events.length) return { transferred: false, count: 0, originalRunnerName: "", previousRunnerName: "", latestAt: null, latestInitiatedBy: "", latestCutoffOverride: "" };
  const latest = events.at(-1);
  return {
    transferred: true,
    count: events.length,
    originalRunnerName: events[0].fromRunnerName,
    previousRunnerName: latest.fromRunnerName,
    latestAt: latest.occurredAt,
    latestInitiatedBy: latest.initiatedBy,
    latestCutoffOverride: latest.cutoffOverride
  };
}

function currentEntry(state, registration, transferHistory) {
  const runner = (state.runners ?? []).find((item) => item.id === registration.runnerId);
  const emergency = (state.emergencyContacts ?? []).find((item) => item.registrationId === registration.id || (!item.registrationId && item.runnerId === registration.runnerId));
  const payment = (state.payments ?? []).find((item) => item.registrationId === registration.id || item.registrationIds?.includes(registration.id));
  const declaration = [...(state.declarations ?? [])].reverse().find((item) => item.registrationId === registration.id && !item.revokedAt);
  const refunded = payment?.refundedRegistrationIds?.includes(registration.id) || payment?.status === "refunded";
  const declarationStatus = declaration ? "complete" : registration.declarationStatus ?? "pending";
  const paymentStatus = refunded ? "refunded" : payment?.status === "paid" ? "successful" : payment?.status === "failed" ? "declined" : payment?.status === "expired" ? "abandoned" : payment?.status ?? "created";
  const transfer = transferSummaryForRegistration(transferHistory, registration.id);
  return {
    entryReference: registration.testReference ?? "",
    registrationId: registration.id,
    raceNumber: registration.raceNumber ?? null,
    firstName: runner?.firstName ?? "",
    lastName: runner?.lastName ?? "",
    email: runner?.email ?? "",
    phone: runner?.phone ?? "",
    dateOfBirth: asDate(runner?.dateOfBirth),
    raceCategory: runner?.raceCategory ?? runner?.genderCategory ?? "",
    club: runner?.club ?? "",
    wfraMember: yesNo(runner?.wfraMember),
    wfraMembershipNumber: runner?.wfraMembershipNumber ?? "",
    emergencyContactName: emergency?.name ?? "",
    emergencyContactPhone: emergency?.phone ?? "",
    entryStatus: registration.entryStatus ?? "",
    placeStatus: registration.placeStatus ?? "",
    paymentStatus,
    declarationStatus,
    clearedToStart: yesNo(declarationStatus === "complete" && registration.placeStatus === "confirmed" && !["cancelled", "released", "place_released"].includes(registration.entryStatus) && !refunded),
    priceActuallyCharged: Number.isFinite(registration.priceActuallyChargedPence) ? registration.priceActuallyChargedPence / 100 : Number.isFinite(registration.pricing?.priceActuallyChargedPence) ? registration.pricing.priceActuallyChargedPence / 100 : Number.isFinite(payment?.priceActuallyChargedPence) ? payment.priceActuallyChargedPence / 100 : Number.isFinite(payment?.actualPaidAmountPence) ? payment.actualPaidAmountPence / 100 : null,
    currency: String(payment?.currency ?? "").toUpperCase(),
    refundState: refunded ? "refunded" : payment?.refundState ?? "",
    transferred: yesNo(transfer.transferred),
    transferCount: transfer.count,
    originalRunnerName: transfer.originalRunnerName,
    previousRunnerName: transfer.previousRunnerName,
    latestTransferAt: transfer.latestAt,
    latestTransferInitiatedBy: transfer.latestInitiatedBy,
    cutoffOverrideUsed: transfer.latestCutoffOverride,
    createdAt: asDate(registration.createdAt),
    updatedAt: asDate(registration.updatedAt)
  };
}

export function buildPrivateWorkbookModel(state, generatedAt = new Date()) {
  const transferHistory = buildTransferHistory(state);
  const registrations = (state.registrations ?? []).filter((item) => !item.deletedAt);
  const currentEntries = registrations.map((registration) => currentEntry(state, registration, transferHistory));
  const active = registrations.filter((item) => !["cancelled", "place_released"].includes(item.entryStatus));
  const summary = {
    event: state.event?.name ?? "Blorenge Fell Race 2026",
    raceDate: asDate(state.event?.raceDate),
    generatedAt: asDate(generatedAt),
    operationalState: state.registrationState ?? state.phase3RegistrationState ?? "",
    capacity: state.event?.capacity ?? null,
    confirmedPlaces: active.filter((item) => item.placeStatus === "confirmed").length,
    waitingListCount: active.filter((item) => item.entryStatus === "waiting_list").length,
    cancelledReleasedCount: registrations.filter((item) => ["cancelled", "place_released"].includes(item.entryStatus)).length,
    registrationsEverTransferred: new Set(transferHistory.map((item) => item.registrationId)).size,
    totalTransferEvents: transferHistory.length,
    pendingDeclarations: currentEntries.filter((item) => item.placeStatus === "confirmed" && item.declarationStatus !== "complete").length,
    clearedToStartCount: currentEntries.filter((item) => item.clearedToStart === "Yes").length
  };
  return { classification: "PRIVATE OPERATIONAL DATA", currentEntries, transferHistory, summary };
}
