export function availableOrganiserActions(registration) {
  const actions = ["messages"];
  if (registration.entryStatus !== "cancelled") actions.push("race_number", "cancel");
  if (registration.raceNumber) actions.push("remove_race_number");
  if (registration.entryStatus === "waiting_list") actions.push("promote");
  if (registration.paymentStatus === "successful") actions.push("refund");
  return actions;
}
