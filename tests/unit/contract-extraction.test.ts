import test from "node:test";
import assert from "node:assert/strict";
import { extractAdvanceMinor, extractContractWithOpenAI, extractionToCandidates, inferBeneficiaryKey, normalizeBeneficiaryKey } from "../../packages/ai/openai-contract.ts";

test("advance figures resolve to minor units, ambiguous text abstains", () => {
  assert.equal(extractAdvanceMinor("The Producer Advance is USD 2,000. It recoups first."), 200000);
  assert.equal(extractAdvanceMinor("Advance: $2,000.00 payable on signing."), 200000);
  assert.equal(extractAdvanceMinor("No advance is paid under this memo."), null);
  assert.equal(extractAdvanceMinor("Advance USD 2,000, later increased to USD 3,000."), null);
});
import { minimalPdf, minimalPdfPages, testConfig } from "../helpers.ts";

const emptyExtraction = { parties: [], rules: [], warnings: [], conflicts: [] };

function textFetchImpl(replies: string[]) {
  const calls: any[] = [];
  return {
    calls,
    fetch: (async (_url: any, init: any) => {
      calls.push(JSON.parse(init.body));
      const text = replies[Math.min(calls.length - 1, replies.length - 1)];
      return new Response(JSON.stringify({ id: "resp-x", output_text: text }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any,
  };
}

test("fenced or truncated replies parse without a retry", async () => {
  const good = JSON.stringify({ ...emptyExtraction, warnings: ["no financial terms in this memo"] });
  const { calls, fetch } = textFetchImpl([`\`\`\`json\n${good}\n\`\`\``]);
  const out = await extractContractWithOpenAI(
    testConfig(), { filename: "memo.pdf", bytes: minimalPdf("a short memo"), documentVersion: 1 }, fetch,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(out.extraction.warnings, ["no financial terms in this memo"]);
});

test("a 10x advance misread triggers repair with the stated figure", async () => {
  const doc = "Producer Advance is USD 2,000. It recoups from revenue first. " + "Additional campaign terms apply. ".repeat(30);
  const bad = JSON.stringify({
    parties: [{ name: "Producer" }],
    rules: [{
      type: "RECOUPMENT", beneficiary_key: "producer", source_version: 1, source_document: "v1.pdf",
      base: "NET_REVENUE", rate_basis_points: null, fixed_minor: null, priority: 10,
      conditions: [], config: { currency: "USD", advanceMinor: 2000000, preRecoupmentBasisPoints: 2500, postRecoupmentBasisPoints: 2000 },
      dependencies: [], page: 1, clause: "3.1", source_text: "Producer Advance is USD 2,000.", confidence: 0.9, needs_human_review: false,
    }],
    warnings: [], conflicts: [],
  });
  const good = JSON.stringify({
    parties: [{ name: "Producer" }],
    rules: [{
      type: "RECOUPMENT", beneficiary_key: "producer", source_version: 1, source_document: "v1.pdf",
      base: "NET_REVENUE", rate_basis_points: null, fixed_minor: null, priority: 10,
      conditions: [], config: { currency: "USD", advanceMinor: 200000, preRecoupmentBasisPoints: 2500, postRecoupmentBasisPoints: 2000 },
      dependencies: [], page: 1, clause: "3.1", source_text: "Producer Advance is USD 2,000.", confidence: 0.9, needs_human_review: false,
    }],
    warnings: [], conflicts: [],
  });
  const { calls, fetch } = textFetchImpl([bad, good]);
  const out = await extractContractWithOpenAI(
    testConfig(), { filename: "v1.pdf", bytes: minimalPdfPages([doc]), documentVersion: 1 }, fetch,
  );
  assert.equal(calls.length, 2, "wrong advance triggers exactly one repair");
  assert.match(calls[1].instructions, /200000/);
  const recoup = out.extraction.rules.find((r: any) => r.type === "RECOUPMENT");
  assert.equal(recoup!.config.advanceMinor, 200000);
});

test("an unexplained empty reply triggers exactly one repair retry", async () => {
  const bigPages = Array.from({ length: 10 }, (_, i) => `Contract memo page ${i + 1} with revenue sharing discussion and royalty terms.`);
  const honest = JSON.stringify({ ...emptyExtraction, warnings: ["document has no revenue terms"] });
  const { calls, fetch } = textFetchImpl(['{"rules":[]}', honest]);
  const out = await extractContractWithOpenAI(
    testConfig(), { filename: "big.pdf", bytes: minimalPdfPages(bigPages), documentVersion: 1 }, fetch,
  );
  assert.equal(calls.length, 2, "one repair retry");
  assert.match(calls[1].instructions, /rejected|previous reply/i);
  assert.deepEqual(out.extraction.warnings, ["document has no revenue terms"]);
});

test("two consecutive bad replies fail loud with the cause", async () => {
  const { fetch } = textFetchImpl(["not json at all {{{", "still not json }}}"]);
  await assert.rejects(
    () => extractContractWithOpenAI(testConfig(), { filename: "a.pdf", bytes: minimalPdf("terms here"), documentVersion: 1 }, fetch),
    /not valid extraction JSON|Unexpected/i,
  );
});

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
