import test from "node:test";
import assert from "node:assert/strict";
import { expectError, one, q } from "./_client.ts";
import {
  activateRecoupmentRuleset,
  canonicalLines,
  commitSettlement,
  createBeneficiaries,
  createContract,
  createRevenueEvent,
  createWorkspace,
  type Fixture,
} from "./_fixtures.ts";

interface RecoupmentRow {
  original_minor: string;
  recouped_minor: string;
  remaining_minor: string;
}

async function recoupment(fixture: Fixture): Promise<RecoupmentRow> {
  const row = await one<RecoupmentRow>(
    `select original_minor::text, recouped_minor::text, remaining_minor::text
     from recoupment_accounts where workspace_id=$1 limit 1`,
    [fixture.workspaceId],
  );
  return row!;
}

function settlementLines(ruleId: string) {
  return canonicalLines().map((line) =>
    line.kind === "RECOUPMENT"
      ? { ...line, ruleId, metadata: { recoupmentAppliedMinor: 60_000 } }
      : line,
  );
}

test("approving a settlement decrements the advance exactly once", async () => {
  const fixture = await createWorkspace("recoupment");
  await createBeneficiaries(fixture);
  const { contractVersionId } = await createContract(fixture);
  const ruleset = await activateRecoupmentRuleset(fixture, contractVersionId, 60_000);
  const revenueEventId = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-RECOUP-1" });
  const settlementId = await commitSettlement(fixture, {
    revenueEventId,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: settlementLines(ruleset.ruleId),
  });

  const before = await recoupment(fixture);
  assert.equal(Number(before.remaining_minor), 60_000);
  assert.equal(Number(before.recouped_minor), 0);

  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [settlementId, fixture.userId]);
  const after = await recoupment(fixture);
  assert.equal(Number(after.recouped_minor), 60_000, "recoupment applied once");
  assert.equal(Number(after.remaining_minor), 0, "advance is fully recovered");

  // A second approval of the same settlement must fail and must not re-apply.
  const repeat = await expectError(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [
    settlementId,
    fixture.userId,
  ]);
  assert.match(repeat, /not awaiting approval/);
  const unchanged = await recoupment(fixture);
  assert.equal(Number(unchanged.recouped_minor), 60_000, "repeat approval does not double-recoup");
});

test("re-committing the same revenue event never double-recoups", async () => {
  const fixture = await createWorkspace("recoupment-repeat");
  await createBeneficiaries(fixture);
  const { contractVersionId } = await createContract(fixture);
  const ruleset = await activateRecoupmentRuleset(fixture, contractVersionId, 60_000);
  const revenueEventId = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-RECOUP-2" });
  const first = await commitSettlement(fixture, {
    revenueEventId,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: settlementLines(ruleset.ruleId),
  });
  const second = await commitSettlement(fixture, {
    revenueEventId,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: settlementLines(ruleset.ruleId),
  });
  assert.equal(first, second, "commit is idempotent per revenue event");
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [first, fixture.userId]);
  const state = await recoupment(fixture);
  assert.equal(Number(state.recouped_minor), 60_000, "one settlement, one recoupment");
});

test("recoupment can never exceed the remaining advance", async () => {
  const fixture = await createWorkspace("recoupment-overrun");
  await createBeneficiaries(fixture);
  const { contractVersionId } = await createContract(fixture);
  const ruleset = await activateRecoupmentRuleset(fixture, contractVersionId, 60_000);

  const firstRevenue = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-RECOUP-A" });
  const firstSettlement = await commitSettlement(fixture, {
    revenueEventId: firstRevenue,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: settlementLines(ruleset.ruleId),
  });
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [firstSettlement, fixture.userId]);

  // A second settlement tries to recoup the same (now exhausted) advance.
  const secondRevenue = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-RECOUP-B" });
  const secondSettlement = await commitSettlement(fixture, {
    revenueEventId: secondRevenue,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: settlementLines(ruleset.ruleId),
  });
  const overrun = await expectError(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [
    secondSettlement,
    fixture.userId,
  ]);
  assert.match(overrun, /exceeds remaining balance/);

  const state = await recoupment(fixture);
  assert.equal(Number(state.recouped_minor), 60_000, "balance is unchanged after the rejected approval");
  assert.equal(Number(state.remaining_minor), 0, "remaining never goes negative");
});

test("concurrent approvals apply the recoupment only once", async () => {
  const fixture = await createWorkspace("recoupment-race");
  await createBeneficiaries(fixture);
  const { contractVersionId } = await createContract(fixture);
  const ruleset = await activateRecoupmentRuleset(fixture, contractVersionId, 60_000);
  const revenueEventId = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-RECOUP-RACE" });
  const settlementId = await commitSettlement(fixture, {
    revenueEventId,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: settlementLines(ruleset.ruleId),
  });

  const attempts = await Promise.allSettled([
    q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [settlementId, fixture.userId]),
    q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [settlementId, fixture.userId]),
    q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [settlementId, fixture.userId]),
  ]);
  const succeeded = attempts.filter((result) => result.status === "fulfilled");
  assert.equal(succeeded.length, 1, "only one concurrent approval wins");

  const state = await recoupment(fixture);
  assert.equal(Number(state.recouped_minor), 60_000, "recoupment applied exactly once under concurrency");
  assert.equal(Number(state.remaining_minor), 0);
});
