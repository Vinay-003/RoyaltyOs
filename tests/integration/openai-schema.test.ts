import test from "node:test";
import assert from "node:assert/strict";
import { extractContractWithOpenAI } from "../../packages/ai/openai-contract.ts";
import { minimalPdf, testConfig } from "../helpers.ts";

test("Responses request sends server-extracted PDF text (never input_file) with strict Structured Outputs",async()=>{
 let body:any;
 const extraction={parties:[],rules:[],warnings:[],conflicts:[]};
 const fetchImpl=async(_url:any,init:any)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({id:"r",output_text:JSON.stringify(extraction)}),{status:200,headers:{"Content-Type":"application/json"}})};
 await extractContractWithOpenAI(testConfig(),{filename:"a.pdf",bytes:minimalPdf("sixty percent artist royalty"),documentVersion:1},fetchImpl as any);
 assert.equal(body.model,"gpt-6-astra");
 const serialized=JSON.stringify(body.input);
 assert.equal(serialized.includes("input_file"),false,"file parts are dropped by some gateways after billing tokens");
 assert.equal(serialized.includes("file_data"),false);
 assert.match(serialized,/sixty percent artist royalty/,"server-extracted PDF text reaches the model");
 assert.equal(body.text.format.type,"json_schema");
 assert.equal(body.text.format.strict,true);
 assert.equal(body.text.format.schema.properties.rules.items.properties.config.additionalProperties,false);
});
