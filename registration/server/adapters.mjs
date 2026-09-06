export function createMockPaymentAdapter() {
  return { kind: "mock", async record(outcome) { return { status: outcome, providerReference: null, externalCall: false }; } };
}

export function createCapturedEmailAdapter() {
  return { kind: "captured-only", async capture(message) { return { ...message, type: message.template, recipient: message.intendedRecipientAddress, subject: "Synthetic registration message", body: "This message was captured locally. Nothing was sent externally.", status: "captured", delivery: "captured_only", providerReference: null, sentAt: null, failure: null, retryCount: 0, externalCall: false }; } };
}

export function assertSafeAdapters({ payment, email }, environment) {
  if (environment === "production" || payment.kind !== "mock" || email.kind !== "captured-only") throw new Error("Phase 2 external adapters are disabled");
}
