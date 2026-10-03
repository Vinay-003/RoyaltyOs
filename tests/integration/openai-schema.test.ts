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

test("native PDF attachment is opt-in per provider capability",async()=>{
 let body:any;
 const extraction={parties:[],rules:[],warnings:[],conflicts:[]};
 const fetchImpl=async(_url:any,init:any)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({id:"r",output_text:JSON.stringify(extraction)}),{status:200,headers:{"Content-Type":"application/json"}})};
 await extractContractWithOpenAI(testConfig({OPENAI_SEND_PDF_FILE:"true"}),{filename:"a.pdf",bytes:minimalPdf("some royalty terms here"),documentVersion:1},fetchImpl as any);
 const files=body.input[0].content.filter((item:any)=>item.type==="input_file");
 assert.equal(files.length,1,"file rides alongside text, never instead of it");
 assert.equal(files[0].filename,"v1-a.pdf");
 const texts=body.input[0].content.filter((item:any)=>item.type==="input_text").map((item:any)=>item.text).join("\n");
 assert.match(texts,/some royalty terms here/,"text stays the primary source even with the file attached");
});

test("image-only PDFs fail fast with a scan/OCR message instead of burning tokens",async()=>{
 let called=false;
 const fetchImpl=async()=>{called=true;throw new Error("must not call the model");};
 const blank=`%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n`;
 await assert.rejects(
   ()=>extractContractWithOpenAI(testConfig(),{filename:"scan.pdf",bytes:new TextEncoder().encode(blank),documentVersion:1},fetchImpl as any),
   /no extractable text/i,
 );
 assert.equal(called,false,"no provider call is made when there is nothing to send");
});
