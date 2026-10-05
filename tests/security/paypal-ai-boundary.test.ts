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
 const fetchImpl=async(_url:any,init:any)=>{captured=JSON.parse(init.body);return new Response(JSON.stringify({id:"resp_test",output_text:"1 workspace invoice"}),{status:200,headers:{"Content-Type":"application/json"}})};
 const fakeGateway={listInvoices:async()=>({items:[{id:"INV-OTHER",status:"PAID"},{id:"INV-1",status:"PAID"}],total_count:2})};
 const config=testConfig();
 const workspaceRecords=[{paypalInvoiceId:"INV-1",amount:"100.00 USD",status:"PAID",recipientEmail:"buyer@example.com"}];
 const result=await runPayPalReadOnlyAssistant(config,fakeGateway as any,"List my invoices",fetchImpl as any,workspaceRecords);
 assert.equal(result.text,"1 workspace invoice");
 assert.equal(result.invoiceCount,1,"footer counts workspace records, not the merchant list");
 assert.deepEqual(result.tools,["server:list_invoices"]);
 assert.equal(captured.tools,undefined,"no MCP tool block is sent to any gateway");
 assert.match(captured.input,/Workspace records \(1 invoice\(s\) owned by this workspace\)/);
 assert.match(captured.input,/INV-1/,"workspace record reaches the model as context");
 assert.match(captured.input,/may include other workspaces/,"merchant snapshot is labeled unscoped");
});

test("PayPal AI fails loud on empty answers instead of showing a blank box",async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({id:"resp_empty",output_text:"  "}),{status:200,headers:{"Content-Type":"application/json"}});
 const fakeGateway={listInvoices:async()=>({items:[],total_count:0})};
 await assert.rejects(()=>runPayPalReadOnlyAssistant(testConfig(),fakeGateway as any,"List my invoices",fetchImpl as any),/empty answer/);
});
