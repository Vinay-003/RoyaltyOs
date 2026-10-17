import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeByResource, authorizeWorkspace, principal } from "../auth.ts";
import type { AppContext } from "../context.ts";
import {
  json,
  parseBase64Data,
  readJson,
  requireMinor,
  requireString,
  routeMatch,
  statusError,
} from "../http.ts";
import {
  activateContractRuleset,
  analyzeContractVersion,
  createContract,
  loadActiveSettlementInputs,
  uploadContractVersion,
} from "../services.ts";
import { calculateSettlement } from "../../../packages/core/settlement-engine.ts";
import { assistRuleRefinement } from "../../../packages/ai/openai-contract.ts";
import { newId } from "../../../packages/core/id.ts";
import { ALL_READ_ROLES, CONTRACT_ROLES, FINANCE_ROLES, enforceRateLimit, workspaceFromProject } from "./helpers.ts";
import { logEvent } from "../logger.ts";

export async function handleContractRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/v1/contracts") {
    const p = await principal(ctx, req);
    const projectId = requireString(url.searchParams.get("projectId"), "projectId", 100);
    const project = await workspaceFromProject(ctx, projectId);
    await ctx.repo.requireRole(p.id, String(project.workspace_id), ALL_READ_ROLES);
    json(res, 200, await ctx.supabase.select("contracts", { select: "*", project_id: `eq.${projectId}`, order: "created_at.desc" }));
    return true;
  }

  if (method === "POST" && path === "/api/v1/contracts") {
    const body = await readJson(req);
    const workspaceId = requireString(body.workspaceId, "workspaceId", 100);
    const projectId = requireString(body.projectId, "projectId", 100);
    const { user } = await authorizeWorkspace(ctx, req, workspaceId, CONTRACT_ROLES);
    const contract = await createContract(ctx, { workspaceId, projectId, title: requireString(body.title, "title", 200), actorId: user.id });
    json(res, 201, contract);
    return true;
  }

  let match = routeMatch("/api/v1/contracts/:id/documents", path);
  if (match && method === "POST") {
    const auth = await authorizeByResource(ctx, req, "contracts", match.id!, CONTRACT_ROLES);
    await enforceRateLimit(ctx, `contract-upload:${auth.user.id}`, 20, 3600);
    const body = await readJson(req, ctx.config.security.maxUploadBytes * 2);
    const filename = requireString(body.filename, "filename", 240);
    if (!filename.toLowerCase().endsWith(".pdf")) throw statusError(400, "Only PDF files are supported");
    const bytes = parseBase64Data(requireString(body.fileBase64, "fileBase64", ctx.config.security.maxUploadBytes * 2));
    const result = await uploadContractVersion(ctx, { workspaceId: auth.workspaceId, contractId: match.id!, actorId: auth.user.id, filename, bytes, effectiveAt: body.effectiveAt ?? null });
    json(res, 201, result);
    return true;
  }

  match = routeMatch("/api/v1/contracts/:id/analyze", path);
  if (match && method === "POST") {
    const auth = await authorizeByResource(ctx, req, "contracts", match.id!, CONTRACT_ROLES);
    await enforceRateLimit(ctx, `contract-ai:${auth.user.id}`, 10, 3600);
    const body = await readJson(req);
    const versionId = requireString(body.versionId, "versionId", 100);
    logEvent("info", "API_ANALYZE_REQUEST", { contractId: match.id, versionId, userId: auth.user.id });
    const result = await analyzeContractVersion(ctx, { workspaceId: auth.workspaceId, contractId: match.id!, versionId, actorId: auth.user.id });
    logEvent("info", "API_ANALYZE_COMPLETED", { contractId: match.id, versionId, candidateCount: result?.candidates?.length ?? 0 });
    json(res, 200, result);
    return true;
  }

  match = routeMatch("/api/v1/contracts/:id/analysis", path);
  if (match && method === "GET") {
    const auth = await authorizeByResource(ctx, req, "contracts", match.id!, ALL_READ_ROLES);
    const version = (await ctx.supabase.select<Record<string, any>>("contract_versions", { select: "*", contract_id: `eq.${match.id}`, order: "version.desc", limit: "1" }))[0];
    if (!version) {
      json(res, 200, { analysis: null, rules: [] });
      return true;
    }
    const analysis = (await ctx.supabase.select<Record<string, any>>("contract_analyses", { select: "*", contract_version_id: `eq.${version.id}`, order: "created_at.desc", limit: "1" }))[0] ?? null;
    const rules = analysis ? await ctx.supabase.select("candidate_rules", { select: "*", analysis_id: `eq.${analysis.id}`, order: "priority.asc" }) : [];
    json(res, 200, { workspaceId: auth.workspaceId, version, analysis, rules });
    return true;
  }

  match = routeMatch("/api/v1/contracts/:id/document-url", path);
  if (match && method === "GET") {
    await authorizeByResource(ctx, req, "contracts", match.id!, ALL_READ_ROLES);
    const versionId = requireString(url.searchParams.get("versionId"), "versionId", 100);
    const doc = (await ctx.supabase.select<Record<string, any>>("contract_documents", { select: "bucket,object_path", contract_version_id: `eq.${versionId}`, limit: "1" }))[0];
    if (!doc) throw statusError(404, "Document not found");
    json(res, 200, { url: await ctx.supabase.signedObjectUrl(String(doc.bucket), String(doc.object_path), 300), expiresIn: 300 });
    return true;
  }

  match = routeMatch("/api/v1/rules/candidates/:id/review", path);
  if (match && method === "POST") {
    const auth = await authorizeByResource(ctx, req, "candidate_rules", match.id!, CONTRACT_ROLES, true);
    const body = await readJson(req);
    const action = requireString(body.action, "action", 20);
    if (!["APPROVE", "REJECT", "UPDATE"].includes(action)) throw statusError(400, "Invalid review action");
    const patch: Record<string, unknown> = { reviewed_by: auth.user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (action === "APPROVE") patch.status = "APPROVED";
    if (action === "REJECT") patch.status = "REJECTED";
    if (body.reviewNote !== undefined) patch.review_note = String(body.reviewNote).slice(0, 1000);
    if (body.rateBasisPoints !== undefined) {
      const n = Number(body.rateBasisPoints); if (!Number.isInteger(n) || n < 0 || n > 10000) throw statusError(400, "Invalid rateBasisPoints"); patch.rate_basis_points = n;
    }
    if (body.fixedMinor !== undefined) { const n = Number(body.fixedMinor); if (!Number.isSafeInteger(n) || n < 0) throw statusError(400, "Invalid fixedMinor"); patch.fixed_minor = n; }
    if (body.priority !== undefined) { const n = Number(body.priority); if (!Number.isInteger(n) || n < 0) throw statusError(400, "Invalid priority"); patch.priority = n; }
    if (body.base !== undefined) {
      if (!["GROSS_REVENUE", "NET_REVENUE", "REMAINDER"].includes(String(body.base))) throw statusError(400, "Invalid base");
      patch.base = String(body.base);
    }
    if (body.config !== undefined && typeof body.config === "object") patch.config = body.config;
    if (body.conditions !== undefined && Array.isArray(body.conditions)) patch.conditions = body.conditions;
    if (body.beneficiaryKey !== undefined) patch.beneficiary_key = body.beneficiaryKey ? String(body.beneficiaryKey).trim() : null;
    if (body.ruleType !== undefined) patch.rule_type = String(body.ruleType);
    const rows = await ctx.supabase.update<Record<string, any>>("candidate_rules", patch, { id: `eq.${match.id}` });
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: auth.workspaceId, p_actor_id: auth.user.id, p_action: `CANDIDATE_RULE_${action}`, p_resource_type: "CANDIDATE_RULE", p_resource_id: match.id, p_detail: `Candidate rule ${action.toLowerCase()} by authorized reviewer`, p_correlation_id: requestId });
    json(res, 200, rows[0]);
    return true;
  }

  match = routeMatch("/api/v1/rules/candidates/:id/assist", path);
  if (match && method === "POST") {
    const auth = await authorizeByResource(ctx, req, "candidate_rules", match.id!, CONTRACT_ROLES, false);
    const body = await readJson(req);
    const prompt = requireString(body.prompt, "prompt", 2000);
    const ruleRow = auth.resource;
    const result = await assistRuleRefinement(ctx.config, {
      rule: ruleRow,
      prompt,
      contractText: typeof body.contractText === "string" ? body.contractText : undefined,
    }, ctx.fetchImpl);
    json(res, 200, result);
    return true;
  }

  if (method === "POST" && path === "/api/v1/rules/candidates") {
    const body = await readJson(req);
    const contractId = requireString(body.contractId, "contractId", 100);
    const auth = await authorizeByResource(ctx, req, "contracts", contractId, CONTRACT_ROLES, true);
    const analyses = await ctx.supabase.select<Record<string, any>>("contract_analyses", {
      select: "id,contract_version_id",
      contract_id: `eq.${contractId}`,
      order: "created_at.desc",
      limit: "1",
    });
    const analysisId = analyses[0]?.id ?? null;
    const versionId = analyses[0]?.contract_version_id ?? null;
    const id = newId();
    const ruleType = requireString(body.ruleType || "FORMULA", "ruleType", 50);
    const beneficiaryKey = body.beneficiaryKey ? String(body.beneficiaryKey).trim() : null;
    const base = ["GROSS_REVENUE", "NET_REVENUE", "REMAINDER"].includes(body.base) ? body.base : "REMAINDER";
    const priority = typeof body.priority === "number" ? body.priority : 10;
    const rateBasisPoints = body.rateBasisPoints !== undefined && body.rateBasisPoints !== null ? Number(body.rateBasisPoints) : null;
    const fixedMinor = body.fixedMinor !== undefined && body.fixedMinor !== null ? Number(body.fixedMinor) : null;
    const config = typeof body.config === "object" && body.config !== null ? body.config : {};
    const conditions = Array.isArray(body.conditions) ? body.conditions : [];
    const newRule = {
      id,
      workspace_id: auth.workspaceId,
      analysis_id: analysisId,
      contract_version_id: versionId,
      rule_type: ruleType,
      beneficiary_key: beneficiaryKey,
      base,
      rate_basis_points: rateBasisPoints,
      fixed_minor: fixedMinor,
      priority,
      conditions,
      config,
      dependencies: [],
      evidence: {
        sourceDocument: "manual_operator_rule",
        sourceVersion: 1,
        page: null,
        clause: body.clause || "Operator Defined Rule",
        sourceText: body.sourceText || "Manually defined rule by operator",
        model: "human-operator",
      },
      confidence: 1.0,
      status: "APPROVED",
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
      review_note: body.reviewNote || "Authored by operator",
    };
    const rows = await ctx.supabase.insert<Record<string, any>>("candidate_rules", newRule);
    await ctx.supabase.rpc("royaltyos_append_audit", {
      p_workspace_id: auth.workspaceId,
      p_actor_id: auth.user.id,
      p_action: "CANDIDATE_RULE_MANUALLY_CREATED",
      p_resource_type: "CANDIDATE_RULE",
      p_resource_id: id,
      p_detail: `Operator manually defined ${ruleType} rule`,
      p_correlation_id: requestId,
    });
    json(res, 201, rows[0] ?? newRule);
    return true;
  }

  match = routeMatch("/api/v1/contracts/:id/approve", path);
  if (match && method === "POST") {
    const auth = await authorizeByResource(ctx, req, "contracts", match.id!, FINANCE_ROLES, true);
    json(res, 200, await activateContractRuleset(ctx, { workspaceId: auth.workspaceId, contractId: match.id!, actorId: auth.user.id }));
    return true;
  }

  if (method === "GET" && path === "/api/v1/rulesets/active") {
    const p = await principal(ctx, req);
    const projectId = requireString(url.searchParams.get("projectId"), "projectId", 100);
    const project = await workspaceFromProject(ctx, projectId);
    await ctx.repo.requireRole(p.id, String(project.workspace_id), ALL_READ_ROLES);
    const data = await loadActiveSettlementInputs(ctx, projectId);
    json(res, 200, data);
    return true;
  }

  match = routeMatch("/api/v1/rulesets/:id/simulate", path);
  if (match && method === "POST") {
    const ruleset = (await ctx.supabase.select<Record<string, any>>("rulesets", { select: "*", id: `eq.${match.id}`, limit: "1" }))[0];
    if (!ruleset) throw statusError(404, "RuleSet not found");
    const auth = await authorizeWorkspace(ctx, req, String(ruleset.workspace_id), ALL_READ_ROLES);
    const body = await readJson(req);
    const revenueMinor = requireMinor(body.revenueMinor, "revenueMinor");
    const inputs = await loadActiveSettlementInputs(ctx, String(ruleset.project_id));
    if (String(inputs.ruleset.id) !== match.id) throw statusError(409, "Simulation requires the active RuleSet");
    const result = calculateSettlement({ revenueMinor, currency: String(body.currency ?? "USD"), category: body.revenueCategory ?? null, occurredAt: body.occurredAt ?? new Date().toISOString() }, inputs.rules, inputs.recoupments);
    await ctx.supabase.insert("simulations", { workspace_id: ruleset.workspace_id, project_id: ruleset.project_id, ruleset_id: ruleset.id, created_by: auth.user.id, input: { revenueMinor, currency: body.currency ?? "USD", revenueCategory: body.revenueCategory ?? null }, output: result }, false);
    json(res, 200, { rulesetId: ruleset.id, rulesetVersion: ruleset.version, result });
    return true;
  }

  return false;
}
