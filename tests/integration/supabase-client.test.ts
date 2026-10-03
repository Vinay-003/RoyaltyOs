import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseClient } from "../../packages/supabase/client.ts";

test("Supabase adapter keeps service-role operations server-side and auth uses anon key",async()=>{
 const calls:Array<{url:string;init:any}>=[];
 const fetchImpl=async(url:any,init:any={})=>{calls.push({url:String(url),init});return new Response(JSON.stringify(String(url).includes("/auth/v1/token")?{access_token:"a",refresh_token:"r",expires_in:3600,token_type:"bearer",user:{id:"u",email:"u@example.com"}}:[]),{status:200,headers:{"Content-Type":"application/json"}})};
 const db=new SupabaseClient("https://x.supabase.co","anon","service",fetchImpl as any);
 await db.select("projects",{select:"*"});
 await db.signIn("u@example.com","password");
 assert.equal(calls[0]?.init.headers.apikey,"service");
 assert.equal(calls[0]?.init.headers.Authorization,"Bearer service");
 assert.equal(calls[1]?.init.headers.apikey,"anon");
 assert.equal(calls[1]?.init.headers.Authorization,"Bearer anon");
});
