import { api, withStepUp } from "../api.js";
import { shell } from "../nav.js";
import { state } from "../state.js";
import { $, $$, busy, esc, hero, submitButton, toast } from "../utils.js";

export async function profile() {
  const me = await api(`/api/v1/profile`);
  state.me = { ...(state.me || {}), displayName: me.displayName };
  const owners = me.workspaces.filter((w) => w.role === "OWNER");
  shell(
    `${hero("PROFILE", "Identity and PayPal connections.", "Your display name identifies you across the workspace. Each workspace can connect its own PayPal app; money paths use the workspace credentials when connected, otherwise the server defaults.")}` +
      `<section class="card"><div class="card-head"><div><div class="kicker">IDENTITY</div><h3>${esc(me.displayName || me.email)}</h3></div></div></div>` +
      `<form id="nameForm" class="row"><input class="input" name="displayName" maxlength="120" value="${esc(me.displayName || "")}" placeholder="Display name"><button class="btn" type="submit">Save name</button></form>` +
      `<small class="mono">${esc(me.email)}</small></section>` +
      `<section class="card" style="margin-top:12px"><div class="card-head"><div><div class="kicker">WORKSPACES</div><h3>Your roles</h3></div></div>` +
      `${me.workspaces.map((w) => `<div class="row" style="justify-content:space-between"><div><b>${esc(w.name)}</b><br><small>${esc(w.role)}${w.paypalConnected ? ` · PayPal ${esc(w.paypalEnvironment || "")} connected` : " · PayPal not connected"}</small></div></div>`).join("") || '<div class="empty">No workspaces yet.</div>'}` +
      `</section>` +
      (owners.length
        ? `<section class="card" style="margin-top:12px"><div class="card-head"><div><div class="kicker">PAYPAL CONNECTION</div><h3>Workspace credentials</h3></div></div><p>Owner-only. Paste a PayPal REST app from the PayPal developer dashboard; the secret is encrypted before storage and never shown again. Disconnecting resumes the server defaults.</p><div id="paypalAccounts"></div></section>`
        : `<section class="card" style="margin-top:12px"><div class="empty">PayPal connections are managed by your workspace owner.</div></section>`),
    "Profile",
  );

  $("#nameForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = submitButton(e.currentTarget);
    if (!busy(b)) return;
    try {
      const fd = new FormData(e.currentTarget);
      const out = await api("/api/v1/profile", { method: "PATCH", json: { displayName: fd.get("displayName") } });
      toast(`Display name set to ${out.displayName}`);
      profile();
    } catch (err) { toast(err.message, 6000); } finally { busy(b, false); }
  });

  for (const w of owners) {
    try {
      const account = await api(`/api/v1/workspaces/${w.id}/paypal-account`);
      const host = $("#paypalAccounts");
      if (!host) break;
      host.insertAdjacentHTML("beforeend",
        `<div class="card" style="margin:10px 0"><div class="kicker">${esc(w.name)}</div>` +
        `<div class="notice ${account.connected ? "success" : ""}">${account.connected ? `Connected (${esc(account.environment || "")}) · client ${esc(account.clientId || "")} · updated ${esc(account.updatedAt || "unknown")}` : "Not connected — server defaults apply."}</div>` +
        `<form data-paypal-form="${esc(w.id)}" class="stack" style="margin-top:10px">` +
        `<input class="input" name="clientId" maxlength="200" placeholder="PayPal client ID" autocomplete="off">` +
        `<input class="input" name="clientSecret" type="password" maxlength="2000" placeholder="PayPal client secret (never shown again)" autocomplete="off">` +
        `<input class="input" name="webhookId" maxlength="200" placeholder="Webhook ID (optional)">` +
        `<div class="row"><select class="input" name="environment"><option value="sandbox">sandbox</option><option value="live">live</option></select>` +
        `<button class="btn" type="submit">${account.connected ? "Update connection" : "Connect"}</button>` +
        (account.connected ? `<button class="btn secondary" type="button" data-disconnect="${esc(w.id)}">Disconnect</button>` : "") +
        `</div></form></div>`);
    } catch (err) { toast(err.message, 6000); }
  }

  $$("[data-paypal-form]").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = submitButton(form);
    if (!busy(b)) return;
    try {
      const fd = new FormData(form);
      const id = form.dataset.paypalForm;
      await withStepUp(() => api(`/api/v1/workspaces/${id}/paypal-account`, {
        method: "PUT",
        json: { clientId: fd.get("clientId"), clientSecret: fd.get("clientSecret"), webhookId: fd.get("webhookId"), environment: fd.get("environment") },
      }));
      toast("PayPal connection saved and verified");
      profile();
    } catch (err) { toast(err.message, 6000); } finally { busy(b, false); }
  }));

  $$("[data-disconnect]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Disconnect this workspace's PayPal account? Server defaults resume.")) return;
    if (!busy(b)) return;
    try {
      await withStepUp(() => api(`/api/v1/workspaces/${b.dataset.disconnect}/paypal-account`, { method: "DELETE", json: {} }));
      toast("PayPal account disconnected");
      profile();
    } catch (err) { toast(err.message, 6000); } finally { busy(b, false); }
  }));
}
