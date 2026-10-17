import React, { useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { User, Shield, Key } from "lucide-react";

export function ProfilePage() {
  const { me, refreshMe } = useApp();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changing, setChanging] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    setChanging(true);
    try {
      await api("/api/v1/auth/change-password", {
        method: "POST",
        json: { currentPassword, newPassword },
      });
      showToast("Password updated successfully", "success");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setChanging(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Operator Profile</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Authenticated identity and financial step-up security credentials.
        </p>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Identity Credentials</h3>
              <p className="card-sub">Current active session</p>
            </div>
            <span className="badge badge-green">Verified</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Email Address</label>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, color: "#fff" }}>{me?.email}</div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Authorized Workspaces</label>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                {(me?.workspaces || []).map((w) => (
                  <span key={w.id} className="badge badge-blue">
                    {w.name} ({w.role})
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Security & Step-Up Auth</h3>
              <p className="card-sub">Used for sensitive payout authorisations</p>
            </div>
          </div>

          <form onSubmit={handleChangePassword}>
            <div className="field">
              <label>Current Password</label>
              <input
                type="password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label>New Password</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" disabled={changing} className="btn btn-primary" style={{ width: "100%", marginTop: 8 }}>
              {changing ? "Updating..." : "Update Password"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
