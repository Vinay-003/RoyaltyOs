import React, { useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { Lock, ArrowRight } from "lucide-react";

export function LoginPage({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const { refreshMe } = useApp();
  const [email, setEmail] = useState("admin@royaltyos.internal");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      await api("/api/v1/auth/login", {
        method: "POST",
        json: { email, password },
      });
      showToast("Authenticated successfully", "success");
      await refreshMe();
      onLoginSuccess();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg-app)", padding: 20 }}>
      <div className="card" style={{ maxWidth: 420, width: "100%", padding: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div className="brand-icon">R</div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#fff" }}>RoyaltyOS Console</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Sign in to manage agreements and payouts</p>
          </div>
        </div>

        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Operator Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@company.com"
              required
            />
          </div>

          <div className="field">
            <label>Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
            />
          </div>

          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%", marginTop: 12 }}>
            {loading ? "Authenticating..." : "Sign In to Sandbox"} <ArrowRight size={14} />
          </button>
        </form>

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border-subtle)", textAlign: "center", fontSize: 11, color: "var(--text-muted)" }}>
          Financial boundary: AI interprets contracts. Deterministic rules calculate. Humans authorize.
        </div>
      </div>
    </div>
  );
}
