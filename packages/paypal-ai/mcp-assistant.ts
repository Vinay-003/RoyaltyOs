import type { AppConfig } from "../core/config.ts";
import { openaiFetch } from "../ai/openai-client.ts";
import type { PayPalGateway } from "../paypal/gateway.ts";

function responseText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const pieces: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) if (typeof content?.text === "string") pieces.push(content.text);
  }
  const joined = pieces.join("").trim();
  return joined || null;
}

function trimInvoice(entry: any) {
  return {
    id: entry?.id ?? null,
    status: entry?.status ?? null,
    amount: entry?.amount ?? null,
    currency: entry?.detail?.currency_code ?? entry?.amount?.currency_code ?? null,
    recipient: entry?.primary_recipients?.[0]?.billing_info?.email_address ?? null,
    invoiceDate: entry?.detail?.invoice_date ?? entry?.invoiced_at ?? null,
  };
}

export interface WorkspaceInvoiceRecord {
  paypalInvoiceId: string;
  amount: string;
  status: string;
  recipientEmail: string;
}

export async function runPayPalReadOnlyAssistant(
  config: AppConfig,
  gateway: PayPalGateway,
  question: string,
  fetchImpl: typeof fetch = fetch,
  workspaceInvoices: WorkspaceInvoiceRecord[] = [],
) {
  if (!config.paypalAi.enabled) throw new Error("PayPal AI assistant is disabled");
  if (!question.trim()) throw new Error("Question is required");
  if (/(create|send|cancel|refund|pay|payout|update|delete|capture|record payment)/i.test(question)) {
    throw new Error("PayPal AI assistant is intentionally read-only; use the explicit RoyaltyOS financial workflow for mutations");
  }
  // Server-side tools: compatible AI gateways drop the Responses-API `mcp`
  // tool type (the model then narrates dead <tool_call> XML instead of
  // calling anything), so RoyaltyOS executes the read-only PayPal calls
  // itself and hands the model live data to summarize. The model never
  // touches PayPal; it only sees this snapshot.
  const listing = await gateway.listInvoices(10).catch((error) => {
    throw new Error(`PayPal invoice lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  const items = Array.isArray(listing?.items) ? listing.items : [];
  const snapshot = {
    environment: config.paypal.environment,
    fetchedAt: new Date().toISOString(),
    totalCount: typeof listing?.total_count === "number" ? listing.total_count : items.length,
    invoices: items.slice(0, 10).map(trimInvoice),
  };
  const response = await openaiFetch(config, fetchImpl, `${config.ai.baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ai.model,
      store: false,
      instructions: [
        "You are the RoyaltyOS PayPal reconciliation assistant for ONE workspace.",
        "The workspace records below are authoritative for what this workspace owns. The live PayPal snapshot is merchant-scoped: it can contain invoices from OTHER workspaces sharing the merchant app — never attribute those to this workspace.",
        "Answer from the workspace records first; use the live snapshot only to explain discrepancies (e.g. paid on PayPal but not yet recorded here).",
        "Never invent invoices, amounts, or statuses. If the answer is not in the data, say exactly what is visible and what is missing.",
        "You cannot create, send, update, cancel, refund, capture or execute anything; say so if asked.",
      ].join(" "),
      input: `Question: ${question}\n\nWorkspace records (${workspaceInvoices.length} invoice(s) owned by this workspace):\n${JSON.stringify(workspaceInvoices)}\n\nLive PayPal merchant snapshot (may include other workspaces):\n${JSON.stringify(snapshot)}`,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`PayPal AI request failed (${response.status}): ${JSON.stringify(payload)}`);
  const text = responseText(payload);
  if (!text) throw new Error("PayPal AI returned an empty answer; try again");
  return { text, responseId: payload?.id ?? null, model: config.ai.model, tools: ["server:list_invoices"], invoiceCount: workspaceInvoices.length };
}
