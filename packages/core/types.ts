export const RULE_TYPES = [
  "PERCENTAGE",
  "FIXED_AMOUNT",
  "RECOUPMENT",
  "CAP",
  "FLOOR",
  "EXCLUSION",
  "RESERVE",
  "PRIORITY",
  "THRESHOLD",
  "DATE_RANGE",
  "REVENUE_CATEGORY",
  "TIERED_CUMULATIVE",
  "DERIVATIVE_SPLIT",
  "COMPOSITE_CONDITION",
  "FORMULA",
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

export type WorkspaceRole =
  | "OWNER"
  | "CONTRACT_MANAGER"
  | "FINANCE_APPROVER"
  | "CONTRIBUTOR"
  | "AUDITOR";

export type TierDefinition = {
  tierIndex: number;
  thresholdMinor: number | null; // null = infinity (final tier)
  rateBasisPoints: number;
  label?: string | null;
};

export type TieredCumulativeConfig = {
  beneficiaryKey: string;
  basis?: "GROSS_REVENUE" | "NET_REVENUE" | "BENEFICIARY_EARNINGS";
  tiers: TierDefinition[];
  mode?: "MARGINAL" | "RETROACTIVE";
  resetPeriod?: "NEVER" | "ANNUAL" | "QUARTERLY" | "MONTHLY";
};

export type CumulativeState = {
  ruleId: string;
  beneficiaryKey: string;
  cumulativeRevenueMinor: number;
  cumulativeEarningsMinor: number;
  periodAnchor?: string | null;
};

export type CandidateRule = {
  id: string;
  type: RuleType | "UNSUPPORTED";
  beneficiaryKey: string | null;
  base: "GROSS_REVENUE" | "NET_REVENUE" | "REMAINDER" | "PARENT_RULE";
  rateBasisPoints: number | null;
  fixedMinor: number | null;
  priority: number;
  conditions: RuleCondition[];
  config: Record<string, unknown>;
  dependencies: string[];
  evidence: RuleEvidence;
  confidence: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REVIEW_REQUIRED";
};

export type RuleCondition = {
  field:
    | "revenue_category"
    | "currency"
    | "occurred_at"
    | "recoupment_remaining"
    | "revenue_minor"
    | "cumulative_earnings_minor"
    | "cumulative_revenue_minor";
  operator: "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE" | "IN" | "BETWEEN";
  value: string | number | Array<string | number>;
};

export type RuleEvidence = {
  sourceDocument: string;
  sourceVersion: number;
  page: number | null;
  clause: string | null;
  sourceText: string;
  model: string;
};

export type ExecutableRule = {
  id: string;
  type: RuleType;
  beneficiaryKey: string | null;
  base: "GROSS_REVENUE" | "NET_REVENUE" | "REMAINDER" | "PARENT_RULE";
  rateBasisPoints: number | null;
  fixedMinor: number | null;
  priority: number;
  conditions: RuleCondition[];
  config: Record<string, unknown>;
  dependencies: string[];
  evidence: RuleEvidence;
};

export type RevenueContext = {
  revenueMinor: number;
  currency: string;
  category: string | null;
  occurredAt: string;
};

export type RecoupmentState = {
  ruleId: string;
  beneficiaryKey: string;
  remainingMinor: number;
  originalMinor: number;
  recoupedMinor: number;
  currency: string;
};

export type SettlementLine = {
  key: string;
  beneficiaryKey: string;
  ruleId: string | null;
  amountMinor: number;
  payableMinor: number;
  kind: "PAYABLE" | "RECOUPMENT" | "RESERVE" | "EXCLUSION" | "FIXED";
  metadata: Record<string, unknown>;
};

export type SettlementResult = {
  totalMinor: number;
  lines: SettlementLine[];
  recoupmentDeltas: Array<{ ruleId: string; appliedMinor: number }>;
  cumulativeDeltas?: Array<{
    ruleId: string;
    beneficiaryKey: string;
    appliedEarningsMinor: number;
    appliedRevenueMinor: number;
  }>;
  explanation: string[];
};
