import { audit } from "./pages/audit.js";
import { contracts } from "./pages/contracts.js";
import { overview } from "./pages/dashboard.js";
import { insights } from "./pages/insights.js";
import { invoices } from "./pages/invoices.js";
import { loadMe, loginView } from "./pages/login.js";
import { shell } from "./nav.js";
import { notificationsView } from "./pages/notifications.js";
import { payouts } from "./pages/payouts.js";
import { profile } from "./pages/profile.js";
import { paypalAi } from "./pages/paypal-ai.js";
import { recipients } from "./pages/recipients.js";
import { royalties } from "./pages/royalties.js";
import { ruleGraph } from "./pages/rule-graph.js";
import { settlements } from "./pages/settlements.js";
import { simulator } from "./pages/simulator.js";
import { state } from "./state.js";
import { team } from "./pages/team.js";
import { esc, hero, loadingView, path, toast } from "./utils.js";

export function navTo(p){history.pushState({},"",p);render()}

const GATEWAY=new Set([502,503,504]);

function errorView(e){
  if(GATEWAY.has(e.status)){
    shell(`${hero("CONNECTION","RoyaltyOS is unreachable.","The server may be waking up from idle; a free-tier cold start usually finishes within a minute.")}<div class="notice"><button class="btn" id="retryView">Try again</button></div>`,"Connection");
    document.getElementById("retryView")?.addEventListener("click",()=>render());
    return;
  }
  shell(`${hero("ERROR","This view could not load.",e.message)}<div class="notice error">${esc(e.stack||e.message)}</div>`,"Error");
}

export async function render(){
  try{
    if(!state.me){const me=await loadMe();if(!me){loginView();return}}
    const raw=path();
    const p=raw==="/app"||raw.startsWith("/app/")?raw.slice(4)||"/":raw;
    shell(loadingView(p),"Loading");
    if(p==="/")return await overview();
    if(p==="/insights")return await insights();
    if(p==="/contracts")return await contracts();
    if(p==="/rule-graph")return await ruleGraph();
    if(p==="/simulator")return await simulator();
    if(p==="/invoices")return await invoices();
    if(p==="/settlements")return await settlements();
    if(p==="/payouts")return await payouts();
    if(p==="/royalties")return await royalties();
    if(p==="/recipients")return await recipients();
    if(p==="/team")return await team();
    if(p==="/notifications")return await notificationsView();
    if(p==="/paypal-ai")return await paypalAi();
    if(p==="/audit")return await audit();
    if(p==="/profile")return await profile();
    navTo("/app");
  }catch(e){errorView(e)}
}

/** Called when the refresh endpoint rejects the session: send them to sign in. */
export function sessionExpired(){
  state.me=null;
  loginView();
  toast("Your session expired. Please sign in again.",6000);
}
