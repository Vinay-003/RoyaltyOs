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
  const content = body.input[0].content;
  const files = content.filter((item: any) => item.type === "input_file");
  assert.deepEqual(files.map((item: any) => item.filename), ["v1-agreement.pdf", "v2-agreement-v2.pdf", "v3-agreement-amendment.pdf"]);
  assert.match(body.instructions, /contradictions, amendments and superseding language/i);
  assert.match(content.at(-1).text, /current contract version 3/i);
});
