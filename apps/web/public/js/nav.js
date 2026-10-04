import { api } from "./api.js";
import { navTo } from "./router.js";
import { clearSession, state } from "./state.js";
import { $, app, busy, esc, path, toast } from "./utils.js";

export const navItems=[
  ["/","Overview","O"],["/insights","Insights","I"],["/contracts","Contracts","C"],["/rule-graph","Rule graph","G"],["/simulator","Simulator","S"],["/invoices","Invoices","$"],["/settlements","Settlements","="],["/payouts","Payouts","P"],["/royalties","Royalties","R"],["/recipients","Recipients","@"],["/team","Team","T"],["/notifications","Notifications","N"],["/paypal-ai","PayPal AI","AI"],["/audit","Audit","A"],["/profile","Profile","U"]
];

export function shell(content,title="RoyaltyOS"){
  const p=path();
  app.innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">R</div><div><strong>RoyaltyOS</strong><small>v${esc(state.version)} · sandbox control room</small></div></div><nav class="nav">${navItems.map(([href,label,icon])=>`<a data-nav href="${href}" class="${p===href?"active":""}"><i>${icon}</i>${label}</a>`).join("")}</nav><div class="boundary"><b>Financial boundary</b><br>AI interprets. Deterministic software calculates. Humans authorize. PayPal moves money.</div></aside><main class="main"><header class="topbar"><div><div class="eyebrow">${esc(title)} · ${esc(state.workspaceId||"workspace")}</div><h1>Agreement to payout, with every decision traceable.</h1></div><div class="top-actions"><span class="badge amber">PAYPAL SANDBOX</span><button class="btn secondary" id="stepup">Verify identity</button><button class="btn ghost" id="logout">Sign out</button></div></header>${content}</main></div>`;
  $("#logout")?.addEventListener("click",async e=>{const b=e?.currentTarget;if(!busy(b))return;try{await api("/api/v1/auth/logout",{method:"POST",json:{}},false)}catch{}clearSession();navTo("/")});
  $("#stepup")?.addEventListener("click",async e=>{const password=prompt("Enter your password for step-up verification:");if(!password)return;const b=e?.currentTarget;if(!busy(b))return;try{await api("/api/v1/auth/step-up",{method:"POST",json:{password}});toast("Sensitive actions unlocked for 15 minutes")}catch(e){toast(e.message)}finally{busy(b,false)}});
}
