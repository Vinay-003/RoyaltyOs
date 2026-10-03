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

test("PayPal AI uses sandbox Remote MCP and only configured read-only tools",async()=>{
 let captured:any=null;
 const fetchImpl=async(_url:any,init:any)=>{captured=JSON.parse(init.body);return new Response(JSON.stringify({id:"resp_test",output_text:"2 invoices"}),{status:200,headers:{"Content-Type":"application/json"}})};
 const fakeGateway={getAccessToken:async()=>"paypal-token"};
 const config=testConfig();
 const result=await runPayPalReadOnlyAssistant(config,fakeGateway as any,"List my invoices",fetchImpl as any);
 assert.equal(result.text,"2 invoices");
 assert.equal(captured.tools[0].server_url,"https://mcp.sandbox.paypal.com/http");
 assert.deepEqual(captured.tools[0].allowed_tools,["list_invoices","get_invoice","list_transactions"]);
 assert.equal(captured.tools[0].authorization,"paypal-token");
 assert.equal(captured.tools[0].headers,undefined);
 assert.equal(captured.tools[0].require_approval,"never");
});
