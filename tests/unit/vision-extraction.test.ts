import test from "node:test";
import assert from "node:assert/strict";
import { assertVisionSemantics, extractContractWithVision, parseVisionJson } from "../../packages/ai/vision-contract.ts";

test("a self-gating recoupment rule fails the semantic gate", () => {
  assert.throws(
    () => assertVisionSemantics({ rules: [{
      type: "RECOUPMENT", beneficiary_key: "producer", rate_basis_points: null,
      config: { advanceMinor: 200000 }, conditions: [{ field: "recoupment_remaining", operator: "GT", value: 0 }],
      evidence: { source_text: "Producer advance USD 2,000." },
    }] }),
    /recoupment_remaining condition/,
  );
});

test("content-free rules fail the semantic gate", () => {
  assert.throws(
    () => assertVisionSemantics({ rules: [{ type: "PERCENTAGE", beneficiary_key: "artist", evidence: {} }] }),
    /no evidence|integer rate/i,
  );
  assert.doesNotThrow(() => assertVisionSemantics({
    rules: [{
      type: "PERCENTAGE", beneficiary_key: "artist", rate_basis_points: 6000,
      evidence: { source_text: "Artist shall receive sixty percent." },
    }],
  }));
});
import { minimalPdf, testConfig } from "../helpers.ts";

test("vision replies parse as strict JSON, fenced JSON, or prose-wrapped JSON", () => {
  assert.deepEqual(parseVisionJson('{"rules":[]}'), { rules: [] });
  assert.deepEqual(parseVisionJson('```json\n{"rules":[]}\n```'), { rules: [] });
  assert.deepEqual(parseVisionJson('Here is the extraction:\n{"rules":[],"warnings":[]}\nDone.'), {
    rules: [],
    warnings: [],
  });
  assert.throws(() => parseVisionJson("no json here at all"), /not valid extraction JSON/);
  assert.throws(() => parseVisionJson('{"parties":[]}'), /no rules array/);
});

test("vision extraction sends page images through chat completions", async () => {
  let body: any;
  const extraction = { parties: [], rules: [], warnings: [], conflicts: [] };
  const fetchImpl = async (url: any, init: any) => {
    body = { url: String(url), json: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({ id: "chatcmpl-1", choices: [{ message: { content: JSON.stringify(extraction) } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const out = await extractContractWithVision(
    testConfig(),
    { filename: "a.pdf", bytes: minimalPdf("vision probe terms"), documentVersion: 1 },
    fetchImpl as any,
  );
  assert.match(body.url, /\/chat\/completions$/);
  const parts = body.json.messages[1].content;
  assert.ok(parts.some((p: any) => p.type === "image_url" && String(p.image_url.url).startsWith("data:image/png;base64,")));
  assert.ok(parts.some((p: any) => p.type === "text" && /Page 1:/.test(p.text)));
  assert.deepEqual(out.extraction.rules, []);
  assert.equal(out.rawResponseId, "chatcmpl-1");
});

test("a markdown-table reply triggers one repair retry, then parses", async () => {
  const calls: any[] = [];
  const good = { parties: [], rules: [], warnings: [], conflicts: [] };
  const fetchImpl = async (_url: any, init: any) => {
    calls.push(JSON.parse(init.body));
    const first = calls.length === 1;
    const content = first ? "| payee | rate |\n| A | 60% |" : JSON.stringify(good);
    return new Response(
      JSON.stringify({ id: "chatcmpl-2", choices: [{ message: { content } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const out = await extractContractWithVision(
    testConfig(),
    { filename: "a.pdf", bytes: minimalPdf("vision probe terms"), documentVersion: 1 },
    fetchImpl as any,
  );
  assert.equal(calls.length, 2, "exactly one repair retry");
  assert.match(JSON.stringify(calls[1].messages.at(-1)), /not valid extraction JSON/);
  assert.deepEqual(out.extraction.rules, []);
});
