import type { AppConfig } from "../core/config.ts";
import { fetchWithRetry } from "../core/http-retry.ts";

/**
 * OpenAI-compatible fetch with API-key fallback. Keys are tried in config
 * order; a 401 (revoked key), 402 (per-key quota/billing exhausted) or 429
 * (rate limited) moves to the next key immediately, while any other response
 * — success or a real request/server error — is returned as-is. Throws only
 * when every key is rejected, naming how many were tried. Per-key transient
 * 5xx still retries inside fetchWithRetry; 429 is excluded there so rotation
 * stays immediate.
 */
export async function openaiFetch(
  config: AppConfig,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const keys = config.ai.openaiApiKeys.filter((key) => typeof key === "string" && key);
  if (!keys.length) throw new Error("No OpenAI API key is configured");
  let lastStatus = 0;
  for (const key of keys) {
    const headers = { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${key}` };
    const response = await fetchWithRetry(
      fetchImpl,
      url,
      { ...init, headers },
      {
        maxRetries: config.ai.maxRetries,
        timeoutMs: config.ai.timeoutMs,
        baseDelayMs: config.ai.retryBaseMs,
        retryStatuses: [500, 502, 503, 504],
      },
    );
    if (response.status !== 401 && response.status !== 402 && response.status !== 429) return response;
    lastStatus = response.status;
    try { await response.arrayBuffer(); } catch { /* consume best effort */ }
  }
  throw new Error(`OpenAI request rejected on all ${keys.length} API keys (last status ${lastStatus})`);
}
