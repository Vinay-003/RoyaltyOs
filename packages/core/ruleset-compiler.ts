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
