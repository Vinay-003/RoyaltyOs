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
      if (rule.type === "PRIORITY") {
        const priorityValue = rule.config.priorityValue;
        if (priorityValue !== undefined && (!Number.isInteger(priorityValue) || Number(priorityValue) < 0)) {
          issues.push({ code: "INVALID_PRIORITY_VALUE", ruleId: rule.id, message: "PRIORITY priorityValue must be a non-negative integer" });
        }
      }
    }
  }

  const graph = new Map<string, string[]>();
  for (const rule of rules) graph.set(rule.id, rule.dependencies ?? []);
  for (const rule of rules) {
    const targetRuleId = typeof rule.config.targetRuleId === "string" ? rule.config.targetRuleId : null;
    if (targetRuleId && !graph.has(targetRuleId)) {
      issues.push({ code: "MISSING_TARGET_RULE", ruleId: rule.id, message: `Target rule ${targetRuleId} does not exist` });
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
    if (!["PERCENTAGE","RECOUPMENT","REVENUE_CATEGORY","RESERVE"].includes(rule.type)) continue;
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
