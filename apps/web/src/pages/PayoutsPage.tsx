import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, withStepUp, showToast } from "../lib/api.ts";
import { formatMoney, formatTimestamp } from "../lib/format.ts";
import { Send, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

export function PayoutsPage() {
  const { workspaceId, projectId, currentProject } = useApp();
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPayouts = async () => {
    if (!workspaceId && !projectId) return;
    try {
      const target = workspaceId ? `/api/v1/payouts?workspaceId=${workspaceId}` : `/api/v1/payouts?projectId=${projectId}`;
      const data = await api<any[]>(target);
      setPayouts(Array.isArray(data) ? data : []);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayouts();
  }, [workspaceId, projectId]);

  const handleRetry = async (settlementId: string) => {
    try {
      await withStepUp(() =>
        api(`/api/v1/settlements/${settlementId}/retry-payout`, {
          method: "POST",
          json: {},
        })
      );
      showToast("Retry payout batch submitted", "success");
      await loadPayouts();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const currency = currentProject?.currency || "USD";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>PayPal Payout Reconciliation</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Batch and recipient-level payout status. Verified webhooks update items independently; failed items can be retried in a new version.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {payouts.map((b) => {
          const items: any[] = Array.isArray(b.items) ? b.items : [];
          const totalMinor = items.reduce((sum, item) => sum + Number(item.amount_minor || 0), 0);
          const canRetry = /FAILED|PARTIAL_FAILURE|RECONCILIATION_REQUIRED/.test(b.status);

          return (
            <section key={b.id} className="card">
              <div className="card-header">
                <div>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>
                    Batch {b.id.slice(0, 8)}… · v{b.payout_version}
                  </div>
                  <h3 className="card-title" style={{ fontSize: 18 }}>
                    {b.paypal_batch_id || "Not submitted"}
                  </h3>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="amount" style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                    {formatMoney(totalMinor, currency)}
                  </span>
                  <span
                    className={`badge ${
                      b.status === "SUCCESS"
                        ? "badge-green"
                        : b.status === "FAILED"
                        ? "badge-red"
                        : "badge-amber"
                    }`}
                  >
                    {b.status}
                  </span>
                </div>
              </div>

              <div className="data-table-wrap" style={{ margin: "12px 0" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Recipient Email</th>
                      <th>Transaction ID / PayPal Item</th>
                      <th>Item Status</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td style={{ fontWeight: 600 }}>{i.recipient_email}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {i.transaction_id || i.paypal_item_id || "pending"}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              i.status === "SUCCESS"
                                ? "badge-green"
                                : i.status === "FAILED"
                                ? "badge-red"
                                : "badge-amber"
                            }`}
                            style={{ fontSize: 10 }}
                          >
                            {i.status}
                          </span>
                        </td>
                        <td className="amount">{formatMoney(i.amount_minor, i.currency || currency)}</td>
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", padding: 16, color: "var(--text-muted)" }}>
                          No items in this batch.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {canRetry && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <button
                    onClick={() => handleRetry(b.settlement_id)}
                    className="btn btn-primary"
                    style={{ padding: "6px 12px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <RefreshCw size={13} /> Retry Failed Items
                  </button>
                </div>
              )}
            </section>
          );
        })}

        {payouts.length === 0 && !loading && (
          <div className="card" style={{ textAlign: "center", padding: 36, color: "var(--text-muted)" }}>
            No payout batches recorded yet. Execute an approved settlement to dispatch payouts.
          </div>
        )}
      </div>
    </div>
  );
}
