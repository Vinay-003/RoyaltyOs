import { clearSession } from "./state.js";
import { toast } from "./utils.js";

export async function api(url, options={}, retry=true){
  const headers={...(options.headers||{})};
  if(options.json!==undefined){headers["Content-Type"]="application/json";options.body=JSON.stringify(options.json)}
  const r=await fetch(url,{...options,headers,credentials:"same-origin"});
  let body;const type=r.headers.get("content-type")||"";
  if(type.includes("application/json")){try{body=await r.json()}catch{body={}}}else body=await r.text();
  if(r.status===401 && retry && !url.includes("/auth/login") && !url.includes("/auth/register") && !url.includes("/auth/refresh")){
    const rr=await fetch("/api/v1/auth/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",credentials:"same-origin"});
    if(rr.ok)return api(url,options,false);
    clearSession();
  }
  if(!r.ok){const err=new Error(body?.error||body?.message||`HTTP ${r.status}`);err.status=r.status;err.body=body;throw err}
  return body;
}

export async function withStepUp(fn){try{return await fn()}catch(e){if(e.status!==428)throw e;const password=prompt("This financial action requires recent password verification. Enter your RoyaltyOS password:");if(!password)throw e;await api("/api/v1/auth/step-up",{method:"POST",json:{password}});toast("Identity verified for sensitive actions");return await fn()}}
