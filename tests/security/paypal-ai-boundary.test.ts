import test from "node:test";
import assert from "node:assert/strict";
import { runPayPalReadOnlyAssistant } from "../../packages/paypal-ai/mcp-assistant.ts";
import { testConfig } from "../helpers.ts";

test("PayPal AI layer refuses money-moving natural language before any model/tool call",async()=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;return new Response("{}",{status:200})};
 const fakeGateway={getAccessToken:async()=>"paypal-token"};
 await assert.rejects(()=>runPayPalReadOnlyAssistant(testConfig(),fakeGateway as any,"Create and send a $100 payout",fetchImpl as any),/intentionally read-only/);
 assert.equal(calls,0);
});

test("PayPal AI answers from server-side reads, never MCP tool calls",async()=>{
 let captured:any=null;
 const fetchImpl=async(_url:any,init:any)=>{captured=JSON.parse(init.body);return new Response(JSON.stringify({id:"resp_test",output_text:"2 paid invoices"}),{status:200,headers:{"Content-Type":"application/json"}})};
 const fakeGateway={listInvoices:async()=>({items:[{id:"INV-1",status:"PAID"},{id:"INV-2",status:"SENT"}],total_count:2})};
 const config=testConfig();
 const result=await runPayPalReadOnlyAssistant(config,fakeGateway as any,"List my invoices",fetchImpl as any);
 assert.equal(result.text,"2 paid invoices");
 assert.equal(result.invoiceCount,2);
 assert.deepEqual(result.tools,["server:list_invoices"]);
 assert.equal(captured.tools,undefined,"no MCP tool block is sent to any gateway");
 assert.match(JSON.stringify(captured.input),/INV-1/,"live PayPal data reaches the model as context");
});

test("PayPal AI fails loud on empty answers instead of showing a blank box",async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({id:"resp_empty",output_text:"  "}),{status:200,headers:{"Content-Type":"application/json"}});
 const fakeGateway={listInvoices:async()=>({items:[],total_count:0})};
 await assert.rejects(()=>runPayPalReadOnlyAssistant(testConfig(),fakeGateway as any,"List my invoices",fetchImpl as any),/empty answer/);
});
