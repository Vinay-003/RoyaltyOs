import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatTimestamp } from "../lib/format.ts";
import { Bell, Mail, ShieldAlert, CheckCircle2 } from "lucide-react";

interface NotificationItem {
  id: string;
  user_id: string | null;
  recipient_email: string | null;
  channel: string;
  event_type: string;
  subject: string;
  payload: any;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

export function NotificationsPage() {
  const { workspaceId, projectId } = useApp();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId && !projectId) return;
    const query = workspaceId ? `workspaceId=${workspaceId}` : `projectId=${projectId}`;
    api<NotificationItem[]>(`/api/v1/notifications?${query}`)
      .then((res) => {
        setNotifications(Array.isArray(res) ? res : []);
      })
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [workspaceId, projectId]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div className="kicker" style={{ marginBottom: 4 }}>SECURITY & PIPELINE TELEMETRY</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>System Notifications</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          Auditable event logs, payout dispatches, step-up verifications, and pipeline delivery receipts.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Dispatch History</h2>
            <p className="card-sub">Realtime notification queue and event deliveries</p>
          </div>
          <span className="badge badge-neutral" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Bell size={12} />
            {notifications.length} logged
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notifications.map((n) => (
            <div
              key={n.id}
              style={{
                background: "var(--bg-input)",
                padding: "14px 16px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {n.channel === "EMAIL" ? (
                    <Mail size={14} style={{ color: "var(--accent)" }} />
                  ) : (
                    <ShieldAlert size={14} style={{ color: "var(--status-warning)" }} />
                  )}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <strong style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>
                      {n.subject || n.event_type || "System Event"}
                    </strong>
                    <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                      {n.event_type}
                    </span>
                    <span
                      className={`badge ${
                        n.status === "SENT" || n.status === "DELIVERED"
                          ? "badge-success"
                          : n.status === "FAILED"
                          ? "badge-danger"
                          : "badge-warning"
                      }`}
                      style={{ fontSize: 10 }}
                    >
                      {n.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {n.recipient_email && <span>Recipient: {n.recipient_email} · </span>}
                    {n.payload?.message ? (
                      n.payload.message
                    ) : (
                      <span className="mono" style={{ fontSize: 11 }}>
                        ID: {n.id.slice(0, 18)}...
                      </span>
                    )}
                  </div>
                  {n.last_error && (
                    <div style={{ fontSize: 11, color: "var(--status-danger)", marginTop: 4 }}>
                      Error: {n.last_error}
                    </div>
                  )}
                </div>
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                {formatTimestamp(n.created_at)}
              </span>
            </div>
          ))}

          {notifications.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}>
              <CheckCircle2 size={32} style={{ margin: "0 auto 10px", color: "var(--status-success)", opacity: 0.8 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                No notifications logged
              </div>
              <div style={{ fontSize: 12 }}>All financial and operational events are current and nominal.</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
