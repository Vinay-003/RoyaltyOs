import test from "node:test";
import assert from "node:assert/strict";
import { expectError, one, q } from "./_client.ts";
import {
  activateRuleset,
  canonicalLines,
  commitSettlement,
  createContract,
  createMember,
  createRevenueEvent,
  createWorkspace,
  hash64,
  preparedSettlement,
} from "./_fixtures.ts";

test("settlement lines must reconcile exactly with distributable revenue", async () => {
  const fixture = await createWorkspace("reconcile");
  const { contractVersionId } = await createContract(fixture);
  const ruleset = await activateRuleset(fixture, contractVersionId);
  const revenueEventId = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-RECONCILE" });

  const mismatched = canonicalLines().map((line) =>
    line.key === "reserve:RESERVE" ? { ...line, amountMinor: line.amountMinor - 1 } : line,
  );
  const error = await expectError(
    `select royaltyos_commit_settlement($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::jsonb,$9::uuid)`,
    [
      fixture.workspaceId,
      fixture.projectId,
      revenueEventId,
      ruleset.rulesetId,
      ruleset.rulesetHash,
      "royalty-engine-v1",
      hash64("mismatched"),
      JSON.stringify(mismatched),
      fixture.userId,
    ],
  );
  assert.match(error, /do not reconcile/);

  const rows = await one<{ count: string }>(`select count(*) from settlements where revenue_event_id=$1`, [
    revenueEventId,
  ]);
  assert.equal(Number(rows!.count), 0, "no settlement was created for the malformed totals");

  // Committing the correct totals for the same event now succeeds and balances.
  const settlementId = await commitSettlement(fixture, {
    revenueEventId,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: canonicalLines(),
  });
  const check = await one<{ sum: string; distributable: string }>(
    `select (select sum(amount_minor) from settlement_lines where settlement_id=$1)::text as sum,
            (select distributable_minor from settlements where id=$1)::text as distributable`,
    [settlementId],
  );
  assert.equal(Number(check!.sum), Number(check!.distributable), "SUM(lines) == distributable_minor");
  assert.equal(Number(check!.sum), 1_000_000);
});

test("committing the same revenue event twice returns the same settlement", async () => {
  const prepared = await preparedSettlement();
  const again = await commitSettlement(prepared.fixture, {
    revenueEventId: prepared.revenueEventId,
    rulesetId: prepared.rulesetId,
    rulesetHash: prepared.rulesetHash,
    lines: [],
  });
  assert.equal(again, prepared.settlementId, "repeat commit is idempotent");
  const rows = await one<{ count: string }>(`select count(*) from settlements where revenue_event_id=$1`, [
    prepared.revenueEventId,
  ]);
  assert.equal(Number(rows!.count), 1);
});

test("an active ruleset hash and the owning workspace are both enforced", async () => {
  const prepared = await preparedSettlement();
  const wrongHashRevenue = await createRevenueEvent(prepared.fixture, { amountMinor: 500_000, externalId: "INV-WRONG-HASH" });
  const wrongHash = await expectError(
    `select royaltyos_commit_settlement($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::jsonb,$9::uuid)`,
    [
      prepared.fixture.workspaceId,
      prepared.fixture.projectId,
      wrongHashRevenue,
      prepared.rulesetId,
      hash64("not-the-real-hash"),
      "royalty-engine-v1",
      hash64("s1"),
      JSON.stringify(canonicalLines()),
      prepared.fixture.userId,
    ],
  );
  assert.match(wrongHash, /active ruleset mismatch/);

  const otherWorkspace = await createWorkspace("tenant");
  const crossTenantRevenue = await createRevenueEvent(prepared.fixture, { amountMinor: 500_000, externalId: "INV-CROSS-TENANT" });
  const crossTenant = await expectError(
    `select royaltyos_commit_settlement($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::jsonb,$9::uuid)`,
    [
      otherWorkspace.workspaceId,
      otherWorkspace.projectId,
      crossTenantRevenue,
      prepared.rulesetId,
      prepared.rulesetHash,
      "royalty-engine-v1",
      hash64("s2"),
      JSON.stringify(canonicalLines()),
      otherWorkspace.userId,
    ],
  );
  assert.match(crossTenant, /revenue tenant mismatch|active ruleset mismatch/);

  const untouched = await one<{ count: string }>(`select count(*) from settlements where revenue_event_id in ($1,$2)`, [
    wrongHashRevenue,
    crossTenantRevenue,
  ]);
  assert.equal(Number(untouched!.count), 0, "neither rejected attempt created a settlement");
});

test("approved settlements and their lines cannot be mutated", async () => {
  const prepared = await preparedSettlement();
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [
    prepared.settlementId,
    prepared.fixture.userId,
  ]);

  const status = await one<{ status: string; approved_by: string | null }>(
    `select status, approved_by from settlements where id=$1`,
    [prepared.settlementId],
  );
  assert.equal(status!.status, "APPROVED");
  assert.equal(status!.approved_by, prepared.fixture.userId);

  const frozen = await expectError(`update settlements set distributable_minor=1 where id=$1`, [prepared.settlementId]);
  assert.match(frozen, /immutable/);
  const lineChanged = await expectError(`update settlement_lines set amount_minor=1 where settlement_id=$1`, [
    prepared.settlementId,
  ]);
  assert.match(lineChanged, /immutable/);
  const lineDeleted = await expectError(`delete from settlement_lines where settlement_id=$1`, [prepared.settlementId]);
  assert.match(lineDeleted, /immutable/);
  const settlementDeleted = await expectError(`delete from settlements where id=$1`, [prepared.settlementId]);
  assert.match(settlementDeleted, /cannot be deleted/);

  const doubleApprove = await expectError(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [
    prepared.settlementId,
    prepared.fixture.userId,
  ]);
  assert.match(doubleApprove, /not awaiting approval/);
});

test("approval requires the finance role", async () => {
  const prepared = await preparedSettlement();
  const contributor = await createMember(prepared.fixture, "CONTRIBUTOR");
  const message = await expectError(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [
    prepared.settlementId,
    contributor,
  ]);
  assert.match(message, /not authorized to approve settlement/);

  const auditor = await createMember(prepared.fixture, "AUDITOR");
  const auditorMessage = await expectError(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [
    prepared.settlementId,
    auditor,
  ]);
  assert.match(auditorMessage, /not authorized/);

  const approver = await createMember(prepared.fixture, "FINANCE_APPROVER");
  const approved = await one<{ id: string }>(
    `select royaltyos_approve_settlement($1::uuid,$2::uuid) as id`,
    [prepared.settlementId, approver],
  );
  assert.equal(approved!.id, prepared.settlementId);
});

test("ledger and financial integrity hold after a committed settlement", async () => {
  const prepared = await preparedSettlement();
  const ledger = await one<{ royaltyos_ledger_integrity: { valid: boolean; transactionCount: number } }>(
    `select royaltyos_ledger_integrity($1::uuid) as royaltyos_ledger_integrity`,
    [prepared.fixture.workspaceId],
  );
  assert.equal(ledger!.royaltyos_ledger_integrity.valid, true);
  assert.ok(ledger!.royaltyos_ledger_integrity.transactionCount >= 1);

  const financial = await one<{ royaltyos_financial_integrity: { valid: boolean; settlementMismatchCount: number } }>(
    `select royaltyos_financial_integrity($1::uuid) as royaltyos_financial_integrity`,
    [prepared.fixture.workspaceId],
  );
  assert.equal(financial!.royaltyos_financial_integrity.valid, true);
  assert.equal(financial!.royaltyos_financial_integrity.settlementMismatchCount, 0);

  // Revenue events themselves are immutable once recorded.
  const revenueError = await expectError(`update revenue_events set distributable_minor=1 where id=$1`, [
    prepared.revenueEventId,
  ]);
  assert.match(revenueError, /immutable/);
  const revenueDelete = await expectError(`delete from revenue_events where id=$1`, [prepared.revenueEventId]);
  assert.match(revenueDelete, /immutable/);
});

test("a second revenue event produces an independent settlement", async () => {
  const prepared = await preparedSettlement();
  const secondRevenue = await createRevenueEvent(prepared.fixture, { amountMinor: 200_000, externalId: "INV-SECOND" });
  const secondSettlement = await commitSettlement(prepared.fixture, {
    revenueEventId: secondRevenue,
    rulesetId: prepared.rulesetId,
    rulesetHash: prepared.rulesetHash,
    lines: canonicalLines().map((line) => ({
      ...line,
      amountMinor: Math.round((line.amountMinor * 200_000) / 1_000_000),
      payableMinor: Math.round((line.payableMinor * 200_000) / 1_000_000),
    })),
  });
  assert.notEqual(secondSettlement, prepared.settlementId);
  const check = await one<{ sum: string; distributable: string }>(
    `select (select sum(amount_minor) from settlement_lines where settlement_id=$1)::text as sum,
            (select distributable_minor from settlements where id=$1)::text as distributable`,
    [secondSettlement],
  );
  assert.equal(Number(check!.sum), Number(check!.distributable));
});
