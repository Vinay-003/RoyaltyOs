import { clearSession, state } from "./state.js";
import { toast } from "./utils.js";

const GATEWAY = new Set([502, 503, 504]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Vercel proxies /api to the Render service, which sleeps when idle. Until the
 * origin wakes (roughly 30-60 seconds on the free tier) the proxy answers
 * 502/503/504 before the request ever reaches the app, so retrying is safe for
 * every method. First failure also fires a wake-up ping at /api/health.
 */
async function request(url, options) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    last = await fetch(url, { ...options, credentials: "same-origin" });
    if (!GATEWAY.has(last.status)) return last;
    toast("RoyaltyOS is waking its server (free-tier cold start). Retrying…", 12000);
    if (attempt === 0) fetch("/api/health", { cache: "no-store" }).catch(() => {});
    await delay(attempt < 2 ? 5000 : 10000);
  }
  return last;
}

export async function api(url, options={}, retry=true){
  const headers={...(options.headers||{})};
  if(options.json!==undefined){headers["Content-Type"]="application/json";options.body=JSON.stringify(options.json)}
  const r=await request(url,{...options,headers});
  let body;const type=r.headers.get("content-type")||"";
  if(type.includes("application/json")){try{body=await r.json()}catch{body={}}}else body=await r.text();
  if(r.status===401 && retry && !url.includes("/auth/login") && !url.includes("/auth/register") && !url.includes("/auth/refresh")){
    const rr=await request("/api/v1/auth/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    if(rr.ok)return api(url,options,false);
    // Only a rejected refresh ends the session; a transient failure keeps it.
    if(rr.status===401){
      const hadSession=!!state.me;
      clearSession();
      // Fresh visits are simply signed out; only a live session (or an expiry
      // cookie rejection) is announced as expired.
      let code=null;try{code=(await rr.json()).code??null}catch{}
      if(hadSession||code==="SESSION_EXPIRED")window.dispatchEvent(new Event("royaltyos:session-expired"));
    }
  }
  if(!r.ok){const err=new Error(body?.error||body?.message||`HTTP ${r.status}`);err.status=r.status;err.body=body;throw err}
  return body;
}

export async function withStepUp(fn){try{return await fn()}catch(e){if(e.status!==428)throw e;const password=prompt("This financial action requires recent password verification. Enter your RoyaltyOS password:");if(!password)throw e;await api("/api/v1/auth/step-up",{method:"POST",json:{password}});toast("Identity verified for sensitive actions");return await fn()}}
