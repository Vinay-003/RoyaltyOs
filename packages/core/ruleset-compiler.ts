import { hashCanonical } from "./hash.ts";
import { validateRuleGraph } from "./rule-validation.ts";
import type { CandidateRule, ExecutableRule } from "./types.ts";

export function compileRuleset(input: {
  candidates: CandidateRule[];
  beneficiaryKeys: Set<string>;
  currency: string;
  contractVersionId: string;
  nextVersion: number;
}) {
  const unresolved = input.candidates.filter((r) => r.status === "PENDING" || r.status === "REVIEW_REQUIRED");
  if (unresolved.length) {
    throw new Error(`Cannot activate RuleSet: ${unresolved.length} candidate rule(s) remain unresolved`);
  }
  const approved = input.candidates.filter((r) => r.status === "APPROVED");
  if (!approved.length) throw new Error("Cannot activate an empty RuleSet");
  const rules: ExecutableRule[] = approved.map((candidate) => {
    if (candidate.type === "UNSUPPORTED") throw new Error(`Unsupported rule ${candidate.id} cannot compile`);
    return {
      id: candidate.id,
      type: candidate.type,
      beneficiaryKey: candidate.beneficiaryKey,
      base: candidate.base,
      rateBasisPoints: candidate.rateBasisPoints,
      fixedMinor: candidate.fixedMinor,
      priority: candidate.priority,
      conditions: candidate.conditions,
      config: candidate.config,
      dependencies: candidate.dependencies,
      evidence: candidate.evidence,
    };
  });
  // Waterfall Normalization: If senior deduction rules (RESERVE, RECOUPMENT) exist alongside
  // downstream payee percentage/tiered rules with higher priority, and keeping all on NET_REVENUE
  // causes percentage overallocation (>100%), the downstream payee rules represent the residual
  // pool (REMAINDER) rather than unconstrained concurrent draws from the top of the waterfall.
  const hasSeniorDeductions = rules.some((r) => r.type === "RESERVE" || r.type === "RECOUPMENT");
  if (hasSeniorDeductions) {
    const minSeniorPriority = Math.min(
      ...rules.filter((r) => r.type === "RESERVE" || r.type === "RECOUPMENT").map((r) => r.priority),
    );
    const initialIssues = validateRuleGraph(rules, input.beneficiaryKeys, input.currency);
    const hasOverallocation = initialIssues.some((i) => i.code === "OVERALLOCATED_PERCENTAGES" && i.message.includes("NET_REVENUE"));
    if (hasOverallocation) {
      for (const rule of rules) {
        if (rule.priority > minSeniorPriority && (rule.type === "TIERED_CUMULATIVE" || rule.type === "PERCENTAGE") && rule.base === "NET_REVENUE") {
          rule.base = "REMAINDER";
        }
      }
    }
  }
  const issues = validateRuleGraph(rules, input.beneficiaryKeys, input.currency);
  if (issues.length) {
    throw new Error(`RuleSet validation failed: ${issues.map((i) => `${i.code}:${i.message}`).join("; ")}`);
  }
  const canonical = {
    contractVersionId: input.contractVersionId,
    version: input.nextVersion,
    rules: [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)),
  };
  return {
    version: input.nextVersion,
    rules,
    rulesetHash: hashCanonical(canonical),
    canonical,
  };
}
