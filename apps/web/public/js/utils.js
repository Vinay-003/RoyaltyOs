import { state } from "./state.js";

export const $ = (s, root=document) => root.querySelector(s);

export const $$ = (s, root=document) => [...root.querySelectorAll(s)];

export const app = $("#app");

export const toastEl = $("#toast");

export function toast(message, ms=3500){toastEl.textContent=message;toastEl.hidden=false;clearTimeout(window.__toast);window.__toast=setTimeout(()=>toastEl.hidden=true,ms)}

export function esc(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}

export function money(minor,currency="USD"){return new Intl.NumberFormat(undefined,{style:"currency",currency}).format(Number(minor||0)/100)}

export function statusBadge(status){const s=String(status||"UNKNOWN");const c=/SUCCESS|ACTIVE|PAID|APPROVED|VALIDATED/.test(s)?"green":/FAILED|REJECT|DENIED|BROKEN/.test(s)?"red":/PENDING|REVIEW|REQUIRED|PROCESSING|SUBMITTED|UNCLAIMED|ONHOLD/.test(s)?"amber":"";return `<span class="badge ${c}">${esc(s)}</span>`}

export function path(){return location.pathname}

export function needProject(){if(!state.workspaceId||!state.projectId)throw new Error("No workspace/project is selected")}

export function hero(kicker,title,desc){return `<section class="hero"><div class="kicker">${esc(kicker)}</div><h2>${esc(title)}</h2><p>${esc(desc)}</p></section>`}

const routeTitles={"/":"Overview","/insights":"Insights","/contracts":"Contracts","/rule-graph":"Rule graph","/simulator":"Simulator","/invoices":"Invoices","/settlements":"Settlements","/payouts":"Payouts","/royalties":"Royalties","/recipients":"Recipients","/team":"Team","/notifications":"Notifications","/paypal-ai":"PayPal AI","/audit":"Audit","/profile":"Profile"};

export function loadingView(p){const t=routeTitles[p]||"RoyaltyOS";return `${hero("LOADING",t,"Fetching fresh data from the API...")}<section class="card"><div class="skel" style="height:20px;width:38%;margin-bottom:12px"></div><div class="skel" style="height:96px;margin-bottom:10px"></div><div class="skel" style="height:96px"></div></section>`}

export function busy(btn,on=true){
  if(!btn||typeof btn.classList==="undefined")return true;
  if(on){
    if(btn.dataset.busy)return false;
    btn.dataset.busy="1";btn.dataset.label=btn.innerHTML;
    btn.disabled=true;btn.classList.add("busy");
    btn.innerHTML=`<span class="spin" aria-hidden="true"></span> ${btn.dataset.label}`;
    return true;
  }
  delete btn.dataset.busy;btn.disabled=false;btn.classList.remove("busy");
  if(btn.dataset.label!==undefined){btn.innerHTML=btn.dataset.label;delete btn.dataset.label}
  return true;
}

export function submitButton(form){return form?.querySelector?.(".btn")||null}
