import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeWorkspace, principal } from "../auth.ts";
import type { AppContext } from "../context.ts";
import {
  authCookieHeaders,
  clearAuthCookieHeaders,
  cookieValue,
  json,
  readJson,
  requireEmail,
  requireString,
  routeMatch,
  statusError,
} from "../http.ts";
import { bootstrapForUser, listWorkspaces } from "../services.ts";
import { clientIpHash, enforceRateLimit } from "./helpers.ts";

export async function handleAuthRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "POST" && path === "/api/v1/auth/register") {
    await enforceRateLimit(ctx, `auth-register:${clientIpHash(req)}`, 8, 900);
    const body = await readJson(req, 1024 * 1024);
    const email = requireEmail(body.email);
    const password = requireString(body.password, "password", 200);
    if (password.length < 10) throw statusError(400, "Password must be at least 10 characters");
    const displayName = requireString(
      typeof body.displayName === "string" && body.displayName.trim() ? body.displayName : email.split("@")[0],
      "displayName",
      120,
    );
    const out = await ctx.supabase.signUp(email, password, displayName);
    const tokenLike = out as Record<string, unknown>;
    const hasSession = typeof tokenLike.access_token === "string" && typeof tokenLike.refresh_token === "string";
    const safe = { user: tokenLike.user ?? null, sessionCreated: hasSession };
    json(res, 201, safe, hasSession ? authCookieHeaders(tokenLike as any, ctx.config.nodeEnv) : {});
    return true;
  }

  if (method === "POST" && path === "/api/v1/auth/login") {
    await enforceRateLimit(ctx, `auth-login:${clientIpHash(req)}`, 20, 900);
    const body = await readJson(req, 1024 * 1024);
    const email = requireEmail(body.email);
    const password = requireString(body.password, "password", 200);
    const auth = await ctx.supabase.signIn(email, password);
    const boot = await bootstrapForUser(ctx, auth.user.id);
    json(res, 200, { user: auth.user, expires_in: auth.expires_in, bootstrap: boot }, authCookieHeaders(auth, ctx.config.nodeEnv));
    return true;
  }

  if (method === "POST" && path === "/api/v1/auth/refresh") {
    const body = await readJson(req, 1024 * 1024);
    const refreshToken = body.refreshToken
      ? requireString(body.refreshToken, "refreshToken", 4096)
      : cookieValue(req, "royaltyos_refresh");
    if (!refreshToken) throw statusError(401, "Refresh session required");
    const auth = await ctx.supabase.refreshSession(refreshToken);
    json(res, 200, { user: auth.user, expires_in: auth.expires_in }, authCookieHeaders(auth, ctx.config.nodeEnv));
    return true;
  }

  if (method === "POST" && path === "/api/v1/auth/logout") {
    json(res, 200, { ok: true }, clearAuthCookieHeaders(ctx.config.nodeEnv));
    return true;
  }

  if (method === "POST" && path === "/api/v1/auth/revoke-sessions") {
    const p = await principal(ctx, req);
    const revokedBefore = await ctx.repo.revokeSessions(p.id);
    const memberships = await listWorkspaces(ctx, p.id);
    for (const membership of memberships) {
      await ctx.supabase.rpc("royaltyos_append_audit", {
        p_workspace_id: membership.workspace_id, p_actor_id: p.id, p_action: "SESSIONS_REVOKED", p_resource_type: "USER", p_resource_id: p.id,
        p_detail: "All access tokens issued before this time were revoked", p_correlation_id: requestId,
      });
    }
    json(res, 200, { ok: true, revokedBefore }, clearAuthCookieHeaders(ctx.config.nodeEnv));
    return true;
  }

  if (method === "POST" && path === "/api/v1/auth/step-up") {
    const p = await principal(ctx, req);
    await enforceRateLimit(ctx, `step-up:${p.id}`, 10, 900);
    if (!p.email) throw statusError(400, "Authenticated account has no email");
    const body = await readJson(req, 1024 * 1024);
    const password = requireString(body.password, "password", 200);
    await ctx.supabase.signIn(p.email, password);
    const stepUpAt = await ctx.repo.markStepUp(p.id);
    const memberships = await listWorkspaces(ctx, p.id);
    const workspaceId = String(memberships[0]?.workspace_id ?? "");
    if (workspaceId) await ctx.supabase.rpc("royaltyos_append_audit", {
      p_workspace_id: workspaceId, p_actor_id: p.id, p_action: "STEP_UP_AUTHENTICATED", p_resource_type: "USER", p_resource_id: p.id,
      p_detail: "User re-verified password for sensitive financial actions", p_correlation_id: requestId,
    });
    json(res, 200, { ok: true, stepUpAt });
    return true;
  }

  if (method === "GET" && path === "/api/v1/me") {
    const p = await principal(ctx, req);
    const memberships = await listWorkspaces(ctx, p.id);
    json(res, 200, { user: p, memberships, version: ctx.config.appVersion });
    return true;
  }

  if (method === "POST" && path === "/api/v1/bootstrap") {
    const p = await principal(ctx, req);
    json(res, 200, await bootstrapForUser(ctx, p.id));
    return true;
  }

  if (method === "GET" && path === "/api/v1/workspaces") {
    const p = await principal(ctx, req);
    json(res, 200, await listWorkspaces(ctx, p.id));
    return true;
  }

  const match = routeMatch("/api/v1/workspaces/:workspaceId/members", path);
  if (match && method === "GET") {
    await authorizeWorkspace(ctx, req, match.workspaceId!, ["OWNER", "AUDITOR"]);
    const memberships = await ctx.supabase.select<Record<string, any>>("workspace_memberships", {
      select: "workspace_id,user_id,role,beneficiary_key,created_at", workspace_id: `eq.${match.workspaceId}`, order: "created_at.asc",
    });
    const members: any[] = [];
    for (const membership of memberships) {
      const user = await ctx.supabase.adminGetUser(String(membership.user_id));
      members.push({ ...membership, email: user.email ?? null, displayName: user.user_metadata?.display_name ?? null });
    }
    json(res, 200, members);
    return true;
  }
  if (match && method === "POST") {
    const { user } = await authorizeWorkspace(ctx, req, match.workspaceId!, ["OWNER"], true);
    const body = await readJson(req);
    const userId = requireString(body.userId, "userId", 100);
    const role = requireString(body.role, "role", 40);
    if (!["OWNER", "CONTRACT_MANAGER", "FINANCE_APPROVER", "CONTRIBUTOR", "AUDITOR"].includes(role)) throw statusError(400, "Invalid role");
    const rows = await ctx.supabase.select<Record<string, any>>("workspace_memberships", { select: "user_id", workspace_id: `eq.${match.workspaceId}`, user_id: `eq.${userId}`, limit: "1" });
    if (rows.length) await ctx.supabase.update("workspace_memberships", { role, beneficiary_key: body.beneficiaryKey ?? null }, { workspace_id: `eq.${match.workspaceId}`, user_id: `eq.${userId}` }, false);
    else await ctx.supabase.insert("workspace_memberships", { workspace_id: match.workspaceId, user_id: userId, role, beneficiary_key: body.beneficiaryKey ?? null }, false);
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: match.workspaceId, p_actor_id: user.id, p_action: "WORKSPACE_ROLE_CHANGED", p_resource_type: "USER", p_resource_id: userId, p_detail: `Workspace role set to ${role}`, p_correlation_id: requestId });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
