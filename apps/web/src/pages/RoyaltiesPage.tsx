import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatMoney } from "../lib/format.ts";
import { Coins, ShieldCheck } from "lucide-react";

export function RoyaltiesPage() {
  const { projectId, currentProject } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    api(`/api/v1/projects/${projectId}/royalties`)
      .then(setData)
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const currency = currentProject?.currency || "USD";
  const recoupments = data?.recoupments || [];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Recoupment & Royalty Ledgers</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Track unrecouped advances, credit owner priorities, and lifetime royalty allocation counters.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Priority Recoupment Ledgers</h3>
            <p className="card-sub">Advances recouped from priority statement pools</p>
          </div>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Credit Owner</th>
                <th>Original Advance</th>
                <th>Remaining Unrecouped</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recoupments.map((r: any) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, textTransform: "capitalize" }}>
                    {r.beneficiary_key?.replace(/_/g, " ") || "Primary Credit"}
                  </td>
                  <td className="amount">{formatMoney(r.opening_balance_minor, currency)}</td>
                  <td className="amount" style={{ color: r.remaining_balance_minor > 0 ? "#fbbf24" : "#34d399" }}>
                    {formatMoney(r.remaining_balance_minor, currency)}
                  </td>
                  <td>
                    <span className={`badge ${r.remaining_balance_minor === 0 ? "badge-green" : "badge-amber"}`}>
                      {r.remaining_balance_minor === 0 ? "RECOUPED" : "UNRECOUPED"}
                    </span>
                  </td>
                </tr>
              ))}
              {recoupments.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>
                    No recoupment balances registered for this project.
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
