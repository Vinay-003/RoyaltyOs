import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatTimestamp } from "../lib/format.ts";
import { FileCheck, ShieldCheck } from "lucide-react";

export function AuditPage() {
  const { workspaceId } = useApp();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    api(`/api/v1/audit?workspaceId=${workspaceId}`)
      .then(setLogs)
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Immutable Audit Trail</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Append-only cryptographic event log verifying state transitions, AI extractions, and approvals.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Event Ledger</h3>
            <p className="card-sub">SHA-256 sealed audit records</p>
          </div>
          <span className="badge badge-green">Tamper Evident</span>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatTimestamp(log.created_at)}</td>
                  <td>
                    <span className="badge badge-neutral" style={{ fontSize: 10 }}>{log.action}</span>
                  </td>
                  <td className="mono">{log.resource_type}</td>
                  <td>{log.detail}</td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>
                    No audit records logged yet.
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
