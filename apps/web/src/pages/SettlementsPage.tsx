import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, withStepUp, showToast } from "../lib/api.ts";
import { formatMoney, formatTimestamp } from "../lib/format.ts";
import { Scale, Lock, CheckCircle2, Download, Play, Trash2, Send } from "lucide-react";

export function SettlementsPage() {
  const { workspaceId, projectId, currentProject } = useApp();
  const [settlements, setSettlements] = useState<any[]>([]);
  const [revenueEvents, setRevenueEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    if (!workspaceId && !projectId) return;
    try {
      const [revs, sets] = await Promise.all([
        projectId
          ? api<any[]>(`/api/v1/revenue-events?projectId=${projectId}`)
          : api<any[]>(`/api/v1/revenue-events?workspaceId=${workspaceId}`),
        workspaceId
          ? api<any[]>(`/api/v1/settlements?workspaceId=${workspaceId}`)
          : api<any[]>(`/api/v1/settlements?projectId=${projectId}`),
      ]);
      setRevenueEvents(Array.isArray(revs) ? revs : []);
      setSettlements(Array.isArray(sets) ? sets : []);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [workspaceId, projectId]);

  const settledRevenueIds = new Set(
    settlements.filter((s) => s.status !== "VOIDED").map((s) => s.revenue_event_id)
  );

  const handleCalculate = async (revenueEventId: string) => {
    try {
      await withStepUp(() =>
        api("/api/v1/settlements", {
          method: "POST",
          json: { revenueEventId },
        })
      );
      showToast("Settlement proposal calculated", "success");
      await loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await withStepUp(() =>
        api(`/api/v1/settlements/${id}/approve`, {
          method: "POST",
          json: {},
        })
      );
      showToast("Settlement approved and frozen", "success");
      await loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleVoid = async (id: string) => {
    if (!confirm("Void this settlement proposal? The revenue can be recalculated fresh afterwards.")) return;
    try {
      await withStepUp(() =>
        api(`/api/v1/settlements/${id}/void`, {
          method: "POST",
          json: {},
        })
      );
      showToast("Settlement voided", "info");
      await loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleExecutePayout = async (id: string) => {
    if (!confirm("Execute this approved settlement through PayPal Sandbox?")) return;
    try {
      await withStepUp(() =>
        api(`/api/v1/settlements/${id}/execute`, {
          method: "POST",
          json: {},
        })
      );
      showToast("PayPal payout batch submitted", "success");
      await loadData();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleExportCsv = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/settlements/export.csv?settlementId=${encodeURIComponent(id)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `royaltyos-${id}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("CSV exported", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const currency = currentProject?.currency || "USD";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Deterministic Settlement Cycles</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Transform cleared revenue events into immutable cryptographic settlements before executing PayPal disbursements.
        </p>
      </div>

      {/* Authoritative Revenue Events Section */}
      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div>
            <h3 className="card-title">Authoritative Revenue Receipts</h3>
            <p className="card-sub">Inbound receipts ready for statement calculation</p>
          </div>
          <span className="badge badge-neutral">{revenueEvents.length} Event(s)</span>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Source & Ref</th>
                <th>Received</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {revenueEvents.map((r) => {
                const isSettled = settledRevenueIds.has(r.id);
                return (
                  <tr key={r.id}>
                    <td className="amount" style={{ fontWeight: 700 }}>
                      {formatMoney(r.distributable_minor, r.currency || currency)}
                    </td>
                    <td>
                      <span style={{ fontWeight: 500 }}>{r.source || "Inbound Receipt"}</span>
                      <small style={{ display: "block", color: "var(--text-muted)", fontSize: 10 }} className="mono">
                        {r.external_id || r.id}
                      </small>
                    </td>
                    <td>{formatTimestamp(r.received_at || r.created_at)}</td>
                    <td>
                      <span className={`badge ${isSettled ? "badge-green" : "badge-amber"}`}>
                        {isSettled ? "SETTLED" : "PENDING"}
                      </span>
                    </td>
                    <td>
                      {!isSettled && (
                        <button
                          onClick={() => handleCalculate(r.id)}
                          className="btn btn-primary"
                          style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <Play size={12} /> Calculate Settlement
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {revenueEvents.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>
                    No revenue events found. Create and pay a PayPal invoice to log income.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Settlements Stack */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {settlements.map((s) => (
          <section key={s.id} className="card" style={{ opacity: s.status === "VOIDED" ? 0.6 : 1 }}>
            <div className="card-header">
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>
                  Settlement {s.id.slice(0, 8)}… · Engine {s.algorithm_version || "v1"}
                </div>
                <h3 className="card-title" style={{ fontSize: 18 }}>
                  {formatMoney(s.distributable_minor, s.currency || currency)}
                </h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  className={`badge ${
                    s.status === "SUCCESS" || s.status === "APPROVED"
                      ? "badge-green"
                      : s.status === "VOIDED"
                      ? "badge-red"
                      : "badge-amber"
                  }`}
                >
                  {s.status}
                </span>
              </div>
            </div>

            {/* Settlement Lines Breakdown */}
            <div className="data-table-wrap" style={{ margin: "12px 0" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Kind</th>
                    <th>Payable</th>
                    <th>Total Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {(s.lines || []).map((l: any, idx: number) => (
                    <tr key={idx}>
                      <td>
                        <strong style={{ fontSize: 13, textTransform: "capitalize" }}>{l.beneficiary_name}</strong>
                        <small style={{ display: "block", color: "var(--text-muted)", fontSize: 10 }}>
                          {l.payout_email || "Non-payable"}
                        </small>
                      </td>
                      <td>
                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>{l.line_kind}</span>
                      </td>
                      <td className="amount" style={{ color: "#34d399", fontWeight: 600 }}>
                        {formatMoney(l.payable_minor, s.currency || currency)}
                      </td>
                      <td className="amount">{formatMoney(l.amount_minor, s.currency || currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Actions Toolbar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }} className="mono">
                Hash: {s.settlement_hash ? `${s.settlement_hash.slice(0, 18)}...` : "Pending"}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handleExportCsv(s.id)}
                  className="btn btn-secondary"
                  style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Download size={12} /> CSV
                </button>

                {s.status === "APPROVAL_REQUIRED" && (
                  <>
                    <button
                      onClick={() => handleVoid(s.id)}
                      className="btn btn-secondary"
                      style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <Trash2 size={12} /> Void
                    </button>
                    <button
                      onClick={() => handleApprove(s.id)}
                      className="btn btn-primary"
                      style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <Lock size={12} /> Freeze & Approve
                    </button>
                  </>
                )}

                {s.status === "APPROVED" && (
                  <button
                    onClick={() => handleExecutePayout(s.id)}
                    className="btn btn-primary"
                    style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Send size={12} /> Execute PayPal Payout
                  </button>
                )}
              </div>
            </div>
          </section>
        ))}

        {settlements.length === 0 && !loading && (
          <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
            No settlement periods created yet. Click "Calculate Settlement" on a revenue event above.
          </div>
        )}
      </div>
    </div>
  );
}
