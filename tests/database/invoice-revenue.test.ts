import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { one } from "./_client.ts";
import { createWorkspace } from "./_fixtures.ts";

async function recordInvoiceRevenue(invoiceId: string, paypalId: string): Promise<string> {
  const row = await one<{ royaltyos_record_invoice_revenue: string }>(
    `select royaltyos_record_invoice_revenue($1::uuid,$2::text,$3::bigint,$4,$5::timestamptz,$6)`,
    [invoiceId, paypalId, 10_000, "USD", new Date().toISOString(), null],
  );
  return row!.royaltyos_record_invoice_revenue;
}

test("recording invoice revenue twice (manual refresh after a webhook) creates one event", async () => {
  const fixture = await createWorkspace("invoice-refresh");
  const paypalId = `INV2-${randomUUID().slice(0, 8).toUpperCase()}`;
  const invoice = await one<{ id: string }>(
    `insert into invoices(workspace_id, project_id, created_by, paypal_invoice_id, recipient_email, item_name, amount_minor, currency, status, request_id)
     values ($1,$2,$3,$4,'buyer@example.com','Revenue',10000,'USD','SENT',$5) returning id`,
    [fixture.workspaceId, fixture.projectId, fixture.userId, paypalId, `refresh-test-${randomUUID()}`],
  );
  const first = await recordInvoiceRevenue(invoice!.id, paypalId);
  const second = await recordInvoiceRevenue(invoice!.id, paypalId);
  assert.equal(second, first, "repeat recording returns the same revenue event");

  const events = await one<{ count: string }>(
    `select count(*) from revenue_events where workspace_id=$1 and source='PAYPAL_INVOICE' and external_id=$2`,
    [fixture.workspaceId, paypalId],
  );
  assert.equal(Number(events!.count), 1, "exactly one revenue event exists");
  const ledger = await one<{ count: string }>(
    `select count(*) from ledger_transactions where revenue_event_id=$1 and event_type='REVENUE_RECEIVED'`,
    [first],
  );
  assert.equal(Number(ledger!.count), 1, "exactly one ledger posting exists");
  const status = await one<{ status: string }>(`select status from invoices where id=$1`, [invoice!.id]);
  assert.equal(status!.status, "PAID");
});
