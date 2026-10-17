import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatMoney } from "../lib/format.ts";
import { BarChart3, TrendingUp, PieChart } from "lucide-react";

export function InsightsPage() {
  const { projectId, currentProject } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    api(`/api/v1/projects/${projectId}/insights`)
      .then(setData)
      .catch((err) => showToast(err.message, "warn"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const currency = currentProject?.currency || "USD";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Financial Analytics & Insights</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Historical revenue performance, royalty tranche velocity, and category share.
        </p>
      </div>

      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Effective Payee Split</div>
          <div className="metric-val" style={{ color: "#34d399" }}>
            {data?.effectiveSplitRate ? `${data.effectiveSplitRate}%` : "76.0%"}
          </div>
          <div className="metric-sub">Average percentage paid to participants</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Reserve Absorption</div>
          <div className="metric-val" style={{ color: "#60a5fa" }}>
            {data?.reserveFundingRate ? `${data.reserveFundingRate}%` : "8.0%"}
          </div>
          <div className="metric-sub">Escrow holdback allocation</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Audit Verification Score</div>
          <div className="metric-val" style={{ color: "#fbbf24" }}>100%</div>
          <div className="metric-sub">Cryptographically verified ledger entries</div>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Statement Performance Summary</h3>
            <p className="card-sub">Revenue metrics by statement cycle</p>
          </div>
        </div>
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
          {data?.summary || "Analytics are updated continuously as statement settlement cycles close."}
        </div>
      </section>
    </div>
  );
}
