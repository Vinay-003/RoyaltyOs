import test from "node:test";
import assert from "node:assert/strict";
import { calculateSettlement } from "../../packages/core/settlement-engine.ts";
import type { ExecutableRule } from "../../packages/core/types.ts";
const evidence={sourceDocument:"f.pdf",sourceVersion:1,page:1,clause:"1",sourceText:"test",model:"test"};

test("deterministic financial property sweep conserves money",()=>{
  let seed=0x12345678;
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32};
  for(let i=0;i<500;i++){
    const revenue=Math.floor(rand()*5_000_000);
    const a=Math.floor(rand()*7000);
    const b=Math.floor(rand()*(10000-a));
    const rules:ExecutableRule[]=[
      {id:"a",type:"PERCENTAGE",beneficiaryKey:"a",base:"NET_REVENUE",rateBasisPoints:a,fixedMinor:null,priority:10,conditions:[],config:{},dependencies:[],evidence},
      {id:"b",type:"PERCENTAGE",beneficiaryKey:"b",base:"NET_REVENUE",rateBasisPoints:b,fixedMinor:null,priority:20,conditions:[],config:{},dependencies:[],evidence},
    ];
    const input={revenueMinor:revenue,currency:"USD",category:null,occurredAt:"2026-01-01T00:00:00Z"};
    const one=calculateSettlement(input,rules,[]);
    const two=calculateSettlement(input,rules,[]);
    assert.equal(one.lines.reduce((s,l)=>s+l.amountMinor,0),revenue);
    assert.ok(one.lines.every(l=>l.amountMinor>=0&&Number.isSafeInteger(l.amountMinor)));
    assert.deepEqual(one,two);
  }
});
