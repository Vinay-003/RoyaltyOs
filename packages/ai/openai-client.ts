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
export const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function openaiFetch(
  config: AppConfig,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const keys = config.ai.openaiApiKeys.filter((key) => typeof key === "string" && key);
  if (!keys.length) {
    console.error("[RoyaltyOS] [ERROR] OPENAI_CONFIG_ERROR No OpenAI API key configured");
    throw new Error("No OpenAI API key is configured");
  }
  let lastStatus = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const maskedKey = `${key.slice(0, 7)}...${key.slice(-4)}`;
    const startTime = Date.now();
    console.log(`[RoyaltyOS] [INFO] OPENAI_REQUEST_START url=${url} keyIndex=${i} key=${maskedKey}`);
    const headers = { "User-Agent": BROWSER_USER_AGENT, ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${key}` };
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
    const durationMs = Date.now() - startTime;
    console.log(`[RoyaltyOS] [INFO] OPENAI_REQUEST_RESPONSE status=${response.status} durationMs=${durationMs} ok=${response.ok}`);
    if (response.status !== 401 && response.status !== 402 && response.status !== 429) {
      if (!response.ok) {
        try {
          const clone = response.clone();
          const errText = await clone.text();
          console.error(`[RoyaltyOS] [ERROR] OPENAI_REQUEST_REJECTED status=${response.status} body=${errText}`);
        } catch { /* ignore clone failure */ }
      }
      return response;
    }
    lastStatus = response.status;
    console.warn(`[RoyaltyOS] [WARN] OPENAI_KEY_ROTATING status=${response.status} keyIndex=${i} (trying next key if available)`);
    try { await response.arrayBuffer(); } catch { /* consume best effort */ }
  }
  console.error(`[RoyaltyOS] [ERROR] OPENAI_ALL_KEYS_EXHAUSTED tried=${keys.length} lastStatus=${lastStatus}`);
  throw new Error(`OpenAI request rejected on all ${keys.length} API keys (last status ${lastStatus})`);
}
