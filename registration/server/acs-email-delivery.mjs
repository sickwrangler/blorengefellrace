const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETDOWN", "ENETRESET",
  "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"
]);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function statusCode(error) {
  const value = Number(error?.statusCode ?? error?.status ?? error?.response?.status);
  return Number.isInteger(value) ? value : null;
}

function header(error, name) {
  const headers = error?.response?.headers ?? error?.headers;
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? null;
}

export function retryAfterMilliseconds(error, now = Date.now()) {
  for (const name of ["retry-after-ms", "x-ms-retry-after-ms"]) {
    const raw = header(error, name);
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const value = header(error, "retry-after");
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = new Date(value).valueOf();
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function classifyEmailError(error) {
  const status = statusCode(error);
  const code = String(error?.code ?? error?.name ?? "email_provider_error").slice(0, 80);
  if (status === 429) return { retryable: true, category: "throttled", statusCode: status };
  if (RETRYABLE_STATUS_CODES.has(status)) return { retryable: true, category: status >= 500 ? "provider_5xx" : "request_timeout", statusCode: status };
  if (RETRYABLE_ERROR_CODES.has(code)) return { retryable: true, category: "network", statusCode: status };
  return { retryable: false, category: status && status >= 400 && status < 500 ? "permanent_provider_rejection" : code, statusCode: status };
}

/**
 * Retries only the ACS transport operation. The caller supplies one stable
 * operationId, so every attempt addresses the same provider operation rather
 * than creating another business communication.
 */
export async function sendAcsEmailWithRetry({
  client,
  request,
  operationId,
  telemetry = console,
  maxAttempts = 4,
  baseDelayMs = 1_000,
  maximumDelayMs = 64_000,
  sleep = wait,
  random = Math.random,
  now = Date.now
}) {
  const attempts = Math.max(1, Math.min(8, Number(maxAttempts) || 1));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const poller = await client.beginSend(request, { operationId });
      const result = await poller.pollUntilDone();
      if (result.status !== "Succeeded") {
        telemetry.error?.("registration_email_delivery_failed", { environment: "production", category: "provider_final_failure", attempt });
        return { delivery: "failed", providerReference: result.id ?? null, externalCall: true, retryCount: attempt - 1, failureCategory: "provider_final_failure" };
      }
      if (attempt > 1) telemetry.info?.("registration_email_retry_succeeded", { environment: "production", attempt, retryCount: attempt - 1 });
      return { delivery: "sent", providerReference: result.id ?? null, externalCall: true, retryCount: attempt - 1, failureCategory: null };
    } catch (error) {
      const failure = classifyEmailError(error);
      if (!failure.retryable || attempt >= attempts) {
        telemetry.error?.("registration_email_delivery_failed", { environment: "production", category: failure.category, statusCode: failure.statusCode, attempt, retryCount: attempt - 1 });
        return { delivery: "failed", providerReference: null, externalCall: true, retryCount: attempt - 1, failureCategory: failure.category };
      }
      const providerDelay = retryAfterMilliseconds(error, now());
      if (providerDelay !== null && providerDelay > maximumDelayMs) {
        telemetry.warn?.("registration_email_retry_deferred", {
          environment: "production",
          category: failure.category,
          statusCode: failure.statusCode,
          attempt,
          retryAfterMs: providerDelay
        });
        return {
          delivery: "failed",
          providerReference: null,
          externalCall: true,
          retryCount: attempt - 1,
          failureCategory: failure.category,
          retryAfterMs: providerDelay
        };
      }
      const exponential = Math.min(maximumDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const jitter = Math.floor(Math.max(0, exponential * 0.25 * random()));
      const delayMs = Math.min(maximumDelayMs, Math.max(providerDelay ?? 0, exponential + jitter));
      telemetry.warn?.("registration_email_retry_scheduled", { environment: "production", category: failure.category, statusCode: failure.statusCode, attempt, delayMs });
      await sleep(delayMs);
    }
  }
  throw new Error("Unreachable email retry state.");
}
