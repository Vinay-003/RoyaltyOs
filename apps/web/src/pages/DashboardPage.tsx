import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api } from "../lib/api.ts";
import { formatMoney, formatTimestamp } from "../lib/format.ts";
import { TrendingUp, FileText, CheckCircle2, DollarSign, Activity } from "lucide-react";

export function DashboardPage() {
  const { projectId, currentProject } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    api(`/api/v1/projects/${projectId}/dashboard`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const currency = currentProject?.currency || "USD";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Financial Operating Console</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Real-time deterministic revenue split tracking, active RuleSet enforcement, and settlement execution.
        </p>
      </div>

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Total Revenue Processed</div>
          <div className="metric-val">{formatMoney(data?.totalRevenueMinor ?? 0, currency)}</div>
          <div className="metric-sub">Cleared receipts across statement cycles</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Total Distributed</div>
          <div className="metric-val" style={{ color: "#34d399" }}>
            {formatMoney(data?.totalPayoutMinor ?? 0, currency)}
          </div>
          <div className="metric-sub">Paid out to verified beneficiaries</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Reserve Balance</div>
          <div className="metric-val" style={{ color: "#60a5fa" }}>
            {formatMoney(data?.reserveBalanceMinor ?? 0, currency)}
          </div>
          <div className="metric-sub">Escrow holdbacks funded</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Active RuleSet</div>
          <div className="metric-val" style={{ color: "#fbbf24" }}>
            {data?.activeRuleset ? `v${data.activeRuleset.version}` : "Draft v0"}
          </div>
          <div className="metric-sub">{data?.activeRuleset?.ruleCount ?? 0} compiled mathematical rules</div>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Recent Settlement Cycles</h3>
              <p className="card-sub">Immutable period close records</p>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Revenue</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recentSettlements || []).map((s: any) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.period || "Current"}</td>
                    <td className="amount">{formatMoney(s.revenue_minor, currency)}</td>
                    <td>
                      <span className={`badge ${s.status === "PAID" ? "badge-green" : "badge-amber"}`}>
                        {s.status}
                      </span>
                    </td>
                    <td>{formatTimestamp(s.created_at)}</td>
                  </tr>
                ))}
                {(!data?.recentSettlements || data.recentSettlements.length === 0) && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>
                      No settlements generated yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Financial Execution Guardrails</h3>
              <p className="card-sub">Deterministic integrity checks</p>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", background: "var(--bg-input)", padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <CheckCircle2 size={18} color="#34d399" />
              <div>
                <strong style={{ fontSize: 13, display: "block" }}>100% Penny-Conservation Math</strong>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Largest remainder apportionment guarantees integer minor units balance exactly to the cent.</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", background: "var(--bg-input)", padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <CheckCircle2 size={18} color="#34d399" />
              <div>
                <strong style={{ fontSize: 13, display: "block" }}>Zero AI-Execution in Ledger</strong>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>AI extracts candidate rules into human-review queue; financial money movement is 100% deterministic code.</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", background: "var(--bg-input)", padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <CheckCircle2 size={18} color="#34d399" />
              <div>
                <strong style={{ fontSize: 13, display: "block" }}>Two-Phase Settlement Freeze</strong>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Step-up password authorization required before any batch is transmitted to PayPal.</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
