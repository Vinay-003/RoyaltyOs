import test from "node:test";
import assert from "node:assert/strict";
import { extractContractWithOpenAI } from "../../packages/ai/openai-contract.ts";
import { minimalPdf, testConfig } from "../helpers.ts";

test("contract intelligence sends prior versions to detect amendments and conflicts", async () => {
  let body: any;
  const fetchImpl = async (_url: any, init: any) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "resp_1", output_text: JSON.stringify({ parties: [], rules: [], warnings: [], conflicts: [] }) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  await extractContractWithOpenAI(testConfig(), {
    filename: "agreement-amendment.pdf",
    bytes: minimalPdf("amendment"),
    documentVersion: 3,
    priorDocuments: [
      { filename: "agreement.pdf", bytes: minimalPdf("original"), documentVersion: 1 },
      { filename: "agreement-v2.pdf", bytes: minimalPdf("second"), documentVersion: 2 },
    ],
  }, fetchImpl as any);
  const texts = body.input[0].content.map((item: any) => item.text).join("\n");
  assert.match(texts, /PRIOR contract version 1[\s\S]*original/);
  assert.match(texts, /PRIOR contract version 2[\s\S]*second/);
  assert.match(texts, /CURRENT contract version 3[\s\S]*amendment/);
  assert.match(body.instructions, /contradictions, amendments and superseding language/i);
});
