import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { Users, Plus, Mail } from "lucide-react";

export function RecipientsPage() {
  const { projectId } = useApp();
  const [recipients, setRecipients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");

  const loadRecipients = async () => {
    if (!projectId) return;
    try {
      const data = await api<any[]>(`/api/v1/beneficiaries?projectId=${projectId}`);
      setRecipients(data);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecipients();
  }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !email.trim()) return;
    try {
      await api("/api/v1/beneficiaries", {
        method: "POST",
        json: {
          projectId,
          beneficiaryKey: key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
          name: name.trim() || key.trim(),
          email: email.trim(),
        },
      });
      showToast("Beneficiary registered", "success");
      setName("");
      setEmail("");
      setKey("");
      loadRecipients();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Beneficiary Directory</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Contractual role keys and verified PayPal disbursement destinations.
        </p>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Add Beneficiary Payee</h3>
              <p className="card-sub">Map role keys to payout addresses</p>
            </div>
          </div>

          <form onSubmit={handleCreate}>
            <div className="field">
              <label>Role Key (snake_case identifier)</label>
              <input
                type="text"
                className="input mono"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. artist, producer, featured_creator"
                required
              />
            </div>

            <div className="field">
              <label>Display Name</label>
              <input
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Legal or stage name"
              />
            </div>

            <div className="field">
              <label>PayPal Payout Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="payee@example.com"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: 8 }}>
              <Plus size={14} /> Register Beneficiary
            </button>
          </form>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Verified Beneficiaries</h3>
              <p className="card-sub">{recipients.length} registered participant(s)</p>
            </div>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Role Key</th>
                  <th>Name</th>
                  <th>Payout Email</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontWeight: 600, color: "#fff" }}>{r.beneficiary_key}</td>
                    <td>{r.name}</td>
                    <td>{r.email}</td>
                    <td>
                      <span className="badge badge-green">ACTIVE</span>
                    </td>
                  </tr>
                ))}
                {recipients.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>
                      No beneficiaries registered yet.
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
