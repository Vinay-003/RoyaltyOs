import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { AppContext } from "../context.ts";
import { statusError } from "../http.ts";
import { sha256Hex } from "../../../packages/core/hash.ts";

export const ALL_READ_ROLES = ["OWNER", "CONTRACT_MANAGER", "FINANCE_APPROVER", "CONTRIBUTOR", "AUDITOR"];
export const CONTRACT_ROLES = ["OWNER", "CONTRACT_MANAGER", "FINANCE_APPROVER"];
export const FINANCE_ROLES = ["OWNER", "FINANCE_APPROVER"];

export function header(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function idempotencyHeader(req: IncomingMessage, fallback = randomUUID()) {
  const value = header(req, "idempotency-key");
  if (!value) return fallback;
  if (value.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(value)) throw statusError(400, "Invalid Idempotency-Key");
  return value;
}

export function clientIpHash(req: IncomingMessage) {
  const forwarded = header(req, "x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]!.trim() : (req.socket.remoteAddress ?? "unknown");
  return sha256Hex(ip).slice(0, 32);
}

export async function enforceRateLimit(
  ctx: AppContext,
  key: string,
  limit: number,
  windowSeconds: number,
) {
  const result = await ctx.supabase.rpc<Record<string, any>>("royaltyos_consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (result?.allowed === false) {
    const error = statusError(429, `Rate limit exceeded; retry after ${String(result.resetAt ?? "the current window")}`);
    (error as Error & { code?: string }).code = "RATE_LIMITED";
    throw error;
  }
  return result;
}

export function moneyString(minor: number) {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

export async function workspaceFromProject(ctx: AppContext, projectId: string) {
  const project = (await ctx.supabase.select<Record<string, any>>("projects", { select: "*", id: `eq.${projectId}`, limit: "1" }))[0];
  if (!project) throw statusError(404, "Project not found");
  return project;
}

export async function resolveWebhookWorkspace(ctx: AppContext, event: any): Promise<string | null> {
  const eventType = String(event?.event_type ?? "");
  if (eventType.startsWith("INVOICING.")) {
    const invoiceId = typeof event?.resource?.id === "string" ? event.resource.id : null;
    if (!invoiceId) return null;
    const invoice = (await ctx.supabase.select<Record<string, any>>("invoices", {
      select: "workspace_id",
      paypal_invoice_id: `eq.${invoiceId}`,
      limit: "1",
    }))[0];
    return invoice ? String(invoice.workspace_id) : null;
  }

  if (eventType.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const batchId = event?.resource?.batch_header?.payout_batch_id ?? event?.resource?.payout_batch_id ?? event?.resource?.id;
    if (typeof batchId !== "string" || !batchId) return null;
    const batch = (await ctx.supabase.select<Record<string, any>>("payout_batches", {
      select: "workspace_id",
      paypal_batch_id: `eq.${batchId}`,
      limit: "1",
    }))[0];
    return batch ? String(batch.workspace_id) : null;
  }

  if (eventType.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const senderItemId = event?.resource?.payout_item?.sender_item_id ?? event?.resource?.sender_item_id;
    const paypalItemId = event?.resource?.payout_item_id;
    let item: Record<string, any> | undefined;
    if (typeof senderItemId === "string" && senderItemId) {
      item = (await ctx.supabase.select<Record<string, any>>("payout_items", {
        select: "payout_batch_id",
        sender_item_id: `eq.${senderItemId}`,
        limit: "1",
      }))[0];
    }
    if (!item && typeof paypalItemId === "string" && paypalItemId) {
      item = (await ctx.supabase.select<Record<string, any>>("payout_items", {
        select: "payout_batch_id",
        paypal_item_id: `eq.${paypalItemId}`,
        limit: "1",
      }))[0];
    }
    if (!item) return null;
    const batch = (await ctx.supabase.select<Record<string, any>>("payout_batches", {
      select: "workspace_id",
      id: `eq.${item.payout_batch_id}`,
      limit: "1",
    }))[0];
    return batch ? String(batch.workspace_id) : null;
  }

  return null;
}

export async function listSettlementViews(ctx: AppContext, workspaceId: string) {
  const settlements = await ctx.supabase.select<Record<string, any>>("settlements", {
    select: "*",
    workspace_id: `eq.${workspaceId}`,
    order: "created_at.desc",
  });
  const result: any[] = [];
  for (const settlement of settlements) {
    const lines = await ctx.supabase.select<Record<string, any>>("settlement_lines", {
      select: "*",
      settlement_id: `eq.${settlement.id}`,
      order: "amount_minor.desc",
    });
    result.push({ ...settlement, lines });
  }
  return result;
}
