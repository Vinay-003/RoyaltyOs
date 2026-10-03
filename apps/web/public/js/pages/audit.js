import { api } from "../api.js";
import { shell } from "../nav.js";
import { state } from "../state.js";
import { esc, hero } from "../utils.js";

function integritySummary(integrity) {
  if (!integrity) return "Not verified yet.";
  const verified = Number(integrity.verifiedEvents ?? 0);
  const legacy = Number(integrity.legacyEvents ?? integrity.legacy ?? 0);
  const state = integrity.valid ? "valid" : `BROKEN (${esc(integrity.reason ?? "unknown")})`;
  return `Chain ${state} — ${verified} verified, ${legacy} legacy (pre-chain, not cryptographic).`;
}

function eventHashLabel(event) {
  if (!event.event_hash) return "legacy (pre-chain)";
  return `${esc(String(event.event_hash).slice(0, 18))}...`;
}

export async function audit() {
  const d = await api(`/api/v1/audit?workspaceId=${state.workspaceId}`);
  const auditOk = d.integrity?.valid;
  const ledgerOk = d.ledger?.valid;
  shell(
    `${hero("APPEND-ONLY AUDIT", "Reconstruct every sensitive decision.", "The database verifies the SHA-256 hash chain and separately verifies that every double-entry ledger transaction balances.")}` +
      `<div class="grid2">` +
      `<div class="notice ${auditOk ? "success" : "error"}"><b>Audit chain</b><br>${esc(integritySummary(d.integrity))}</div>` +
      `<div class="notice ${ledgerOk ? "success" : "error"}"><b>Ledger integrity</b><br>${esc(JSON.stringify(d.ledger))}</div>` +
      `</div>` +
      `<section class="card" style="margin-top:12px"><div class="timeline">` +
      `${d.events.map((e) => `<div class="audit-row"><span class="mono">${new Date(e.created_at).toLocaleString()}</span><div class="audit-dot"></div><div><b>${esc(e.action)}</b><p>${esc(e.detail)}</p><small class="mono">${esc(e.resource_type)} · ${esc(e.resource_id)} · ${eventHashLabel(e)}</small></div></div>`).join("") || '<div class="empty">No audit events yet.</div>'}` +
      `</div></section>`,
    "Audit",
  );
}
