import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { ShieldCheck, UserCheck } from "lucide-react";

export function TeamPage() {
  const { workspaceId } = useApp();
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    api<any[]>(`/api/v1/workspaces/${workspaceId}/members`)
      .then((data) => setMembers(Array.isArray(data) ? data : []))
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div className="kicker" style={{ marginBottom: 4 }}>GOVERNANCE & PERMISSIONS</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Workspace Access & Roles</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          Role-based access control (RBAC) governing contract approval and settlement execution.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Team Members</h2>
            <p className="card-sub">Authorized personnel for this workspace</p>
          </div>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User / Display Name</th>
                <th>Role</th>
                <th>Permissions Scope</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id || m.user_id}>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {m.displayName || m.email || "User"}
                    </div>
                    {m.displayName && m.email && (
                      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{m.email}</div>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-neutral">{m.role}</span>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {m.role === "OWNER" || m.role === "FINANCE_APPROVER"
                      ? "Full payment, rule activation, and contract review"
                      : "Read-only ledger access"}
                  </td>
                </tr>
              ))}
              {members.length === 0 && !loading && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", padding: 24, color: "var(--text-secondary)" }}>
                    No additional team members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
