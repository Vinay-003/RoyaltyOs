import type { AppConfig } from "../core/config.ts";
import { fetchWithRetry } from "../core/http-retry.ts";
import type { PayPalGateway } from "../paypal/gateway.ts";

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const pieces: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) if (typeof content?.text === "string") pieces.push(content.text);
  }
  return pieces.join("");
}

export async function runPayPalReadOnlyAssistant(
  config: AppConfig,
  gateway: PayPalGateway,
  question: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (!config.paypalAi.enabled) throw new Error("PayPal AI assistant is disabled");
  if (!question.trim()) throw new Error("Question is required");
  if (/(create|send|cancel|refund|pay|payout|update|delete|capture|record payment)/i.test(question)) {
    throw new Error("PayPal AI assistant is intentionally read-only; use the explicit RoyaltyOS financial workflow for mutations");
  }
  const accessToken = await gateway.getAccessToken();
  const response = await fetchWithRetry(fetchImpl, "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.ai.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.paypalAi.model,
      store: false,
      instructions: "You are the RoyaltyOS PayPal reconciliation assistant. Use only read-only PayPal tools. Never create, send, update, cancel, refund, capture or execute a payment. Explain current PayPal state and discrepancies concisely.",
      tools: [{
        type: "mcp",
        server_label: "paypal-mcp",
        server_description: "Official PayPal remote MCP server, restricted by RoyaltyOS to read-only operations.",
        server_url: config.paypalAi.serverUrl,
        require_approval: "never",
        allowed_tools: config.paypalAi.allowedTools,
        authorization: accessToken,
      }],
      input: question,
    }),
  }, { maxRetries: config.ai.maxRetries, timeoutMs: config.ai.timeoutMs, baseDelayMs: config.ai.retryBaseMs });
  const payload = await response.json();
  if (!response.ok) throw new Error(`PayPal AI MCP request failed (${response.status}): ${JSON.stringify(payload)}`);
  return { text: responseText(payload), responseId: payload?.id ?? null, model: config.paypalAi.model, tools: config.paypalAi.allowedTools };
}
