import { allocateLargestRemainder, assertMinorUnits } from "./money.ts";
import type {
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
) {
  if (!ruleMatches(rule, ctx, recoupmentRemaining)) return false;
  for (const modifier of allRules.filter((candidate) =>
    candidate.type === "DATE_RANGE" && modifierTarget(candidate) === rule.id
  )) {
    if (!ruleMatches(modifier, ctx, recoupmentRemaining)) return false;
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
): SettlementResult {
  assertMinorUnits(ctx.revenueMinor, "revenueMinor");
  const sorted = [...rules].sort((a, b) => effectivePriority(a, rules) - effectivePriority(b, rules) || a.id.localeCompare(b.id));
  const recByRule = new Map(recoupments.map((r) => [r.ruleId, { ...r }]));
  const explanation: string[] = [];
  const lines: SettlementLine[] = [];
  const recoupmentDeltas: Array<{ ruleId: string; appliedMinor: number }> = [];
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

  const total = lines.reduce((s, line) => s + line.amountMinor, 0);
  if (total !== ctx.revenueMinor) {
    throw new Error(`Settlement invariant failed: ${total} != ${ctx.revenueMinor}`);
  }
  if (recoupmentDeltas.some((delta) => delta.appliedMinor < 0)) {
    throw new Error("Recoupment invariant failed");
  }

  explanation.push(`Settlement reconciles exactly to ${ctx.revenueMinor} minor units.`);
  return { totalMinor: ctx.revenueMinor, lines, recoupmentDeltas, explanation };
}
