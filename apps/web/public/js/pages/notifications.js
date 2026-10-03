import { api } from "../api.js";
import { shell } from "../nav.js";
import { state } from "../state.js";
import { esc, hero, statusBadge } from "../utils.js";

export async function notificationsView(){
  const rows=await api(`/api/v1/notifications?workspaceId=${state.workspaceId}`);
  shell(`${hero("NOTIFICATIONS","Operational delivery history.","Settlement approval and payout lifecycle notifications are stored durably. Set NOTIFICATION_PROVIDER=resend to deliver email; disabled mode records SKIPPED delivery without blocking finance workflows.")}<section class="card"><div class="table"><div class="tr head"><span>Event</span><span>Recipient</span><span>Status</span><span>Created</span></div>${rows.map(n=>`<div class="tr"><span><b>${esc(n.subject||n.event_type)}</b><br><small>${esc(n.event_type)}</small></span><span>${esc(n.recipient_email||n.user_id||"")}</span><span>${statusBadge(n.status)}</span><span>${new Date(n.created_at).toLocaleString()}</span></div>`).join("")||'<div class="empty">No notifications yet.</div>'}</div></section>`,"Notifications");
}
