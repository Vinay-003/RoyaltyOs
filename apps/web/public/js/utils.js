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
