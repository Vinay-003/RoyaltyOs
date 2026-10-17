import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatMoney, formatRate } from "../lib/format.ts";
import { Network, ArrowDown, Shield, Coins, Layers, CheckCircle2 } from "lucide-react";

export function RuleGraphPage() {
  const { projectId, currentProject } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    api(`/api/v1/rulesets/active?projectId=${projectId}`)
      .then(setData)
      .catch((err) => {
        showToast(err.message, "warn");
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const currency = currentProject?.currency || "USD";
  const rules = data?.rules || [];
  const ruleset = data?.ruleset;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Compiled Rule Graph</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Deterministic waterfall dependency graph compiled from verified contract rules.
        </p>
      </div>

      {ruleset ? (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "center", background: "var(--bg-card)", padding: "12px 16px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-card)", marginBottom: 20 }}>
            <div>
              <span className="badge badge-green" style={{ fontSize: 11 }}>Active RuleSet v{ruleset.version}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Hash: <span className="mono" style={{ color: "var(--text-primary)" }}>{ruleset.ruleset_hash?.slice(0, 16)}...</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Enforcing <strong style={{ color: "#fff" }}>{rules.length}</strong> mathematical constraints
            </div>
          </div>

          <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
            {/* Stage 1: Cash Receipts */}
            <div style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border-card)", borderRadius: "var(--radius-md)", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 14, color: "#fff" }}>1. Gross Cash Receipts (G_t)</strong>
                <span className="badge badge-neutral">Inflow</span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                Total cleared funds collected across all platforms and payment channels.
              </p>
            </div>

            <ArrowDown size={20} color="var(--border-active)" />

            {/* Stage 2: Deductions */}
            <div style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border-card)", borderRadius: "var(--radius-md)", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 14, color: "#fff" }}>2. Net Receipts Pool (N_t = max(0, G_t - D_t))</strong>
                <span className="badge badge-neutral">Deductions Floor</span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                Transaction taxes, payment processing fees, and documented approved direct project expenses.
              </p>
            </div>

            <ArrowDown size={20} color="var(--border-active)" />

            {/* Stage 3: Senior Obligations */}
            <div style={{ width: "100%", background: "rgba(37,99,235,0.06)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: "var(--radius-md)", padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Shield size={16} color="#60a5fa" />
                  <strong style={{ fontSize: 14, color: "#fff" }}>3. Senior Waterfall Deductions</strong>
                </div>
                <span className="badge badge-blue">Priority 10–20</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {rules.filter((r: any) => r.type === "RESERVE" || r.type === "RECOUPMENT").map((r: any) => (
                  <div key={r.id} style={{ background: "var(--bg-card)", padding: 12, borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span className="badge badge-neutral" style={{ fontSize: 10 }}>{r.type}</span>
                      <strong className="num" style={{ fontSize: 12 }}>{formatRate(r.rate_basis_points ?? r.config?.preRecoupmentBasisPoints)}</strong>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{r.beneficiary_key || "Reserve Holdback"}</div>
                    {r.config?.advanceMinor && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        Advance Balance: {formatMoney(r.config.advanceMinor, currency)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <ArrowDown size={20} color="var(--border-active)" />

            {/* Stage 4: Downstream Splits */}
            <div style={{ width: "100%", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: "var(--radius-md)", padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Coins size={16} color="#34d399" />
                  <strong style={{ fontSize: 14, color: "#fff" }}>4. Residual Royalty Splits (Q_t = P_t - R_t)</strong>
                </div>
                <span className="badge badge-green">Remainder Base</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rules.filter((r: any) => r.type !== "RESERVE" && r.type !== "RECOUPMENT").map((r: any) => (
                  <div key={r.id} style={{ background: "var(--bg-card)", padding: 12, borderRadius: 8, border: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong style={{ fontSize: 13, textTransform: "capitalize", color: "#fff" }}>
                        {r.beneficiary_key?.replace(/_/g, " ") || "Payee"}
                      </strong>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        Base: {r.base} · Type: {r.type}
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      {r.type === "TIERED_CUMULATIVE" && r.config?.tiers ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          {r.config.tiers.map((t: any, i: number) => (
                            <span key={i} className="badge badge-neutral num">
                              {formatRate(t.rateBasisPoints)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="badge badge-neutral num">{formatRate(r.rate_basis_points)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
          No active RuleSet compiled for this project yet. Go to Contracts and activate an approved RuleSet.
        </div>
      )}
    </div>
  );
}
