import test from "node:test";
import assert from "node:assert/strict";
import { compileRuleset } from "../../packages/core/ruleset-compiler.ts";
import { calculateSettlement } from "../../packages/core/settlement-engine.ts";
import type { CandidateRule } from "../../packages/core/types.ts";

const e=(text:string)=>({sourceDocument:"agreement-amendment.pdf",sourceVersion:2,page:2,clause:"3.1",sourceText:text,model:"gpt-6-astra"});
const candidates:CandidateRule[]=[
 {id:"00000000-0000-4000-8000-000000000001",type:"PERCENTAGE",beneficiaryKey:"artist",base:"NET_REVENUE",rateBasisPoints:6000,fixedMinor:null,priority:10,conditions:[],config:{},dependencies:[],evidence:e("Artist 60%"),confidence:.99,status:"APPROVED"},
 {id:"00000000-0000-4000-8000-000000000002",type:"RECOUPMENT",beneficiaryKey:"producer",base:"NET_REVENUE",rateBasisPoints:1500,fixedMinor:null,priority:20,conditions:[],config:{advanceMinor:200000,preRecoupmentBasisPoints:2500,postRecoupmentBasisPoints:1500},dependencies:[],evidence:e("Producer advance then 15%"),confidence:.99,status:"APPROVED"},
 {id:"00000000-0000-4000-8000-000000000003",type:"PERCENTAGE",beneficiaryKey:"manager",base:"NET_REVENUE",rateBasisPoints:1000,fixedMinor:null,priority:30,conditions:[],config:{},dependencies:[],evidence:e("Manager 10%"),confidence:.99,status:"APPROVED"},
 {id:"00000000-0000-4000-8000-000000000004",type:"REVENUE_CATEGORY",beneficiaryKey:"featured_creator",base:"NET_REVENUE",rateBasisPoints:500,fixedMinor:null,priority:40,conditions:[],config:{category:"VIDEO"},dependencies:[],evidence:e("Featured 5% video"),confidence:.99,status:"APPROVED"},
];

test("approved candidates compile and same frozen inputs reproduce the same settlement",()=>{
 const compiled=compileRuleset({candidates,beneficiaryKeys:new Set(["artist","producer","manager","featured_creator"]),currency:"USD",contractVersionId:"version-2",nextVersion:4});
 const ctx={revenueMinor:1_000_000,currency:"USD",category:"VIDEO",occurredAt:"2026-10-03T00:00:00Z"};
 const rec=[{ruleId:candidates[1]!.id,beneficiaryKey:"producer",remainingMinor:60000,originalMinor:200000,recoupedMinor:140000,currency:"USD"}];
 const a=calculateSettlement(ctx,compiled.rules,rec);
 const b=calculateSettlement(ctx,compiled.rules,rec);
 assert.deepEqual(a,b);
 assert.equal(a.lines.reduce((s,l)=>s+l.amountMinor,0),ctx.revenueMinor);
 assert.equal(a.lines.filter(l=>l.payableMinor>0).reduce((s,l)=>s+l.payableMinor,0),846000);
});
