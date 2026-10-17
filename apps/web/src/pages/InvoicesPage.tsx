import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { formatMoney, formatTimestamp } from "../lib/format.ts";
import { Receipt, Plus, Send, RefreshCw, ExternalLink } from "lucide-react";

export function InvoicesPage() {
  const { workspaceId, projectId, currentProject } = useApp();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [itemName, setItemName] = useState("Northstar Creator Campaign Revenue");
  const [amountDollars, setAmountDollars] = useState("100.00");
  const [submitting, setSubmitting] = useState(false);

  const loadInvoices = async () => {
    if (!projectId && !workspaceId) return;
    try {
      const target = projectId ? `/api/v1/invoices?projectId=${projectId}` : `/api/v1/invoices?workspaceId=${workspaceId}`;
      const data = await api<any[]>(target);
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, [projectId, workspaceId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amountDollars);
    if (!recipientEmail.trim() || !itemName.trim() || isNaN(val) || val <= 0) {
      showToast("Enter a valid recipient email, item description, and dollar amount", "warn");
      return;
    }
    setSubmitting(true);
    try {
      await api("/api/v1/invoices", {
        method: "POST",
        headers: {
          "Idempotency-Key": crypto.randomUUID(),
        },
        json: {
          workspaceId,
          projectId,
          recipientEmail: recipientEmail.trim(),
          itemName: itemName.trim(),
          amountMinor: Math.round(val * 100),
          currency: currentProject?.currency || "USD",
        },
      });
      showToast("PayPal draft invoice created", "success");
      setRecipientEmail("");
      await loadInvoices();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = async (id: string) => {
    try {
      await api(`/api/v1/invoices/${id}/send`, { method: "POST", json: {} });
      showToast("Invoice sent through PayPal", "success");
      await loadInvoices();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleRefresh = async (id: string) => {
    try {
      const r = await api<any>(`/api/v1/invoices/${id}/refresh`, { method: "POST", json: {} });
      showToast(`PayPal status: ${r.status}`, "info");
      await loadInvoices();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const currency = currentProject?.currency || "USD";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>PayPal Invoicing</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Create and send authoritative PayPal Sandbox invoices. Paid webhooks are cryptographically verified and reconciled against ledger state.
        </p>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">New Draft Invoice</h3>
              <p className="card-sub">Generate PayPal Sandbox invoice</p>
            </div>
          </div>

          <form onSubmit={handleCreate}>
            <div className="field">
              <label>Sandbox Buyer Email</label>
              <input
                type="email"
                className="input"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="sandbox-buyer@example.com"
                required
              />
            </div>

            <div className="field">
              <label>Description / Item Name</label>
              <input
                type="text"
                className="input"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="Creator Campaign Distribution"
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
                placeholder="100.00"
                required
              />
            </div>

            <button type="submit" disabled={submitting} className="btn btn-primary" style={{ width: "100%", marginTop: 8 }}>
              <Plus size={14} /> {submitting ? "Creating PayPal Draft..." : "Create PayPal Draft"}
            </button>
          </form>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Invoice Lifecycle</h3>
              <p className="card-sub">Draft → Sent → Paid & Reconciled</p>
            </div>
            <span className="badge badge-neutral">{invoices.length} Total</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {invoices.map((inv) => (
              <div key={inv.id} className="card" style={{ background: "var(--bg-input)", border: "1px solid var(--border-subtle)", padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div>
                    <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>{inv.item_name}</strong>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {inv.recipient_email} · ID: <span className="mono">{inv.paypal_invoice_id}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="amount" style={{ fontSize: 14, fontWeight: 700 }}>
                      {formatMoney(inv.amount_minor, inv.currency || currency)}
                    </div>
                    <span
                      className={`badge ${
                        inv.status === "PAID"
                          ? "badge-green"
                          : inv.status === "SENT"
                          ? "badge-blue"
                          : "badge-amber"
                      }`}
                      style={{ fontSize: 10, marginTop: 4, display: "inline-block" }}
                    >
                      {inv.status}
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                  {inv.status === "DRAFT" ? (
                    <button
                      onClick={() => handleSend(inv.id)}
                      className="btn btn-primary"
                      style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <Send size={12} /> Send via PayPal
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRefresh(inv.id)}
                      className="btn btn-secondary"
                      style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <RefreshCw size={12} /> Refresh Status
                    </button>
                  )}

                  {inv.recipient_view_url && (
                    <a
                      href={inv.recipient_view_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary"
                      style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                    >
                      <ExternalLink size={12} /> Open PayPal Invoice
                    </a>
                  )}
                </div>
              </div>
            ))}

            {invoices.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 12 }}>
                No invoices created yet. Create a draft invoice using the form.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
