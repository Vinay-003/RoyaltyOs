import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeWorkspace } from "../auth.ts";
import type { AppContext } from "../context.ts";
import { json, readJson, requireString } from "../http.ts";
import { runPayPalReadOnlyAssistant } from "../../../packages/paypal-ai/mcp-assistant.ts";
import { paypalForWorkspace } from "../services.ts";
import { enforceRateLimit } from "./helpers.ts";

/**
 * Read-only PayPal intelligence. The assistant runs against the official PayPal
 * Remote MCP endpoint through the OpenAI Responses API. It holds no PayPal
 * credentials and cannot move money: only read/list MCP tools are enabled.
 */
export async function handleAssistantRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "POST" && path === "/api/v1/assistant/paypal") {
    const body = await readJson(req);
    const workspaceId = requireString(body.workspaceId, "workspaceId", 100);
    const auth = await authorizeWorkspace(ctx, req, workspaceId, ["OWNER", "FINANCE_APPROVER", "AUDITOR"]);
    await enforceRateLimit(ctx, `paypal-ai:${auth.user.id}`, 20, 600);
    const question = requireString(body.question, "question", 2000);
    // Workspace-scoped records lead: PayPal's own invoice list is
    // merchant-scoped, so a shared merchant app would leak other workspaces'
    // invoices into the answer. Our rows are always this workspace's truth.
    const records = await ctx.supabase.select<Record<string, any>>("invoices", {
      select: "paypal_invoice_id,amount_minor,currency,status,recipient_email,created_at",
      workspace_id: `eq.${workspaceId}`,
      order: "created_at.desc",
      limit: "50",
    });
    const { gateway } = await paypalForWorkspace(ctx, workspaceId);
    const result = await runPayPalReadOnlyAssistant(ctx.config, gateway, question, ctx.fetchImpl, records.map((row) => ({
      paypalInvoiceId: String(row.paypal_invoice_id),
      amount: `${(Number(row.amount_minor) / 100).toFixed(2)} ${String(row.currency)}`,
      status: String(row.status),
      recipientEmail: String(row.recipient_email ?? ""),
    })));
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: workspaceId, p_actor_id: auth.user.id, p_action: "PAYPAL_AI_READONLY_QUERY", p_resource_type: "PAYPAL_AI", p_resource_id: String(result.responseId ?? requestId), p_detail: `Read-only PayPal assistant query over ${records.length} workspace invoice(s)`, p_correlation_id: requestId });
    json(res, 200, result);
    return true;
  }

  return false;
}