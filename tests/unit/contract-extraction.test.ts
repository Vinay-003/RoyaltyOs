import test from "node:test";
import assert from "node:assert/strict";
import { extractionToCandidates, inferBeneficiaryKey, normalizeBeneficiaryKey } from "../../packages/ai/openai-contract.ts";

test("model-provided keys are normalized to snake_case", () => {
  assert.equal(normalizeBeneficiaryKey("Artist"), "artist");
  assert.equal(normalizeBeneficiaryKey("Featured Creator"), "featured_creator");
  assert.equal(normalizeBeneficiaryKey("  "), null);
  assert.equal(normalizeBeneficiaryKey(42), null);
});

const parties = [{ name: "Artist", role: null, email: null }, { name: "Featured Creator", role: null, email: null }];

test("party names resolve to snake_case beneficiary keys, longest first", () => {
  assert.equal(inferBeneficiaryKey(parties, "Featured Creator shall receive five percent.", "5.1"), "featured_creator");
  assert.equal(inferBeneficiaryKey(parties, "Artist shall receive sixty percent.", "2.1"), "artist");
  assert.equal(inferBeneficiaryKey(parties, "Campaign settlements are reported.", null), null);
});

test("model-provided beneficiary keys win over inference", () => {
  const candidates = extractionToCandidates({
    extraction: {
      parties,
      rules: [{
        type: "PERCENTAGE", beneficiary_key: "artist", source_version: 1, source_document: "v1.pdf",
        base: "NET_REVENUE", rate_basis_points: 6000, fixed_minor: null, priority: 10,
        conditions: [], config: {}, dependencies: [], page: 2, clause: "2.1",
        source_text: "Artist shall receive sixty percent.", confidence: 0.9, needs_human_review: false,
      }],
      warnings: [], conflicts: [],
    },
    analysisId: "a1",
    documentTitle: "Demo",
    documentVersion: 1,
    model: "test",
    idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  assert.equal(candidates[0]!.beneficiaryKey, "artist");
});

test("null model keys fall back to party inference, payee-less rules stay null", () => {
  const candidates = extractionToCandidates({
    extraction: {
      parties,
      rules: [
        {
          type: "PERCENTAGE", beneficiary_key: null, source_version: 1, source_document: "v1.pdf",
          base: "NET_REVENUE", rate_basis_points: 500, fixed_minor: null, priority: 40,
          conditions: [], config: { category: "VIDEO" }, dependencies: [], page: 5, clause: "5.1",
          source_text: "Featured Creator shall receive five percent of VIDEO revenue.", confidence: 0.9, needs_human_review: false,
        },
        {
          type: "RESERVE", beneficiary_key: null, source_version: 1, source_document: "v1.pdf",
          base: "REMAINDER", rate_basis_points: null, fixed_minor: null, priority: 100,
          conditions: [], config: {}, dependencies: [], page: null, clause: null,
          source_text: "Remainder is held in reserve.", confidence: 0.9, needs_human_review: false,
        },
      ],
      warnings: [], conflicts: [],
    },
    analysisId: "a1",
    documentTitle: "Demo",
    documentVersion: 1,
    model: "test",
    idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  assert.equal(candidates[0]!.beneficiaryKey, "featured_creator");
  assert.equal(candidates[1]!.beneficiaryKey, null);
});
