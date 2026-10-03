import { createAppContext } from "../api/context.ts";
import { calculateAndCommitSettlement, parsePayPalInvoiceAmount } from "../api/services.ts";
import { NotificationGateway } from "../../packages/notifications/resend.ts";

const ctx = createAppContext();
const notifications = new NotificationGateway(ctx.config, ctx.fetchImpl);
let stopped = false;
process.on("SIGTERM", () => { stopped = true; });
process.on("SIGINT", () => { stopped = true; });

function payoutStatus(eventType: string) {
  if (eventType.endsWith(".SUCCEEDED")) return "SUCCESS";
  if (eventType.endsWith(".FAILED") || eventType.endsWith(".CANCELED")) return "FAILED";
  if (eventType.endsWith(".UNCLAIMED")) return "UNCLAIMED";
  if (eventType.endsWith(".RETURNED")) return "RETURNED";
  if (eventType.endsWith(".REFUNDED")) return "REFUNDED";
  if (eventType.endsWith(".BLOCKED")) return "BLOCKED";
  if (eventType.endsWith(".HELD")) return "ONHOLD";
  return "PENDING";
}

async function sendNotification(input: {
  workspaceId: string;
  userId?: string | null;
  recipientEmail: string;
  eventType: string;
  subject: string;
  text: string;
  resourceId: string;
}) {
  const dedupeKey = `${input.eventType}:${input.resourceId}:${input.userId ?? input.recipientEmail.toLowerCase()}`;
  const existing = await ctx.supabase.select<Record<string, any>>("notifications", {
    select: "id,status",
    dedupe_key: `eq.${dedupeKey}`,
    limit: "1",
  });
  if (existing[0]?.status === "SENT" || existing[0]?.status === "SKIPPED") return;
  let notificationId = existing[0]?.id as string | undefined;
  if (!notificationId) {
    const rows = await ctx.supabase.insert<Record<string, any>>("notifications", {
      workspace_id: input.workspaceId,
      user_id: input.userId ?? null,
      recipient_email: input.recipientEmail,
      channel: "EMAIL",
      event_type: input.eventType,
      subject: input.subject,
      payload: { resourceId: input.resourceId, text: input.text },
      status: "PENDING",
      dedupe_key: dedupeKey,
    });
    notificationId = String(rows[0]?.id ?? "");
  }
  try {
    const delivered = await notifications.send({
      to: input.recipientEmail,
      subject: input.subject,
      text: input.text,
      idempotencyKey: dedupeKey,
    });
    if (notificationId) await ctx.supabase.update("notifications", {
      status: delivered.status,
      provider_message_id: delivered.providerMessageId,
      attempts: 1,
      sent_at: delivered.status === "SENT" ? new Date().toISOString() : null,
      last_error: null,
    }, { id: `eq.${notificationId}` }, false);
  } catch (error) {
    if (notificationId) await ctx.supabase.update("notifications", {
      status: "FAILED",
      attempts: 1,
      last_error: error instanceof Error ? error.message.slice(0, 1000) : "Unknown notification error",
    }, { id: `eq.${notificationId}` }, false);
    throw error;
  }
}

async function notifyWorkspaceRoles(workspaceId: string, roles: string[], eventType: string, subject: string, text: string, resourceId: string) {
  const members = await ctx.supabase.select<Record<string, any>>("workspace_memberships", {
    select: "user_id,role", workspace_id: `eq.${workspaceId}`,
  });
  for (const member of members.filter((row) => roles.includes(String(row.role)))) {
    const user = await ctx.supabase.adminGetUser(String(member.user_id));
    if (!user.email) continue;
    await sendNotification({ workspaceId, userId: String(member.user_id), recipientEmail: user.email, eventType, subject, text, resourceId });
  }
}

async function notifyPayoutBatch(batchId: string) {
  const batch = (await ctx.supabase.select<Record<string, any>>("payout_batches", { select: "*", id: `eq.${batchId}`, limit: "1" }))[0];
  if (!batch || !["SUCCESS","FAILED","PARTIAL_FAILURE","RECONCILIATION_REQUIRED"].includes(String(batch.status))) return;
  const settlement = (await ctx.supabase.select<Record<string, any>>("settlements", { select: "*", id: `eq.${batch.settlement_id}`, limit: "1" }))[0];
  if (!settlement) return;
  const items = await ctx.supabase.select<Record<string, any>>("payout_items", { select: "*", payout_batch_id: `eq.${batchId}` });
  for (const item of items) {
    await sendNotification({
      workspaceId: String(batch.workspace_id), recipientEmail: String(item.recipient_email), eventType: `PAYOUT_${item.status}`,
      subject: `RoyaltyOS payout ${String(item.status).toLowerCase()}`,
      text: `Your RoyaltyOS payout item for settlement ${settlement.id} is ${item.status}. Amount: ${item.amount_minor} minor units ${item.currency}. PayPal transaction: ${item.transaction_id ?? item.paypal_item_id ?? "pending"}.`,
      resourceId: String(item.id),
    });
  }
  await notifyWorkspaceRoles(String(batch.workspace_id), ["OWNER","FINANCE_APPROVER"], `PAYOUT_BATCH_${batch.status}`, `RoyaltyOS payout batch ${batch.status}`, `Payout batch ${batch.id} for settlement ${settlement.id} is ${batch.status}.`, String(batch.id));
}

async function recordReconciliationIssue(input: {
  workspaceId: string;
  projectId?: string | null;
  resourceType: string;
  resourceId: string;
  issueType: string;
  severity: "INFO" | "WARNING" | "HIGH" | "CRITICAL";
  expected?: Record<string, unknown>;
  observed?: Record<string, unknown>;
  correlationId?: string | null;
}) {
  const existing = await ctx.supabase.select<Record<string, any>>("reconciliation_issues", {
    select: "id,status",
    workspace_id: `eq.${input.workspaceId}`,
    resource_type: `eq.${input.resourceType}`,
    resource_id: `eq.${input.resourceId}`,
    issue_type: `eq.${input.issueType}`,
    status: "eq.OPEN",
    limit: "1",
  });
  if (existing.length) return existing[0];
  const rows = await ctx.supabase.insert<Record<string, any>>("reconciliation_issues", {
    workspace_id: input.workspaceId,
    project_id: input.projectId ?? null,
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    provider: "PAYPAL",
    issue_type: input.issueType,
    severity: input.severity,
    expected: input.expected ?? {},
    observed: input.observed ?? {},
    status: "OPEN",
    correlation_id: input.correlationId ?? null,
  });
  await notifyWorkspaceRoles(
    input.workspaceId,
    ["OWNER","FINANCE_APPROVER","AUDITOR"],
    `RECONCILIATION_${input.issueType}`,
    `RoyaltyOS reconciliation issue: ${input.issueType}`,
    `A ${input.severity.toLowerCase()} reconciliation issue was opened for ${input.resourceType} ${input.resourceId}.`,
    input.resourceId,
  );
  return rows[0];
}

async function reconcileInvoiceWebhook(row: Record<string, any>, event: any) {
  const paypalInvoiceId = String(event?.resource?.id ?? row.resource_id ?? "");
  if (!paypalInvoiceId) throw new Error("Invoice webhook has no resource id");
  const authoritative = await ctx.paypal.getInvoice(paypalInvoiceId);
  const local = (await ctx.supabase.select<Record<string, any>>("invoices", {
    select: "*", paypal_invoice_id: `eq.${paypalInvoiceId}`, limit: "1"
  }))[0];
  if (!local) throw new Error("No local invoice mapping for PayPal invoice");

  const amount = parsePayPalInvoiceAmount(authoritative);
  const amountMatches = Number(local.amount_minor) === amount.amountMinor && String(local.currency) === amount.currency;
  const authoritativeStatus = String(authoritative.status ?? event?.resource?.status ?? local.status);
  await ctx.supabase.update("invoices", {
    status: authoritativeStatus,
    recipient_view_url: authoritative?.detail?.metadata?.recipient_view_url ?? local.recipient_view_url ?? null,
    last_reconciled_at: new Date().toISOString(),
    reconciliation_status: amountMatches ? "MATCHED" : "MISMATCH",
    updated_at: new Date().toISOString(),
  }, { id: `eq.${local.id}` }, false);

  if (!amountMatches) {
    await recordReconciliationIssue({
      workspaceId: String(local.workspace_id),
      projectId: String(local.project_id),
      resourceType: "INVOICE",
      resourceId: String(local.id),
      issueType: "INVOICE_AMOUNT_OR_CURRENCY_MISMATCH",
      severity: "CRITICAL",
      expected: { amountMinor: Number(local.amount_minor), currency: String(local.currency) },
      observed: { amountMinor: amount.amountMinor, currency: amount.currency, status: authoritativeStatus },
      correlationId: row.correlation_id ?? null,
    });
    throw new Error("Invoice reconciliation mismatch");
  }

  if (authoritativeStatus === "PAID") {
    const revenueEventId = await ctx.supabase.rpc<string>("royaltyos_record_invoice_revenue", {
      p_invoice_id: local.id,
      p_paypal_invoice_id: paypalInvoiceId,
      p_amount_minor: amount.amountMinor,
      p_currency: amount.currency,
      p_received_at: new Date().toISOString(),
      p_revenue_category: null,
    });
    try { await calculateAndCommitSettlement(ctx, { revenueEventId, actorId: null }); }
    catch (error) { console.error("Automatic settlement after PayPal revenue failed", error); }
  }

  if (["REFUNDED","PARTIALLY_REFUNDED","CANCELLED","CANCELED"].includes(authoritativeStatus)) {
    const revenue = (await ctx.supabase.select<Record<string, any>>("revenue_events", {
      select: "id", workspace_id: `eq.${String(local.workspace_id)}`, source: "eq.PAYPAL_INVOICE", external_id: `eq.${paypalInvoiceId}`, limit: "1"
    }))[0];
    if (revenue) {
      await recordReconciliationIssue({
        workspaceId: String(local.workspace_id),
        projectId: String(local.project_id),
        resourceType: "INVOICE",
        resourceId: String(local.id),
        issueType: "POST_REVENUE_INVOICE_REVERSAL",
        severity: "HIGH",
        expected: { priorRevenueEventId: String(revenue.id), expectedStatus: "PAID" },
        observed: { status: authoritativeStatus, paypalInvoiceId },
        correlationId: row.correlation_id ?? null,
      });
    }
  }
}

async function processWebhook(paypalEventId: string) {
  const row = (await ctx.supabase.select<Record<string, any>>("webhook_events", { select: "*", paypal_event_id: `eq.${paypalEventId}`, limit: "1" }))[0];
  if (!row) throw new Error(`Webhook ${paypalEventId} not found`);
  const event = row.raw_payload as any;
  const type = String(row.event_type);

  if (type.startsWith("INVOICING.INVOICE.")) {
    await reconcileInvoiceWebhook(row, event);
    await ctx.supabase.update("webhook_events", { processing_status: "PROCESSED", processed_at: new Date().toISOString() }, { paypal_event_id: `eq.${paypalEventId}` }, false);
    return;
  }

  if (type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const resource = event?.resource ?? {};
    const senderItemId = resource?.payout_item?.sender_item_id ?? resource?.sender_item_id;
    if (!senderItemId) throw new Error("Payout item webhook missing sender_item_id");
    await ctx.supabase.rpc("royaltyos_mark_payout_item", {
      p_sender_item_id: String(senderItemId),
      p_paypal_item_id: resource?.payout_item_id ?? null,
      p_transaction_id: resource?.transaction_id ?? null,
      p_status: payoutStatus(type),
      p_event_type: type,
    });
    const localItem = (await ctx.supabase.select<Record<string, any>>("payout_items", { select: "payout_batch_id", sender_item_id: `eq.${String(senderItemId)}`, limit: "1" }))[0];
    if (localItem?.payout_batch_id) await notifyPayoutBatch(String(localItem.payout_batch_id));
    await ctx.supabase.update("webhook_events", { processing_status: "PROCESSED", processed_at: new Date().toISOString() }, { paypal_event_id: `eq.${paypalEventId}` }, false);
    return;
  }

  if (type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const paypalBatchId = event?.resource?.batch_header?.payout_batch_id ?? event?.resource?.payout_batch_id ?? row.resource_id;
    if (!paypalBatchId) throw new Error("Payout batch webhook missing batch id");
    const batch = await ctx.paypal.getPayoutBatch(String(paypalBatchId));
    for (const item of batch?.items ?? []) {
      const senderItemId = item?.payout_item?.sender_item_id;
      if (!senderItemId) continue;
      const statusMap: Record<string, string> = { SUCCESS: "SUCCESS", FAILED: "FAILED", UNCLAIMED: "UNCLAIMED", RETURNED: "RETURNED", REFUNDED: "REFUNDED", BLOCKED: "BLOCKED", ONHOLD: "ONHOLD", PENDING: "PENDING" };
      await ctx.supabase.rpc("royaltyos_mark_payout_item", {
        p_sender_item_id: senderItemId,
        p_paypal_item_id: item.payout_item_id ?? null,
        p_transaction_id: item.transaction_id ?? null,
        p_status: statusMap[String(item.transaction_status)] ?? "PENDING",
        p_event_type: type,
      });
    }
    const localBatch = (await ctx.supabase.select<Record<string, any>>("payout_batches", { select: "id", paypal_batch_id: `eq.${String(paypalBatchId)}`, limit: "1" }))[0];
    if (localBatch?.id) await notifyPayoutBatch(String(localBatch.id));
    await ctx.supabase.update("webhook_events", { processing_status: "PROCESSED", processed_at: new Date().toISOString() }, { paypal_event_id: `eq.${paypalEventId}` }, false);
    return;
  }

  await ctx.supabase.update("webhook_events", { processing_status: "IGNORED", processed_at: new Date().toISOString() }, { paypal_event_id: `eq.${paypalEventId}` }, false);
}

async function processEvent(event: Record<string, any>) {
  if (event.topic === "paypal.webhook") return await processWebhook(String(event.payload?.paypalEventId ?? event.aggregate_id));
  if (event.topic === "revenue.recorded") return await calculateAndCommitSettlement(ctx, { revenueEventId: String(event.payload?.revenueEventId ?? event.aggregate_id), actorId: null });
  if (event.topic === "settlement.calculated") {
    const settlement = (await ctx.supabase.select<Record<string, any>>("settlements", { select: "workspace_id,id", id: `eq.${String(event.aggregate_id)}`, limit: "1" }))[0];
    if (settlement) await notifyWorkspaceRoles(String(settlement.workspace_id), ["OWNER","FINANCE_APPROVER"], "SETTLEMENT_APPROVAL_REQUIRED", "RoyaltyOS settlement awaiting approval", `Settlement ${settlement.id} was calculated deterministically and is awaiting finance approval.`, String(settlement.id));
    return;
  }
  if (event.topic === "settlement.approved") {
    const settlement = (await ctx.supabase.select<Record<string, any>>("settlements", { select: "workspace_id,id", id: `eq.${String(event.aggregate_id)}`, limit: "1" }))[0];
    if (settlement) await notifyWorkspaceRoles(String(settlement.workspace_id), ["OWNER","FINANCE_APPROVER"], "SETTLEMENT_APPROVED", "RoyaltyOS settlement approved", `Settlement ${settlement.id} was approved and is ready for payout execution.`, String(settlement.id));
    return;
  }
  if (event.topic === "payout.reconcile") {
    const paypalBatchId = String(event.payload?.paypalBatchId ?? "");
    if (!paypalBatchId) throw new Error("payout.reconcile is missing paypalBatchId");
    const batch = await ctx.paypal.getPayoutBatch(paypalBatchId);
    for (const item of batch?.items ?? []) {
      const senderItemId = item?.payout_item?.sender_item_id;
      if (!senderItemId) continue;
      const statusMap: Record<string, string> = { SUCCESS: "SUCCESS", FAILED: "FAILED", UNCLAIMED: "UNCLAIMED", RETURNED: "RETURNED", REFUNDED: "REFUNDED", BLOCKED: "BLOCKED", ONHOLD: "ONHOLD", PENDING: "PENDING" };
      await ctx.supabase.rpc("royaltyos_mark_payout_item", { p_sender_item_id: senderItemId, p_paypal_item_id: item.payout_item_id ?? null, p_transaction_id: item.transaction_id ?? null, p_status: statusMap[String(item.transaction_status)] ?? "PENDING", p_event_type: "POLL_RECONCILIATION" });
    }
    const localBatch = (await ctx.supabase.select<Record<string, any>>("payout_batches", { select: "id,status", paypal_batch_id: `eq.${paypalBatchId}`, limit: "1" }))[0];
    if (localBatch?.id) await notifyPayoutBatch(String(localBatch.id));
    if (localBatch && ["READY","SUBMITTED","PENDING"].includes(String(localBatch.status))) throw new Error(`Payout batch ${paypalBatchId} is still pending`);
    return;
  }
  if (event.topic === "beneficiary.changed") {
    const beneficiary = (await ctx.supabase.select<Record<string, any>>("beneficiaries", { select: "*", id: `eq.${String(event.aggregate_id)}`, limit: "1" }))[0];
    if (beneficiary) await notifyWorkspaceRoles(String(beneficiary.workspace_id), ["OWNER","FINANCE_APPROVER"], "PAYOUT_RECIPIENT_CHANGED", "RoyaltyOS payout recipient changed", `Payout destination/profile changed for beneficiary ${beneficiary.beneficiary_key}. Existing approved settlement snapshots were not modified.`, String(beneficiary.id));
    return;
  }
  if (event.topic.startsWith("notification.")) return;
}

async function loop() {
  console.log(JSON.stringify({ level: "info", message: "RoyaltyOS worker started", version: ctx.config.appVersion }));
  while (!stopped) {
    try {
      const events = await ctx.supabase.rpc<Record<string, any>[]>("royaltyos_claim_outbox", { p_limit: ctx.config.worker.batchSize });
      if (!Array.isArray(events) || !events.length) {
        await new Promise((r) => setTimeout(r, ctx.config.worker.pollIntervalMs));
        continue;
      }
      for (const event of events) {
        try {
          await processEvent(event);
          await ctx.supabase.rpc("royaltyos_finish_outbox", { p_id: event.id, p_success: true, p_error: null, p_retry_seconds: 0 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown worker error";
          const retrySeconds = Math.min(3600, 2 ** Math.min(Number(event.attempts ?? 1), 10));
          await ctx.supabase.rpc("royaltyos_finish_outbox", { p_id: event.id, p_success: false, p_error: message.slice(0, 2000), p_retry_seconds: retrySeconds });
          console.error(JSON.stringify({ level: "error", eventId: event.id, topic: event.topic, message }));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: "Worker loop failure", error: error instanceof Error ? error.message : "unknown" }));
      await new Promise((r) => setTimeout(r, ctx.config.worker.pollIntervalMs));
    }
  }
  console.log(JSON.stringify({ level: "info", message: "RoyaltyOS worker stopped" }));
}

await loop();
