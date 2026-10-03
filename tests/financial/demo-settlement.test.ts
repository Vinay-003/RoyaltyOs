import test from "node:test";
import assert from "node:assert/strict";
import { calculateSettlement } from "../../packages/core/settlement-engine.ts";
import type { ExecutableRule, RecoupmentState } from "../../packages/core/types.ts";

const evidence = { sourceDocument:"campaign.pdf",sourceVersion:2,page:2,clause:"3.1",sourceText:"source",model:"test" };
const rules: ExecutableRule[] = [
  {id:"artist",type:"PERCENTAGE",beneficiaryKey:"artist",base:"NET_REVENUE",rateBasisPoints:6000,fixedMinor:null,priority:10,conditions:[],config:{},dependencies:[],evidence},
  {id:"producer",type:"RECOUPMENT",beneficiaryKey:"producer",base:"NET_REVENUE",rateBasisPoints:1500,fixedMinor:null,priority:20,conditions:[],config:{advanceMinor:200000,preRecoupmentBasisPoints:2500,postRecoupmentBasisPoints:1500},dependencies:[],evidence},
  {id:"manager",type:"PERCENTAGE",beneficiaryKey:"manager",base:"NET_REVENUE",rateBasisPoints:1000,fixedMinor:null,priority:30,conditions:[],config:{},dependencies:[],evidence},
  {id:"featured",type:"REVENUE_CATEGORY",beneficiaryKey:"featured_creator",base:"NET_REVENUE",rateBasisPoints:500,fixedMinor:null,priority:40,conditions:[],config:{category:"VIDEO"},dependencies:[],evidence},
];
const recoupments: RecoupmentState[] = [{ruleId:"producer",beneficiaryKey:"producer",originalMinor:200000,recoupedMinor:140000,remainingMinor:60000,currency:"USD"}];

test("canonical $10,000 VIDEO demo recoups $600 then applies post-recoupment royalties", () => {
  const result = calculateSettlement({revenueMinor:1_000_000,currency:"USD",category:"VIDEO",occurredAt:"2026-10-03T00:00:00Z"},rules,recoupments);
  const map = new Map(result.lines.map((line)=>[line.beneficiaryKey+":"+line.kind,line]));
  assert.equal(map.get("producer:RECOUPMENT")?.amountMinor,60_000);
  assert.equal(map.get("artist:PAYABLE")?.amountMinor,564_000);
  assert.equal(map.get("producer:PAYABLE")?.amountMinor,141_000);
  assert.equal(map.get("manager:PAYABLE")?.amountMinor,94_000);
  assert.equal(map.get("featured_creator:PAYABLE")?.amountMinor,47_000);
  assert.equal(map.get("reserve:RESERVE")?.amountMinor,94_000);
  assert.equal(result.lines.reduce((s,l)=>s+l.amountMinor,0),1_000_000);
  assert.deepEqual(result.recoupmentDeltas,[{ruleId:"producer",appliedMinor:60_000}]);
});

test("non-video revenue omits Featured Creator and conserves money in reserve", () => {
  const result = calculateSettlement({revenueMinor:1_000_000,currency:"USD",category:"AUDIO",occurredAt:"2026-10-03T00:00:00Z"},rules,recoupments);
  assert.equal(result.lines.some((l)=>l.beneficiaryKey==="featured_creator"),false);
  assert.equal(result.lines.reduce((s,l)=>s+l.amountMinor,0),1_000_000);
  const reserve = result.lines.filter((l)=>l.beneficiaryKey==="reserve").reduce((s,l)=>s+l.amountMinor,0);
  assert.equal(reserve,141_000);
});

test("revenue below remaining advance is consumed by recoupment without negative balance", () => {
  const result = calculateSettlement({revenueMinor:50_000,currency:"USD",category:"VIDEO",occurredAt:"2026-10-03T00:00:00Z"},rules,recoupments);
  const rec = result.lines.find((l)=>l.kind==="RECOUPMENT");
  assert.equal(rec?.amountMinor,50_000);
  assert.equal(rec?.payableMinor,0);
  assert.equal(rec?.metadata.recoupmentRemainingAfterMinor,10_000);
  assert.equal(result.lines.reduce((s,l)=>s+l.amountMinor,0),50_000);
});
