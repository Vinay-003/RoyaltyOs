import { api } from "./api.js";
import { navTo } from "./router.js";
import { clearSession, state } from "./state.js";
import { $, app, busy, esc, path, toast } from "./utils.js";

export const navItems=[
  ["/app","Overview","O"],["/app/insights","Insights","I"],["/app/contracts","Contracts","C"],["/app/rule-graph","Rule graph","G"],["/app/simulator","Simulator","S"],["/app/invoices","Invoices","$"],["/app/settlements","Settlements","="],["/app/payouts","Payouts","P"],["/app/royalties","Royalties","R"],["/app/recipients","Recipients","@"],["/app/team","Team","T"],["/app/notifications","Notifications","N"],["/app/paypal-ai","PayPal AI","AI"],["/app/audit","Audit","A"],["/app/profile","Profile","U"]
];

function isActive(href, raw){
  if(href==="/app")return raw==="/app"||raw==="/app/"||raw==="/";
  return raw===href||raw===href+"/";
}

export function shell(content,title="RoyaltyOS"){
  const raw=path();
  app.innerHTML=`<div class="shell"><button class="mobile-toggle" id="navToggle" aria-label="Open menu">☰</button><div class="nav-scrim" id="navScrim"></div><aside class="sidebar" id="sidebar"><div class="brand"><div class="brand-mark">R</div><div><strong>RoyaltyOS</strong><small>v${esc(state.version)} · sandbox control room</small></div></div><nav class="nav">${navItems.map(([href,label,icon])=>`<a data-nav href="${href}" class="${isActive(href,raw)?"active":""}"><i>${icon}</i>${label}</a>`).join("")}</nav><div class="boundary"><b>Financial boundary</b><br>AI interprets. Deterministic software calculates. Humans authorize. PayPal moves money.</div></aside><main class="main"><header class="topbar"><div><div class="eyebrow">${esc(title)} · workspace ${esc((state.workspaceId||"workspace").slice(0,8))}</div><h1>Agreement to payout, with every decision traceable.</h1></div><div class="top-actions"><span class="badge amber">PAYPAL SANDBOX</span><button class="btn secondary" id="stepup">Verify identity</button><button class="btn ghost" id="logout">Sign out</button></div></header>${content}</main></div>`;
  const sidebar=$("#sidebar"),scrim=$("#navScrim");
  const setNav=open=>{sidebar?.classList.toggle("open",open);scrim?.classList.toggle("open",open)};
  $("#navToggle")?.addEventListener("click",()=>setNav(!sidebar?.classList.contains("open")));
  scrim?.addEventListener("click",()=>setNav(false));
  $(".nav")?.addEventListener("click",()=>setNav(false));
  $("#logout")?.addEventListener("click",async e=>{const b=e?.currentTarget;if(!busy(b))return;try{await api("/api/v1/auth/logout",{method:"POST",json:{}},false)}catch{}clearSession();navTo("/app")});
  $("#stepup")?.addEventListener("click",async e=>{const password=prompt("Enter your password for step-up verification:");if(!password)return;const b=e?.currentTarget;if(!busy(b))return;try{await api("/api/v1/auth/step-up",{method:"POST",json:{password}});toast("Sensitive actions unlocked for 15 minutes")}catch(e){toast(e.message)}finally{busy(b,false)}});
}
