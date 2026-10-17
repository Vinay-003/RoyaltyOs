import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatMoney } from "../lib/format.ts";
import { Coins, FileCheck, DollarSign, CheckCircle2 } from "lucide-react";

export function RoyaltiesPage() {
  const { workspaceId, projectId, currentProject } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId && !projectId) return;
    setLoading(true);
    const target = workspaceId ? `/api/v1/reports/royalties?workspaceId=${workspaceId}` : `/api/v1/projects/${projectId}/royalties`;
    api<any>(target)
      .then(setData)
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [workspaceId, projectId]);

  const currency = currentProject?.currency || "USD";
  const rows: any[] = Array.isArray(data?.rows) ? data.rows : [];
  const recoupments: any[] = Array.isArray(data?.recoupments) ? data.recoupments : [];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Explainable Royalty Statements</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Every royalty line traces directly to the contract clause evidence, revenue event source, and PayPal payout status.
        </p>
      </div>

      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Total Payable in View</div>
          <div className="metric-val" style={{ color: "#34d399" }}>
            {formatMoney(data?.totalPayableMinor ?? 0, currency)}
          </div>
          <div className="metric-sub">{rows.length} verified allocation line(s)</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Statement Scope</div>
          <div className="metric-val" style={{ color: "var(--accent-primary)" }}>
            {data?.scope || "ALL"}
          </div>
          <div className="metric-sub">Role / beneficiary visibility filter</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Recoupment Accounts</div>
          <div className="metric-val" style={{ color: "#fbbf24" }}>
            {recoupments.length}
          </div>
          <div className="metric-sub">Active advance ledgers monitored</div>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div>
            <h3 className="card-title">Statement Allocation Lines</h3>
            <p className="card-sub">Traced to contract source clause & evidence</p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((r, idx) => (
            <div key={idx} className="card" style={{ background: "var(--bg-input)", border: "1px solid var(--border-subtle)", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>
                    {r.line?.beneficiary_name || r.line?.beneficiary_key}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                    {formatMoney(r.line?.payable_minor ?? 0, r.settlement?.currency || currency)}
                  </div>
                </div>
                <span className={`badge ${r.payoutItem?.status === "SUCCESS" || r.settlement?.status === "PAID" ? "badge-green" : "badge-amber"}`}>
                  {r.payoutItem?.status || r.settlement?.status || "CALCULATED"}
                </span>
              </div>

              <div className="grid-3" style={{ gap: 10, marginBottom: 10 }}>
                <div style={{ background: "var(--bg-card)", padding: 10, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                  <strong style={{ fontSize: 11, display: "block", color: "var(--text-primary)" }}>Contract Rule</strong>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.rule?.rule_type || "Split"}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                    {r.evidence?.source_document || "Agreement.pdf"} · Page {r.evidence?.page ?? "?"} · Clause {r.evidence?.clause ?? "?"}
                  </div>
                </div>

                <div style={{ background: "var(--bg-card)", padding: 10, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                  <strong style={{ fontSize: 11, display: "block", color: "var(--text-primary)" }}>Revenue Source</strong>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.revenue?.source || "Inbound Payment"}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }} className="mono">
                    Ref: {r.revenue?.external_id || r.settlement?.id?.slice(0, 8)}
                  </div>
                </div>

                <div style={{ background: "var(--bg-card)", padding: 10, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                  <strong style={{ fontSize: 11, display: "block", color: "var(--text-primary)" }}>PayPal Disbursement</strong>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.payoutItem?.status || "Pending settlement batch"}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }} className="mono">
                    {r.payoutItem?.transaction_id || r.payoutItem?.paypal_item_id || "Unsubmitted"}
                  </div>
                </div>
              </div>

              {r.evidence?.source_text && (
                <div style={{ background: "var(--bg-card)", borderLeft: "3px solid var(--accent-primary)", padding: "8px 12px", fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                  "{r.evidence.source_text}"
                </div>
              )}
            </div>
          ))}

          {rows.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 13 }}>
              No royalty statement lines generated yet. Settle revenue events to populate lines.
            </div>
          )}
        </div>
      </section>

      {recoupments.length > 0 && (
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
                {recoupments.map((rec) => (
                  <tr key={rec.id}>
                    <td style={{ fontWeight: 600, textTransform: "capitalize" }}>
                      {rec.beneficiary_key?.replace(/_/g, " ") || "Primary Credit"}
                    </td>
                    <td className="amount">{formatMoney(rec.opening_balance_minor || rec.original_minor, currency)}</td>
                    <td className="amount" style={{ color: Number(rec.remaining_balance_minor ?? rec.remaining_minor) > 0 ? "#fbbf24" : "#34d399" }}>
                      {formatMoney(rec.remaining_balance_minor ?? rec.remaining_minor, currency)}
                    </td>
                    <td>
                      <span className={`badge ${Number(rec.remaining_balance_minor ?? rec.remaining_minor) === 0 ? "badge-green" : "badge-amber"}`}>
                        {Number(rec.remaining_balance_minor ?? rec.remaining_minor) === 0 ? "RECOUPED" : "UNRECOUPED"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
