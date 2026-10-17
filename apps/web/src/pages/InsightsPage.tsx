import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatMoney } from "../lib/format.ts";
import { BarChart3, TrendingUp, ShieldCheck, AlertCircle, PieChart } from "lucide-react";

export function InsightsPage() {
  const { workspaceId, projectId, currentProject } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId && !projectId) return;
    setLoading(true);
    const target = workspaceId ? `/api/v1/insights?workspaceId=${workspaceId}` : `/api/v1/projects/${projectId}/insights`;
    api<any>(target)
      .then(setData)
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [workspaceId, projectId]);

  const currency = currentProject?.currency || "USD";
  const metrics = data?.metrics || {};
  const latestSettlement = data?.latestSettlement;
  const lines: any[] = Array.isArray(latestSettlement?.lines) ? latestSettlement.lines : [];
  const maxLineAmount = Math.max(1, ...lines.map((l) => Number(l.amount_minor || 0)));
  const recoupments: any[] = Array.isArray(data?.recoupments) ? data.recoupments : [];
  const issues: any[] = Array.isArray(data?.reconciliationIssues) ? data.reconciliationIssues : [];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Financial Analytics & Insights</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Deterministic calculations, latest settlement allocation map, advance recovery, and integrity verifications.
        </p>
      </div>

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Gross Revenue Cleared</div>
          <div className="metric-val">{formatMoney(metrics.revenueMinor ?? 0, currency)}</div>
          <div className="metric-sub">{metrics.invoiceCount ?? 0} PayPal invoice(s) generated</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Payout Remittances</div>
          <div className="metric-val" style={{ color: "#34d399" }}>
            {formatMoney(metrics.payoutSuccessMinor ?? 0, currency)}
          </div>
          <div className="metric-sub">Executed through PayPal Payouts</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Settlement Cycles</div>
          <div className="metric-val" style={{ color: "#60a5fa" }}>
            {metrics.settlementCount ?? 0}
          </div>
          <div className="metric-sub">{metrics.pendingSettlementCount ?? 0} awaiting approval</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Active RuleSets</div>
          <div className="metric-val" style={{ color: "#fbbf24" }}>
            {metrics.activeRulesetCount ?? 0}
          </div>
          <div className="metric-sub">Automated waterfall pipelines</div>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Latest Settlement Allocation Map</h3>
              <p className="card-sub">
                {latestSettlement
                  ? `Cycle ${latestSettlement.id?.slice(0, 8)} · ${formatMoney(latestSettlement.distributable_minor, latestSettlement.currency || currency)}`
                  : "No settlements calculated yet"}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {lines.map((l, idx) => (
              <div key={idx} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <strong style={{ fontSize: 13, textTransform: "capitalize" }}>{l.beneficiary_name || l.beneficiary_key}</strong>
                  <span className="amount">{formatMoney(l.amount_minor, latestSettlement?.currency || currency)}</span>
                </div>
                <div style={{ height: 6, background: "var(--bg-elevated)", borderRadius: 999, overflow: "hidden", margin: "6px 0" }}>
                  <div
                    style={{
                      width: `${Math.min(100, (Number(l.amount_minor || 0) / maxLineAmount) * 100)}%`,
                      height: "100%",
                      background: "var(--accent-primary)",
                      borderRadius: 999,
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
                  <span>{l.line_kind || "Standard Split"}</span>
                  <span>Payable: {formatMoney(l.payable_minor, latestSettlement?.currency || currency)}</span>
                </div>
              </div>
            ))}
            {lines.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 12 }}>
                No settlement allocation lines recorded yet.
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Recoupment & Advance Recovery</h3>
              <p className="card-sub">Tracking recoupment priorities</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {recoupments.map((r, idx) => (
              <div key={idx} className="metric-card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 13, textTransform: "capitalize" }}>{r.beneficiary_key}</strong>
                  <span className={`badge ${Number(r.remaining_minor) === 0 ? "badge-green" : "badge-amber"}`}>
                    {Number(r.remaining_minor) === 0 ? "Fully Recouped" : "Unrecouped"}
                  </span>
                </div>
                <div style={{ fontSize: 12, marginTop: 6, color: "var(--text-secondary)" }}>
                  {formatMoney(r.recouped_minor ?? 0, r.currency || currency)} recouped of {formatMoney(r.original_minor ?? 0, r.currency || currency)}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  Remaining balance: {formatMoney(r.remaining_minor ?? 0, r.currency || currency)}
                </div>
              </div>
            ))}
            {recoupments.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 12 }}>
                No active recoupment accounts configured.
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className={`badge ${data?.auditIntegrity?.valid !== false ? "badge-green" : "badge-red"}`} style={{ padding: "8px 12px", display: "flex", gap: 6 }}>
                <ShieldCheck size={14} />
                <span>Audit Chain: {data?.auditIntegrity?.valid !== false ? "100% Cryptographically Sealed" : "Tamper Alert"}</span>
              </div>
              <div className={`badge ${data?.financialIntegrity?.valid !== false ? "badge-green" : "badge-amber"}`} style={{ padding: "8px 12px", display: "flex", gap: 6 }}>
                <ShieldCheck size={14} />
                <span>Financial Ledger: {data?.financialIntegrity?.valid !== false ? "Perfect Conservation Balanced" : "Open Issues"}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
