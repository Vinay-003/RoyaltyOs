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
    api(`/api/v1/workspaces/${workspaceId}/members`)
      .then(setMembers)
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Workspace Access & Roles</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Role-based access control (RBAC) governing contract approval and settlement execution.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Team Members</h3>
            <p className="card-sub">Authorized personnel for this workspace</p>
          </div>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User Email</th>
                <th>Role</th>
                <th>Permissions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.email}</td>
                  <td>
                    <span className="badge badge-blue">{m.role}</span>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {m.role === "FINANCE_ADMIN" ? "Full payment, rule activation, and contract review" : "Read-only ledger access"}
                  </td>
                </tr>
              ))}
              {members.length === 0 && !loading && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>
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
