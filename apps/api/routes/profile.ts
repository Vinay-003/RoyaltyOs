import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeWorkspace, principal } from "../auth.ts";
import type { AppContext } from "../context.ts";
import { json, readJson, requireString, routeMatch, statusError } from "../http.ts";
import { PayPalGateway } from "../../../packages/paypal/gateway.ts";
import { encryptSecret } from "../../../packages/security/paypal-vault.ts";

export interface SafePayPalAccount {
  connected: boolean;
  environment: "sandbox" | "live" | null;
  clientIdMasked: string | null;
  webhookConfigured: boolean;
  secretConfigured: boolean;
  updatedAt: string | null;
}

/**
 * Strips everything sensitive on the server: the secret never serializes,
 * and identifiers leave only a last-4 receipt (compiled here, never in the
 * browser, so a frontend bug cannot leak the full values).
 */
export function toSafeAccount(row: Record<string, any> | undefined): SafePayPalAccount {
  if (!row) {
    return { connected: false, environment: null, clientIdMasked: null, webhookConfigured: false, secretConfigured: false, updatedAt: null };
  }
  const clientId = String(row.paypal_client_id ?? "");
  return {
    connected: true,
    environment: row.environment === "live" ? "live" : "sandbox",
    clientIdMasked: clientId ? `••••${clientId.slice(-4)}` : null,
    webhookConfigured: Boolean(row.paypal_webhook_id),
    secretConfigured: Boolean(row.paypal_client_secret_enc),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

async function paypalAccountRow(ctx: AppContext, workspaceId: string) {
  return (await ctx.supabase.select<Record<string, any>>("workspace_paypal_accounts", {
    select: "*",
    workspace_id: `eq.${workspaceId}`,
    limit: "1",
  }))[0];
}

export async function handleProfileRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId?: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/v1/profile") {
    const p = await principal(ctx, req);
    const user = await ctx.supabase.adminGetUser(p.id);
    const memberships = await ctx.repo.memberships(p.id);
    const workspaceIds = memberships.map((m: any) => String(m.workspace_id));
    const accounts = workspaceIds.length
      ? await ctx.supabase.select<Record<string, any>>("workspace_paypal_accounts", {
        select: "workspace_id,environment",
        workspace_id: `in.(${workspaceIds.join(",")})`,
      })
      : [];
    const connected = new Map(accounts.map((a) => [String(a.workspace_id), a.environment === "live" ? "live" : "sandbox"]));
    json(res, 200, {
      id: p.id,
      email: user.email ?? p.email,
      displayName: (user.user_metadata?.display_name as string | undefined) ?? null,
      workspaces: memberships.map((m: any) => ({
        id: String(m.workspace_id),
        name: m.workspaces?.name ?? String(m.workspace_id),
        role: String(m.role),
        paypalConnected: connected.has(String(m.workspace_id)),
        paypalEnvironment: connected.get(String(m.workspace_id)) ?? null,
      })),
    });
    return true;
  }

  if (method === "PATCH" && path === "/api/v1/profile") {
    const p = await principal(ctx, req);
    const body = await readJson(req);
    const displayName = requireString(body.displayName, "displayName", 120);
    const updated = await ctx.supabase.adminUpdateUser(p.id, { displayName });
    json(res, 200, {
      id: p.id,
      email: updated.email ?? p.email,
      displayName: (updated.user_metadata?.display_name as string | undefined) ?? displayName,
    });
    return true;
  }

  let match = routeMatch("/api/v1/workspaces/:workspaceId/paypal-account", path);
  if (match && (method === "GET" || method === "PUT" || method === "DELETE")) {
    const workspaceId = match.workspaceId!;
    if (method === "GET") {
      await authorizeWorkspace(ctx, req, workspaceId, ["OWNER"]);
      json(res, 200, toSafeAccount(await paypalAccountRow(ctx, workspaceId)));
      return true;
    }
    const auth = await authorizeWorkspace(ctx, req, workspaceId, ["OWNER"], true);
    if (method === "DELETE") {
      const existing = await paypalAccountRow(ctx, workspaceId);
      if (!existing) throw statusError(404, "Workspace has no connected PayPal account");
      await ctx.supabase.delete("workspace_paypal_accounts", { workspace_id: `eq.${workspaceId}` });
      await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: workspaceId, p_actor_id: auth.user.id, p_action: "PAYPAL_ACCOUNT_DISCONNECTED", p_resource_type: "WORKSPACE", p_resource_id: workspaceId, p_detail: "Workspace PayPal account disconnected; global credentials resume", p_correlation_id: requestId ?? null });
      json(res, 200, { ok: true, connected: false });
      return true;
    }
    const body = await readJson(req);
    const clientId = requireString(body.clientId, "clientId", 200);
    const clientSecret = requireString(body.clientSecret, "clientSecret", 2000);
    const webhookId = typeof body.webhookId === "string" && body.webhookId.trim() ? body.webhookId.trim() : null;
    if (webhookId && webhookId.length > 200) throw statusError(400, "Invalid webhookId");
    const environment = body.environment === "live" ? "live" : "sandbox";
    const key = ctx.config.security.paypalCredentialsKey;
    if (!key) throw statusError(500, "PayPal credential encryption is not configured");
    // Fail fast: prove the credentials work before storing anything.
    const probe = new PayPalGateway(ctx.config, ctx.fetchImpl, {
      clientId,
      clientSecret,
      webhookId: webhookId ?? undefined,
      environment,
    });
    try {
      await probe.getAccessToken();
    } catch {
      throw statusError(400, "PayPal rejected these credentials; check the client ID, secret and environment");
    }
    const existing = await paypalAccountRow(ctx, workspaceId);
    const row = { workspace_id: workspaceId, environment, paypal_client_id: clientId, paypal_client_secret_enc: encryptSecret(clientSecret, key), paypal_webhook_id: webhookId, created_by: auth.user.id, updated_at: new Date().toISOString() };
    const saved = existing
      ? (await ctx.supabase.update<Record<string, any>>("workspace_paypal_accounts", row, { workspace_id: `eq.${workspaceId}` }))[0]
      : (await ctx.supabase.insert<Record<string, any>>("workspace_paypal_accounts", row))[0];
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: workspaceId, p_actor_id: auth.user.id, p_action: existing ? "PAYPAL_ACCOUNT_UPDATED" : "PAYPAL_ACCOUNT_CONNECTED", p_resource_type: "WORKSPACE", p_resource_id: workspaceId, p_detail: `Workspace PayPal account ${existing ? "updated" : "connected"} (${environment})`, p_correlation_id: requestId ?? null });
    json(res, 200, toSafeAccount(saved));
    return true;
  }

  return false;
}
