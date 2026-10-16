export function assertMinorUnits(value: number, label = "amount") {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer in minor units`);
  }
}

export function sumMinor(values: number[]) {
  return values.reduce((a, b) => {
    assertMinorUnits(b);
    const next = a + b;
    if (!Number.isSafeInteger(next)) throw new Error("minor-unit sum overflow");
    return next;
  }, 0);
}

export function allocateLargestRemainder(
  totalMinor: number,
  weights: Array<{ key: string; weight: number }>,
): Array<{ key: string; amountMinor: number }> {
  assertMinorUnits(totalMinor, "totalMinor");
  if (!weights.length) return [];
  for (const row of weights) {
    if (!Number.isSafeInteger(row.weight) || row.weight < 0) {
      throw new Error(`Invalid weight for ${row.key}`);
    }
  }
  const weightSum = weights.reduce((s, row) => s + row.weight, 0);
  if (weightSum <= 0) {
    return weights.map((row) => ({ key: row.key, amountMinor: 0 }));
  }
  const raw = weights.map((row, index) => {
    const numerator = totalMinor * row.weight;
    const floored = Math.floor(numerator / weightSum);
    const remainder = numerator - floored * weightSum;
    return { ...row, index, floored, remainder };
  });
  let leftover = totalMinor - raw.reduce((s, row) => s + row.floored, 0);
  const order = [...raw].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const bonus = new Map<string, number>();
  for (let i = 0; i < leftover; i++) {
    const row = order[i % order.length]!;
    bonus.set(row.key, (bonus.get(row.key) ?? 0) + 1);
  }
  return raw.map((row) => ({
    key: row.key,
    amountMinor: row.floored + (bonus.get(row.key) ?? 0),
  }));
}

export type TrancheAllocation = {
  tierIndex: number;
  rateBasisPoints: number;
  applicableRevenueMinor: number;
  allocatedMinor: number;
  label: string | null;
};

export function allocateTieredTranches(
  eventRevenueMinor: number,
  priorCumulativeMinor: number,
  tiers: Array<{ tierIndex: number; thresholdMinor: number | null; rateBasisPoints: number; label?: string | null }>,
  basis: "REVENUE" | "EARNINGS" = "REVENUE",
): TrancheAllocation[] {
  assertMinorUnits(eventRevenueMinor, "eventRevenueMinor");
  assertMinorUnits(priorCumulativeMinor, "priorCumulativeMinor");
  if (!tiers.length || eventRevenueMinor <= 0) return [];

  const sortedTiers = [...tiers].sort((a, b) => {
    if (a.thresholdMinor === null) return 1;
    if (b.thresholdMinor === null) return -1;
    return a.thresholdMinor - b.thresholdMinor;
  });

  let remainingRevenue = eventRevenueMinor;
  let currentCumulative = priorCumulativeMinor;
  const allocations: TrancheAllocation[] = [];

  for (const tier of sortedTiers) {
    if (remainingRevenue <= 0) break;
    const ceiling = tier.thresholdMinor ?? Number.MAX_SAFE_INTEGER;

    if (currentCumulative >= ceiling) {
      continue;
    }

    if (basis === "EARNINGS") {
      const earningsCapacity = ceiling - currentCumulative;
      if (tier.rateBasisPoints <= 0) {
        allocations.push({
          tierIndex: tier.tierIndex,
          rateBasisPoints: 0,
          applicableRevenueMinor: remainingRevenue,
          allocatedMinor: 0,
          label: tier.label ?? null,
        });
        remainingRevenue = 0;
        break;
      }
      const revenueNeeded = Math.ceil((earningsCapacity * 10000) / tier.rateBasisPoints);
      const applicable = Math.min(remainingRevenue, revenueNeeded);
      const allocated = Math.min(earningsCapacity, Math.floor((applicable * tier.rateBasisPoints) / 10000));

      allocations.push({
        tierIndex: tier.tierIndex,
        rateBasisPoints: tier.rateBasisPoints,
        applicableRevenueMinor: applicable,
        allocatedMinor: allocated,
        label: tier.label ?? null,
      });

      remainingRevenue -= applicable;
      currentCumulative += allocated;
    } else {
      const revenueCapacity = ceiling - currentCumulative;
      const applicable = Math.min(remainingRevenue, revenueCapacity);
      const allocated = Math.floor((applicable * tier.rateBasisPoints) / 10000);

      allocations.push({
        tierIndex: tier.tierIndex,
        rateBasisPoints: tier.rateBasisPoints,
        applicableRevenueMinor: applicable,
        allocatedMinor: allocated,
        label: tier.label ?? null,
      });

      remainingRevenue -= applicable;
      currentCumulative += applicable;
    }
  }

  return allocations;
}

