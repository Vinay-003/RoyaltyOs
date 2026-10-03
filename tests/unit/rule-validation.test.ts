import test from "node:test";
import assert from "node:assert/strict";
import { validateRuleGraph } from "../../packages/core/rule-validation.ts";
import type { ExecutableRule } from "../../packages/core/types.ts";

const evidence = { sourceDocument: "agreement.pdf", sourceVersion: 1, page: 2, clause: "3.1", sourceText: "Royalty clause", model: "test" };
const rule = (patch: Partial<ExecutableRule> = {}): ExecutableRule => ({
  id: "00000000-0000-4000-8000-000000000001",
  type: "PERCENTAGE",
  beneficiaryKey: "artist",
  base: "NET_REVENUE",
  rateBasisPoints: 6000,
  fixedMinor: null,
  priority: 10,
  conditions: [],
  config: {},
  dependencies: [],
  evidence,
  ...patch,
});

test("rule graph detects cycles and missing dependencies", () => {
  const a = rule({ id: "a", dependencies: ["b"] });
  const b = rule({ id: "b", beneficiaryKey: "producer", dependencies: ["a"] });
  const c = rule({ id: "c", beneficiaryKey: "manager", dependencies: ["missing"] });
  const issues = validateRuleGraph([a, b, c], new Set(["artist","producer","manager"]), "USD");
  assert.ok(issues.some((i) => i.code === "CYCLIC_DEPENDENCY"));
  assert.ok(issues.some((i) => i.code === "MISSING_DEPENDENCY"));
});

test("rule graph rejects over-allocation in the same revenue scope", () => {
  const issues = validateRuleGraph([
    rule({ id: "a", rateBasisPoints: 8000 }),
    rule({ id: "b", beneficiaryKey: "producer", rateBasisPoints: 3000 }),
  ], new Set(["artist","producer"]), "USD");
  assert.ok(issues.some((i) => i.code === "OVERALLOCATED_PERCENTAGES"));
});

test("category-scoped rules are validated independently", () => {
  const issues = validateRuleGraph([
    rule({ id: "video", rateBasisPoints: 8000, config: { category: "VIDEO" } }),
    rule({ id: "audio", beneficiaryKey: "producer", rateBasisPoints: 8000, config: { category: "AUDIO" } }),
  ], new Set(["artist","producer"]), "USD");
  assert.equal(issues.filter((i) => i.code === "OVERALLOCATED_PERCENTAGES").length, 0);
});

test("modifier targets must exist and DATE_RANGE cannot be empty", () => {
  const issues = validateRuleGraph([
    rule({ id: "base" }),
    rule({ id: "date", type: "DATE_RANGE", rateBasisPoints: null, beneficiaryKey: null, config: { targetRuleId: "missing" } }),
  ], new Set(["artist"]), "USD");
  assert.ok(issues.some((i) => i.code === "MISSING_TARGET_RULE"));
  assert.ok(issues.some((i) => i.code === "EMPTY_DATE_RANGE"));
});

test("recoupment pre-rate participates in worst-case percentage validation", () => {
  const issues = validateRuleGraph([
    rule({ id: "artist", rateBasisPoints: 8000 }),
    rule({ id: "producer", type: "RECOUPMENT", beneficiaryKey: "producer", rateBasisPoints: 1000, config: { preRecoupmentBasisPoints: 3000, postRecoupmentBasisPoints: 1000 } }),
  ], new Set(["artist","producer"]), "USD");
  assert.ok(issues.some((i) => i.code === "OVERALLOCATED_PERCENTAGES"));
});
