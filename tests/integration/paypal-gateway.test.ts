import test from "node:test";
import assert from "node:assert/strict";
import { invoiceIdFromLinks, PayPalGateway } from "../../packages/paypal/gateway.ts";

test("invoice id is read off the bare self-link creation response",async()=>{
 const fetchImpl=async(url:any,init:any={})=>{
   if(String(url).endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({access_token:"ACCESS",expires_in:3600}),{status:200,headers:{"Content-Type":"application/json"}});
   return new Response(JSON.stringify({rel:"self",href:"https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-LINK-ONLY",method:"GET"}),{status:201,headers:{"Content-Type":"application/json"}});
 };
 const gateway=new PayPalGateway(testConfig(),fetchImpl as any);
 const invoice=await gateway.createInvoice({requestId:"idem-link",currency:"USD",recipientEmail:"buyer@example.com",itemName:"Revenue",amountMinor:1000});
 assert.equal(invoice.id,"INV2-LINK-ONLY");
 assert.equal(invoiceIdFromLinks([{rel:"self",href:"https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-X9/",method:"GET"}]),"INV2-X9");
 assert.equal(invoiceIdFromLinks([{rel:"self",href:"https://example.test/other"}]),null);
 assert.equal(invoiceIdFromLinks("nope"),null);
});
import { testConfig } from "../helpers.ts";

test("PayPal gateway authenticates, creates invoice with idempotency and verifies webhook",async()=>{
 const calls:Array<{url:string;init:any}>=[];
 const fetchImpl=async(url:any,init:any={})=>{
   calls.push({url:String(url),init});
   if(String(url).endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({access_token:"ACCESS",expires_in:3600}),{status:200,headers:{"Content-Type":"application/json"}});
   if(String(url).endsWith("/v2/invoicing/invoices")) return new Response(JSON.stringify({id:"INV2-TEST",status:"DRAFT"}),{status:201,headers:{"Content-Type":"application/json"}});
   if(String(url).endsWith("/v1/notifications/verify-webhook-signature")) return new Response(JSON.stringify({verification_status:"SUCCESS"}),{status:200,headers:{"Content-Type":"application/json"}});
   return new Response("{}",{status:200,headers:{"Content-Type":"application/json"}});
 };
 const gateway=new PayPalGateway(testConfig(),fetchImpl as any);
 const invoice=await gateway.createInvoice({requestId:"idem-1",currency:"USD",recipientEmail:"buyer@example.com",itemName:"Revenue",amountMinor:12345});
 assert.equal(invoice.id,"INV2-TEST");
 const invoiceCall=calls.find(c=>c.url.endsWith("/v2/invoicing/invoices"))!;
 assert.equal(invoiceCall.init.headers["PayPal-Request-Id"],"idem-1");
 const parsed=JSON.parse(invoiceCall.init.body);
 assert.equal(parsed.items[0].unit_amount.value,"123.45");
 assert.equal(await gateway.verifyWebhook({authAlgo:"SHA256withRSA",certUrl:"https://example.test/cert",transmissionId:"tid",transmissionSig:"sig",transmissionTime:"2026-10-03T00:00:00Z"},{id:"WH"}),true);
 const verify=JSON.parse(calls.at(-1)!.init.body);
 assert.equal(verify.webhook_id,"WH-TEST");
});

test("PayPal OAuth token is cached",async()=>{
 let oauth=0;
 const fetchImpl=async(url:any)=>{if(String(url).endsWith("/v1/oauth2/token")){oauth++;return new Response(JSON.stringify({access_token:"A",expires_in:3600}),{status:200,headers:{"Content-Type":"application/json"}})}return new Response("{}",{status:200})};
 const gateway=new PayPalGateway(testConfig(),fetchImpl as any);
 await gateway.getAccessToken();await gateway.getAccessToken();
 assert.equal(oauth,1);
});

test("PayPal gateway retries a transient 429 when request is idempotent", async () => {
  let invoiceAttempts=0;
  const fetchImpl: typeof fetch = async (url:any, init:any) => {
    const u=String(url);
    if(u.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({access_token:"t",expires_in:300}),{status:200,headers:{"content-type":"application/json"}});
    if(u.endsWith("/v2/invoicing/invoices")) {
      invoiceAttempts++;
      if(invoiceAttempts===1) return new Response(JSON.stringify({name:"RATE_LIMIT_REACHED"}),{status:429,headers:{"content-type":"application/json","retry-after":"0"}});
      return new Response(JSON.stringify({id:"INV2-retry",status:"DRAFT"}),{status:201,headers:{"content-type":"application/json"}});
    }
    throw new Error("unexpected "+u);
  };
  const base=testConfig();
  const cfg={...base,paypal:{...base.paypal,maxRetries:2,retryBaseMs:1,timeoutMs:1000}} as any;
  const gateway=new PayPalGateway(cfg,fetchImpl);
  const invoice=await gateway.createInvoice({requestId:"stable-key",currency:"USD",recipientEmail:"buyer@example.com",itemName:"Revenue",amountMinor:100});
  assert.equal(invoice.id,"INV2-retry");
  assert.equal(invoiceAttempts,2);
});
