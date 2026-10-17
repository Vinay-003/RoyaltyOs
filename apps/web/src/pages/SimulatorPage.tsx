import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatMoney } from "../lib/format.ts";
import { PlayCircle, CheckCircle2, DollarSign } from "lucide-react";

export function SimulatorPage() {
  const { projectId, workspaceId, currentProject } = useApp();
  const [activeRuleset, setActiveRuleset] = useState<any>(null);
  const [revenueDollars, setRevenueDollars] = useState("100000");
  const [category, setCategory] = useState("all");
  const [result, setResult] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    if (!projectId && !workspaceId) return;
    const query = projectId ? `projectId=${projectId}` : `workspaceId=${workspaceId}`;
    api(`/api/v1/rulesets/active?${query}`)
      .then((data: any) => setActiveRuleset(data?.ruleset ?? null))
      .catch(() => {});
  }, [projectId, workspaceId]);

  const currency = currentProject?.currency || "USD";

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRuleset) {
      showToast("Activate an approved RuleSet first", "warn");
      return;
    }
    const val = parseFloat(revenueDollars.replace(/[^0-9.]/g, ""));
    if (isNaN(val) || val <= 0) {
      showToast("Enter a valid revenue dollar amount", "warn");
      return;
    }
    setSimulating(true);
    try {
      const revenueMinor = Math.round(val * 100);
      const res = await api<{ result: any }>(`/api/v1/rulesets/${activeRuleset.id}/simulate`, {
        method: "POST",
        json: {
          revenueMinor,
          currency,
          revenueCategory: category === "all" ? null : category,
        },
      });
      setResult(res.result);
      showToast("Simulation computed successfully", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div className="kicker" style={{ marginBottom: 4 }}>DETERMINISTIC SIMULATION</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Scenario Simulator</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          Run synthetic financial calculations against the active RuleSet to verify exact penny allocations.
        </p>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Scenario Parameters</h2>
              <p className="card-sub">
                Targeting Active RuleSet {activeRuleset ? `v${activeRuleset.version}` : "(None Active)"}
              </p>
            </div>
          </div>

          <form onSubmit={handleSimulate}>
            <div className="field">
              <label>Gross Statement Revenue ({currency})</label>
              <input
                type="text"
                className="input amount"
                value={revenueDollars}
                onChange={(e) => setRevenueDollars(e.target.value)}
                placeholder="100000"
              />
            </div>

            <div className="field">
              <label>Revenue Category Stream</label>
              <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">All Categories (Standard Waterfall)</option>
                <option value="streaming">Digital Streaming</option>
                <option value="sync">Synchronization / Licensing</option>
                <option value="physical">Physical Merchandise</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={simulating || !activeRuleset}
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 8 }}
            >
              <PlayCircle size={15} />
              {simulating ? "Calculating Deterministic Math..." : "Run Scenario Simulation"}
            </button>
          </form>
        </section>

        {result && (
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Calculation Breakdown</h2>
                <p className="card-sub">Penny-perfect allocation across waterfall</p>
              </div>
              <span className="badge badge-success">Conserved</span>
            </div>

            <div className="grid-2" style={{ marginBottom: 16 }}>
              <div style={{ background: "var(--bg-input)", padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>Total Inflow</div>
                <div className="amount" style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                  {formatMoney(result.revenueMinor, currency)}
                </div>
              </div>

              <div style={{ background: "var(--bg-input)", padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>Payable Payouts</div>
                <div className="amount" style={{ fontSize: 18, fontWeight: 700, color: "var(--status-success)" }}>
                  {formatMoney(result.payableMinor, currency)}
                </div>
              </div>
            </div>

            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Beneficiary</th>
                    <th>Kind</th>
                    <th>Allocated</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.lines || []).map((line: any, idx: number) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 600, textTransform: "capitalize" }}>
                        {line.beneficiaryKey?.replace(/_/g, " ") || "Reserve"}
                      </td>
                      <td>
                        <span className={`badge ${line.kind === "RESERVE" ? "badge-neutral" : "badge-neutral"}`} style={{ fontSize: 9 }}>
                          {line.kind}
                        </span>
                      </td>
                      <td className="amount" style={{ color: line.payableMinor > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
                        {formatMoney(line.amountMinor, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
