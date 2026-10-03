import test from "node:test";
import assert from "node:assert/strict";
import { calculateSettlement } from "../../packages/core/settlement-engine.ts";
import type { ExecutableRule } from "../../packages/core/types.ts";
const ev={sourceDocument:"x.pdf",sourceVersion:1,page:1,clause:"1",sourceText:"x",model:"test"};
const r=(x:Partial<ExecutableRule>):ExecutableRule=>({id:"base",type:"PERCENTAGE",beneficiaryKey:"artist",base:"NET_REVENUE",rateBasisPoints:5000,fixedMinor:null,priority:10,conditions:[],config:{},dependencies:[],evidence:ev,...x});

test("cap reduction flows back to reserve",()=>{
 const out=calculateSettlement({revenueMinor:10000,currency:"USD",category:null,occurredAt:"2026-01-01T00:00:00Z"},[
  r({id:"base",rateBasisPoints:8000}),r({id:"cap",type:"CAP",rateBasisPoints:null,fixedMinor:5000,priority:20,config:{targetRuleId:"base"}})
 ],[]);
 assert.equal(out.lines.find(l=>l.ruleId==="base")?.amountMinor,5000);
 assert.equal(out.lines.filter(l=>l.beneficiaryKey==="reserve").reduce((s,l)=>s+l.amountMinor,0),5000);
});

test("floor may consume available reserve but cannot over-allocate",()=>{
 const out=calculateSettlement({revenueMinor:10000,currency:"USD",category:null,occurredAt:"2026-01-01T00:00:00Z"},[
  r({id:"base",rateBasisPoints:2000}),r({id:"floor",type:"FLOOR",rateBasisPoints:null,fixedMinor:3000,priority:20,config:{targetRuleId:"base"}})
 ],[]);
 assert.equal(out.lines.find(l=>l.ruleId==="base")?.amountMinor,3000);
 assert.equal(out.lines.reduce((s,l)=>s+l.amountMinor,0),10000);
});

test("fixed allocation is taken before percentage pool",()=>{
 const out=calculateSettlement({revenueMinor:10000,currency:"USD",category:null,occurredAt:"2026-01-01T00:00:00Z"},[
  r({id:"fixed",type:"FIXED_AMOUNT",beneficiaryKey:"producer",fixedMinor:2000,rateBasisPoints:null,priority:1}),r({id:"base",rateBasisPoints:5000})
 ],[]);
 assert.equal(out.lines.find(l=>l.ruleId==="fixed")?.amountMinor,2000);
 assert.equal(out.lines.find(l=>l.ruleId==="base")?.amountMinor,4000);
 assert.equal(out.lines.reduce((s,l)=>s+l.amountMinor,0),10000);
});

test("DATE_RANGE modifier gates a target rule",()=>{
 const out=calculateSettlement({revenueMinor:10000,currency:"USD",category:null,occurredAt:"2026-01-01T00:00:00Z"},[
  r({id:"base",rateBasisPoints:5000}),
  r({id:"date",type:"DATE_RANGE",beneficiaryKey:null,rateBasisPoints:null,priority:2,config:{targetRuleId:"base",startDate:"2027-01-01T00:00:00Z"}})
 ],[]);
 assert.equal(out.lines.some(l=>l.ruleId==="base"),false);
 assert.equal(out.lines.reduce((s,l)=>s+l.amountMinor,0),10000);
});

test("PRIORITY modifier can advance a fixed allocation deterministically",()=>{
 const out=calculateSettlement({revenueMinor:10000,currency:"USD",category:null,occurredAt:"2026-01-01T00:00:00Z"},[
  r({id:"fixed-a",type:"FIXED_AMOUNT",beneficiaryKey:"artist",fixedMinor:8000,rateBasisPoints:null,priority:20}),
  r({id:"fixed-b",type:"FIXED_AMOUNT",beneficiaryKey:"producer",fixedMinor:8000,rateBasisPoints:null,priority:10}),
  r({id:"prio",type:"PRIORITY",beneficiaryKey:null,rateBasisPoints:null,priority:100,config:{targetRuleId:"fixed-a",priorityValue:1}})
 ],[]);
 assert.equal(out.lines.find(l=>l.ruleId==="fixed-a")?.amountMinor,8000);
 assert.equal(out.lines.find(l=>l.ruleId==="fixed-b")?.amountMinor,2000);
});

test("GROSS_REVENUE percentage is calculated from the original event before remainder rules", () => {
  const rules = [
    r({ id: "gross", type: "PERCENTAGE", beneficiaryKey: "gross_party", base: "GROSS_REVENUE", rateBasisPoints: 1000, priority: 10 }),
    r({ id: "net", type: "PERCENTAGE", beneficiaryKey: "net_party", base: "NET_REVENUE", rateBasisPoints: 5000, priority: 20 }),
  ];
  const result = calculateSettlement({revenueMinor:10000,currency:"USD",category:null,occurredAt:"2026-01-01T00:00:00Z"}, rules, []);
  assert.equal(result.lines.find((line) => line.ruleId === "gross")?.amountMinor, 1000);
  assert.equal(result.lines.find((line) => line.ruleId === "net")?.amountMinor, 4500);
  assert.equal(result.lines.find((line) => line.key === "reserve:remainder")?.amountMinor, 4500);
  assert.equal(result.lines.reduce((sum, line) => sum + line.amountMinor, 0), 10000);
});

test("GROSS_REVENUE allocations fail safely when deductions leave insufficient distributable revenue", () => {
  const rules = [
    r({ id: "fixed", type: "FIXED_AMOUNT", beneficiaryKey: "fixed_party", base: "NET_REVENUE", rateBasisPoints: null, fixedMinor: 7000, priority: 5 }),
    r({ id: "gross", type: "PERCENTAGE", beneficiaryKey: "gross_party", base: "GROSS_REVENUE", rateBasisPoints: 5000, priority: 10 }),
  ];
  assert.throws(() => calculateSettlement({revenueMinor:10000,currency:"USD",category:null,occurredAt:"2026-01-01T00:00:00Z"}, rules, []), /GROSS_REVENUE allocations/);
});
