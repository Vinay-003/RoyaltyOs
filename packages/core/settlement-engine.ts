import { allocateLargestRemainder, allocateTieredTranches, assertMinorUnits } from "./money.ts";
import { evaluateFormula } from "./formula.ts";
import type {
  CumulativeState,
  ExecutableRule,
  RecoupmentState,
  RevenueContext,
  RuleCondition,
  SettlementLine,
  SettlementResult,
} from "./types.ts";

function numberConfig(rule: ExecutableRule, key: string): number | null {
  const value = rule.config[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return null;
}

function stringConfig(rule: ExecutableRule, key: string): string | null {
  const value = rule.config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compareCondition(actual: string | number | null, condition: RuleCondition): boolean {
  const expected = condition.value;
  switch (condition.operator) {
    case "EQ": return actual === expected;
    case "NEQ": return actual !== expected;
    case "GT": return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "GTE": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "LT": return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "LTE": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "IN": return Array.isArray(expected) && expected.includes(actual as never);
    case "BETWEEN": {
      if (!Array.isArray(expected) || expected.length !== 2 || typeof actual !== "number") return false;
      const [a, b] = expected;
      return typeof a === "number" && typeof b === "number" && actual >= a && actual <= b;
    }
  }
}

function ruleMatches(
  rule: ExecutableRule,
  ctx: RevenueContext,
  recoupmentRemaining: number,
  cumulativeState?: CumulativeState | null,
): boolean {
  const configuredCategory = stringConfig(rule, "category");
  if (configuredCategory && configuredCategory.toUpperCase() !== (ctx.category ?? "").toUpperCase()) return false;
  const configuredCurrency = stringConfig(rule, "currency");
  if (configuredCurrency && configuredCurrency.toUpperCase() !== ctx.currency.toUpperCase()) return false;
  const startDate = stringConfig(rule, "startDate");
  const endDate = stringConfig(rule, "endDate");
  const occurred = Date.parse(ctx.occurredAt);
  if (startDate && occurred < Date.parse(startDate)) return false;
  if (endDate && occurred > Date.parse(endDate)) return false;

  for (const condition of rule.conditions ?? []) {
    let actual: string | number | null = null;
    if (condition.field === "revenue_category") actual = ctx.category;
    if (condition.field === "currency") actual = ctx.currency;
    if (condition.field === "occurred_at") actual = occurred;
    if (condition.field === "recoupment_remaining") actual = recoupmentRemaining;
    if (condition.field === "revenue_minor") actual = ctx.revenueMinor;
    if (condition.field === "cumulative_earnings_minor") actual = cumulativeState?.cumulativeEarningsMinor ?? 0;
    if (condition.field === "cumulative_revenue_minor") actual = cumulativeState?.cumulativeRevenueMinor ?? 0;
    if (!compareCondition(actual, condition)) return false;
  }
  return true;
}

function modifierTarget(rule: ExecutableRule) {
  return stringConfig(rule, "targetRuleId");
}

function ruleMatchesWithDateModifiers(
  rule: ExecutableRule,
  allRules: ExecutableRule[],
  ctx: RevenueContext,
  recoupmentRemaining: number,
  cumulativeState?: CumulativeState | null,
) {
  if (!ruleMatches(rule, ctx, recoupmentRemaining, cumulativeState)) return false;
  for (const modifier of allRules.filter((candidate) =>
    candidate.type === "DATE_RANGE" && modifierTarget(candidate) === rule.id
  )) {
    if (!ruleMatches(modifier, ctx, recoupmentRemaining, cumulativeState)) return false;
  }
  return true;
}

function effectivePriority(rule: ExecutableRule, allRules: ExecutableRule[]) {
  const modifiers = allRules.filter((candidate) =>
    candidate.type === "PRIORITY" && modifierTarget(candidate) === rule.id
  );
  if (!modifiers.length) return rule.priority;
  const values = modifiers.map((modifier) => numberConfig(modifier, "priorityValue") ?? modifier.priority);
  return Math.min(rule.priority, ...values);
}

function applyModifier(
  line: SettlementLine,
  rule: ExecutableRule,
  remainingAvailable: number,
): SettlementLine {
  let amount = line.amountMinor;
  if (rule.type === "CAP") {
    const cap = rule.fixedMinor ?? numberConfig(rule, "amountMinor") ?? numberConfig(rule, "capMinor");
    if (cap !== null) amount = Math.min(amount, cap);
  }
  if (rule.type === "FLOOR") {
    const floor = rule.fixedMinor ?? numberConfig(rule, "amountMinor") ?? numberConfig(rule, "floorMinor");
    if (floor !== null) amount = Math.min(remainingAvailable, Math.max(amount, floor));
  }
  if (rule.type === "THRESHOLD") {
    const threshold = rule.fixedMinor ?? numberConfig(rule, "thresholdMinor") ?? 0;
    const mode = stringConfig(rule, "mode") ?? "MIN_REVENUE";
    if (mode === "MIN_REVENUE" && remainingAvailable < threshold) amount = 0;
    if (mode === "MIN_PAYOUT" && amount < threshold) amount = 0;
  }
  return {
    ...line,
    amountMinor: amount,
    payableMinor: Math.min(line.payableMinor, amount),
    metadata: { ...line.metadata, modifierRuleId: rule.id, modifierType: rule.type },
  };
}

export function calculateSettlement(
  ctx: RevenueContext,
  rules: ExecutableRule[],
  recoupments: RecoupmentState[],
  cumulatives: CumulativeState[] = [],
): SettlementResult {
  assertMinorUnits(ctx.revenueMinor, "revenueMinor");
  const sorted = [...rules].sort((a, b) => effectivePriority(a, rules) - effectivePriority(b, rules) || a.id.localeCompare(b.id));
  const recByRule = new Map(recoupments.map((r) => [r.ruleId, { ...r }]));
  const cumByRule = new Map(cumulatives.map((c) => [c.ruleId, { ...c }]));
  const cumByBeneficiary = new Map(cumulatives.map((c) => [c.beneficiaryKey, { ...c }]));
  const explanation: string[] = [];
  const lines: SettlementLine[] = [];
  const recoupmentDeltas: Array<{ ruleId: string; appliedMinor: number }> = [];
  const cumulativeDeltas: Array<{
    ruleId: string;
    beneficiaryKey: string;
    appliedEarningsMinor: number;
    appliedRevenueMinor: number;
  }> = [];
  let remaining = ctx.revenueMinor;

  // 1) Contractual exclusions/deductions.
  for (const rule of sorted.filter((r) => r.type === "EXCLUSION")) {
    if (!ruleMatchesWithDateModifiers(rule, rules, ctx, 0)) continue;
    const requested = rule.fixedMinor ?? numberConfig(rule, "amountMinor") ?? 0;
    assertMinorUnits(requested, `exclusion ${rule.id}`);
    const amount = Math.min(requested, remaining);
    remaining -= amount;
    lines.push({
      key: `exclusion:${rule.id}`,
      beneficiaryKey: rule.beneficiaryKey ?? "excluded",
      ruleId: rule.id,
      amountMinor: amount,
      payableMinor: 0,
      kind: "EXCLUSION",
      metadata: { requestedMinor: requested },
    });
    explanation.push(`Excluded ${amount} minor units under ${rule.id}.`);
  }

  // 2) Advance recoupment is a priority deduction from the revenue pool.
  for (const rule of sorted.filter((r) => r.type === "RECOUPMENT")) {
    const state = recByRule.get(rule.id);
    if (!state || state.remainingMinor <= 0 || remaining <= 0) continue;
    if (state.currency.toUpperCase() !== ctx.currency.toUpperCase()) {
      throw new Error(`Recoupment currency mismatch for ${rule.id}`);
    }
    if (!ruleMatchesWithDateModifiers(rule, rules, ctx, state.remainingMinor)) continue;
    const maxPerEvent = numberConfig(rule, "maxRecoupmentPerEventMinor");
    const requested = maxPerEvent === null ? state.remainingMinor : Math.min(state.remainingMinor, maxPerEvent);
    const applied = Math.min(requested, remaining);
    if (applied <= 0) continue;
    remaining -= applied;
    state.remainingMinor -= applied;
    state.recoupedMinor += applied;
    recoupmentDeltas.push({ ruleId: rule.id, appliedMinor: applied });
    lines.push({
      key: `recoupment:${rule.id}`,
      beneficiaryKey: rule.beneficiaryKey ?? state.beneficiaryKey,
      ruleId: rule.id,
      amountMinor: applied,
      payableMinor: 0,
      kind: "RECOUPMENT",
      metadata: {
        recoupmentAppliedMinor: applied,
        recoupmentRemainingAfterMinor: state.remainingMinor,
        nonCashSettlementLine: true,
      },
    });
    explanation.push(`Applied ${applied} minor units to ${state.beneficiaryKey} advance recoupment.`);
  }

  // 3) Fixed allocations from what remains.
  for (const rule of sorted.filter((r) => r.type === "FIXED_AMOUNT")) {
    const relevantRec = rule.beneficiaryKey
      ? [...recByRule.values()].find((r) => r.beneficiaryKey === rule.beneficiaryKey)?.remainingMinor ?? 0
      : 0;
    if (!ruleMatchesWithDateModifiers(rule, rules, ctx, relevantRec)) continue;
    const requested = rule.fixedMinor ?? numberConfig(rule, "amountMinor") ?? 0;
    assertMinorUnits(requested, `fixed amount ${rule.id}`);
    const amount = Math.min(requested, remaining);
    remaining -= amount;
    lines.push({
      key: `fixed:${rule.id}`,
      beneficiaryKey: rule.beneficiaryKey ?? "fixed",
      ruleId: rule.id,
      amountMinor: amount,
      payableMinor: amount,
      kind: "FIXED",
      metadata: { requestedMinor: requested },
    });
    explanation.push(`Allocated fixed amount ${amount} under ${rule.id}.`);
  }

  // 3.5) Tiered cumulative allocations.
  for (const rule of sorted.filter((r) => r.type === "TIERED_CUMULATIVE")) {
    let cumState = cumByRule.get(rule.id) ?? (rule.beneficiaryKey ? cumByBeneficiary.get(rule.beneficiaryKey) : null);
    if (!cumState && rule.beneficiaryKey) {
      cumState = {
        ruleId: rule.id,
        beneficiaryKey: rule.beneficiaryKey,
        cumulativeRevenueMinor: 0,
        cumulativeEarningsMinor: 0,
        periodAnchor: null,
      };
      cumByRule.set(rule.id, cumState);
      cumByBeneficiary.set(rule.beneficiaryKey, cumState);
    }
    if (!ruleMatchesWithDateModifiers(rule, rules, ctx, 0, cumState)) continue;
    const tiers = Array.isArray(rule.config.tiers) ? (rule.config.tiers as any[]) : [];
    if (!tiers.length) continue;

    const basisConfig = stringConfig(rule, "cumulativeBasis") ?? stringConfig(rule, "basis") ?? "BENEFICIARY_EARNINGS";
    const trancheBasis = (basisConfig === "GROSS_REVENUE" || basisConfig === "REVENUE") ? "REVENUE" : "EARNINGS";
    const prior = trancheBasis === "EARNINGS" ? (cumState?.cumulativeEarningsMinor ?? 0) : (cumState?.cumulativeRevenueMinor ?? 0);
    const baseMinor = rule.base === "GROSS_REVENUE" ? ctx.revenueMinor : remaining;
    const tranches = allocateTieredTranches(baseMinor, prior, tiers, trancheBasis);
    const totalAllocated = tranches.reduce((sum, t) => sum + t.allocatedMinor, 0);

    const payable = Math.min(remaining, totalAllocated);
    if (payable > 0 || totalAllocated === 0) {
      remaining -= payable;
      lines.push({
        key: `tiered:${rule.id}`,
        beneficiaryKey: rule.beneficiaryKey ?? "tiered",
        ruleId: rule.id,
        amountMinor: payable,
        payableMinor: payable,
        kind: "PAYABLE",
        metadata: {
          ruleType: "TIERED_CUMULATIVE",
          tranches,
          priorCumulativeMinor: prior,
          basis: basisConfig,
        },
      });
      if (cumState) {
        cumState.cumulativeEarningsMinor += payable;
        cumState.cumulativeRevenueMinor += baseMinor;
      }
      cumulativeDeltas.push({
        ruleId: rule.id,
        beneficiaryKey: rule.beneficiaryKey ?? "tiered",
        appliedEarningsMinor: payable,
        appliedRevenueMinor: baseMinor,
      });
      explanation.push(`Allocated ${payable} minor units under tiered rule ${rule.id} across ${tranches.length} tranche(s).`);
    }
  }

  // 3.8) Custom mathematical formula rules.
  for (const rule of sorted.filter((r) => r.type === "FORMULA")) {
    const formulaStr = stringConfig(rule, "formula");
    if (!formulaStr) continue;
    const relevantRec = rule.beneficiaryKey
      ? [...recByRule.values()].find((r) => r.beneficiaryKey === rule.beneficiaryKey)?.remainingMinor ?? 0
      : 0;
    const cumState = cumByRule.get(rule.id) ?? (rule.beneficiaryKey ? cumByBeneficiary.get(rule.beneficiaryKey) : null);
    if (!ruleMatchesWithDateModifiers(rule, rules, ctx, relevantRec, cumState)) continue;

    const baseMinor = rule.base === "GROSS_REVENUE" ? ctx.revenueMinor : remaining;
    const computed = evaluateFormula(formulaStr, {
      revenue: ctx.revenueMinor,
      gross_revenue: ctx.revenueMinor,
      net_revenue: baseMinor,
      cumulative_revenue: cumState?.cumulativeRevenueMinor ?? 0,
      cumulative_earnings: cumState?.cumulativeEarningsMinor ?? 0,
      recoupment_remaining: relevantRec,
      rate: rule.rateBasisPoints !== null ? rule.rateBasisPoints / 10000 : 0,
      fixed: rule.fixedMinor ?? 0,
      category: ctx.category ?? "",
      currency: ctx.currency,
    });

    const payable = Math.max(0, Math.min(remaining, Math.trunc(computed)));
    remaining -= payable;
    lines.push({
      key: `formula:${rule.id}`,
      beneficiaryKey: rule.beneficiaryKey ?? "formula",
      ruleId: rule.id,
      amountMinor: payable,
      payableMinor: payable,
      kind: "PAYABLE",
      metadata: {
        formula: formulaStr,
        explanation: stringConfig(rule, "formulaExplanation") ?? "Custom formula evaluation",
      },
    });
    if (cumState) {
      cumState.cumulativeEarningsMinor += payable;
      cumState.cumulativeRevenueMinor += baseMinor;
    }
    explanation.push(`Allocated ${payable} minor units under formula rule ${rule.id} ('${formulaStr}').`);
  }

  // 4) Percentage allocations. GROSS_REVENUE rules are calculated against the
  // original event amount. NET_REVENUE/REMAINDER rules are calculated against the
  // pool that remains after exclusions, recoupment, fixed allocations and gross-base
  // allocations. This keeps base semantics explicit instead of silently treating every
  // percentage as a remainder percentage.
  const percentageRules = sorted.filter((r) => ["PERCENTAGE", "RECOUPMENT", "REVENUE_CATEGORY", "RESERVE"].includes(r.type));

  const eligibleWeighted = (candidates: ExecutableRule[]) => {
    const weighted: Array<{ rule: ExecutableRule; basisPoints: number }> = [];
    for (const rule of candidates) {
      const state = recByRule.get(rule.id);
      const recRemaining = state?.remainingMinor ?? 0;
      if (!ruleMatchesWithDateModifiers(rule, rules, ctx, recRemaining)) continue;
      let bps = rule.rateBasisPoints;
      if (rule.type === "RECOUPMENT") {
        const pre = numberConfig(rule, "preRecoupmentBasisPoints");
        const post = numberConfig(rule, "postRecoupmentBasisPoints");
        bps = recRemaining > 0 ? (pre ?? bps) : (post ?? bps);
      }
      if (bps === null || bps === 0) continue;
      if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error(`Invalid basis points on ${rule.id}`);
      weighted.push({ rule, basisPoints: bps });
    }
    const totalBps = weighted.reduce((sum, row) => sum + row.basisPoints, 0);
    if (totalBps > 10000) throw new Error(`Percentage allocation exceeds 100% (${totalBps} bps)`);
    return { weighted, totalBps };
  };

  const buildPercentageLines = (
    baseMinor: number,
    weighted: Array<{ rule: ExecutableRule; basisPoints: number }>,
    includeRemainder: boolean,
  ) => {
    if (!weighted.length) return { built: [] as SettlementLine[], remainderMinor: includeRemainder ? baseMinor : 0 };
    const totalBps = weighted.reduce((sum, row) => sum + row.basisPoints, 0);
    const allocations = allocateLargestRemainder(baseMinor, [
      ...weighted.map(({ rule, basisPoints }) => ({ key: rule.id, weight: basisPoints })),
      { key: "__unallocated__", weight: 10000 - totalBps },
    ]);
    const amountByRule = new Map(allocations.map((row) => [row.key, row.amountMinor]));
    const built = weighted.map(({ rule, basisPoints }): SettlementLine => ({
      key: `percentage:${rule.id}`,
      beneficiaryKey: rule.beneficiaryKey ?? (rule.type === "RESERVE" ? "reserve" : "unassigned"),
      ruleId: rule.id,
      amountMinor: amountByRule.get(rule.id) ?? 0,
      payableMinor: rule.type === "RESERVE" ? 0 : (amountByRule.get(rule.id) ?? 0),
      kind: rule.type === "RESERVE" ? "RESERVE" : "PAYABLE",
      metadata: { basisPoints, baseMinor, base: rule.base },
    }));
    return { built, remainderMinor: includeRemainder ? (amountByRule.get("__unallocated__") ?? 0) : 0 };
  };

  const applyLineModifiers = (inputLine: SettlementLine, availableForFloor: number) => {
    let line = inputLine;
    const modifiers = sorted.filter((rule) => {
      if (!["CAP", "FLOOR", "THRESHOLD"].includes(rule.type)) return false;
      const targetRuleId = stringConfig(rule, "targetRuleId");
      if (targetRuleId && targetRuleId !== line.ruleId) return false;
      if (!targetRuleId && rule.beneficiaryKey && rule.beneficiaryKey !== line.beneficiaryKey) return false;
      return ruleMatches(rule, ctx, 0);
    });
    for (const modifier of modifiers) line = applyModifier(line, modifier, availableForFloor);
    return line;
  };

  const grossEligible = eligibleWeighted(percentageRules.filter((rule) => rule.base === "GROSS_REVENUE"));
  const grossBuilt = buildPercentageLines(ctx.revenueMinor, grossEligible.weighted, false).built
    .map((line) => applyLineModifiers(line, remaining));
  const grossTotal = grossBuilt.reduce((sum, line) => sum + line.amountMinor, 0);
  if (grossTotal > remaining) {
    throw new Error(`GROSS_REVENUE allocations (${grossTotal}) exceed remaining distributable pool (${remaining})`);
  }
  if (grossBuilt.length) {
    lines.push(...grossBuilt);
    remaining -= grossTotal;
    explanation.push(`Applied ${grossBuilt.length} GROSS_REVENUE percentage rule(s) against ${ctx.revenueMinor} minor units.`);
  }

  const poolEligible = eligibleWeighted(percentageRules.filter((rule) => rule.base !== "GROSS_REVENUE"));
  const poolAllocation = buildPercentageLines(remaining, poolEligible.weighted, true);
  const poolLines = poolAllocation.built.map((line) => applyLineModifiers(line, remaining));
  const poolLineTotal = poolLines.reduce((sum, line) => sum + line.amountMinor, 0);
  let residual = remaining - poolLineTotal;
  if (residual < 0) throw new Error("Rule floors/caps produced an over-allocation");
  lines.push(...poolLines);

  // Any unallocated remainder is held safely rather than silently paid to a party. It
  // preserves a trace to the active percentage rules in metadata; contributor reports
  // intentionally exclude this non-payable line.
  if (residual > 0) {
    lines.push({
      key: "reserve:remainder",
      beneficiaryKey: "reserve",
      ruleId: null,
      amountMinor: residual,
      payableMinor: 0,
      kind: "RESERVE",
      metadata: {
        reason: "unallocated remainder / reserve",
        contributingRuleIds: [...grossEligible.weighted, ...poolEligible.weighted].map((row) => row.rule.id),
      },
    });
  }

  // 5) Derivative splits carved out of parent rules.
  for (const rule of sorted.filter((r) => r.type === "DERIVATIVE_SPLIT" || r.base === "PARENT_RULE")) {
    const parentId = stringConfig(rule, "parentRuleId");
    const parentLine = lines.find((l) => l.ruleId === parentId);
    if (parentLine && parentLine.amountMinor > 0) {
      const bps = rule.rateBasisPoints ?? 0;
      const childShare = Math.floor((parentLine.amountMinor * bps) / 10000);
      if (childShare > 0) {
        parentLine.amountMinor -= childShare;
        parentLine.payableMinor = Math.min(parentLine.payableMinor, parentLine.amountMinor);
        lines.push({
          key: `derivative:${rule.id}`,
          beneficiaryKey: rule.beneficiaryKey ?? "derivative",
          ruleId: rule.id,
          amountMinor: childShare,
          payableMinor: childShare,
          kind: "PAYABLE",
          metadata: { parentRuleId: parentId, rateBasisPoints: bps },
        });
        explanation.push(`Carved derivative split ${rule.id} (${childShare} minor units) from parent rule ${parentId}.`);
      }
    }
  }

  const total = lines.reduce((s, line) => s + line.amountMinor, 0);
  if (total !== ctx.revenueMinor) {
    throw new Error(`Settlement invariant failed: ${total} != ${ctx.revenueMinor}`);
  }
  if (recoupmentDeltas.some((delta) => delta.appliedMinor < 0)) {
    throw new Error("Recoupment invariant failed");
  }

  explanation.push(`Settlement reconciles exactly to ${ctx.revenueMinor} minor units.`);
  return { totalMinor: ctx.revenueMinor, lines, recoupmentDeltas, cumulativeDeltas, explanation };
}
