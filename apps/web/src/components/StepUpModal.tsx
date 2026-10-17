import React, { useEffect, useState } from "react";
import { registerStepUpHandler } from "../lib/api.ts";
import { Lock } from "lucide-react";

export function StepUpModal() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [resolver, setResolver] = useState<((pwd: string | null) => void) | null>(null);

  useEffect(() => {
    registerStepUpHandler((res) => {
      setResolver(() => res);
      setPassword("");
      setOpen(true);
    });
  }, []);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (resolver) resolver(password);
    setOpen(false);
  };

  const handleCancel = () => {
    if (resolver) resolver(null);
    setOpen(false);
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.75)",
      backdropFilter: "blur(4px)",
      zIndex: 10000,
      display: "grid",
      placeItems: "center",
      padding: 20
    }}>
      <div className="card" style={{ maxWidth: 400, width: "100%", margin: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ padding: 8, background: "rgba(37,99,235,0.15)", borderRadius: 8, color: "#60a5fa" }}>
            <Lock size={20} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>Financial Step-Up Verification</h3>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>Confirm your password to authorize sensitive action</p>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>RoyaltyOS Account Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoFocus
              required
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary">Authorize Action</button>
          </div>
        </form>
      </div>
    </div>
  );
}
