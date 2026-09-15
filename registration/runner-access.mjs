const recoverableOrder = (recovered) => recovered?.ok === true
  && ["draft", "checkout_expired", "checkout_pending"].includes(recovered.order?.status);

export function runnerAccessDecision({ canTest, status, privateAccess = null, recovered = null }) {
  if (!canTest || status?.unavailable) return "unavailable";
  if (status?.environment !== "production") return "available";
  if (status.operationalState === "OPEN") return "available";

  const recovering = recoverableOrder(recovered);
  if (status.operationalState === "PRIVATE_LIVE") {
    const invited = privateAccess?.ok === true && privateAccess.purpose === "registration";
    return invited || recovering ? "available" : "unavailable";
  }

  const closedProviderProof = privateAccess?.ok === true && privateAccess.purpose === "stripe_provider_proof";
  const recoveringProviderProof = recovering && recovered.order?.providerProof === true;
  return closedProviderProof || recoveringProviderProof ? "available" : "unavailable";
}
