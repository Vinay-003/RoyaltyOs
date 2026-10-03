import test from "node:test";
import assert from "node:assert/strict";
import { expectError, one, q } from "./_client.ts";
import { canonicalLines, preparedSettlement, type Fixture } from "./_fixtures.ts";
import { buildPayoutIdempotencyKey } from "../../packages/paypal/idempotency.ts";

interface BatchRow {
  id: string;
  payout_version: number;
  status: string;
  idempotency_key: string;
}

async function reserve(fixture: Fixture, settlementId: string, key: string): Promise<BatchRow> {
  const row = await one<{ royaltyos_reserve_payout: BatchRow }>(
    `select royaltyos_reserve_payout($1::uuid,$2::uuid,$3::text) as royaltyos_reserve_payout`,
    [settlementId, fixture.userId, key],
  );
  return row!.royaltyos_reserve_payout;
}

async function reserveRetry(fixture: Fixture, settlementId: string, key: string): Promise<BatchRow> {
  const row = await one<{ royaltyos_reserve_payout_retry: BatchRow }>(
    `select royaltyos_reserve_payout_retry($1::uuid,$2::uuid,$3::text) as royaltyos_reserve_payout_retry`,
    [settlementId, fixture.userId, key],
  );
  return row!.royaltyos_reserve_payout_retry;
}

async function batchCount(settlementId: string): Promise<number> {
  const row = await one<{ count: string }>(`select count(*) from payout_batches where settlement_id=$1`, [settlementId]);
  return Number(row!.count);
}

async function itemsOf(batchId: string) {
  return q<{
    settlement_line_id: string;
    recipient_email: string;
    amount_minor: string;
    status: string;
    sender_item_id: string;
  }>(
    `select settlement_line_id, recipient_email, amount_minor, status, sender_item_id
     from payout_items where payout_batch_id=$1 order by sender_item_id`,
    [batchId],
  );
}

async function lineOwners(settlementId: string): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  for (const line of canonicalLines()) {
    const row = await one<{ id: string }>(`select id from settlement_lines where settlement_id=$1 and line_key=$2`, [
      settlementId,
      line.key,
    ]);
    owners.set(row!.id, line.beneficiaryKey);
  }
  return owners;
}

let paypalEventSequence = 0;

function markItem(senderItemId: string, owner: string, status: string) {
  paypalEventSequence += 1;
  const suffix = `${owner}-${paypalEventSequence}`;
  return q(`select royaltyos_mark_payout_item($1::text,$2::text,$3::text,$4::text,$5::text)`, [
    senderItemId,
    `PP-${suffix}`,
    `TX-${suffix}`,
    status,
    "PAYMENT.PAYOUTS-ITEM.EVENT",
  ]);
}

async function settlementStatus(settlementId: string): Promise<string> {
  const row = await one<{ status: string }>(`select status from settlements where id=$1`, [settlementId]);
  return row!.status;
}

test("execute reservation is idempotent and cannot be duplicated by a fresh key or by concurrency", async () => {
  const { fixture, settlementId } = await preparedSettlement();
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [settlementId, fixture.userId]);

  const canonical = buildPayoutIdempotencyKey({ workspaceId: fixture.workspaceId, settlementId, version: 1 });

  const first = await reserve(fixture, settlementId, canonical);
  assert.equal(first.payout_version, 1);
  assert.equal(first.status, "READY");
  assert.equal(first.idempotency_key, canonical);

  const repeat = await reserve(fixture, settlementId, canonical);
  assert.equal(repeat.id, first.id, "same key returns the same reservation");

  // A fresh key (including the historical divergent shape) never mints another batch.
  const freshKey = await reserve(fixture, settlementId, `payout:${settlementId}:v1`);
  assert.equal(freshKey.id, first.id, "divergent key format reuses the existing batch");
  assert.equal(await batchCount(settlementId), 1);

  const concurrent = await Promise.all([
    reserve(fixture, settlementId, canonical),
    reserve(fixture, settlementId, canonical),
    reserve(fixture, settlementId, canonical),
  ]);
  assert.equal(new Set(concurrent.map((batch) => batch.id)).size, 1, "concurrent callers share one reservation");
  assert.equal(await batchCount(settlementId), 1, "concurrent execute cannot create parallel batches");

  const items = await itemsOf(first.id);
  assert.equal(items.length, 4, "only payable lines are reserved");
  const payableTotal = canonicalLines()
    .filter((line) => line.payableMinor > 0)
    .reduce((sum, line) => sum + line.payableMinor, 0);
  assert.equal(
    items.reduce((sum, item) => sum + Number(item.amount_minor), 0),
    payableTotal,
  );
});

test("a non-canonical key is rejected when it would create the first batch", async () => {
  const prepared = await preparedSettlement();
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [prepared.settlementId, prepared.fixture.userId]);

  const message = await expectError(`select royaltyos_reserve_payout($1::uuid,$2::uuid,$3::text)`, [
    prepared.settlementId,
    prepared.fixture.userId,
    `payout:${prepared.settlementId}:v1`,
  ]);
  assert.match(message, /canonical format/);
  assert.equal(await batchCount(prepared.settlementId), 0);
});

test("execute cannot resume after definitive failure; retry reserves only failed items", async () => {
  const { fixture, settlementId } = await preparedSettlement();
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [settlementId, fixture.userId]);

  const canonicalV1 = buildPayoutIdempotencyKey({ workspaceId: fixture.workspaceId, settlementId, version: 1 });
  const batch = await reserve(fixture, settlementId, canonicalV1);
  const items = await itemsOf(batch.id);
  assert.equal(items.length, 4);

  await q(`select royaltyos_mark_payout_submitted($1::uuid,$2::text)`, [batch.id, "PAYPAL-BATCH-DB-TEST"]);
  const owners = await lineOwners(settlementId);
  for (const item of items) {
    const owner = owners.get(item.settlement_line_id)!;
    await markItem(item.sender_item_id, owner, owner === "artist" || owner === "producer" ? "SUCCESS" : "FAILED");
  }
  assert.equal(await settlementStatus(settlementId), "PARTIAL_FAILURE");

  // Execute path can never produce another full-value batch once failures are known.
  const executeError = await expectError(`select royaltyos_reserve_payout($1::uuid,$2::uuid,$3::text)`, [
    settlementId,
    fixture.userId,
    canonicalV1,
  ]);
  assert.match(executeError, /requires retry reservation/);
  const freshExecuteError = await expectError(`select royaltyos_reserve_payout($1::uuid,$2::uuid,$3::text)`, [
    settlementId,
    fixture.userId,
    `payout:${fixture.workspaceId}:${settlementId}:v9`,
  ]);
  assert.match(freshExecuteError, /requires retry reservation/);
  assert.equal(await batchCount(settlementId), 1, "no second full-value batch was reserved");

  const canonicalV2 = buildPayoutIdempotencyKey({ workspaceId: fixture.workspaceId, settlementId, version: 2 });
  const retry = await reserveRetry(fixture, settlementId, canonicalV2);
  assert.equal(retry.payout_version, 2);
  const retryItems = await itemsOf(retry.id);
  const retriedOwners = retryItems.map((item) => owners.get(item.settlement_line_id)).sort();
  assert.deepEqual(retriedOwners, ["featured_creator", "manager"], "only definitively failed items are retried");
  const retryTotal = retryItems.reduce((sum, item) => sum + Number(item.amount_minor), 0);
  assert.equal(retryTotal, 94_000 + 47_000);
  assert.ok(retryTotal < 846_000, "retry total stays below the unpaid approved obligations");
  assert.equal(await batchCount(settlementId), 2);

  const retryAgain = await reserveRetry(
    fixture,
    settlementId,
    buildPayoutIdempotencyKey({ workspaceId: fixture.workspaceId, settlementId, version: 3 }),
  );
  assert.equal(retryAgain.id, retry.id, "duplicate retry returns the same reservation");
  const retryForeignKey = await reserveRetry(fixture, settlementId, `another-key-${Date.now()}`);
  assert.equal(retryForeignKey.id, retry.id, "fresh key cannot start a parallel retry");
  assert.equal(await batchCount(settlementId), 2);
});

test("retry only advances after definitive failure and never re-sends SUCCESS items", async () => {
  const { fixture, settlementId } = await preparedSettlement();
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [settlementId, fixture.userId]);

  const canonicalV1 = buildPayoutIdempotencyKey({ workspaceId: fixture.workspaceId, settlementId, version: 1 });
  const batchV1 = await reserve(fixture, settlementId, canonicalV1);
  await q(`select royaltyos_mark_payout_submitted($1::uuid,$2::text)`, [batchV1.id, "PAYPAL-BATCH-DB-V1"]);

  const owners = await lineOwners(settlementId);
  const v1Items = await itemsOf(batchV1.id);
  for (const item of v1Items) {
    const owner = owners.get(item.settlement_line_id)!;
    const status = ["artist", "producer"].includes(owner) ? "SUCCESS" : owner === "manager" ? "FAILED" : "ONHOLD";
    await markItem(item.sender_item_id, owner, status);
  }

  // While an item is still ONHOLD the settlement is PROCESSING: automatic retry is refused.
  assert.equal(await settlementStatus(settlementId), "PROCESSING");
  const earlyRetry = await expectError(`select royaltyos_reserve_payout_retry($1::uuid,$2::uuid,$3::text)`, [
    settlementId,
    fixture.userId,
    buildPayoutIdempotencyKey({ workspaceId: fixture.workspaceId, settlementId, version: 2 }),
  ]);
  assert.match(earlyRetry, /not eligible for retry/);
  assert.equal(await batchCount(settlementId), 1, "unresolved items never trigger a second batch");

  // Execute still resolves to the same in-flight batch.
  const inFlight = await reserve(fixture, settlementId, canonicalV1);
  assert.equal(inFlight.id, batchV1.id);
  assert.equal(await batchCount(settlementId), 1);

  // The held item now definitively fails -> retry becomes eligible.
  const featuredItem = v1Items.find((item) => owners.get(item.settlement_line_id) === "featured_creator")!;
  await markItem(featuredItem.sender_item_id, "featured_creator", "FAILED");
  assert.equal(await settlementStatus(settlementId), "PARTIAL_FAILURE");

  const canonicalV2 = buildPayoutIdempotencyKey({ workspaceId: fixture.workspaceId, settlementId, version: 2 });
  const batchV2 = await reserveRetry(fixture, settlementId, canonicalV2);
  assert.equal(batchV2.payout_version, 2);
  const v2Items = await itemsOf(batchV2.id);
  assert.deepEqual(
    v2Items.map((item) => owners.get(item.settlement_line_id)).sort(),
    ["featured_creator", "manager"],
    "v2 retries exactly the definitively failed items",
  );
  assert.equal(await batchCount(settlementId), 2);

  // Duplicate retries reuse v2 instead of creating v3.
  const retryAgain = await reserveRetry(
    fixture,
    settlementId,
    buildPayoutIdempotencyKey({ workspaceId: fixture.workspaceId, settlementId, version: 3 }),
  );
  assert.equal(retryAgain.id, batchV2.id, "duplicate retry returns the same reservation");
  const retryForeignKey = await reserveRetry(fixture, settlementId, `another-key-${Date.now()}`);
  assert.equal(retryForeignKey.id, batchV2.id, "fresh key cannot start a parallel retry");
  assert.equal(await batchCount(settlementId), 2);

  // v2 partially succeeds: manager is paid, featured fails again.
  await q(`select royaltyos_mark_payout_submitted($1::uuid,$2::text)`, [batchV2.id, "PAYPAL-BATCH-DB-V2"]);
  const managerItem = v2Items.find((item) => owners.get(item.settlement_line_id) === "manager")!;
  const featuredV2 = v2Items.find((item) => owners.get(item.settlement_line_id) === "featured_creator")!;
  await markItem(managerItem.sender_item_id, "manager", "SUCCESS");
  await markItem(featuredV2.sender_item_id, "featured_creator", "FAILED");

  // The historical key shape is rejected outright: divergent derivation cannot recur.
  const legacyKey = await expectError(`select royaltyos_reserve_payout_retry($1::uuid,$2::uuid,$3::text)`, [
    settlementId,
    fixture.userId,
    `payout:${settlementId}:v3`,
  ]);
  assert.match(legacyKey, /canonical format/);
  assert.equal(await batchCount(settlementId), 2);

  // v3 exists only now and contains only the still-failed item.
  const canonicalV3 = buildPayoutIdempotencyKey({ workspaceId: fixture.workspaceId, settlementId, version: 3 });
  const batchV3 = await reserveRetry(fixture, settlementId, canonicalV3);
  assert.equal(batchV3.payout_version, 3);
  const v3Items = await itemsOf(batchV3.id);
  assert.deepEqual(
    v3Items.map((item) => owners.get(item.settlement_line_id)),
    ["featured_creator"],
    "a recipient that reached SUCCESS is permanently excluded from later retries",
  );
  assert.equal(await batchCount(settlementId), 3);

  // Everything is paid: the settlement closes and no further reservation is possible.
  await q(`select royaltyos_mark_payout_submitted($1::uuid,$2::text)`, [batchV3.id, "PAYPAL-BATCH-DB-V3"]);
  await markItem(v3Items[0]!.sender_item_id, "featured_creator", "SUCCESS");
  assert.equal(await settlementStatus(settlementId), "SUCCESS");
  const closed = await expectError(`select royaltyos_reserve_payout($1::uuid,$2::uuid,$3::text)`, [
    settlementId,
    fixture.userId,
    canonicalV1,
  ]);
  assert.match(closed, /not eligible for payout/);
  assert.equal(await batchCount(settlementId), 3);
});

test("a payout key from another settlement cannot be replayed against this one", async () => {
  const a = await preparedSettlement();
  const b = await preparedSettlement();
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [a.settlementId, a.fixture.userId]);
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [b.settlementId, b.fixture.userId]);

  const keyA = buildPayoutIdempotencyKey({ workspaceId: a.fixture.workspaceId, settlementId: a.settlementId, version: 1 });
  await reserve(a.fixture, a.settlementId, keyA);

  const message = await expectError(`select royaltyos_reserve_payout($1::uuid,$2::uuid,$3::text)`, [
    b.settlementId,
    b.fixture.userId,
    keyA,
  ]);
  assert.match(message, /belongs to a different settlement/);
  assert.equal(await batchCount(b.settlementId), 0);
});
