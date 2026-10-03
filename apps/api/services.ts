import { hashCanonical, sha256Hex } from "../../packages/core/hash.ts";
import { newId } from "../../packages/core/id.ts";
import { compileRuleset } from "../../packages/core/ruleset-compiler.ts";
import { calculateSettlement } from "../../packages/core/settlement-engine.ts";
import type { CandidateRule, ExecutableRule, RecoupmentState } from "../../packages/core/types.ts";
import { extractionToCandidates, extractContractWithOpenAI } from "../../packages/ai/openai-contract.ts";
import { extractContractWithVision } from "../../packages/ai/vision-contract.ts";
import { validateContractUpload } from "../../packages/security/upload.ts";
import type { AppContext } from "./context.ts";
import { statusError } from "./http.ts";

function toCandidate(row: Record<string, any>): CandidateRule {
  return {
    id: String(row.id),
    type: row.rule_type,
    beneficiaryKey: row.beneficiary_key ?? null,
    base: row.base,
    rateBasisPoints: row.rate_basis_points === null ? null : Number(row.rate_basis_points),
    fixedMinor: row.fixed_minor === null ? null : Number(row.fixed_minor),
    priority: Number(row.priority),
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
    config: row.config && typeof row.config === "object" ? row.config : {},
    dependencies: Array.isArray(row.dependencies) ? row.dependencies : [],
    evidence: row.evidence,
    confidence: Number(row.confidence),
    status: row.status,
  };
}

function toExecutableRule(row: Record<string, any>, evidence: Record<string, any> | null): ExecutableRule {
  return {
    id: String(row.id),
    type: row.rule_type,
    beneficiaryKey: row.beneficiary_key ?? null,
    base: row.base,
    rateBasisPoints: row.rate_basis_points === null ? null : Number(row.rate_basis_points),
    fixedMinor: row.fixed_minor === null ? null : Number(row.fixed_minor),
    priority: Number(row.priority),
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
    config: row.config && typeof row.config === "object" ? row.config : {},
    dependencies: Array.isArray(row.dependencies) ? row.dependencies : [],
    evidence: {
      sourceDocument: evidence?.source_document ?? "Unknown",
      sourceVersion: Number(evidence?.source_version ?? 1),
      page: evidence?.page === null || evidence?.page === undefined ? null : Number(evidence.page),
      clause: evidence?.clause ?? null,
      sourceText: evidence?.source_text ?? "",
      model: evidence?.extraction_model ?? "unknown",
    },
  };
}

export async function bootstrapForUser(ctx: AppContext, userId: string) {
  return await ctx.supabase.rpc<{ workspaceId: string; projectId: string }>("royaltyos_bootstrap_workspace", {
    p_user_id: userId,
    p_workspace_name: "RoyaltyOS Workspace",
    p_project_name: "Northstar Creator Campaign",
    p_currency: ctx.config.paypal.currency,
  });
}

export async function listWorkspaces(ctx: AppContext, userId: string) {
  return await ctx.repo.memberships(userId);
}

export async function createContract(
  ctx: AppContext,
  input: { workspaceId: string; projectId: string; title: string; actorId: string },
) {
  const project = (await ctx.supabase.select<Record<string, any>>("projects", {
    select: "id,workspace_id,currency",
    id: `eq.${input.projectId}`,
    workspace_id: `eq.${input.workspaceId}`,
    limit: "1",
  }))[0];
  if (!project) throw statusError(404, "Project not found in workspace");
  const rows = await ctx.supabase.insert<Record<string, any>>("contracts", {
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    title: input.title,
    created_by: input.actorId,
    status: "DRAFT",
  });
  const contract = rows[0];
  if (!contract) throw new Error("Contract insert returned no record");
  await ctx.supabase.rpc("royaltyos_append_audit", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId,
    p_action: "CONTRACT_CREATED",
    p_resource_type: "CONTRACT",
    p_resource_id: String(contract.id),
    p_detail: `Contract created: ${input.title}`,
    p_correlation_id: null,
  });
  return contract;
}

export async function uploadContractVersion(
  ctx: AppContext,
  input: {
    workspaceId: string;
    contractId: string;
    actorId: string;
    filename: string;
    bytes: Uint8Array;
    effectiveAt?: string | null;
  },
) {
  const contract = (await ctx.supabase.select<Record<string, any>>("contracts", {
    select: "id,workspace_id,project_id,title,status",
    id: `eq.${input.contractId}`,
    workspace_id: `eq.${input.workspaceId}`,
    limit: "1",
  }))[0];
  if (!contract) throw statusError(404, "Contract not found");
  const validation = await validateContractUpload(input.bytes, {
    maxBytes: ctx.config.security.maxUploadBytes,
    maxPages: ctx.config.security.maxPdfPages,
    malwareScanMode: ctx.config.security.malwareScanMode,
    clamavHost: ctx.config.security.clamavHost,
    clamavPort: ctx.config.security.clamavPort,
    nodeEnv: ctx.config.nodeEnv,
  });
  const prior = await ctx.supabase.select<Record<string, any>>("contract_versions", {
    select: "id,version",
    contract_id: `eq.${input.contractId}`,
    order: "version.desc",
    limit: "1",
  });
  const nextVersion = Number(prior[0]?.version ?? 0) + 1;
  const versionRows = await ctx.supabase.insert<Record<string, any>>("contract_versions", {
    workspace_id: input.workspaceId,
    contract_id: input.contractId,
    version: nextVersion,
    title: contract.title,
    effective_at: input.effectiveAt ?? null,
    supersedes_version_id: prior[0]?.id ?? null,
    created_by: input.actorId,
  });
  const version = versionRows[0];
  if (!version) throw new Error("Contract version insert failed");
  const objectPath = `${input.workspaceId}/${input.contractId}/v${nextVersion}/${validation.sha256.slice(0, 16)}-${input.filename.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  try {
    await ctx.supabase.uploadPrivateObject(ctx.config.supabase.storageBucket, objectPath, input.bytes, "application/pdf");
    await ctx.supabase.insert("contract_documents", {
      workspace_id: input.workspaceId,
      contract_version_id: version.id,
      bucket: ctx.config.supabase.storageBucket,
      object_path: objectPath,
      original_filename: input.filename,
      mime_type: "application/pdf",
      file_size_bytes: validation.sizeBytes,
      page_count: validation.pageCount,
      sha256: validation.sha256,
      malware_scan_status: validation.malwareScan,
      malware_scan_detail: validation.malwareScanDetail,
    }, false);
  } catch (error) {
    // Contract versions are immutable. A failed storage write intentionally leaves an orphaned
    // draft version rather than mutating history; the UI can upload the next version.
    throw error;
  }
  await ctx.supabase.rpc("royaltyos_append_audit", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId,
    p_action: "CONTRACT_VERSION_UPLOADED",
    p_resource_type: "CONTRACT_VERSION",
    p_resource_id: String(version.id),
    p_detail: `PDF v${nextVersion} validated, hashed and stored privately (${validation.sha256.slice(0, 16)}...)`,
    p_correlation_id: null,
  });
  return { ...version, document: { ...validation, objectPath } };
}

export async function analyzeContractVersion(
  ctx: AppContext,
  input: { workspaceId: string; contractId: string; versionId: string; actorId: string },
) {
  const version = (await ctx.supabase.select<Record<string, any>>("contract_versions", {
    select: "id,contract_id,workspace_id,version,title",
    id: `eq.${input.versionId}`,
    contract_id: `eq.${input.contractId}`,
    workspace_id: `eq.${input.workspaceId}`,
    limit: "1",
  }))[0];
  if (!version) throw statusError(404, "Contract version not found");
  const document = (await ctx.supabase.select<Record<string, any>>("contract_documents", {
    select: "bucket,object_path,original_filename,file_size_bytes,page_count,sha256",
    contract_version_id: `eq.${input.versionId}`,
    limit: "1",
  }))[0];
  if (!document) throw statusError(409, "Contract version has no validated document");
  const bytes = await ctx.supabase.downloadPrivateObject(String(document.bucket), String(document.object_path));

  const priorVersionRows = await ctx.supabase.select<Record<string, any>>("contract_versions", {
    select: "id,version",
    contract_id: `eq.${input.contractId}`,
    order: "version.desc",
    limit: "4",
  });
  const priorDocuments: Array<{ filename: string; bytes: Uint8Array; documentVersion: number }> = [];
  for (const priorVersion of priorVersionRows
    .filter((row) => Number(row.version) < Number(version.version))
    .slice(0, 3)
    .reverse()) {
    const priorDocument = (await ctx.supabase.select<Record<string, any>>("contract_documents", {
      select: "bucket,object_path,original_filename",
      contract_version_id: `eq.${priorVersion.id}`,
      limit: "1",
    }))[0];
    if (!priorDocument) continue;
    priorDocuments.push({
      filename: String(priorDocument.original_filename),
      bytes: await ctx.supabase.downloadPrivateObject(String(priorDocument.bucket), String(priorDocument.object_path)),
      documentVersion: Number(priorVersion.version),
    });
  }

  const extractor = ctx.config.ai.extractionMode === "vision" ? extractContractWithVision : extractContractWithOpenAI;
  const result = await extractor(ctx.config, {
    filename: String(document.original_filename),
    bytes,
    documentVersion: Number(version.version),
    priorDocuments,
  }, ctx.fetchImpl);
  const analysisRows = await ctx.supabase.insert<Record<string, any>>("contract_analyses", {
    workspace_id: input.workspaceId,
    contract_version_id: input.versionId,
    provider: ctx.config.ai.provider,
    model: result.model,
    provider_response_id: result.rawResponseId,
    status: "REVIEW_REQUIRED",
    extraction: result.extraction,
    warnings: result.extraction.warnings,
    conflicts: result.extraction.conflicts,
  });
  const analysis = analysisRows[0];
  if (!analysis) throw new Error("Analysis insert failed");
  const candidates = extractionToCandidates({
    extraction: result.extraction,
    analysisId: String(analysis.id),
    documentTitle: String(version.title),
    documentVersion: Number(version.version),
    model: result.model,
    idFactory: newId,
  });
  if (candidates.length) {
    await ctx.supabase.insert("candidate_rules", candidates.map((r) => ({
      id: r.id,
      workspace_id: input.workspaceId,
      analysis_id: analysis.id,
      contract_version_id: input.versionId,
      rule_type: r.type,
      beneficiary_key: r.beneficiaryKey,
      base: r.base,
      rate_basis_points: r.rateBasisPoints,
      fixed_minor: r.fixedMinor,
      priority: r.priority,
      conditions: r.conditions,
      config: r.config,
      dependencies: r.dependencies,
      evidence: r.evidence,
      confidence: r.confidence,
      status: r.status,
    })), false);
  }
  console.info(JSON.stringify({
    level: "info",
    message: "AI contract extraction finished",
    contractId: input.contractId,
    versionId: input.versionId,
    model: result.model,
    mode: ctx.config.ai.extractionMode,
    candidates: candidates.length,
    warnings: result.extraction.warnings.length,
    conflicts: result.extraction.conflicts.length,
  }));
  await ctx.supabase.update("contracts", { status: "REVIEW_REQUIRED" }, { id: `eq.${input.contractId}` }, false);
  await ctx.supabase.rpc("royaltyos_append_audit", {
    p_workspace_id: input.workspaceId,
    p_actor_id: input.actorId,
    p_action: "AI_CONTRACT_EXTRACTION",
    p_resource_type: "CONTRACT_VERSION",
    p_resource_id: input.versionId,
    p_detail: `${candidates.length} candidate rules extracted with ${result.extraction.conflicts.length} conflict(s); human review required`,
    p_correlation_id: null,
  });
  return { analysisId: analysis.id, parties: result.extraction.parties, candidates, warnings: result.extraction.warnings, conflicts: result.extraction.conflicts };
}

export async function activateContractRuleset(
  ctx: AppContext,
  input: { workspaceId: string; contractId: string; actorId: string },
) {
  const contract = (await ctx.supabase.select<Record<string, any>>("contracts", {
    select: "id,workspace_id,project_id,title",
    id: `eq.${input.contractId}`,
    workspace_id: `eq.${input.workspaceId}`,
    limit: "1",
  }))[0];
  if (!contract) throw statusError(404, "Contract not found");
  const version = (await ctx.supabase.select<Record<string, any>>("contract_versions", {
    select: "id,version",
    contract_id: `eq.${input.contractId}`,
    order: "version.desc",
    limit: "1",
  }))[0];
  if (!version) throw statusError(409, "Contract has no version");
  const analysis = (await ctx.supabase.select<Record<string, any>>("contract_analyses", {
    select: "id",
    contract_version_id: `eq.${version.id}`,
    order: "created_at.desc",
    limit: "1",
  }))[0];
  if (!analysis) throw statusError(409, "Analyze the latest contract version first");
  const candidateRows = await ctx.supabase.select<Record<string, any>>("candidate_rules", {
    select: "*",
    analysis_id: `eq.${analysis.id}`,
    order: "priority.asc",
  });
  const beneficiaries = await ctx.supabase.select<Record<string, any>>("beneficiaries", {
    select: "beneficiary_key",
    project_id: `eq.${contract.project_id}`,
    status: "eq.ACTIVE",
  });
  const project = (await ctx.supabase.select<Record<string, any>>("projects", {
    select: "currency",
    id: `eq.${contract.project_id}`,
    limit: "1",
  }))[0];
  if (!project) throw statusError(404, "Project not found");
  const previous = await ctx.supabase.select<Record<string, any>>("rulesets", {
    select: "version",
    project_id: `eq.${contract.project_id}`,
    order: "version.desc",
    limit: "1",
  });
  const compiled = compileRuleset({
    candidates: candidateRows.map(toCandidate),
    beneficiaryKeys: new Set(beneficiaries.map((b) => String(b.beneficiary_key))),
    currency: String(project.currency),
    contractVersionId: String(version.id),
    nextVersion: Number(previous[0]?.version ?? 0) + 1,
  });
  const rulesetId = await ctx.supabase.rpc<string>("royaltyos_activate_ruleset", {
    p_workspace_id: input.workspaceId,
    p_project_id: contract.project_id,
    p_contract_version_id: version.id,
    p_version: compiled.version,
    p_ruleset_hash: compiled.rulesetHash,
    p_rules: compiled.rules,
    p_actor_id: input.actorId,
  });
  await ctx.supabase.update("contract_analyses", { status: "APPROVED" }, { id: `eq.${analysis.id}` }, false);
  return { rulesetId, version: compiled.version, rulesetHash: compiled.rulesetHash, rules: compiled.rules };
}

export async function loadActiveSettlementInputs(ctx: AppContext, projectId: string) {
  const ruleset = (await ctx.supabase.select<Record<string, any>>("rulesets", {
    select: "*",
    project_id: `eq.${projectId}`,
    status: "eq.ACTIVE",
    order: "version.desc",
    limit: "1",
  }))[0];
  if (!ruleset) throw statusError(409, "Project has no active RuleSet");
  const ruleRows = await ctx.supabase.select<Record<string, any>>("rules", {
    select: "*",
    ruleset_id: `eq.${ruleset.id}`,
    order: "priority.asc",
  });
  const evidenceRows = await ctx.supabase.select<Record<string, any>>("rule_evidence", {
    select: "*",
    rule_id: `in.(${ruleRows.map((r) => r.id).join(",")})`,
  });
  const evidenceByRule = new Map(evidenceRows.map((r) => [String(r.rule_id), r]));
  const rules = ruleRows.map((row) => toExecutableRule(row, evidenceByRule.get(String(row.id)) ?? null));
  const recRows = await ctx.supabase.select<Record<string, any>>("recoupment_accounts", {
    select: "*",
    project_id: `eq.${projectId}`,
  });
  const recoupments: RecoupmentState[] = recRows.map((r) => ({
    ruleId: String(r.rule_id),
    beneficiaryKey: String(r.beneficiary_key),
    originalMinor: Number(r.original_minor),
    recoupedMinor: Number(r.recouped_minor),
    remainingMinor: Number(r.remaining_minor),
    currency: String(r.currency),
  }));
  return { ruleset, rules, recoupments };
}

export async function calculateAndCommitSettlement(
  ctx: AppContext,
  input: { revenueEventId: string; actorId: string | null },
) {
  const revenue = (await ctx.supabase.select<Record<string, any>>("revenue_events", {
    select: "*",
    id: `eq.${input.revenueEventId}`,
    limit: "1",
  }))[0];
  if (!revenue) throw statusError(404, "Revenue event not found");
  const { ruleset, rules, recoupments } = await loadActiveSettlementInputs(ctx, String(revenue.project_id));
  const result = calculateSettlement({
    revenueMinor: Number(revenue.distributable_minor),
    currency: String(revenue.currency),
    category: revenue.revenue_category ?? null,
    occurredAt: String(revenue.received_at),
  }, rules, recoupments);
  const settlementHash = hashCanonical({
    revenueEventId: input.revenueEventId,
    rulesetId: ruleset.id,
    rulesetHash: ruleset.ruleset_hash,
    algorithmVersion: "royalty-engine-v1",
    result,
  });
  const settlementId = await ctx.supabase.rpc<string>("royaltyos_commit_settlement", {
    p_workspace_id: revenue.workspace_id,
    p_project_id: revenue.project_id,
    p_revenue_event_id: input.revenueEventId,
    p_ruleset_id: ruleset.id,
    p_ruleset_hash: ruleset.ruleset_hash,
    p_algorithm_version: "royalty-engine-v1",
    p_settlement_hash: settlementHash,
    p_lines: result.lines,
    p_actor_id: input.actorId,
  });
  return { settlementId, settlementHash, rulesetId: ruleset.id, result };
}

export function parsePayPalInvoiceAmount(invoice: Record<string, any>) {
  const value = invoice?.amount?.value;
  const currency = invoice?.amount?.currency_code;
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value) || typeof currency !== "string") {
    throw new Error("PayPal invoice amount is malformed");
  }
  const [whole, fraction = ""] = value.split(".");
  const amountMinor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(amountMinor)) throw new Error("PayPal invoice amount overflow");
  return { amountMinor, currency };
}

export function paypalWebhookPayloadHash(raw: Uint8Array) {
  return sha256Hex(raw);
}
