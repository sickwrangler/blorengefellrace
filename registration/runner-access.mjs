const recoverableOrder = (recovered) => recovered?.ok === true
  && ["draft", "checkout_expired", "checkout_pending"].includes(recovered.order?.status);

export function privateAccessPurposeCandidates({ offerHint = false, proofHint = false } = {}) {
  if (proofHint) return ["stripe_provider_proof"];
  if (offerHint) return ["waiting_list_offer"];
  return ["registration", "waiting_list_offer"];
}

export function publicEntryState(status) {
  if (!status || status.ok === false || status.unavailable) return "unavailable";
  if (status.operationalState === "CLOSED") return "pre-opening";
  if (status.operationalState === "PRIVATE_LIVE") return status.publicWaitingListAvailable === true ? "full" : "pre-opening";
  if (status.operationalState === "PAUSED") return "paused";
  if (status.operationalState === "CLOSED_FINAL") return "closed";
  if (status.operationalState !== "OPEN") return "unavailable";
  if (status.waitingListPriorityActive || status.waiting > 0 || status.remaining === 0) return "full";
  return status.publicRegistrationAvailable ? "open" : "unavailable";
}

export function runnerEntryAvailability({ status, privateAccess = null, hasPrivateInvitation = false }) {
  const publicRegistrationAvailable = status?.publicRegistrationAvailable ?? (status?.remaining > 0 && !(status?.waiting > 0));
  const waitingListOffer = privateAccess?.ok === true && privateAccess.purpose === "waiting_list_offer";
  const invalidPrivateLink = hasPrivateInvitation && privateAccess?.ok !== true;
  return {
    publicRegistrationAvailable,
    waitingListOffer,
    invalidPrivateLink,
    entryFormAvailable: !invalidPrivateLink && (publicRegistrationAvailable || waitingListOffer),
    waitingListAvailable: !invalidPrivateLink && !publicRegistrationAvailable && !waitingListOffer
  };
}

export function runnerAccessDecision({ canTest, status, privateAccess = null, recovered = null, hasPrivateInvitation = false }) {
  if (!canTest || status?.unavailable) return "unavailable";
  if (hasPrivateInvitation && privateAccess?.ok !== true && !recoverableOrder(recovered)) return "unavailable";
  if (status?.environment !== "production") return "available";
  if (status.operationalState === "OPEN") return "available";

  const recovering = recoverableOrder(recovered);
  if (status.operationalState === "PRIVATE_LIVE") {
    const invited = privateAccess?.ok === true && ["registration", "waiting_list_offer"].includes(privateAccess.purpose);
    const joiningPublicWaitingList = !hasPrivateInvitation && status.publicWaitingListAvailable === true;
    return invited || recovering || joiningPublicWaitingList ? "available" : "unavailable";
  }

  const closedProviderProof = privateAccess?.ok === true && privateAccess.purpose === "stripe_provider_proof";
  const recoveringProviderProof = recovering && recovered.order?.providerProof === true;
  return closedProviderProof || recoveringProviderProof ? "available" : "unavailable";
}
