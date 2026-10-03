import test from "node:test";
import assert from "node:assert/strict";
import { compileRuleset } from "../../packages/core/ruleset-compiler.ts";
import type { CandidateRule } from "../../packages/core/types.ts";

const base: CandidateRule = {
  id: "10000000-0000-4000-8000-000000000001",
  type: "PERCENTAGE",
  beneficiaryKey: "artist",
  base: "NET_REVENUE",
  rateBasisPoints: 6000,
  fixedMinor: null,
  priority: 10,
  conditions: [],
  config: {},
  dependencies: [],
  evidence: { sourceDocument: "agreement.pdf", sourceVersion: 1, page: 1, clause: "2", sourceText: "Artist receives 60%", model: "test" },
  confidence: 0.99,
  status: "APPROVED",
};

test("compiler refuses unresolved candidates", () => {
  assert.throws(() => compileRuleset({ candidates: [{...base,status:"REVIEW_REQUIRED"}], beneficiaryKeys:new Set(["artist"]),currency:"USD",contractVersionId:"cv1",nextVersion:1 }), /remain unresolved/);
});

test("compiler produces deterministic immutable hash for same canonical input", () => {
  const input = { candidates:[base],beneficiaryKeys:new Set(["artist"]),currency:"USD",contractVersionId:"cv1",nextVersion:1 };
  const a = compileRuleset(input);
  const b = compileRuleset(input);
  assert.equal(a.rulesetHash, b.rulesetHash);
  assert.match(a.rulesetHash, /^[a-f0-9]{64}$/);
});
