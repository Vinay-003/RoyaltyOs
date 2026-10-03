import test from "node:test";
import assert from "node:assert/strict";
import { extractContractWithOpenAI } from "../../packages/ai/openai-contract.ts";
import { minimalPdf, testConfig } from "../helpers.ts";

test("OpenAI Responses request uses PDF input detail and strict Structured Outputs",async()=>{
 let body:any;
 const extraction={parties:[],rules:[],warnings:[],conflicts:[]};
 const fetchImpl=async(_url:any,init:any)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({id:"r",output_text:JSON.stringify(extraction)}),{status:200,headers:{"Content-Type":"application/json"}})};
 await extractContractWithOpenAI(testConfig(),{filename:"a.pdf",bytes:minimalPdf(),documentVersion:1},fetchImpl as any);
 assert.equal(body.model,"gpt-6-astra");
 assert.equal(body.input[0].content[0].type,"input_file");
 assert.equal(body.input[0].content[0].detail,"low");
 assert.equal(body.text.format.type,"json_schema");
 assert.equal(body.text.format.strict,true);
});
