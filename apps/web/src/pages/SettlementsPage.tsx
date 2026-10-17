import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, withStepUp, showToast } from "../lib/api.ts";
import { formatMoney, formatTimestamp } from "../lib/format.ts";
import { Scale, Lock, CheckCircle2 } from "lucide-react";

export function SettlementsPage() {
  const { projectId, currentProject } = useApp();
  const [settlements, setSettlements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSettlements = async () => {
    if (!projectId) return;
    try {
      const data = await api<any[]>(`/api/v1/settlements?projectId=${projectId}`);
      setSettlements(data);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettlements();
  }, [projectId]);

  const handleApprove = async (id: string) => {
    try {
      await withStepUp(() => api(`/api/v1/settlements/${id}/approve`, { method: "POST", json: {} }));
      showToast("Settlement approved and frozen", "success");
      loadSettlements();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const currency = currentProject?.currency || "USD";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Settlement Cycles</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Close statement periods, freeze calculated ledger allocations, and prepare payouts.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Statement Periods</h3>
            <p className="card-sub">Immutable financial balance sheets</p>
          </div>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Period Name</th>
                <th>Revenue</th>
                <th>Payable</th>
                <th>Status</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.period || "Monthly Close"}</td>
                  <td className="amount">{formatMoney(s.revenue_minor, currency)}</td>
                  <td className="amount" style={{ color: "#34d399" }}>{formatMoney(s.payable_minor, currency)}</td>
                  <td>
                    <span className={`badge ${s.status === "PAID" || s.status === "FROZEN" ? "badge-green" : "badge-amber"}`}>
                      {s.status}
                    </span>
                  </td>
                  <td>{formatTimestamp(s.created_at)}</td>
                  <td>
                    {s.status === "DRAFT" && (
                      <button onClick={() => handleApprove(s.id)} className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: 11 }}>
                        <Lock size={12} /> Freeze & Approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {settlements.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 30, color: "var(--text-muted)" }}>
                    No settlement records found for this project.
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
