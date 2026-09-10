export function queryRegistrations(state, { search = "", entry = "", payment = "" } = {}) {
  const needle = search.toLowerCase().trim();
  return state.registrations.filter((item) => {
    const text = `${item.testReference ?? ""} ${item.runner.firstName} ${item.runner.lastName} ${item.runner.club ?? ""} ${item.runner.email}`.toLowerCase();
    return (!needle || text.includes(needle)) && (!entry || item.entryStatus === entry) && (!payment || item.paymentStatus === payment);
  });
}
