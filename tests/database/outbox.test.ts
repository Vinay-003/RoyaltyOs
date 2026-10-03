import test from "node:test";
import assert from "node:assert/strict";
import { expectError, one, q } from "./_client.ts";
import { createWorkspace, sha256 } from "./_fixtures.ts";

async function insertOutbox(workspaceId: string, dedupeKey: string | null = null) {
  const row = await one<{ id: string }>(
    `insert into outbox_events(workspace_id, topic, aggregate_type, aggregate_id, payload, dedupe_key)
     values ($1,'test.event','TEST','aggregate-1','{}'::jsonb,$2) returning id`,
    [workspaceId, dedupeKey],
  );
  return row!.id;
}

test("outbox claim is exclusive and retried with backoff until it succeeds", async () => {
  const fixture = await createWorkspace("outbox");
  const id = await insertOutbox(fixture.workspaceId);

  const firstClaim = await q<{ id: string; status: string; attempts: number }>(
    `select id, status, attempts from royaltyos_claim_outbox(10) where id=$1`,
    [id],
  );
  assert.equal(firstClaim.length, 1, "worker claims the event");
  assert.equal(firstClaim[0]!.status, "PROCESSING");
  assert.equal(firstClaim[0]!.attempts, 1);

  const secondClaim = await q<{ id: string }>(`select id from royaltyos_claim_outbox(10) where id=$1`, [id]);
  assert.equal(secondClaim.length, 0, "an in-flight event is not handed to a second worker");

  await q(`select royaltyos_finish_outbox($1::uuid,false,'provider unavailable',30)`, [id]);
  const retried = await one<{ status: string; attempts: number; available_at: string; last_error: string }>(
    `select status, attempts, available_at::text, last_error from outbox_events where id=$1`,
    [id],
  );
  assert.equal(retried!.status, "PENDING", "a failed attempt returns to the queue");
  assert.equal(retried!.last_error, "provider unavailable");
  assert.ok(Date.parse(retried!.available_at) > Date.now() - 5_000, "retry is scheduled in the future");

  const notYetAvailable = await q<{ id: string }>(`select id from royaltyos_claim_outbox(10) where id=$1`, [id]);
  assert.equal(notYetAvailable.length, 0, "backoff prevents an immediate re-claim");

  await q(`update outbox_events set available_at=now() - interval '1 minute' where id=$1`, [id]);
  const reclaimed = await q<{ id: string; attempts: number }>(
    `select id, attempts from royaltyos_claim_outbox(10) where id=$1`,
    [id],
  );
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0]!.attempts, 2, "attempt counter increments");

  await q(`select royaltyos_finish_outbox($1::uuid,true,null,0)`, [id]);
  const done = await one<{ status: string }>(`select status from outbox_events where id=$1`, [id]);
  assert.equal(done!.status, "DONE");

  const claimedAgain = await q<{ id: string }>(`select id from royaltyos_claim_outbox(10) where id=$1`, [id]);
  assert.equal(claimedAgain.length, 0, "a completed event is never re-delivered");
});

test("an event that never succeeds is parked after the attempt limit", async () => {
  const fixture = await createWorkspace("outbox-exhausted");
  const id = await insertOutbox(fixture.workspaceId);
  await q(`update outbox_events set attempts=7, available_at=now() - interval '1 minute' where id=$1`, [id]);
  await q(`select royaltyos_claim_outbox(10)`);
  await q(`select royaltyos_finish_outbox($1::uuid,false,'still failing',0)`, [id]);
  const parked = await one<{ status: string; attempts: number }>(
    `select status, attempts from outbox_events where id=$1`,
    [id],
  );
  assert.equal(parked!.status, "FAILED", "attempts>=8 parks the event instead of looping forever");
  assert.ok(parked!.attempts >= 8);
});

test("dedupe keys make enqueue idempotent", async () => {
  const fixture = await createWorkspace("outbox-dedupe");
  await insertOutbox(fixture.workspaceId, "dedupe-key-1");
  await expectError(`insert into outbox_events(workspace_id, topic, aggregate_type, aggregate_id, payload, dedupe_key)
                     values ($1,'test.event','TEST','aggregate-1','{}'::jsonb,'dedupe-key-1')`, [
    fixture.workspaceId,
  ]);
  const rows = await one<{ count: string }>(`select count(*) from outbox_events where dedupe_key='dedupe-key-1'`);
  assert.equal(Number(rows!.count), 1);
});

test("verified PayPal webhooks are stored once and duplicate deliveries are reported", async () => {
  const fixture = await createWorkspace("webhook");
  const payload = { id: "WH-EVENT-1", event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV-1" } };
  const args = [
    fixture.workspaceId,
    "WH-EVENT-1",
    "INVOICING.INVOICE.PAID",
    "INV-1",
    "TXN-1",
    JSON.stringify(payload),
    sha256(JSON.stringify(payload)),
    "corr-1",
  ];

  const first = await one<{ royaltyos_store_verified_paypal_webhook: { duplicate: boolean; queued: boolean } }>(
    `select royaltyos_store_verified_paypal_webhook($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::jsonb,$7::text,$8::text) as royaltyos_store_verified_paypal_webhook`,
    args,
  );
  assert.equal(first!.royaltyos_store_verified_paypal_webhook.duplicate, false);

  const second = await one<{ royaltyos_store_verified_paypal_webhook: { duplicate: boolean; queued: boolean } }>(
    `select royaltyos_store_verified_paypal_webhook($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::jsonb,$7::text,$8::text) as royaltyos_store_verified_paypal_webhook`,
    args,
  );
  assert.equal(second!.royaltyos_store_verified_paypal_webhook.duplicate, true, "second delivery is marked duplicate");
  assert.equal(second!.royaltyos_store_verified_paypal_webhook.queued, false, "a duplicate is not queued again");

  const rows = await one<{ count: string }>(`select count(*) from webhook_events where paypal_event_id='WH-EVENT-1'`);
  assert.equal(Number(rows!.count), 1, "the provider event id is unique per stored event");
  const queued = await one<{ count: string }>(
    `select count(*) from outbox_events where topic='paypal.webhook' and aggregate_id='WH-EVENT-1'`,
  );
  assert.equal(Number(queued!.count), 1, "exactly one outbox intent exists for the event");
});
