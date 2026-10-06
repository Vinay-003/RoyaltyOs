import type { IncomingMessage } from "node:http";
import type { AppContext } from "./context.ts";
import { assertSessionFresh, bearerToken, statusError } from "./http.ts";

function jwtIssuedAt(token: string) {
  const part = token.split(".")[1];
  if (!part) return 0;
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    return typeof payload.iat === "number" ? payload.iat * 1000 : 0;
  } catch { return 0; }
}

export async function principal(ctx: AppContext, req: IncomingMessage) {
  const token = bearerToken(req);
  assertSessionFresh(req);
  const user = await ctx.supabase.verifyUser(token);
  if (!user?.id) throw statusError(401, "Invalid access token");
  const revokedBefore = await ctx.repo.sessionRevokedBefore(user.id);
  if (revokedBefore) {
    const issuedAt = jwtIssuedAt(token);
    if (!issuedAt || issuedAt <= Date.parse(revokedBefore)) throw statusError(401, "Session was revoked");
  }
  return { id: user.id, email: user.email ?? null, token };
}

export async function authorizeWorkspace(
  ctx: AppContext,
  req: IncomingMessage,
  workspaceId: string,
  roles: string[],
  stepUp = false,
) {
  const user = await principal(ctx, req);
  const membership = await ctx.repo.requireRole(user.id, workspaceId, roles);
  if (stepUp) await ctx.repo.requireRecentStepUp(user.id, ctx.config.security.stepUpTtlSeconds);
  return { user, membership };
}

export async function authorizeByResource(
  ctx: AppContext,
  req: IncomingMessage,
  table: string,
  resourceId: string,
  roles: string[],
  stepUp = false,
) {
  const rows = await ctx.supabase.select<Record<string, unknown>>(table, {
    select: "workspace_id,id",
    id: `eq.${resourceId}`,
    limit: "1",
  });
  const row = rows[0];
  if (!row) throw statusError(404, "Resource not found");
  const workspaceId = String(row.workspace_id);
  const auth = await authorizeWorkspace(ctx, req, workspaceId, roles, stepUp);
  return { ...auth, workspaceId, resource: row };
}
