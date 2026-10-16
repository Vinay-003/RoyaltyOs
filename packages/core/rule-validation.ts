import { RULE_TYPES, type ExecutableRule } from "./types.ts";

export type RuleValidationIssue = {
  code: string;
  ruleId: string | null;
  message: string;
};

export function validateRuleGraph(
  rules: ExecutableRule[],
  beneficiaryKeys: Set<string>,
  currency: string,
): RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];
  const ids = new Set<string>();
  const allowed = new Set<string>(RULE_TYPES);

  for (const rule of rules) {
    if (ids.has(rule.id)) {
      issues.push({ code: "DUPLICATE_RULE_ID", ruleId: rule.id, message: "Rule IDs must be unique" });
    }
    ids.add(rule.id);
    if (!allowed.has(rule.type)) {
      issues.push({ code: "UNSUPPORTED_RULE_TYPE", ruleId: rule.id, message: `Unsupported rule type ${rule.type}` });
    }
    if (rule.rateBasisPoints !== null && (!Number.isInteger(rule.rateBasisPoints) || rule.rateBasisPoints < 0 || rule.rateBasisPoints > 10000)) {
      issues.push({ code: "INVALID_RATE", ruleId: rule.id, message: "Rate must be an integer from 0 to 10000 basis points" });
    }
    if (rule.fixedMinor !== null && (!Number.isSafeInteger(rule.fixedMinor) || rule.fixedMinor < 0)) {
      issues.push({ code: "INVALID_FIXED_AMOUNT", ruleId: rule.id, message: "Fixed amount must be non-negative minor units" });
    }
    if (rule.beneficiaryKey && !beneficiaryKeys.has(rule.beneficiaryKey) && !["RESERVE", "EXCLUSION"].includes(rule.type)) {
      issues.push({ code: "UNKNOWN_BENEFICIARY", ruleId: rule.id, message: `Beneficiary ${rule.beneficiaryKey} does not exist` });
    }
    if (!rule.evidence.sourceDocument || !rule.evidence.sourceText || rule.evidence.sourceVersion < 1) {
      issues.push({ code: "MISSING_EVIDENCE", ruleId: rule.id, message: "Every financial rule requires source document/version/text evidence" });
    }
    const configuredCurrency = typeof rule.config.currency === "string" ? rule.config.currency : null;
    if (configuredCurrency && configuredCurrency !== currency) {
      issues.push({ code: "CURRENCY_MISMATCH", ruleId: rule.id, message: `Rule currency ${configuredCurrency} does not match project currency ${currency}` });
    }
    const start = typeof rule.config.startDate === "string" ? Date.parse(rule.config.startDate) : null;
    const end = typeof rule.config.endDate === "string" ? Date.parse(rule.config.endDate) : null;
    if (start !== null && !Number.isFinite(start)) {
      issues.push({ code: "INVALID_START_DATE", ruleId: rule.id, message: "Rule start date is invalid" });
    }
    if (end !== null && !Number.isFinite(end)) {
      issues.push({ code: "INVALID_END_DATE", ruleId: rule.id, message: "Rule end date is invalid" });
    }
    if (start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && start > end) {
      issues.push({ code: "INVALID_DATE_RANGE", ruleId: rule.id, message: "Rule start date is after end date" });
    }

    if (["CAP","FLOOR","THRESHOLD","DATE_RANGE","PRIORITY"].includes(rule.type)) {
      const targetRuleId = typeof rule.config.targetRuleId === "string" ? rule.config.targetRuleId : null;
      if (targetRuleId && targetRuleId === rule.id) {
        issues.push({ code: "SELF_TARGETING_MODIFIER", ruleId: rule.id, message: "A modifier cannot target itself" });
      }
      if (rule.type === "DATE_RANGE" && !start && !end) {
        issues.push({ code: "EMPTY_DATE_RANGE", ruleId: rule.id, message: "DATE_RANGE requires startDate and/or endDate" });
      }
      if (rule.type === "THRESHOLD") {
        const mode = typeof rule.config.mode === "string" ? rule.config.mode : null;
        if (mode && !["MIN_REVENUE", "MIN_PAYOUT"].includes(mode)) {
          issues.push({ code: "INVALID_THRESHOLD_MODE", ruleId: rule.id, message: `Invalid threshold mode ${mode}` });
        }
      }
      if (rule.type === "PRIORITY") {
        const priorityValue = rule.config.priorityValue;
        if (priorityValue !== undefined && (!Number.isInteger(priorityValue) || Number(priorityValue) < 0)) {
          issues.push({ code: "INVALID_PRIORITY_VALUE", ruleId: rule.id, message: "PRIORITY priorityValue must be a non-negative integer" });
        }
      }
    }

    if (rule.type === "TIERED_CUMULATIVE") {
      const tiers = Array.isArray(rule.config.tiers) ? (rule.config.tiers as any[]) : null;
      if (!tiers || tiers.length === 0) {
        issues.push({ code: "MISSING_TIERS", ruleId: rule.id, message: "TIERED_CUMULATIVE requires a non-empty tiers array" });
      } else {
        let lastThreshold: number | null = -1;
        for (let i = 0; i < tiers.length; i++) {
          const t = tiers[i];
          const rate = t.rateBasisPoints;
          if (!Number.isInteger(rate) || rate < 0 || rate > 10000) {
            issues.push({ code: "INVALID_TIER_RATE", ruleId: rule.id, message: `Tier ${i} rate must be integer between 0 and 10000 basis points` });
          }
          const thresh = t.thresholdMinor;
          if (thresh !== null && (!Number.isSafeInteger(thresh) || thresh < 0)) {
            issues.push({ code: "INVALID_TIER_THRESHOLD", ruleId: rule.id, message: `Tier ${i} threshold must be a non-negative safe integer or null` });
          }
          if (lastThreshold !== null) {
            if (thresh === null) {
              lastThreshold = null; // final tier with infinity
            } else if (thresh <= lastThreshold) {
              issues.push({ code: "NON_MONOTONIC_TIERS", ruleId: rule.id, message: `Tier ${i} threshold (${thresh}) must be greater than previous tier threshold (${lastThreshold})` });
            } else {
              lastThreshold = thresh;
            }
          } else if (thresh !== null) {
            issues.push({ code: "NON_MONOTONIC_TIERS", ruleId: rule.id, message: `Tier ${i} threshold cannot follow a final open-ended tier` });
          }
        }
      }
    }

    if (rule.base === "PARENT_RULE") {
      const parentRuleId = typeof rule.config.parentRuleId === "string" ? rule.config.parentRuleId : null;
      if (!parentRuleId) {
        issues.push({ code: "MISSING_PARENT_RULE", ruleId: rule.id, message: "Rule with base PARENT_RULE must specify config.parentRuleId" });
      }
    }
  }

  // Check for CAP < FLOOR conflict on the same target or beneficiary
  const caps = rules.filter((r) => r.type === "CAP");
  const floors = rules.filter((r) => r.type === "FLOOR");
  for (const cap of caps) {
    const capVal = cap.fixedMinor ?? (typeof cap.config.capMinor === "number" ? cap.config.capMinor : null);
    if (capVal === null) continue;
    const capTarget = (typeof cap.config.targetRuleId === "string" ? cap.config.targetRuleId : null) ?? cap.beneficiaryKey;
    for (const floor of floors) {
      const floorTarget = (typeof floor.config.targetRuleId === "string" ? floor.config.targetRuleId : null) ?? floor.beneficiaryKey;
      if (capTarget && floorTarget && capTarget === floorTarget) {
        const floorVal = floor.fixedMinor ?? (typeof floor.config.floorMinor === "number" ? floor.config.floorMinor : null);
        if (floorVal !== null && capVal < floorVal) {
          issues.push({
            code: "CAP_EXCEEDED_BY_FLOOR",
            ruleId: cap.id,
            message: `Cap (${capVal}) is strictly less than Floor (${floorVal}) for target ${capTarget}`,
          });
        }
      }
    }
  }

  const graph = new Map<string, string[]>();
  for (const rule of rules) {
    const deps = [...(rule.dependencies ?? [])];
    const targetRuleId = typeof rule.config.targetRuleId === "string" ? rule.config.targetRuleId : null;
    if (targetRuleId && !deps.includes(targetRuleId)) deps.push(targetRuleId);
    const parentRuleId = typeof rule.config.parentRuleId === "string" ? rule.config.parentRuleId : null;
    if (parentRuleId && !deps.includes(parentRuleId)) deps.push(parentRuleId);
    graph.set(rule.id, deps);
  }
  for (const rule of rules) {
    const targetRuleId = typeof rule.config.targetRuleId === "string" ? rule.config.targetRuleId : null;
    if (targetRuleId && !rules.some((r) => r.id === targetRuleId)) {
      issues.push({ code: "MISSING_TARGET_RULE", ruleId: rule.id, message: `Target rule ${targetRuleId} does not exist` });
    }
    const parentRuleId = typeof rule.config.parentRuleId === "string" ? rule.config.parentRuleId : null;
    if (parentRuleId && !rules.some((r) => r.id === parentRuleId)) {
      issues.push({ code: "MISSING_PARENT_RULE", ruleId: rule.id, message: `Parent rule ${parentRuleId} does not exist` });
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: string[]) => {
    if (visiting.has(id)) {
      issues.push({ code: "CYCLIC_DEPENDENCY", ruleId: id, message: `Cycle detected: ${[...trail, id].join(" -> ")}` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) {
      if (!graph.has(dep)) {
        issues.push({ code: "MISSING_DEPENDENCY", ruleId: id, message: `Dependency ${dep} does not exist` });
      } else {
        visit(dep, [...trail, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) visit(id, []);

  const percentageByScope = new Map<string, number>();
  for (const rule of rules) {
    if (!["PERCENTAGE","RECOUPMENT","REVENUE_CATEGORY","RESERVE","TIERED_CUMULATIVE"].includes(rule.type)) continue;
    const category = typeof rule.config.category === "string" ? rule.config.category : "*";
    const key = `${rule.base}:${category}`;
    const candidates: number[] = [];
    if (rule.rateBasisPoints !== null) candidates.push(rule.rateBasisPoints);
    if (rule.type === "RECOUPMENT") {
      const pre = Number(rule.config.preRecoupmentBasisPoints);
      const post = Number(rule.config.postRecoupmentBasisPoints);
      if (Number.isInteger(pre) && pre >= 0 && pre <= 10000) candidates.push(pre);
      if (Number.isInteger(post) && post >= 0 && post <= 10000) candidates.push(post);
    }
    if (rule.type === "TIERED_CUMULATIVE" && Array.isArray(rule.config.tiers)) {
      for (const t of rule.config.tiers as any[]) {
        if (Number.isInteger(t?.rateBasisPoints) && t.rateBasisPoints >= 0 && t.rateBasisPoints <= 10000) {
          candidates.push(t.rateBasisPoints);
        }
      }
    }
    const effectiveMax = candidates.length ? Math.max(...candidates) : 0;
    percentageByScope.set(key, (percentageByScope.get(key) ?? 0) + effectiveMax);
  }
  for (const [scope, total] of percentageByScope) {
    if (total > 10000) {
      issues.push({ code: "OVERALLOCATED_PERCENTAGES", ruleId: null, message: `Percentage rules exceed 100% for scope ${scope}` });
    }
  }
  return issues;
}
