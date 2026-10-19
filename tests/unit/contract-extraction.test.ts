import test from "node:test";
import assert from "node:assert/strict";
import { extractAdvanceMinor, extractContractWithOpenAI, extractionToCandidates, inferBeneficiaryKey, normalizeBeneficiaryKey, normalizeRateBasisPoints, normalizeFixedMinor, normalizeTiers } from "../../packages/ai/openai-contract.ts";
import { assertVisionSemantics } from "../../packages/ai/vision-contract.ts";

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

test("apinex is selected as priority 1 provider with deepseek pro model", async () => {
  const requestedUrls: string[] = [];
  const requestedModels: string[] = [];
  const userAgents: string[] = [];

  const mockFetch = (async (url: any, init: any) => {
    requestedUrls.push(String(url));
    const body = JSON.parse(init.body);
    requestedModels.push(body.model);
    userAgents.push(init.headers?.["User-Agent"] ?? "");
    const reply = JSON.stringify({
      parties: [{ name: "Producer", role: "producer", email: null }],
      rules: [{
        type: "PERCENTAGE", beneficiary_key: "producer", source_version: 1, source_document: "test.pdf",
        base: "NET_REVENUE", rate_basis_points: 1500, fixed_minor: null, priority: 10,
        conditions: [], config: {}, dependencies: [], page: 1, clause: "1", source_text: "15% royalty",
        confidence: 0.95, needs_human_review: false,
      }],
      warnings: [], conflicts: [],
    });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;

  const cfg = testConfig({
    APINEX_API_KEY: "sk-apx-test",
    GROQ_API_KEY: "gsk-test",
  });

  const res = await extractContractWithOpenAI(
    cfg,
    { filename: "test.pdf", bytes: minimalPdf("Producer gets 15% royalty on net receipts."), documentVersion: 1 },
    mockFetch,
  );

  assert.equal(requestedUrls[0], "https://apinex.bond/v1/chat/completions");
  assert.equal(requestedModels[0], "free/deepseek-v4-pro-0813");
  assert.equal(userAgents[0], "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
  assert.equal(res.extraction.rules.length, 1);
  assert.equal(res.model, "free/deepseek-v4-pro-0813");
});

test("when apinex and groq fail or return 413, fallback cascades to NVIDIA NIM without repair loops", async () => {
  const attempts: Array<{ url: string; model: string }> = [];

  const mockFetch = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    attempts.push({ url: String(url), model: body.model });

    // Apinex primary 500
    if (body.model === "free/deepseek-v4-pro-0813") {
      return new Response(JSON.stringify({ error: "server error" }), { status: 500 });
    }
    // Apinex fallback 500
    if (body.model === "free/qwen-3.8-max") {
      return new Response(JSON.stringify({ error: "gateway error" }), { status: 502 });
    }
    // Groq 413 payload too large (tokens per minute exceeded)
    if (body.model === "openai/gpt-oss-120b" || body.model === "qwen/qwen3.8-27b") {
      return new Response(JSON.stringify({ error: { message: "Request too large" } }), { status: 413 });
    }
    // NVIDIA NIM succeeds with markdown and trailing prose
    if (body.model === "meta/llama-3.2-11b-vision-instruct") {
      const validJson = JSON.stringify({
        parties: [{ name: "Artist", role: "artist", email: null }],
        rules: [{
          type: "PERCENTAGE", beneficiary_key: "artist", source_version: 1, source_document: "test.pdf",
          base: "NET_REVENUE", rate_basis_points: 2000, fixed_minor: null, priority: 10,
          conditions: [], config: {}, dependencies: [], page: 1, clause: "2", source_text: "20% net",
          confidence: 0.9, needs_human_review: false,
        }],
        warnings: [], conflicts: [],
      });
      const proseWrapped = `Here is the extracted contract:\n\`\`\`json\n${validJson}\n\`\`\`\nHope this helps!`;
      return new Response(JSON.stringify({ choices: [{ message: { content: proseWrapped } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unexpected" }), { status: 400 });
  }) as any;

  const cfg = testConfig({
    APINEX_API_KEY: "sk-apx-test",
    GROQ_API_KEY: "gsk-test",
    NVIDIA_API_KEY: "nvapi-test",
  });

  const res = await extractContractWithOpenAI(
    cfg,
    { filename: "test.pdf", bytes: minimalPdf("Artist gets 20% of net."), documentVersion: 1 },
    mockFetch,
  );

  // Assert cascade order: Apinex (free/deepseek-v4-pro-0813) -> Apinex Fallback (free/qwen-3.8-max) -> Groq -> Groq Fallback -> NVIDIA NIM
  assert.equal(attempts.length, 5);
  assert.equal(attempts[0]!.model, "free/deepseek-v4-pro-0813");
  assert.equal(attempts[1]!.model, "free/qwen-3.8-max");
  assert.equal(attempts[2]!.model, "openai/gpt-oss-120b");
  assert.equal(attempts[3]!.model, "qwen/qwen3.8-27b");
  assert.equal(attempts[4]!.model, "meta/llama-3.2-11b-vision-instruct");
  assert.equal(res.model, "meta/llama-3.2-11b-vision-instruct");
  assert.equal(res.extraction.rules.length, 1);
  assert.equal(res.extraction.rules[0]!.beneficiary_key, "artist");

});

test("normalizeRateBasisPoints sanitizes all model outputs to strictly [0, 10000] bps", () => {
  assert.equal(normalizeRateBasisPoints(null), null);
  assert.equal(normalizeRateBasisPoints(undefined), null);
  assert.equal(normalizeRateBasisPoints(0), 0);
  assert.equal(normalizeRateBasisPoints(0.15), 1500);
  assert.equal(normalizeRateBasisPoints(0.08), 800);
  assert.equal(normalizeRateBasisPoints("15%"), 1500);
  assert.equal(normalizeRateBasisPoints("20"), 2000);
  assert.equal(normalizeRateBasisPoints(2000), 2000);
  assert.equal(normalizeRateBasisPoints(10000), 10000);
  // Extra zero scaling: 20000 -> 2000, 60000 -> 6000
  assert.equal(normalizeRateBasisPoints(20000), 2000);
  assert.equal(normalizeRateBasisPoints(60000), 6000);
  // Out of range (money / large numbers / negatives) safely return null to satisfy Postgres check constraint
  assert.equal(normalizeRateBasisPoints(250000000), null);
  assert.equal(normalizeRateBasisPoints(3000000), null);
  assert.equal(normalizeRateBasisPoints(-500), null);
});

test("extractionToCandidates prevents candidate_rules_rate_basis_points_check violations", () => {
  const candidates = extractionToCandidates({
    extraction: {
      parties: [{ name: "Producer", role: "producer", email: null }],
      rules: [
        {
          type: "PERCENTAGE",
          beneficiary_key: "producer",
          rate_basis_points: 60000, // extra zero from model
          source_text: "Producer gets 60%",
        },
        {
          type: "FIXED_AMOUNT",
          beneficiary_key: "producer",
          rate_basis_points: 250000000, // model confused fixed amount ($2,500,000) into rate_basis_points
          source_text: "Producer fee is $2,500,000",
        },
        {
          type: "RESERVE",
          beneficiary_key: "reserve",
          rate_basis_points: -100, // negative value
          source_text: "Reserve holdback",
        },
      ],
      warnings: [],
      conflicts: [],
    },
    analysisId: "a1",
    documentTitle: "test.pdf",
    documentVersion: 1,
    model: "test-model",
    idFactory: (() => { let n = 0; return () => `c-${++n}`; })(),
  });

  // Rule 0: 60000 was scaled to 6000
  assert.equal(candidates[0]!.rateBasisPoints, 6000);
  // Rule 1: 250000000 was rejected as rate and recovered into fixedMinor
  assert.equal(candidates[1]!.rateBasisPoints, null);
  assert.equal(candidates[1]!.fixedMinor, 250000000);
  // Rule 2: -100 was rejected as rate
  assert.equal(candidates[2]!.rateBasisPoints, null);

  // Assert every single candidate satisfies the Postgres check constraint: null or 0..10000
  for (const c of candidates) {
    if (c.rateBasisPoints !== null) {
      assert.ok(c.rateBasisPoints >= 0 && c.rateBasisPoints <= 10000, `Rate ${c.rateBasisPoints} must be between 0 and 10000`);
    }
  }
});

test("assertVisionSemantics rejects empty rules with synthetic fixture excuse warnings and triggers repair", () => {
  // If rules is empty and warning is a synthetic fixture excuse, it must throw to force repair
  assert.throws(
    () => {
      assertVisionSemantics(
        {
          rules: [],
          warnings: ["Document is a SYNTHETIC TEST FIXTURE labeled 'NOT FOR EXECUTION' with fictional test data; no operative financial terms extracted."],
        },
        5000,
      );
    },
    /reply returned zero candidate rules/,
  );
});

test("extractionToCandidates maps field aliases (payee, rule_type, amount, basis)", () => {
  const candidates = extractionToCandidates({
    extraction: {
      parties: [{ name: "Producer", role: "producer", email: null }],
      rules: [
        {
          rule_type: "RESERVE",
          payee: "reserve",
          rate: 800,
          source_text: "Reserve holdback 8%",
          basis: "REMAINDER",
        },
        {
          ruleType: "FIXED_AMOUNT",
          recipient: "producer",
          amount: 500000,
          source_text: "Producer bonus $5,000",
        },
      ],
      warnings: [],
      conflicts: [],
    },
    analysisId: "a2",
    documentTitle: "alias-test.pdf",
    documentVersion: 1,
    model: "test-model",
    idFactory: (() => { let n = 0; return () => `c-${++n}`; })(),
  });

  assert.equal(candidates[0]!.type, "RESERVE");
  assert.equal(candidates[0]!.beneficiaryKey, "reserve");
  assert.equal(candidates[0]!.rateBasisPoints, 800);
  assert.equal(candidates[0]!.base, "REMAINDER");

  assert.equal(candidates[1]!.type, "FIXED_AMOUNT");
  assert.equal(candidates[1]!.beneficiaryKey, "producer");
  assert.equal(candidates[1]!.fixedMinor, 500000);
});

test("extractionToCandidates drops pipeline formulas, administrative deadlines, and duplicate threshold tiers", () => {
  const candidates = extractionToCandidates({
    extraction: {
      parties: [
        { name: "Artist", role: "artist", email: null },
        { name: "Producer", role: "producer", email: null },
      ],
      rules: [
        // 1. Real tiered cumulative rule
        {
          type: "TIERED_CUMULATIVE",
          beneficiary_key: "artist",
          rate_basis_points: 4600,
          config: {
            tiers: [
              { thresholdMinor: 0, rateBasisPoints: 4600, label: "tier1" },
              { thresholdMinor: 25000000, rateBasisPoints: 5000, label: "tier2" },
              { thresholdMinor: 75000000, rateBasisPoints: 5400, label: "tier3" },
            ],
          },
          source_text: "Artist tiers 46% up to $250k, 50% up to $750k, 54% thereafter",
        },
        // 2. Redundant duplicate threshold cards (matching rules 15 & 19)
        {
          type: "THRESHOLD",
          beneficiary_key: "artist",
          rate_basis_points: 5000,
          source_text: "B_t = $0 and $250,000 <= C_t < $750,000: Artist 50%",
        },
        {
          type: "THRESHOLD",
          beneficiary_key: "artist",
          rate_basis_points: 5400,
          source_text: "B_t = $0 and C_t >= $750,000: Artist 54%",
        },
        // 3. Pipeline algebra rules (matching rules 25-28)
        {
          type: "UNSUPPORTED",
          beneficiary_key: "reserve",
          config: { formula: "max(0, G_t - D_t)" },
          source_text: "N_t = max(0, G_t - D_t)",
        },
        {
          type: "UNSUPPORTED",
          beneficiary_key: "reserve",
          config: { formula: "N_t - H_t + U_t" },
          source_text: "P_t = N_t - H_t + U_t",
        },
        {
          type: "UNSUPPORTED",
          beneficiary_key: "reserve",
          config: { formula: "C_t + Q_t" },
          source_text: "C_(t+1) = C_t + Q_t",
        },
        // 4. Administrative deadline rule (matching rule 30)
        {
          type: "DATE_RANGE",
          beneficiary_key: "artist",
          source_text: "A statement is issued monthly within 15 calendar days after month-end",
        },
        // 5. Carryforward payout threshold (matching rule 29)
        {
          type: "FIXED_AMOUNT",
          beneficiary_key: "artist",
          fixed_minor: 10000,
          source_text: "If a party's net payable amount is below $100, that party's amount carries forward",
        },
        // 6. Redundant pre-recoupment flat percentage rule when TIERED_CUMULATIVE already exists
        {
          type: "PERCENTAGE",
          beneficiary_key: "artist",
          rate_basis_points: 4000,
          source_text: "Royalty Pool split matrix: Recoupment Ledger B_t > $0 -> 40%",
        },
        // 7. Pipeline recoupment pool cap misclassified as RECOUPMENT
        {
          type: "RECOUPMENT",
          beneficiary_key: "reserve",
          rate_basis_points: 6000,
          source_text: "R_t is allocated sequentially in the table order... R_t is defined as the lesser of 60% of P_t and B_t",
        },
        // 8. Reserve cohort release schedule misclassified as active RESERVE holdback
        {
          type: "RESERVE",
          beneficiary_key: "reserve",
          rate_basis_points: 7000,
          source_text: "Each held cohort releases 70% when it reaches 120 calendar days old and the remaining 30% when it reaches 240 calendar days old",
        },
      ],
      warnings: [],
      conflicts: [],
    },
    analysisId: "a3",
    documentTitle: "dedup-test.pdf",
    documentVersion: 1,
    model: "test-model",
    idFactory: (() => { let n = 0; return () => `c-${++n}`; })(),
  });

  // Only the single canonical TIERED_CUMULATIVE rule should remain!
  // All redundant threshold cards, flat percentages, pipeline formulas, recoupment pool caps, cohort releases, deadlines, and carryforward thresholds are filtered out!
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.type, "TIERED_CUMULATIVE");
  assert.equal(candidates[0]!.beneficiaryKey, "artist");
  assert.equal(candidates[0]!.rateBasisPoints, 4600);
});

test("normalizeTiers sanitizes extra zeros and nulls out open-ended final tiers", () => {
  const sample = [
    { thresholdMinor: 0, rateBasisPoints: 4000, label: "Recoupment state (B_t > $0)" },
    { thresholdMinor: 250000000, rateBasisPoints: 4600, label: "C_t < $250,000" },
    { thresholdMinor: 750000000, rateBasisPoints: 5000, label: "$250,000 <= C_t < $750,000" },
    { thresholdMinor: 750000000, rateBasisPoints: 5400, label: "C_t >= $750,000" },
  ];

  const normalized = normalizeTiers(sample);
  assert.ok(normalized);
  assert.equal(normalized.length, 4);
  assert.equal(normalized[0]!.thresholdMinor, 0);
  assert.equal(normalized[1]!.thresholdMinor, 25000000); // 250,000,000 -> 25,000,000 ($250k)
  assert.equal(normalized[2]!.thresholdMinor, 75000000); // 750,000,000 -> 75,000,000 ($750k)
  assert.equal(normalized[3]!.thresholdMinor, null);     // C_t >= $750,000 -> null (infinity)
});


