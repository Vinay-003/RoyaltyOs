import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeByResource, authorizeWorkspace, principal } from "../auth.ts";
import type { AppContext } from "../context.ts";
import {
  json,
  readBody,
  readJson,
  requireEmail,
  requireMinor,
  requireString,
  routeMatch,
  statusError,
} from "../http.ts";
import {
  calculateAndCommitSettlement,
  paypalWebhookPayloadHash,
  reconcileInvoiceState,
} from "../services.ts";
import { sha256Hex } from "../../../packages/core/hash.ts";
import { buildPayoutIdempotencyKey } from "../../../packages/paypal/idempotency.ts";
import { ALL_READ_ROLES, FINANCE_ROLES, header, idempotencyHeader, listSettlementViews, resolveWebhookWorkspace, workspaceFromProject } from "./helpers.ts";

export async function handleFinanceRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/v1/invoices") {
    const p = await principal(ctx, req);
    const projectId = requireString(url.searchParams.get("projectId"), "projectId", 100);
    const project = await workspaceFromProject(ctx, projectId);
    await ctx.repo.requireRole(p.id, String(project.workspace_id), ALL_READ_ROLES);
    json(res, 200, await ctx.supabase.select("invoices", { select: "*", project_id: `eq.${projectId}`, order: "created_at.desc" }));
    return true;
  }

  if (method === "POST" && path === "/api/v1/invoices") {
    const body = await readJson(req);
    const workspaceId = requireString(body.workspaceId, "workspaceId", 100);
    const projectId = requireString(body.projectId, "projectId", 100);
    const { user } = await authorizeWorkspace(ctx, req, workspaceId, FINANCE_ROLES);
    const project = await workspaceFromProject(ctx, projectId);
    if (String(project.workspace_id) !== workspaceId) throw statusError(404, "Project not found in workspace");
    const amountMinor = requireMinor(body.amountMinor, "amountMinor");
    const recipientEmail = requireEmail(body.recipientEmail, "recipientEmail");
    const itemName = requireString(body.itemName, "itemName", 250);
    const idempotencyKey = idempotencyHeader(req);
    const existing = await ctx.supabase.select<Record<string, any>>("invoices", { select: "*", workspace_id: `eq.${workspaceId}`, request_id: `eq.${idempotencyKey}`, limit: "1" });
    if (existing[0]) {
      json(res, 200, existing[0]);
      return true;
    }
    const invoiceInput: Parameters<typeof ctx.paypal.createInvoice>[0] = {
      requestId: idempotencyKey, currency: String(body.currency ?? ctx.config.paypal.currency), recipientEmail, itemName, amountMinor, reference: `RoyaltyOS ${projectId}`,
    };
    if (body.note) invoiceInput.note = String(body.note).slice(0, 4000);
    const paypal = await ctx.paypal.createInvoice(invoiceInput);
    if (typeof paypal?.id !== "string") throw new Error("PayPal did not return an invoice id");
    const rows = await ctx.supabase.insert<Record<string, any>>("invoices", { workspace_id: workspaceId, project_id: projectId, created_by: user.id, paypal_invoice_id: paypal.id, recipient_email: recipientEmail, item_name: itemName, amount_minor: amountMinor, currency: body.currency ?? ctx.config.paypal.currency, status: paypal.status ?? "DRAFT", recipient_view_url: paypal?.detail?.metadata?.recipient_view_url ?? null, request_id: idempotencyKey });
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: workspaceId, p_actor_id: user.id, p_action: "INVOICE_CREATED", p_resource_type: "INVOICE", p_resource_id: String(rows[0]?.id), p_detail: `PayPal draft invoice ${paypal.id} created`, p_correlation_id: requestId });
    json(res, 201, rows[0]);
    return true;
  }

  let match = routeMatch("/api/v1/invoices/:id/send", path);
  if (match && method === "POST") {
    const auth = await authorizeByResource(ctx, req, "invoices", match.id!, FINANCE_ROLES);
    const invoice = (await ctx.supabase.select<Record<string, any>>("invoices", { select: "*", id: `eq.${match.id}`, limit: "1" }))[0];
    if (!invoice) throw statusError(404, "Invoice not found");
    const sendRequestId = sha256Hex(`send|${invoice.id}`).slice(0, 36);
    await ctx.paypal.sendInvoice(String(invoice.paypal_invoice_id), sendRequestId);
    const authoritative = await ctx.paypal.getInvoice(String(invoice.paypal_invoice_id));
    const rows = await ctx.supabase.update<Record<string, any>>("invoices", { status: authoritative.status ?? "SENT", recipient_view_url: authoritative?.detail?.metadata?.recipient_view_url ?? invoice.recipient_view_url, updated_at: new Date().toISOString() }, { id: `eq.${match.id}` });
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: auth.workspaceId, p_actor_id: auth.user.id, p_action: "INVOICE_SENT", p_resource_type: "INVOICE", p_resource_id: match.id, p_detail: `PayPal invoice ${invoice.paypal_invoice_id} sent`, p_correlation_id: sendRequestId });
    json(res, 200, rows[0]);
    return true;
  }

  match = routeMatch("/api/v1/invoices/:id/refresh", path);
  if (match && method === "POST") {
    // Manual authoritative refresh: a lost PayPal webhook can never strand an
    // invoice. Replays the worker's reconcile decision deterministically; the
    // revenue RPC is idempotent, so refreshing twice is safe.
    const auth = await authorizeByResource(ctx, req, "invoices", match.id!, FINANCE_ROLES);
    const invoice = (await ctx.supabase.select<Record<string, any>>("invoices", { select: "*", id: `eq.${match.id}`, limit: "1" }))[0];
    if (!invoice) throw statusError(404, "Invoice not found");
    const authoritative = await ctx.paypal.getInvoice(String(invoice.paypal_invoice_id));
    const reconciled = reconcileInvoiceState(
      { amountMinor: Number(invoice.amount_minor), currency: String(invoice.currency), viewUrl: invoice.recipient_view_url ?? null },
      authoritative,
    );
    const rows = await ctx.supabase.update<Record<string, any>>("invoices", {
      status: reconciled.status,
      recipient_view_url: reconciled.viewUrl,
      last_reconciled_at: new Date().toISOString(),
      reconciliation_status: reconciled.matched ? "MATCHED" : "MISMATCH",
      updated_at: new Date().toISOString(),
    }, { id: `eq.${match.id}` });
    if (reconciled.status === "PAID") {
      if (!reconciled.matched) throw statusError(409, "Invoice amount or currency mismatch with PayPal");
      // Revenue only: settlement stays a deliberate human action (Calculate),
      // so proposals are always computed against reviewed, current state.
      await ctx.supabase.rpc("royaltyos_record_invoice_revenue", {
        p_invoice_id: invoice.id,
        p_paypal_invoice_id: String(invoice.paypal_invoice_id),
        p_amount_minor: reconciled.amountMinor,
        p_currency: reconciled.currency,
        p_received_at: new Date().toISOString(),
        p_revenue_category: null,
      });
    }
    await ctx.supabase.rpc("royaltyos_append_audit", { p_workspace_id: auth.workspaceId, p_actor_id: auth.user.id, p_action: "INVOICE_REFRESHED", p_resource_type: "INVOICE", p_resource_id: match.id, p_detail: `PayPal invoice ${invoice.paypal_invoice_id} refreshed: ${reconciled.status}`, p_correlation_id: null });
    json(res, 200, (await ctx.supabase.select<Record<string, any>>("invoices", { select: "*", id: `eq.${match.id}`, limit: "1" }))[0] ?? rows[0]);
    return true;
  }

  if (method === "POST" && path === "/api/v1/webhooks/paypal") {
    const raw = await readBody(req, 2 * 1024 * 1024);
    let event: any;
    try { event = JSON.parse(new TextDecoder().decode(raw)); } catch { throw statusError(400, "Invalid PayPal webhook JSON"); }
    const eventId = requireString(event.id, "event.id", 200);
    const existing = await ctx.supabase.select<Record<string, any>>("webhook_events", { select: "paypal_event_id,verification_status", paypal_event_id: `eq.${eventId}`, limit: "1" });
    if (existing[0]?.verification_status === "SUCCESS") {
      json(res, 200, { received: true, duplicate: true });
      return true;
    }
    const webhookHeaders = {
      authAlgo: requireString(header(req, "paypal-auth-algo"), "paypal-auth-algo", 200),
      certUrl: requireString(header(req, "paypal-cert-url"), "paypal-cert-url", 2000),
      transmissionId: requireString(header(req, "paypal-transmission-id"), "paypal-transmission-id", 500),
      transmissionSig: requireString(header(req, "paypal-transmission-sig"), "paypal-transmission-sig", 5000),
      transmissionTime: requireString(header(req, "paypal-transmission-time"), "paypal-transmission-time", 200),
    };
    const verified = await ctx.paypal.verifyWebhook(webhookHeaders, event);
    if (!verified) throw statusError(400, "PayPal webhook signature verification failed");
    const resourceId = typeof event?.resource?.id === "string" ? event.resource.id : typeof event?.resource?.payout_batch_id === "string" ? event.resource.payout_batch_id : null;
    const webhookWorkspaceId = await resolveWebhookWorkspace(ctx, event);
    const stored = await ctx.supabase.rpc<Record<string, any>>("royaltyos_store_verified_paypal_webhook", {
      p_workspace_id: webhookWorkspaceId,
      p_paypal_event_id: eventId,
      p_event_type: String(event.event_type ?? "UNKNOWN"),
      p_resource_id: resourceId,
      p_transmission_id: webhookHeaders.transmissionId,
      p_raw_payload: event,
      p_raw_payload_hash: paypalWebhookPayloadHash(raw),
      p_correlation_id: requestId,
    });
    json(res, 200, { received: true, duplicate: Boolean(stored?.duplicate), queued: Boolean(stored?.queued), processingStatus: stored?.processingStatus ?? "STORED" });
    return true;
  }

  if (method === "GET" && path === "/api/v1/revenue-events") {
    const p = await principal(ctx, req);
    const projectId = requireString(url.searchParams.get("projectId"), "projectId", 100);
    const project = await workspaceFromProject(ctx, projectId);
    await ctx.repo.requireRole(p.id, String(project.workspace_id), ALL_READ_ROLES);
    json(res, 200, await ctx.supabase.select("revenue_events", { select: "*", project_id: `eq.${projectId}`, order: "received_at.desc" }));
    return true;
  }

  if (method === "POST" && path === "/api/v1/settlements") {
    const body = await readJson(req);
    const revenueEventId = requireString(body.revenueEventId, "revenueEventId", 100);
    const revenue = (await ctx.supabase.select<Record<string, any>>("revenue_events", { select: "*", id: `eq.${revenueEventId}`, limit: "1" }))[0];
    if (!revenue) throw statusError(404, "Revenue event not found");
    const auth = await authorizeWorkspace(ctx, req, String(revenue.workspace_id), FINANCE_ROLES);
    json(res, 200, await calculateAndCommitSettlement(ctx, { revenueEventId, actorId: auth.user.id }));
    return true;
  }

  if (method === "GET" && path === "/api/v1/settlements") {
    const p = await principal(ctx, req);
    const workspaceId = requireString(url.searchParams.get("workspaceId"), "workspaceId", 100);
    await ctx.repo.requireRole(p.id, workspaceId, ALL_READ_ROLES);
    json(res, 200, await listSettlementViews(ctx, workspaceId));
    return true;
  }

  match = routeMatch("/api/v1/settlements/:id/approve", path);
  if (match && method === "POST") {
    const auth = await authorizeByResource(ctx, req, "settlements", match.id!, FINANCE_ROLES, true);
    await ctx.supabase.rpc("royaltyos_approve_settlement", { p_settlement_id: match.id, p_actor_id: auth.user.id });
    const row = (await ctx.supabase.select<Record<string, any>>("settlements", { select: "*", id: `eq.${match.id}`, limit: "1" }))[0];
    json(res, 200, row);
    return true;
  }

  match = routeMatch("/api/v1/settlements/:id/void", path);
  if (match && method === "POST") {
    // Voids a stale proposal so the revenue can be recalculated fresh.
    // Only unapproved settlements can be voided; voided rows stay visible.
    const auth = await authorizeByResource(ctx, req, "settlements", match.id!, FINANCE_ROLES, true);
    await ctx.supabase.rpc("royaltyos_void_settlement", { p_settlement_id: match.id, p_actor_id: auth.user.id });
    const row = (await ctx.supabase.select<Record<string, any>>("settlements", { select: "*", id: `eq.${match.id}`, limit: "1" }))[0];
    json(res, 200, row);
    return true;
  }

  match = routeMatch("/api/v1/settlements/:id/execute", path);
  if (match && method === "POST") {
    const auth = await authorizeByResource(ctx, req, "settlements", match.id!, FINANCE_ROLES, true);
    const settlement = (await ctx.supabase.select<Record<string, any>>("settlements", { select: "*", id: `eq.${match.id}`, limit: "1" }))[0];
    if (!settlement) throw statusError(404, "Settlement not found");
    const payableLines = await ctx.supabase.select<Record<string, any>>("settlement_lines", { select: "id", settlement_id: `eq.${match.id}`, payable_minor: "gt.0", limit: "1" });
    if (!payableLines.length) throw statusError(409, "Settlement has no payable lines: fully absorbed by recoupment or reserve, nothing to send");
    const existingBatches = await ctx.supabase.select<Record<string, any>>("payout_batches", { select: "*", settlement_id: `eq.${match.id}`, order: "payout_version.desc", limit: "1" });
    const latest = existingBatches[0];
    const version = latest ? Number(latest.payout_version) : 1;
    const idempotencyKey = buildPayoutIdempotencyKey({ workspaceId: auth.workspaceId, settlementId: match.id!, version });
    const batch = await ctx.supabase.rpc<Record<string, any>>("royaltyos_reserve_payout", { p_settlement_id: match.id, p_actor_id: auth.user.id, p_idempotency_key: idempotencyKey });
    if (batch.status !== "READY" && batch.paypal_batch_id) {
      json(res, 200, batch);
      return true;
    }
    const items = await ctx.supabase.select<Record<string, any>>("payout_items", { select: "*", payout_batch_id: `eq.${batch.id}`, order: "sender_item_id.asc" });
    // PayPal request id is derived from the batch the database actually returned, so a
    // repeat/concurrent execute always replays the same PayPal idempotent request.
    const payoutRequestId = sha256Hex(buildPayoutIdempotencyKey({ workspaceId: auth.workspaceId, settlementId: match.id!, version: Number(batch.payout_version) || version })).slice(0, 36);
    const paypal = await ctx.paypal.createPayout(payoutRequestId, String(batch.id), items.map((item) => ({ recipientEmail: String(item.recipient_email), amountMinor: Number(item.amount_minor), currency: String(item.currency), note: ctx.config.paypal.payoutNote, senderItemId: String(item.sender_item_id) })));
    const paypalBatchId = paypal?.batch_header?.payout_batch_id;
    if (typeof paypalBatchId !== "string") throw new Error("PayPal payout did not return batch id");
    await ctx.supabase.rpc("royaltyos_mark_payout_submitted", { p_batch_id: batch.id, p_paypal_batch_id: paypalBatchId, p_correlation_id: payoutRequestId });
    json(res, 200, { ...batch, status: "SUBMITTED", paypal_batch_id: paypalBatchId });
    return true;
  }

  match = routeMatch("/api/v1/settlements/:id/retry-payout", path);
  if (match && method === "POST") {
    const auth = await authorizeByResource(ctx, req, "settlements", match.id!, FINANCE_ROLES, true);
    const latest = (await ctx.supabase.select<Record<string, any>>("payout_batches", { select: "*", settlement_id: `eq.${match.id}`, order: "payout_version.desc", limit: "1" }))[0];
    if (!latest) throw statusError(409, "No prior payout batch");
    const nextVersion = Number(latest.payout_version) + 1;
    const idempotencyKey = buildPayoutIdempotencyKey({ workspaceId: auth.workspaceId, settlementId: match.id!, version: nextVersion });
    const batch = await ctx.supabase.rpc<Record<string, any>>("royaltyos_reserve_payout_retry", { p_settlement_id: match.id, p_actor_id: auth.user.id, p_idempotency_key: idempotencyKey });
    const items = await ctx.supabase.select<Record<string, any>>("payout_items", { select: "*", payout_batch_id: `eq.${batch.id}` });
    const retryRequestId = sha256Hex(buildPayoutIdempotencyKey({ workspaceId: auth.workspaceId, settlementId: match.id!, version: Number(batch.payout_version) || nextVersion })).slice(0, 36);
    const paypal = await ctx.paypal.createPayout(retryRequestId, String(batch.id), items.map((item) => ({ recipientEmail: String(item.recipient_email), amountMinor: Number(item.amount_minor), currency: String(item.currency), note: `Retry: ${ctx.config.paypal.payoutNote}`, senderItemId: String(item.sender_item_id) })));
    const paypalBatchId = paypal?.batch_header?.payout_batch_id;
    if (typeof paypalBatchId !== "string") throw new Error("PayPal payout did not return batch id");
    await ctx.supabase.rpc("royaltyos_mark_payout_submitted", { p_batch_id: batch.id, p_paypal_batch_id: paypalBatchId });
    json(res, 200, { ...batch, status: "SUBMITTED", paypal_batch_id: paypalBatchId });
    return true;
  }

  if (method === "GET" && path === "/api/v1/payouts") {
    const p = await principal(ctx, req);
    const workspaceId = requireString(url.searchParams.get("workspaceId"), "workspaceId", 100);
    await ctx.repo.requireRole(p.id, workspaceId, ALL_READ_ROLES);
    const batches = await ctx.supabase.select<Record<string, any>>("payout_batches", { select: "*", workspace_id: `eq.${workspaceId}`, order: "created_at.desc" });
    const out: any[] = [];
    for (const batch of batches) out.push({ ...batch, items: await ctx.supabase.select("payout_items", { select: "*", payout_batch_id: `eq.${batch.id}`, order: "sender_item_id.asc" }) });
    json(res, 200, out);
    return true;
  }

  if (method === "GET" && path === "/api/v1/reports/royalties") {
    const p = await principal(ctx, req);
    const workspaceId = requireString(url.searchParams.get("workspaceId"), "workspaceId", 100);
    const membership = await ctx.repo.requireRole(p.id, workspaceId, ALL_READ_ROLES);
    const requested = url.searchParams.get("beneficiaryKey");
    const beneficiaryKey = membership.role === "CONTRIBUTOR" ? membership.beneficiary_key : requested;
    let lines = await ctx.supabase.select<Record<string, any>>("settlement_lines", { select: "*", workspace_id: `eq.${workspaceId}`, order: "created_at.desc" });
    if (beneficiaryKey) lines = lines.filter((line) => line.beneficiary_key === beneficiaryKey);
    lines = lines.filter((line) => !["reserve", "excluded"].includes(String(line.beneficiary_key)));
    const rows: any[] = [];
    for (const line of lines) {
      const settlement = (await ctx.supabase.select<Record<string, any>>("settlements", { select: "*", id: `eq.${line.settlement_id}`, limit: "1" }))[0];
      const revenue = settlement ? (await ctx.supabase.select<Record<string, any>>("revenue_events", { select: "*", id: `eq.${settlement.revenue_event_id}`, limit: "1" }))[0] : null;
      const rule = line.rule_id ? (await ctx.supabase.select<Record<string, any>>("rules", { select: "*", id: `eq.${line.rule_id}`, limit: "1" }))[0] : null;
      const evidence = line.rule_id ? (await ctx.supabase.select<Record<string, any>>("rule_evidence", { select: "*", rule_id: `eq.${line.rule_id}`, limit: "1" }))[0] : null;
      const payoutItem = (await ctx.supabase.select<Record<string, any>>("payout_items", { select: "*", settlement_line_id: `eq.${line.id}`, order: "updated_at.desc", limit: "1" }))[0] ?? null;
      rows.push({ line, settlement, revenue, rule, evidence, payoutItem });
    }
    json(res, 200, { scope: beneficiaryKey ?? "ALL", rows, totalPayableMinor: rows.reduce((s, r) => s + Number(r.line.payable_minor ?? 0), 0) });
    return true;
  }

  if (method === "GET" && path === "/api/v1/audit") {
    const p = await principal(ctx, req);
    const workspaceId = requireString(url.searchParams.get("workspaceId"), "workspaceId", 100);
    await ctx.repo.requireRole(p.id, workspaceId, ALL_READ_ROLES);
    const [integrity, ledger, events] = await Promise.all([
      ctx.supabase.rpc("royaltyos_verify_audit_chain", { p_workspace_id: workspaceId }),
      ctx.supabase.rpc("royaltyos_ledger_integrity", { p_workspace_id: workspaceId }),
      ctx.supabase.select("audit_events", { select: "*", workspace_id: `eq.${workspaceId}`, order: "created_at.desc", limit: "100" }),
    ]);
    json(res, 200, { integrity, ledger, events });
    return true;
  }

  if (method === "GET" && path === "/api/v1/notifications") {
    const p = await principal(ctx, req);
    const workspaceId = requireString(url.searchParams.get("workspaceId"), "workspaceId", 100);
    const membership = await ctx.repo.requireRole(p.id, workspaceId, ALL_READ_ROLES);
    const rows = await ctx.supabase.select<Record<string, any>>("notifications", {
      select: "id,user_id,recipient_email,channel,event_type,subject,payload,status,attempts,provider_message_id,last_error,created_at,sent_at",
      workspace_id: `eq.${workspaceId}`, order: "created_at.desc", limit: "100",
    });
    const canViewAll = ["OWNER", "FINANCE_APPROVER", "AUDITOR"].includes(String(membership.role));
    json(res, 200, canViewAll ? rows : rows.filter((row) => String(row.user_id ?? "") === p.id));
    return true;
  }

  if (method === "GET" && path === "/api/v1/insights") {
    const p = await principal(ctx, req);
    const workspaceId = requireString(url.searchParams.get("workspaceId"), "workspaceId", 100);
    await ctx.repo.requireRole(p.id, workspaceId, ALL_READ_ROLES);
    const [revenues, settlements, invoices, rulesets, payouts, recoupments, ledgerTx, webhookEvents, audit, reconciliationIssues, financialIntegrity] = await Promise.all([
      ctx.supabase.select<Record<string, any>>("revenue_events", { select: "*", workspace_id: `eq.${workspaceId}` }),
      ctx.supabase.select<Record<string, any>>("settlements", { select: "*", workspace_id: `eq.${workspaceId}` }),
      ctx.supabase.select<Record<string, any>>("invoices", { select: "*", workspace_id: `eq.${workspaceId}` }),
      ctx.supabase.select<Record<string, any>>("rulesets", { select: "*", workspace_id: `eq.${workspaceId}` }),
      ctx.supabase.select<Record<string, any>>("payout_batches", { select: "*", workspace_id: `eq.${workspaceId}` }),
      ctx.supabase.select<Record<string, any>>("recoupment_accounts", { select: "*", workspace_id: `eq.${workspaceId}` }),
      ctx.supabase.select<Record<string, any>>("ledger_transactions", { select: "*", workspace_id: `eq.${workspaceId}` }),
      ctx.supabase.select<Record<string, any>>("webhook_events", { select: "*", workspace_id: `eq.${workspaceId}`, verification_status: "eq.SUCCESS" }),
      ctx.supabase.rpc<any>("royaltyos_verify_audit_chain", { p_workspace_id: workspaceId }),
      ctx.supabase.select<Record<string, any>>("reconciliation_issues", { select: "*", workspace_id: `eq.${workspaceId}`, status: "eq.OPEN", order: "created_at.desc", limit: "25" }),
      ctx.supabase.rpc<any>("royaltyos_financial_integrity", { p_workspace_id: workspaceId }),
    ]);
    const latestSettlement = [...settlements].sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))[0];
    const latestLines = latestSettlement ? await ctx.supabase.select<Record<string, any>>("settlement_lines", { select: "*", settlement_id: `eq.${latestSettlement.id}`, order: "amount_minor.desc" }) : [];
    const successfulPayoutItems: Record<string, any>[] = [];
    for (const batch of payouts.filter((b) => b.status === "SUCCESS")) successfulPayoutItems.push(...await ctx.supabase.select<Record<string, any>>("payout_items", { select: "*", payout_batch_id: `eq.${batch.id}`, status: "eq.SUCCESS" }));
    json(res, 200, {
      metrics: {
        revenueMinor: revenues.reduce((s, r) => s + Number(r.distributable_minor), 0),
        settlementCount: settlements.length,
        pendingSettlementCount: settlements.filter((s) => !["SUCCESS"].includes(String(s.status))).length,
        payoutSuccessMinor: successfulPayoutItems.reduce((s, i) => s + Number(i.amount_minor), 0),
        invoiceCount: invoices.length,
        activeRulesetCount: rulesets.filter((r) => r.status === "ACTIVE").length,
        verifiedWebhookCount: webhookEvents.length,
        ledgerTransactionCount: ledgerTx.length,
        openReconciliationIssueCount: reconciliationIssues.length,
      },
      auditIntegrity: audit,
      financialIntegrity,
      reconciliationIssues,
      latestSettlement: latestSettlement ? { ...latestSettlement, lines: latestLines } : null,
      invoicesByStatus: Object.entries(invoices.reduce((acc: Record<string, number>, row) => { acc[String(row.status)] = (acc[String(row.status)] ?? 0) + 1; return acc; }, {})),
      recoupments,
    });
    return true;
  }

  if (method === "GET" && path === "/api/v1/settlements/export.csv") {
    const p = await principal(ctx, req);
    const settlementId = requireString(url.searchParams.get("settlementId"), "settlementId", 100);
    const settlement = (await ctx.supabase.select<Record<string, any>>("settlements", { select: "*", id: `eq.${settlementId}`, limit: "1" }))[0];
    if (!settlement) throw statusError(404, "Settlement not found");
    await ctx.repo.requireRole(p.id, String(settlement.workspace_id), ["OWNER", "FINANCE_APPROVER", "AUDITOR"]);
    const lines = await ctx.supabase.select<Record<string, any>>("settlement_lines", { select: "*", settlement_id: `eq.${settlementId}`, order: "amount_minor.desc" });
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csvHeaders = ["settlement_id", "status", "beneficiary_key", "beneficiary_name", "amount_minor", "payable_minor", "currency", "payout_email", "rule_id", "line_kind", "settlement_hash", "algorithm_version"];
    const csv = [csvHeaders, ...lines.map((line) => [settlement.id, settlement.status, line.beneficiary_key, line.beneficiary_name, line.amount_minor, line.payable_minor, settlement.currency, line.payout_email, line.rule_id, line.line_kind, settlement.settlement_hash, settlement.algorithm_version])].map((row) => row.map(escape).join(",")).join("\n");
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="royaltyos-${settlementId}.csv"` });
    res.end(csv);
    return true;
  }

  return false;
}