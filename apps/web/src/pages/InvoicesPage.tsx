import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatMoney, formatTimestamp } from "../lib/format.ts";
import { Receipt, Plus } from "lucide-react";

export function InvoicesPage() {
  const { projectId, currentProject } = useApp();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [amountDollars, setAmountDollars] = useState("");

  const loadInvoices = async () => {
    if (!projectId) return;
    try {
      const data = await api<any[]>(`/api/v1/invoices?projectId=${projectId}`);
      setInvoices(data);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amountDollars);
    if (!description.trim() || isNaN(val) || val <= 0) {
      showToast("Enter a valid description and positive dollar amount", "warn");
      return;
    }
    try {
      await api("/api/v1/invoices", {
        method: "POST",
        json: {
          projectId,
          description: description.trim(),
          amountMinor: Math.round(val * 100),
          currency: currentProject?.currency || "USD",
        },
      });
      showToast("Inbound revenue event logged", "success");
      setDescription("");
      setAmountDollars("");
      loadInvoices();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const currency = currentProject?.currency || "USD";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Revenue Ledger</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Cleared inbound receipts and platform revenue streams credited to the project.
        </p>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Log Revenue Inflow</h3>
              <p className="card-sub">Credit gross statement receipts</p>
            </div>
          </div>

          <form onSubmit={handleCreate}>
            <div className="field">
              <label>Revenue Source Description</label>
              <input
                type="text"
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Spotify Q3 Distribution"
                required
              />
            </div>

            <div className="field">
              <label>Amount ({currency})</label>
              <input
                type="number"
                step="0.01"
                className="input amount"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                placeholder="25000.00"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: 8 }}>
              <Plus size={14} /> Record Revenue Event
            </button>
          </form>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Recorded Receipts</h3>
              <p className="card-sub">Historical revenue entries</p>
            </div>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 600 }}>{inv.description}</td>
                    <td className="amount">{formatMoney(inv.amount_minor, currency)}</td>
                    <td>
                      <span className="badge badge-green">{inv.status || "CLEARED"}</span>
                    </td>
                    <td>{formatTimestamp(inv.created_at)}</td>
                  </tr>
                ))}
                {invoices.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>
                      No revenue invoices logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
