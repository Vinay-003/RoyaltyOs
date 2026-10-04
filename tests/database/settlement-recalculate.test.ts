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
} from "./_fixtures.ts";

function linesWithRecoupment(ruleId: string, recoupMinor: number) {
  return canonicalLines().map((line) =>
    line.kind === "RECOUPMENT"
      ? { ...line, ruleId, amountMinor: recoupMinor, metadata: { recoupmentAppliedMinor: recoupMinor } }
      : line,
  );
}

test("a voided settlement can be recalculated fresh from the same revenue", async () => {
  const fixture = await createWorkspace("void-recalc");
  await createBeneficiaries(fixture);
  const { contractVersionId } = await createContract(fixture);
  const ruleset = await activateRecoupmentRuleset(fixture, contractVersionId, 60_000);
  const revenueEventId = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-VOID-1" });
  const stale = await commitSettlement(fixture, {
    revenueEventId,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: linesWithRecoupment(ruleset.ruleId, 60_000),
  });

  await q(`select royaltyos_void_settlement($1::uuid,$2::uuid)`, [stale, fixture.userId]);
  const voided = await one<{ status: string }>(`select status from settlements where id=$1`, [stale]);
  assert.equal(voided!.status, "VOIDED");

  const blocked = await expectError(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [stale, fixture.userId]);
  assert.match(blocked, /awaiting approval/, "a voided settlement can never be approved");

  const fresh = await commitSettlement(fixture, {
    revenueEventId,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: linesWithRecoupment(ruleset.ruleId, 60_000),
  });
  assert.notEqual(fresh, stale, "recalculation returns a new settlement, not the voided one");
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [fresh, fixture.userId]);
  const approved = await one<{ status: string }>(`select status from settlements where id=$1`, [fresh]);
  assert.equal(approved!.status, "APPROVED");
});

test("only unapproved settlements can be voided", async () => {
  const fixture = await createWorkspace("void-approved");
  const { contractVersionId } = await createContract(fixture);
  const ruleset = await activateRecoupmentRuleset(fixture, contractVersionId, 60_000);
  const revenueEventId = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-VOID-2" });
  const settlementId = await commitSettlement(fixture, {
    revenueEventId,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: linesWithRecoupment(ruleset.ruleId, 60_000),
  });
  // Voiding twice fails the second time; approving a voided row fails too.
  await q(`select royaltyos_void_settlement($1::uuid,$2::uuid)`, [settlementId, fixture.userId]);
  const twice = await expectError(`select royaltyos_void_settlement($1::uuid,$2::uuid)`, [settlementId, fixture.userId]);
  assert.match(twice, /only settlements awaiting approval can be voided/);
});

test("concurrent proposals against one advance cannot over-recoup at approval", async () => {
  const fixture = await createWorkspace("void-overrun");
  await createBeneficiaries(fixture);
  const { contractVersionId } = await createContract(fixture);
  const ruleset = await activateRecoupmentRuleset(fixture, contractVersionId, 60_000);
  const firstRevenue = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-OVER-A" });
  const secondRevenue = await createRevenueEvent(fixture, { amountMinor: 1_000_000, externalId: "INV-OVER-B" });
  // Both proposals are calculated against the untouched $60,000 advance.
  const first = await commitSettlement(fixture, {
    revenueEventId: firstRevenue,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: linesWithRecoupment(ruleset.ruleId, 60_000),
  });
  const second = await commitSettlement(fixture, {
    revenueEventId: secondRevenue,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: linesWithRecoupment(ruleset.ruleId, 60_000),
  });
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [first, fixture.userId]);
  const stale = await expectError(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [second, fixture.userId]);
  assert.match(stale, /exceeds remaining/, "the second approval is refused, never over-applied");

  // Recourse: void the stale proposal and recalculate against current state.
  // With the advance exhausted, the fresh proposal recoups $0 and parks the
  // difference in reserve so lines still reconcile exactly.
  await q(`select royaltyos_void_settlement($1::uuid,$2::uuid)`, [second, fixture.userId]);
  const recalculated = await commitSettlement(fixture, {
    revenueEventId: secondRevenue,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: canonicalLines().map((line) =>
      line.kind === "RECOUPMENT"
        ? { ...line, ruleId: ruleset.ruleId, amountMinor: 0, payableMinor: 0, metadata: { recoupmentAppliedMinor: 0 } }
        : line.kind === "RESERVE"
          ? { ...line, amountMinor: line.amountMinor + 60_000 }
          : line,
    ),
  });
  assert.notEqual(recalculated, second);
  await q(`select royaltyos_approve_settlement($1::uuid,$2::uuid)`, [recalculated, fixture.userId]);
  const remaining = await one<{ remaining_minor: string }>(
    `select remaining_minor::text from recoupment_accounts where workspace_id=$1 limit 1`,
    [fixture.workspaceId],
  );
  assert.equal(Number(remaining!.remaining_minor), 0, "exactly the advance was recovered, never more");
});
