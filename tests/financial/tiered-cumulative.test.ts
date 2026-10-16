import test from "node:test";
import assert from "node:assert/strict";
import { allocateTieredTranches } from "../../packages/core/money.ts";
import { calculateSettlement } from "../../packages/core/settlement-engine.ts";
import { validateRuleGraph } from "../../packages/core/rule-validation.ts";
import { compileRuleset } from "../../packages/core/ruleset-compiler.ts";
import type { CandidateRule, CumulativeState, ExecutableRule, RevenueContext } from "../../packages/core/types.ts";

test("allocateTieredTranches: splits revenue across earnings boundary accurately", () => {
  // Scenario: 10% (1000 bps) until $20,000 earnings (2,000,000 minor), 15% (1500 bps) thereafter.
  const tiers = [
    { tierIndex: 0, thresholdMinor: 2_000_000, rateBasisPoints: 1000, label: "10% up to $20k earnings" },
    { tierIndex: 1, thresholdMinor: null, rateBasisPoints: 1500, label: "15% thereafter" },
  ];

  // Prior earnings: $19,000 (1,900,000 minor). Needs $1,000 (100,000 minor) to hit threshold.
  // At 10% rate, $10,000 (1,000,000 minor) revenue generates that $1,000.
  // Event revenue: $15,000 (1,500,000 minor).
  // Tranche 1: $10,000 @ 10% = $1,000 (100,000 minor)
  // Tranche 2: $5,000 @ 15% = $750 (75,000 minor)
  // Total earnings = $1,750 (175,000 minor)
  const tranches = allocateTieredTranches(1_500_000, 1_900_000, tiers, "EARNINGS");

  assert.equal(tranches.length, 2);
  assert.equal(tranches[0]!.tierIndex, 0);
  assert.equal(tranches[0]!.applicableRevenueMinor, 1_000_000);
  assert.equal(tranches[0]!.allocatedMinor, 100_000);

  assert.equal(tranches[1]!.tierIndex, 1);
  assert.equal(tranches[1]!.applicableRevenueMinor, 500_000);
  assert.equal(tranches[1]!.allocatedMinor, 75_000);

  const totalRevenueUsed = tranches.reduce((sum, t) => sum + t.applicableRevenueMinor, 0);
  assert.equal(totalRevenueUsed, 1_500_000);
});

test("allocateTieredTranches: splits revenue across revenue threshold accurately", () => {
  // Scenario: 20% on first $50,000 revenue (5,000,000 minor), 30% thereafter.
  const tiers = [
    { tierIndex: 0, thresholdMinor: 5_000_000, rateBasisPoints: 2000, label: "20% on first $50k" },
    { tierIndex: 1, thresholdMinor: null, rateBasisPoints: 3000, label: "30% thereafter" },
  ];

  // Prior revenue: $30,000 (3,000,000 minor).
  // New revenue: $40,000 (4,000,000 minor).
  // Tranche 1: $20,000 @ 20% = $4,000 (400,000 minor)
  // Tranche 2: $20,000 @ 30% = $6,000 (600,000 minor)
  // Total allocated = $10,000 (1,000,000 minor)
  const tranches = allocateTieredTranches(4_000_000, 3_000_000, tiers, "REVENUE");

  assert.equal(tranches.length, 2);
  assert.equal(tranches[0]!.applicableRevenueMinor, 2_000_000);
  assert.equal(tranches[0]!.allocatedMinor, 400_000);
  assert.equal(tranches[1]!.applicableRevenueMinor, 2_000_000);
  assert.equal(tranches[1]!.allocatedMinor, 600_000);

  const totalUsed = tranches.reduce((sum, t) => sum + t.applicableRevenueMinor, 0);
  assert.equal(totalUsed, 4_000_000);
});

test("calculateSettlement: full lifecycle of tiered cumulative contract with straddling", () => {
  const tieredRule: ExecutableRule = {
    id: "rule_artist_tiered",
    type: "TIERED_CUMULATIVE",
    beneficiaryKey: "artist_main",
    base: "NET_REVENUE",
    rateBasisPoints: null,
    fixedMinor: null,
    priority: 10,
    conditions: [],
    dependencies: [],
    evidence: {
      sourceDocument: "contract.pdf",
      sourceVersion: 1,
      page: 2,
      clause: "Section 3.1",
      sourceText: "Artist receives 10% royalties until total cumulative earnings reach $20,000. After that, the royalty rate becomes 15%.",
      model: "gpt-4o",
    },
    config: {
      basis: "BENEFICIARY_EARNINGS",
      tiers: [
        { tierIndex: 0, thresholdMinor: 2_000_000, rateBasisPoints: 1000, label: "10% up to $20k earnings" },
        { tierIndex: 1, thresholdMinor: null, rateBasisPoints: 1500, label: "15% thereafter" },
      ],
    },
  };

  // Event 1: First settlement of $10,000 revenue. Prior cumulative earnings = 0.
  const ctx1: RevenueContext = {
    revenueMinor: 1_000_000, // $10,000
    currency: "USD",
    category: "STREAMING",
    occurredAt: "2026-03-01T00:00:00Z",
  };

  const cumulatives: CumulativeState[] = [
    {
      ruleId: "rule_artist_tiered",
      beneficiaryKey: "artist_main",
      cumulativeRevenueMinor: 0,
      cumulativeEarningsMinor: 0,
    },
  ];

  const res1 = calculateSettlement(ctx1, [tieredRule], [], cumulatives);
  assert.equal(res1.totalMinor, 1_000_000);
  const artistLine1 = res1.lines.find((l) => l.beneficiaryKey === "artist_main")!;
  assert.equal(artistLine1.amountMinor, 100_000); // 10% of $10k = $1k
  assert.equal(res1.cumulativeDeltas?.[0]?.appliedEarningsMinor, 100_000);

  // Cumulative state updates to $1,000 (100,000 minor)
  cumulatives[0]!.cumulativeEarningsMinor += res1.cumulativeDeltas![0]!.appliedEarningsMinor;
  cumulatives[0]!.cumulativeRevenueMinor += res1.cumulativeDeltas![0]!.appliedRevenueMinor;
  assert.equal(cumulatives[0]!.cumulativeEarningsMinor, 100_000);

  // Event 2: Fast forward cumulative earnings to $19,000 (1,900,000 minor)
  cumulatives[0]!.cumulativeEarningsMinor = 1_900_000;
  const ctx2: RevenueContext = {
    revenueMinor: 1_500_000, // $15,000
    currency: "USD",
    category: "STREAMING",
    occurredAt: "2026-06-01T00:00:00Z",
  };

  const res2 = calculateSettlement(ctx2, [tieredRule], [], cumulatives);
  assert.equal(res2.totalMinor, 1_500_000);
  const artistLine2 = res2.lines.find((l) => l.beneficiaryKey === "artist_main")!;
  // $10,000 @ 10% = $1,000 + $5,000 @ 15% = $750 => $1,750 (175,000 minor)
  assert.equal(artistLine2.amountMinor, 175_000);
  assert.equal(res2.cumulativeDeltas?.[0]?.appliedEarningsMinor, 175_000);

  // Cumulative state updates past threshold: $19,000 + $1,750 = $20,750 (2,075,000 minor)
  cumulatives[0]!.cumulativeEarningsMinor += res2.cumulativeDeltas![0]!.appliedEarningsMinor;
  assert.equal(cumulatives[0]!.cumulativeEarningsMinor, 2_075_000);

  // Event 3: Settlement fully above threshold ($10,000 revenue @ 15% flat = $1,500)
  const ctx3: RevenueContext = {
    revenueMinor: 1_000_000,
    currency: "USD",
    category: "STREAMING",
    occurredAt: "2026-09-01T00:00:00Z",
  };
  const res3 = calculateSettlement(ctx3, [tieredRule], [], cumulatives);
  const artistLine3 = res3.lines.find((l) => l.beneficiaryKey === "artist_main")!;
  assert.equal(artistLine3.amountMinor, 150_000); // 15% of $10,000 = $1,500
});

test("calculateSettlement: derivative split carved from parent rule", () => {
  const artistRule: ExecutableRule = {
    id: "rule_artist",
    type: "PERCENTAGE",
    beneficiaryKey: "artist",
    base: "NET_REVENUE",
    rateBasisPoints: 5000, // 50%
    fixedMinor: null,
    priority: 10,
    conditions: [],
    dependencies: [],
    evidence: { sourceDocument: "contract.pdf", sourceVersion: 1, page: 1, clause: "1", sourceText: "50% to artist", model: "gpt-4o" },
    config: {},
  };

  const producerRule: ExecutableRule = {
    id: "rule_producer_derivative",
    type: "DERIVATIVE_SPLIT",
    beneficiaryKey: "producer",
    base: "PARENT_RULE",
    rateBasisPoints: 2000, // 20% of artist's share
    fixedMinor: null,
    priority: 20,
    conditions: [],
    dependencies: ["rule_artist"],
    evidence: { sourceDocument: "contract.pdf", sourceVersion: 1, page: 1, clause: "2", sourceText: "20% of artist share to producer", model: "gpt-4o" },
    config: { parentRuleId: "rule_artist" },
  };

  const ctx: RevenueContext = {
    revenueMinor: 1_000_000, // $10,000
    currency: "USD",
    category: "STREAMING",
    occurredAt: "2026-01-01T00:00:00Z",
  };

  const res = calculateSettlement(ctx, [artistRule, producerRule], []);
  assert.equal(res.totalMinor, 1_000_000);

  const artistLine = res.lines.find((l) => l.beneficiaryKey === "artist")!;
  const producerLine = res.lines.find((l) => l.beneficiaryKey === "producer")!;
  const reserveLine = res.lines.find((l) => l.beneficiaryKey === "reserve")!;

  // 50% of $10,000 = $5,000. Producer takes 20% of $5,000 = $1,000. Artist retains $4,000.
  assert.equal(producerLine.amountMinor, 100_000);
  assert.equal(artistLine.amountMinor, 400_000);
  assert.equal(reserveLine.amountMinor, 500_000); // Remaining 50%
  assert.equal(producerLine.amountMinor + artistLine.amountMinor + reserveLine.amountMinor, 1_000_000);
});

test("validateRuleGraph: detects non-monotonic tiers in TIERED_CUMULATIVE", () => {
  const invalidRule: ExecutableRule = {
    id: "rule_bad_tiers",
    type: "TIERED_CUMULATIVE",
    beneficiaryKey: "artist",
    base: "NET_REVENUE",
    rateBasisPoints: null,
    fixedMinor: null,
    priority: 10,
    conditions: [],
    dependencies: [],
    evidence: { sourceDocument: "doc", sourceVersion: 1, page: 1, clause: "c", sourceText: "text", model: "m" },
    config: {
      tiers: [
        { tierIndex: 0, thresholdMinor: 5_000_000, rateBasisPoints: 1000 },
        { tierIndex: 1, thresholdMinor: 2_000_000, rateBasisPoints: 1500 }, // Less than previous!
      ],
    },
  };

  const issues = validateRuleGraph([invalidRule], new Set(["artist"]), "USD");
  assert.ok(issues.some((i) => i.code === "NON_MONOTONIC_TIERS"));
});

test("validateRuleGraph: detects CAP < FLOOR conflict", () => {
  const capRule: ExecutableRule = {
    id: "rule_cap",
    type: "CAP",
    beneficiaryKey: "artist",
    base: "NET_REVENUE",
    rateBasisPoints: null,
    fixedMinor: 10_000, // $100 cap
    priority: 20,
    conditions: [],
    dependencies: [],
    evidence: { sourceDocument: "doc", sourceVersion: 1, page: 1, clause: "c", sourceText: "text", model: "m" },
    config: { targetRuleId: "rule_base" },
  };

  const floorRule: ExecutableRule = {
    id: "rule_floor",
    type: "FLOOR",
    beneficiaryKey: "artist",
    base: "NET_REVENUE",
    rateBasisPoints: null,
    fixedMinor: 50_000, // $500 floor (greater than cap!)
    priority: 25,
    conditions: [],
    dependencies: [],
    evidence: { sourceDocument: "doc", sourceVersion: 1, page: 1, clause: "c", sourceText: "text", model: "m" },
    config: { targetRuleId: "rule_base" },
  };

  const baseRule: ExecutableRule = {
    id: "rule_base",
    type: "PERCENTAGE",
    beneficiaryKey: "artist",
    base: "NET_REVENUE",
    rateBasisPoints: 5000,
    fixedMinor: null,
    priority: 10,
    conditions: [],
    dependencies: [],
    evidence: { sourceDocument: "doc", sourceVersion: 1, page: 1, clause: "c", sourceText: "text", model: "m" },
    config: {},
  };

  const issues = validateRuleGraph([baseRule, capRule, floorRule], new Set(["artist"]), "USD");
  assert.ok(issues.some((i) => i.code === "CAP_EXCEEDED_BY_FLOOR"));
});

test("compileRuleset: compiles candidate TIERED_CUMULATIVE rules cleanly", () => {
  const candidate: CandidateRule = {
    id: "candidate_tiered",
    type: "TIERED_CUMULATIVE",
    beneficiaryKey: "artist",
    base: "NET_REVENUE",
    rateBasisPoints: null,
    fixedMinor: null,
    priority: 10,
    conditions: [],
    dependencies: [],
    evidence: { sourceDocument: "doc.pdf", sourceVersion: 1, page: 1, clause: "1", sourceText: "text", model: "gpt-4o" },
    confidence: 0.95,
    status: "APPROVED",
    config: {
      basis: "BENEFICIARY_EARNINGS",
      tiers: [
        { tierIndex: 0, thresholdMinor: 1_000_000, rateBasisPoints: 1000, label: "Tier 1" },
        { tierIndex: 1, thresholdMinor: null, rateBasisPoints: 2000, label: "Tier 2" },
      ],
    },
  };

  const compiled = compileRuleset({
    candidates: [candidate],
    beneficiaryKeys: new Set(["artist"]),
    currency: "USD",
    contractVersionId: "cv_123",
    nextVersion: 1,
  });

  assert.equal(compiled.rules.length, 1);
  assert.equal(compiled.rules[0]!.type, "TIERED_CUMULATIVE");
  assert.ok(compiled.rulesetHash);
});

test("fuzz: tiered tranche allocations conserve revenue under random inputs", () => {
  for (let i = 0; i < 200; i++) {
    const revenue = Math.floor(Math.random() * 5_000_000) + 1;
    const prior = Math.floor(Math.random() * 2_000_000);
    const threshold = Math.floor(Math.random() * 3_000_000) + 1;
    const tiers = [
      { tierIndex: 0, thresholdMinor: threshold, rateBasisPoints: 1000 },
      { tierIndex: 1, thresholdMinor: null, rateBasisPoints: 2000 },
    ];
    const tranches = allocateTieredTranches(revenue, prior, tiers, "REVENUE");
    const totalApplicable = tranches.reduce((sum, t) => sum + t.applicableRevenueMinor, 0);
    assert.equal(totalApplicable, revenue);
  }
});
