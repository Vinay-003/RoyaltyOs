import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatTimestamp } from "../lib/format.ts";
import { Bell, CheckCheck } from "lucide-react";

export function NotificationsPage() {
  const { workspaceId } = useApp();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    api(`/api/v1/notifications?workspaceId=${workspaceId}`)
      .then(setNotifications)
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>System Notifications</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Alerts on contract analyses, settlement completions, and step-up authorizations.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Recent Alerts</h3>
            <p className="card-sub">Event dispatch history</p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notifications.map((n) => (
            <div key={n.id} style={{ background: "var(--bg-input)", padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ fontSize: 13, color: "#fff", display: "block" }}>{n.title || "Notification"}</strong>
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{n.message}</span>
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{formatTimestamp(n.created_at)}</span>
            </div>
          ))}
          {notifications.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)", fontSize: 12 }}>
              No notifications pending. All financial pipelines are nominal.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
