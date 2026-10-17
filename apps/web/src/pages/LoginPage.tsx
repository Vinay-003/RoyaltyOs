import React, { useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { Lock, Mail, User, Eye, EyeOff, ArrowRight, ShieldCheck, Sparkles, CheckCircle2 } from "lucide-react";

export function LoginPage({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const { refreshMe } = useApp();
  const [tab, setTab] = useState<"signin" | "signup">("signin");

  // Sign In state
  const [email, setEmail] = useState("admin@royaltyos.internal");
  const [password, setPassword] = useState("SandboxOperator2026!");
  const [showPassword, setShowPassword] = useState(false);

  // Sign Up state
  const [displayName, setDisplayName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupSuccessNotice, setSignupSuccessNotice] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const friendlyError = (err: any) => {
    const status = err?.status;
    const code = err?.body?.code;
    if (status === 401) {
      if (code === "EMAIL_NOT_CONFIRMED") {
        return "Please confirm your email address first. Check your inbox for the confirmation link, then sign in.";
      }
      return "Incorrect email or password. Please verify your credentials.";
    }
    if (status === 429) {
      return "Too many requests. Please wait a moment and try again.";
    }
    return err?.message || "An unexpected error occurred during authentication.";
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await api("/api/v1/auth/login", {
        method: "POST",
        json: { email: email.trim(), password },
      }, false);

      if (res.bootstrap?.workspaceId) {
        localStorage.setItem("royaltyos_workspace_id", res.bootstrap.workspaceId);
      }
      if (res.bootstrap?.projectId) {
        localStorage.setItem("royaltyos_project_id", res.bootstrap.projectId);
      }

      showToast("Authenticated successfully", "success");
      await refreshMe();
      onLoginSuccess();
    } catch (err: any) {
      const msg = friendlyError(err);
      setErrorMessage(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupEmail.trim() || !signupPassword) return;
    if (signupPassword.length < 10) {
      setErrorMessage("Password must be at least 10 characters long.");
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    setSignupSuccessNotice(null);
    try {
      const out = await api("/api/v1/auth/register", {
        method: "POST",
        json: {
          email: signupEmail.trim(),
          password: signupPassword,
          displayName: displayName.trim() || signupEmail.split("@")[0],
        },
      }, false);

      if (out.sessionCreated) {
        const boot = await api<{ workspaceId: string; projectId: string }>("/api/v1/bootstrap", {
          method: "POST",
          json: {},
        });
        if (boot?.workspaceId) localStorage.setItem("royaltyos_workspace_id", boot.workspaceId);
        if (boot?.projectId) localStorage.setItem("royaltyos_project_id", boot.projectId);
        showToast("Account created and workspace initialized!", "success");
        await refreshMe();
        onLoginSuccess();
      } else {
        setSignupSuccessNotice(
          "Account created! Supabase has sent a confirmation link to your email. Please verify your email, then return here to sign in."
        );
        showToast("Account created! Please check your email to verify.", "info");
      }
    } catch (err: any) {
      const msg = friendlyError(err);
      setErrorMessage(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const fillSandboxDemo = () => {
    setEmail("admin@royaltyos.internal");
    setPassword("SandboxOperator2026!");
    setErrorMessage(null);
    showToast("Filled sandbox operator credentials", "info");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(circle at 50% 20%, #111a2e 0%, #080c14 70%)",
        padding: "24px 16px",
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 440,
          width: "100%",
          padding: 36,
          background: "rgba(14, 20, 34, 0.88)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04)",
          borderRadius: 14,
        }}
      >
        {/* Brand header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <div
            className="brand-icon"
            style={{
              width: 38,
              height: 38,
              fontSize: 18,
              borderRadius: 8,
              background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
            }}
          >
            R
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0, color: "#fff", letterSpacing: "-0.01em" }}>
                RoyaltyOS
              </h2>
              <span className="badge badge-blue" style={{ fontSize: 9, padding: "2px 6px" }}>
                CONSOLE
              </span>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>
              Institutional Contract-to-Payout Infrastructure
            </p>
          </div>
        </div>

        {/* Tab switcher: Sign In vs Create Account */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 4,
            background: "rgba(8, 12, 20, 0.8)",
            padding: 4,
            borderRadius: 8,
            marginBottom: 24,
            border: "1px solid var(--border-subtle)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setTab("signin");
              setErrorMessage(null);
            }}
            style={{
              padding: "8px 12px",
              background: tab === "signin" ? "var(--bg-card-hover)" : "transparent",
              color: tab === "signin" ? "#fff" : "var(--text-muted)",
              border: tab === "signin" ? "1px solid var(--border-card)" : "1px solid transparent",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("signup");
              setErrorMessage(null);
            }}
            style={{
              padding: "8px 12px",
              background: tab === "signup" ? "var(--bg-card-hover)" : "transparent",
              color: tab === "signup" ? "#fff" : "var(--text-muted)",
              border: tab === "signup" ? "1px solid var(--border-card)" : "1px solid transparent",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            Create Account
          </button>
        </div>

        {/* Error notification banner */}
        {errorMessage && (
          <div
            style={{
              padding: "10px 14px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              borderRadius: 8,
              color: "#f87171",
              fontSize: 12,
              lineHeight: 1.4,
              marginBottom: 18,
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Success notification banner (email verification) */}
        {signupSuccessNotice && (
          <div
            style={{
              padding: "12px 14px",
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              borderRadius: 8,
              color: "#34d399",
              fontSize: 12,
              lineHeight: 1.4,
              marginBottom: 18,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <CheckCircle2 size={16} style={{ marginTop: 2, flexShrink: 0 }} />
            <div>{signupSuccessNotice}</div>
          </div>
        )}

        {/* SIGN IN FORM */}
        {tab === "signin" && (
          <form onSubmit={handleSignIn}>
            <div className="field">
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Operator Email</span>
                <button
                  type="button"
                  onClick={fillSandboxDemo}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--badge-blue-text)",
                    fontSize: 11,
                    cursor: "pointer",
                    padding: 0,
                    fontWeight: 500,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <Sparkles size={11} /> 1-Click Sandbox Fill
                </button>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type="email"
                  className="input"
                  style={{ width: "100%", paddingLeft: 36 }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@company.com"
                  required
                />
                <Mail
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                  }}
                />
              </div>
            </div>

            <div className="field">
              <label>Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  className="input"
                  style={{ width: "100%", paddingLeft: 36, paddingRight: 38 }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                />
                <Lock
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: 4,
                  }}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{
                width: "100%",
                padding: "10px 16px",
                marginTop: 10,
                fontSize: 13,
                fontWeight: 600,
                boxShadow: "0 4px 12px rgba(37, 99, 235, 0.35)",
              }}
            >
              {loading ? (
                <>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff",
                      borderRadius: "50%",
                      animation: "spin 0.6s linear infinite",
                      display: "inline-block",
                    }}
                  />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Sign In to Console</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>
        )}

        {/* SIGN UP FORM */}
        {tab === "signup" && (
          <form onSubmit={handleSignUp}>
            <div className="field">
              <label>Full Name / Display Name</label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%", paddingLeft: 36 }}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Vinay Saini"
                />
                <User
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                  }}
                />
              </div>
            </div>

            <div className="field">
              <label>Work Email</label>
              <div style={{ position: "relative" }}>
                <input
                  type="email"
                  className="input"
                  style={{ width: "100%", paddingLeft: 36 }}
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                />
                <Mail
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                  }}
                />
              </div>
            </div>

            <div className="field">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ margin: 0 }}>Password</label>
                <span style={{ fontSize: 10, color: signupPassword.length >= 10 ? "var(--badge-green-text)" : "var(--text-muted)" }}>
                  {signupPassword.length}/10 chars min
                </span>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  className="input"
                  style={{ width: "100%", paddingLeft: 36, paddingRight: 38 }}
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="Minimum 10 characters"
                  minLength={10}
                  required
                />
                <Lock
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: 4,
                  }}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || signupPassword.length < 10}
              className="btn btn-primary"
              style={{
                width: "100%",
                padding: "10px 16px",
                marginTop: 10,
                fontSize: 13,
                fontWeight: 600,
                boxShadow: "0 4px 12px rgba(37, 99, 235, 0.35)",
              }}
            >
              {loading ? (
                <>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff",
                      borderRadius: "50%",
                      animation: "spin 0.6s linear infinite",
                      display: "inline-block",
                    }}
                  />
                  <span>Provisioning Account...</span>
                </>
              ) : (
                <>
                  <span>Create Account & Workspace</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>
        )}

        {/* Security / Architecture Footer */}
        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 11,
            color: "var(--text-muted)",
            lineHeight: 1.45,
          }}
        >
          <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 2, color: "#3b82f6" }} />
          <div>
            <strong>Institutional Trust Model:</strong> AI parses contracts with ground-truth attribution. Deterministic state machines execute math. Humans authorize treasury distributions.
          </div>
        </div>
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
