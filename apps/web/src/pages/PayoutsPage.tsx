import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, withStepUp, showToast } from "../lib/api.ts";
import { formatMoney, formatTimestamp } from "../lib/format.ts";
import { Send, CheckCircle2, AlertCircle } from "lucide-react";

export function PayoutsPage() {
  const { projectId, currentProject } = useApp();
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPayouts = async () => {
    if (!projectId) return;
    try {
      const data = await api<any[]>(`/api/v1/payouts?projectId=${projectId}`);
      setPayouts(data);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayouts();
  }, [projectId]);

  const currency = currentProject?.currency || "USD";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>PayPal Payout Execution</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Track and execute batch remittances via the PayPal Payouts API.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Payout Batches</h3>
            <p className="card-sub">Cryptographically signed batch transactions</p>
          </div>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>Total Payout</th>
                <th>Recipients</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td className="mono" style={{ fontWeight: 600 }}>{p.batch_id || p.id.slice(0, 8)}</td>
                  <td className="amount" style={{ color: "#34d399" }}>{formatMoney(p.total_amount_minor, currency)}</td>
                  <td>{p.item_count ?? 1} beneficiary(s)</td>
                  <td>
                    <span className={`badge ${p.status === "SUCCESS" ? "badge-green" : "badge-amber"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td>{formatTimestamp(p.created_at)}</td>
                </tr>
              ))}
              {payouts.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--text-muted)" }}>
                    No payout batches executed yet.
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
