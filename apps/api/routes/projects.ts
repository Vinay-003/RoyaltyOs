import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeByResource, authorizeWorkspace, principal } from "../auth.ts";
import type { AppContext } from "../context.ts";
import {
  json,
  readJson,
  requireEmail,
  requireString,
  routeMatch,
  statusError,
} from "../http.ts";
import { listWorkspaces } from "../services.ts";
import { ALL_READ_ROLES, FINANCE_ROLES, workspaceFromProject } from "./helpers.ts";

export async function handleProjectRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/v1/projects") {
    const p = await principal(ctx, req);
    const workspaceIdParam = url.searchParams.get("workspaceId");
    if (workspaceIdParam) {
      await ctx.repo.requireRole(p.id, workspaceIdParam, ALL_READ_ROLES);
      json(res, 200, await ctx.supabase.select("projects", { select: "*", workspace_id: `eq.${workspaceIdParam}`, order: "created_at.asc" }));
      return true;
    }
    const memberships = await listWorkspaces(ctx, p.id);
    const workspaceIds = memberships.map((m: any) => String(m.workspace_id));
    if (!workspaceIds.length) {
      json(res, 200, []);
      return true;
    }
    json(res, 200, await ctx.supabase.select("projects", { select: "*", workspace_id: `in.(${workspaceIds.join(",")})`, order: "created_at.asc" }));
    return true;
  }

  let match = routeMatch("/api/v1/workspaces/:workspaceId/projects", path);
  if (match && method === "GET") {
    const p = await principal(ctx, req);
    const workspaceId = match.workspaceId!;
    await ctx.repo.requireRole(p.id, workspaceId, ALL_READ_ROLES);
    json(res, 200, await ctx.supabase.select("projects", { select: "*", workspace_id: `eq.${workspaceId}`, order: "created_at.asc" }));
    return true;
  }

  match = routeMatch("/api/v1/projects/:id", path);
  if (match && method === "GET") {
    const p = await principal(ctx, req);
    const project = (await ctx.supabase.select<Record<string, any>>("projects", { select: "*", id: `eq.${match.id}`, limit: "1" }))[0];
    if (!project) throw statusError(404, "Project not found");
    await ctx.repo.requireRole(p.id, String(project.workspace_id), ALL_READ_ROLES);
    json(res, 200, project);
    return true;
  }

  if (method === "POST" && path === "/api/v1/projects") {
    const body = await readJson(req);
    const workspaceId = requireString(body.workspaceId, "workspaceId", 100);
    const { user } = await authorizeWorkspace(ctx, req, workspaceId, ["OWNER"]);
    const name = requireString(body.name, "name", 160);
    const currency = requireString(body.currency ?? ctx.config.paypal.currency, "currency", 3).toUpperCase();
    const rows = await ctx.supabase.insert<Record<string, any>>("projects", { workspace_id: workspaceId, name, currency });
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: workspaceId, p_actor_id: user.id, p_action: "PROJECT_CREATED", p_resource_type: "PROJECT", p_resource_id: String(rows[0]?.id), p_detail: `Project created: ${name}`, p_correlation_id: requestId });
    json(res, 201, rows[0]);
    return true;
  }

  if (method === "GET" && path === "/api/v1/beneficiaries") {
    const p = await principal(ctx, req);
    const projectId = url.searchParams.get("projectId");
    const workspaceId = url.searchParams.get("workspaceId");
    if (projectId) {
      const project = await workspaceFromProject(ctx, projectId);
      await ctx.repo.requireRole(p.id, String(project.workspace_id), ALL_READ_ROLES);
      json(res, 200, await ctx.supabase.select("beneficiaries", { select: "*", project_id: `eq.${projectId}`, order: "display_name.asc" }));
      return true;
    }
    if (workspaceId) {
      await ctx.repo.requireRole(p.id, workspaceId, ALL_READ_ROLES);
      json(res, 200, await ctx.supabase.select("beneficiaries", { select: "*", workspace_id: `eq.${workspaceId}`, order: "display_name.asc" }));
      return true;
    }
    throw statusError(400, "projectId or workspaceId required");
  }

  if (method === "POST" && path === "/api/v1/beneficiaries") {
    const body = await readJson(req);
    const projectId = requireString(body.projectId, "projectId", 100);
    const project = await workspaceFromProject(ctx, projectId);
    const { user } = await authorizeWorkspace(ctx, req, String(project.workspace_id), FINANCE_ROLES, true);
    const rawKey = body.beneficiaryKey ?? body.key ?? body.name;
    const beneficiaryKey = requireString(rawKey, "beneficiaryKey", 100).toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const rawName = body.displayName ?? body.name ?? beneficiaryKey;
    const displayName = requireString(rawName, "displayName", 160);
    const rawEmail = body.payoutEmail ?? body.email;
    const payoutEmail = rawEmail ? requireEmail(rawEmail, "payoutEmail") : null;
    const rows = await ctx.supabase.insert<Record<string, any>>("beneficiaries", { workspace_id: project.workspace_id, project_id: projectId, beneficiary_key: beneficiaryKey, display_name: displayName, payout_email: payoutEmail, status: "ACTIVE" });
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: project.workspace_id, p_actor_id: user.id, p_action: "BENEFICIARY_CREATED", p_resource_type: "BENEFICIARY", p_resource_id: String(rows[0]?.id), p_detail: `Beneficiary ${beneficiaryKey} created`, p_correlation_id: requestId });
    json(res, 201, rows[0]);
    return true;
  }

  match = routeMatch("/api/v1/beneficiaries/:id", path);
  if (match && method === "PATCH") {
    const auth = await authorizeByResource(ctx, req, "beneficiaries", match.id!, FINANCE_ROLES, true);
    const body = await readJson(req);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.displayName !== undefined) patch.display_name = requireString(body.displayName, "displayName", 160);
    if (body.payoutEmail !== undefined) patch.payout_email = body.payoutEmail ? requireEmail(body.payoutEmail, "payoutEmail") : null;
    if (body.status !== undefined) {
      const status = requireString(body.status, "status", 20);
      if (!["ACTIVE", "HOLD", "ARCHIVED"].includes(status)) throw statusError(400, "Invalid beneficiary status");
      patch.status = status;
    }
    const rows = await ctx.supabase.update<Record<string, any>>("beneficiaries", patch, { id: `eq.${match.id}` });
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: auth.workspaceId, p_actor_id: auth.user.id, p_action: "PAYOUT_RECIPIENT_UPDATED", p_resource_type: "BENEFICIARY", p_resource_id: match.id, p_detail: "Beneficiary payout destination/profile updated; prior settlement snapshots are unchanged", p_correlation_id: requestId });
    await ctx.supabase.insert("outbox_events", {
      workspace_id: auth.workspaceId, topic: "beneficiary.changed", aggregate_type: "BENEFICIARY", aggregate_id: match.id,
      payload: { beneficiaryId: match.id, changedBy: auth.user.id }, correlation_id: requestId, dedupe_key: `beneficiary.changed:${match.id}:${requestId}`,
    }, false);
    json(res, 200, rows[0]);
    return true;
  }

  return false;
}
