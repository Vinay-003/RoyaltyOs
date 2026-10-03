import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeWorkspace } from "../auth.ts";
import type { AppContext } from "../context.ts";
import { json, readJson, requireString } from "../http.ts";
import { runPayPalReadOnlyAssistant } from "../../../packages/paypal-ai/mcp-assistant.ts";
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
    const result = await runPayPalReadOnlyAssistant(ctx.config, ctx.paypal, question, ctx.fetchImpl);
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: workspaceId, p_actor_id: auth.user.id, p_action: "PAYPAL_AI_READONLY_QUERY", p_resource_type: "PAYPAL_AI", p_resource_id: String(result.responseId ?? requestId), p_detail: `Read-only PayPal MCP assistant query using tools: ${result.tools.join(",")}`, p_correlation_id: requestId });
    json(res, 200, result);
    return true;
  }

  return false;
}