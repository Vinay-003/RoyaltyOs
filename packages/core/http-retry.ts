export type RetryOptions = {
  maxRetries: number;
  timeoutMs: number;
  baseDelayMs: number;
  retryStatuses?: number[];
};

function retryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response> {
  const retryStatuses = new Set(options.retryStatuses ?? [429, 500, 502, 503, 504]);
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Request timeout after ${options.timeoutMs}ms`)), options.timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (!retryStatuses.has(response.status) || attempt === options.maxRetries) return response;
      try { await response.arrayBuffer(); } catch { /* consume best effort */ }
      const retryAfter = retryAfterMs(response.headers.get("retry-after"));
      const backoff = retryAfter ?? Math.min(10_000, options.baseDelayMs * 2 ** attempt);
      if (backoff > 0) await sleep(backoff);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === options.maxRetries) throw error;
      await sleep(Math.min(10_000, options.baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("External request failed");
}
