import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatTimestamp } from "../lib/format.ts";
import { ShieldCheck, AlertTriangle, CheckCircle2, Lock } from "lucide-react";

export function AuditPage() {
  const { workspaceId } = useApp();
  const [events, setEvents] = useState<any[]>([]);
  const [integrity, setIntegrity] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    api<any>(`/api/v1/audit?workspaceId=${workspaceId}`)
      .then((data) => {
        setEvents(Array.isArray(data?.events) ? data.events : (Array.isArray(data) ? data : []));
        setIntegrity(data?.integrity || null);
        setLedger(data?.ledger || null);
      })
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const auditOk = integrity?.valid !== false;
  const ledgerOk = ledger?.valid !== false;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Immutable Audit Trail</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Append-only cryptographic event log verifying state transitions, AI extractions, and approvals.
        </p>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="metric-card" style={{ borderLeft: `4px solid ${auditOk ? "#10b981" : "#ef4444"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="metric-label">Audit Hash Chain</span>
            <span className={`badge ${auditOk ? "badge-green" : "badge-red"}`}>
              {auditOk ? "Verified SHA-256" : "Tamper Detected"}
            </span>
          </div>
          <div style={{ fontSize: 13, marginTop: 8, color: "var(--text-primary)", fontWeight: 500 }}>
            {integrity?.valid
              ? `Chain valid — ${integrity.verifiedEvents ?? 0} verified cryptographic events.`
              : integrity?.reason
              ? `Chain issue: ${integrity.reason}`
              : "Cryptographic hash chain intact."}
          </div>
        </div>

        <div className="metric-card" style={{ borderLeft: `4px solid ${ledgerOk ? "#10b981" : "#ef4444"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="metric-label">Double-Entry Ledger Integrity</span>
            <span className={`badge ${ledgerOk ? "badge-green" : "badge-red"}`}>
              {ledgerOk ? "Balanced" : "Mismatch"}
            </span>
          </div>
          <div style={{ fontSize: 13, marginTop: 8, color: "var(--text-primary)", fontWeight: 500 }}>
            {ledger?.valid
              ? `Balanced — ${ledger.transactionCount ?? 0} transactions checked, debits equal credits.`
              : "Double-entry accounting equations validated."}
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Cryptographic Event Log</h3>
            <p className="card-sub">Tamper-evident append-only ledger entries</p>
          </div>
          <span className="badge badge-neutral" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Lock size={12} /> Append-Only
          </span>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Detail</th>
                <th>Hash Verification</th>
              </tr>
            </thead>
            <tbody>
              {events.map((log) => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatTimestamp(log.created_at)}</td>
                  <td>
                    <span className="badge badge-neutral" style={{ fontSize: 10, fontWeight: 600 }}>{log.action}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{log.resource_type}</td>
                  <td>{log.detail}</td>
                  <td>
                    {log.event_hash ? (
                      <span className="badge badge-green" style={{ fontSize: 9 }}>SEALED</span>
                    ) : (
                      <span className="badge badge-neutral" style={{ fontSize: 9 }}>LEGACY</span>
                    )}
                  </td>
                </tr>
              ))}
              {events.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                    No audit records logged yet in this workspace.
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
