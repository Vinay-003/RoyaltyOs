import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, withStepUp, showToast } from "../lib/api.ts";
import { User, Shield, Key, Link2, CheckCircle2, Lock, Trash2 } from "lucide-react";

interface PayPalAccountInfo {
  connected: boolean;
  environment: "sandbox" | "live" | null;
  clientIdMasked: string | null;
  webhookConfigured: boolean;
  secretConfigured: boolean;
  updatedAt: string | null;
}

export function ProfilePage() {
  const { me, refreshMe, workspaceId } = useApp();
  const [profileData, setProfileData] = useState<any>(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // PayPal Account State
  const [paypalAccounts, setPaypalAccounts] = useState<Record<string, PayPalAccountInfo>>({});
  const [paypalForm, setPaypalForm] = useState({
    clientId: "",
    clientSecret: "",
    webhookId: "",
    environment: "sandbox",
  });
  const [savingPaypal, setSavingPaypal] = useState(false);

  // Change Password State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changing, setChanging] = useState(false);

  const loadProfile = async () => {
    try {
      const res = await api<any>("/api/v1/profile");
      setProfileData(res);
      setDisplayName(res.displayName || "");

      // For owner workspaces, load PayPal connections
      const ownerWorkspaces = (res.workspaces || []).filter((w: any) => w.role === "OWNER");
      for (const w of ownerWorkspaces) {
        try {
          const acc = await api<PayPalAccountInfo>(`/api/v1/workspaces/${w.id}/paypal-account`);
          setPaypalAccounts((prev) => ({ ...prev, [w.id]: acc }));
        } catch {}
      }
    } catch (err: any) {
      showToast(err.message, "warn");
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const handleSaveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSavingName(true);
    try {
      const out = await api<any>("/api/v1/profile", {
        method: "PATCH",
        json: { displayName: displayName.trim() },
      });
      showToast(`Display name set to ${out.displayName}`, "success");
      await refreshMe();
      await loadProfile();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setSavingName(false);
    }
  };

  const handleSavePayPal = async (wsId: string) => {
    if (!paypalForm.clientId.trim() || !paypalForm.clientSecret.trim()) {
      showToast("Enter PayPal Client ID and Client Secret", "warn");
      return;
    }
    setSavingPaypal(true);
    try {
      await withStepUp(() =>
        api(`/api/v1/workspaces/${wsId}/paypal-account`, {
          method: "PUT",
          json: {
            clientId: paypalForm.clientId.trim(),
            clientSecret: paypalForm.clientSecret.trim(),
            webhookId: paypalForm.webhookId.trim() || null,
            environment: paypalForm.environment,
          },
        })
      );
      showToast("PayPal connection verified and securely encrypted", "success");
      setPaypalForm({ clientId: "", clientSecret: "", webhookId: "", environment: "sandbox" });
      await loadProfile();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setSavingPaypal(false);
    }
  };

  const handleDisconnectPayPal = async (wsId: string) => {
    if (!confirm("Disconnect this workspace's PayPal credentials? Global server defaults will resume.")) return;
    try {
      await withStepUp(() =>
        api(`/api/v1/workspaces/${wsId}/paypal-account`, {
          method: "DELETE",
          json: {},
        })
      );
      showToast("PayPal account disconnected", "info");
      await loadProfile();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

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

  const currentWs = me?.workspaces.find((w) => w.id === workspaceId);
  const currentPaypal = workspaceId ? paypalAccounts[workspaceId] : null;
  const isOwner = currentWs?.role === "OWNER";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Operator Profile & Integrations</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Manage your verified identity, workspace roles, secure PayPal API credentials, and step-up password.
        </p>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        {/* Identity & Display Name */}
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Operator Identity</h3>
              <p className="card-sub">Authenticated session details</p>
            </div>
            <span className="badge badge-green">Verified</span>
          </div>

          <form onSubmit={handleSaveDisplayName} style={{ marginBottom: 20 }}>
            <div className="field">
              <label>Email Address</label>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", padding: "8px 0" }}>
                {me?.email || profileData?.email || "sandbox@royaltyos.internal"}
              </div>
            </div>

            <div className="field">
              <label>Display Name</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your Full Name"
                  style={{ flex: 1 }}
                />
                <button type="submit" disabled={savingName} className="btn btn-primary">
                  {savingName ? "Saving..." : "Save Name"}
                </button>
              </div>
            </div>
          </form>

          <div>
            <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Authorized Workspaces
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {(me?.workspaces || []).map((w) => (
                <span key={w.id} className="badge badge-blue">
                  {w.name} ({w.role})
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Change Password */}
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Security & Credentials</h3>
              <p className="card-sub">Step-up verification password</p>
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
                placeholder="••••••••••••"
                required
              />
            </div>

            <div className="field">
              <label>New Password (min 10 characters)</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                required
              />
            </div>

            <button type="submit" disabled={changing} className="btn btn-primary" style={{ width: "100%", marginTop: 8 }}>
              {changing ? "Updating..." : "Update Password"}
            </button>
          </form>
        </section>
      </div>

      {/* Workspace PayPal Account Integration */}
      <section className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Workspace PayPal Connection</h3>
            <p className="card-sub">
              {currentWs ? `Configure custom PayPal credentials for ${currentWs.name}` : "Workspace PayPal Account"}
            </p>
          </div>
          <span className={`badge ${currentPaypal?.connected ? "badge-green" : "badge-neutral"}`}>
            {currentPaypal?.connected ? `Connected (${currentPaypal.environment})` : "Server Default Sandbox"}
          </span>
        </div>

        {isOwner ? (
          <div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" }}>
              Owner-only privilege. Connect your PayPal REST Application credentials from the PayPal Developer Portal. Client secrets are AES-256-GCM encrypted in the secure vault before database storage and never exposed to the client.
            </p>

            {currentPaypal?.connected && (
              <div
                style={{
                  background: "var(--badge-green-bg)",
                  border: "1px solid var(--badge-green-border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 12,
                  marginBottom: 16,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong style={{ fontSize: 13, color: "var(--badge-green-text)", display: "block" }}>
                    Active PayPal REST Connection ({currentPaypal.environment})
                  </strong>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    Client ID: {currentPaypal.clientIdMasked} · Webhook: {currentPaypal.webhookConfigured ? "Configured" : "None"} · Updated: {currentPaypal.updatedAt?.slice(0, 10)}
                  </span>
                </div>
                {workspaceId && (
                  <button
                    onClick={() => handleDisconnectPayPal(workspaceId)}
                    className="btn btn-secondary"
                    style={{ padding: "4px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Trash2 size={12} /> Disconnect
                  </button>
                )}
              </div>
            )}

            {workspaceId && (
              <div style={{ background: "var(--bg-input)", padding: 16, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px", color: "var(--text-primary)" }}>
                  {currentPaypal?.connected ? "Update PayPal Credentials" : "Connect PayPal Account"}
                </h4>

                <div className="grid-2">
                  <div className="field">
                    <label>PayPal Client ID</label>
                    <input
                      type="text"
                      className="input mono"
                      value={paypalForm.clientId}
                      onChange={(e) => setPaypalForm({ ...paypalForm, clientId: e.target.value })}
                      placeholder="e.g. A21AA... or client ID from developer.paypal.com"
                    />
                  </div>

                  <div className="field">
                    <label>PayPal Client Secret</label>
                    <input
                      type="password"
                      className="input"
                      value={paypalForm.clientSecret}
                      onChange={(e) => setPaypalForm({ ...paypalForm, clientSecret: e.target.value })}
                      placeholder="Secret (AES-256-GCM encrypted)"
                    />
                  </div>

                  <div className="field">
                    <label>PayPal Webhook ID (Optional)</label>
                    <input
                      type="text"
                      className="input mono"
                      value={paypalForm.webhookId}
                      onChange={(e) => setPaypalForm({ ...paypalForm, webhookId: e.target.value })}
                      placeholder="Webhook ID for signature verification"
                    />
                  </div>

                  <div className="field">
                    <label>Environment</label>
                    <select
                      className="select"
                      value={paypalForm.environment}
                      onChange={(e) => setPaypalForm({ ...paypalForm, environment: e.target.value })}
                    >
                      <option value="sandbox">Sandbox (Testing & Staging)</option>
                      <option value="live">Live (Production Settlement)</option>
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleSavePayPal(workspaceId)}
                  disabled={savingPaypal}
                  className="btn btn-primary"
                  style={{ marginTop: 8 }}
                >
                  <Lock size={13} /> {savingPaypal ? "Verifying with PayPal..." : currentPaypal?.connected ? "Update Connection" : "Verify & Connect"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
            PayPal connections for this workspace are managed exclusively by Workspace Owners.
          </div>
        )}
      </section>
    </div>
  );
}
