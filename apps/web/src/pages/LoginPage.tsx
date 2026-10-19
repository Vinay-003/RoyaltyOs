import React, { useState, useEffect } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import {
  Lock,
  Mail,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Sun,
  Moon,
  Activity,
  Cpu,
  FileCheck2,
  Zap,
} from "lucide-react";

export function LoginPage({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const { refreshMe, theme, toggleTheme } = useApp();
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
  const [wakingUp, setWakingUp] = useState(false);
  const [serverStatus, setServerStatus] = useState<"online" | "waking" | "checking">("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Continuous background health polling with automatic online detection
  useEffect(() => {
    let active = true;
    let timer: any = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!active) return;
        if (res.ok) {
          setServerStatus("online");
          setWakingUp(false);
          // When warm, check every 30s to keep liveness
          timer = setTimeout(poll, 30000);
        } else {
          setServerStatus("waking");
          // When waking, poll actively every 2.5s
          timer = setTimeout(poll, 2500);
        }
      } catch {
        if (!active) return;
        setServerStatus("waking");
        timer = setTimeout(poll, 2500);
      }
    };

    poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

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
    if (status === 502 || status === 503 || status === 504) {
      return "The cloud server on Render is waking up from idle (~40s). It will connect automatically once booted.";
    }
    return err?.message || "An unexpected error occurred during authentication.";
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setErrorMessage(null);

    // If server is currently waking up, wait for it before failing with 502
    if (serverStatus === "waking") {
      setWakingUp(true);
      showToast("Server is waking up from idle. Auto-signing in once online...", "info");
      const startTime = Date.now();
      while (Date.now() - startTime < 65000) {
        try {
          const check = await fetch("/api/health", { cache: "no-store" });
          if (check.ok) {
            setServerStatus("online");
            setWakingUp(false);
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    try {
      const res = await api("/api/v1/auth/login", {
        method: "POST",
        json: { email: email.trim(), password },
        maxRetries: 3,
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
      setWakingUp(false);
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

    if (serverStatus === "waking") {
      setWakingUp(true);
      showToast("Server is waking up from idle. Provisioning once online...", "info");
      const startTime = Date.now();
      while (Date.now() - startTime < 65000) {
        try {
          const check = await fetch("/api/health", { cache: "no-store" });
          if (check.ok) {
            setServerStatus("online");
            setWakingUp(false);
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    try {
      const out = await api("/api/v1/auth/register", {
        method: "POST",
        json: {
          email: signupEmail.trim(),
          password: signupPassword,
          displayName: displayName.trim() || signupEmail.split("@")[0],
        },
        maxRetries: 3,
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
          "Account registered! Supabase has sent a verification link to your email. Confirm your email, then return here to sign in."
        );
        showToast("Account created! Check your email to verify.", "info");
      }
    } catch (err: any) {
      const msg = friendlyError(err);
      setErrorMessage(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
      setWakingUp(false);
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
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-app)",
        color: "var(--text-primary)",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* Top utility bar */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "18px 32px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-card)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "linear-gradient(135deg, var(--accent-primary), #1d4ed8)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontSize: 16,
              boxShadow: "0 2px 10px var(--accent-glow)",
            }}
          >
            R
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>
            RoyaltyOS
          </span>
          <span
            className="badge badge-blue"
            style={{ fontSize: 10, padding: "2px 8px", fontWeight: 600 }}
          >
            ENTERPRISE
          </span>
        </div>

        {/* Right header controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Server status pill */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "4px 10px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 500,
              background:
                serverStatus === "online"
                  ? "var(--badge-green-bg)"
                  : "var(--badge-amber-bg)",
              color:
                serverStatus === "online"
                  ? "var(--badge-green-text)"
                  : "var(--badge-amber-text)",
              border: `1px solid ${
                serverStatus === "online"
                  ? "var(--badge-green-border)"
                  : "var(--badge-amber-border)"
              }`,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background:
                  serverStatus === "online"
                    ? "var(--badge-green-text)"
                    : "var(--badge-amber-text)",
                boxShadow:
                  serverStatus === "online"
                    ? "0 0 6px var(--badge-green-text)"
                    : "0 0 6px var(--badge-amber-text)",
                animation: serverStatus === "waking" ? "ros-pulse 1.4s infinite" : "none",
              }}
            />
            {serverStatus === "online"
              ? "System Operational"
              : serverStatus === "waking"
              ? "Cloud Backend Waking Up..."
              : "Checking System..."}
          </div>

          {/* Theme switcher */}
          <button
            type="button"
            onClick={toggleTheme}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
              padding: "7px 10px",
              borderRadius: 8,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              transition: "all 0.15s ease",
            }}
          >
            {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
            <span>{theme === "light" ? "Dark" : "Light"}</span>
          </button>
        </div>
      </header>

      {/* Main split-screen container */}
      <main
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          maxWidth: 1200,
          width: "100%",
          margin: "0 auto",
          padding: "48px 24px",
          gap: 48,
          alignItems: "center",
        }}
      >
        {/* Left Column: Platform Presentation & Trust */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 12px",
                borderRadius: 20,
                background: "var(--badge-blue-bg)",
                border: "1px solid var(--badge-blue-border)",
                color: "var(--badge-blue-text)",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              <Zap size={13} /> Next-Gen Rights & Revenue Cloud
            </div>
            <h1
              style={{
                fontSize: "clamp(28px, 4vw, 42px)",
                fontWeight: 800,
                lineHeight: 1.15,
                letterSpacing: "-0.03em",
                margin: "0 0 16px",
                color: "var(--text-primary)",
              }}
            >
              The Ledger for High-Value Royalty Settlements.
            </h1>
            <p
              style={{
                fontSize: 15,
                lineHeight: 1.6,
                color: "var(--text-secondary)",
                margin: 0,
                maxWidth: 480,
              }}
            >
              Transform complex legal agreements into deterministic mathematical execution. 
              Zero floating-point rounding errors, clause-level audit trail, and instant treasury disbursements.
            </p>
          </div>

          {/* Institutional Feature Highlights */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "14px 16px",
                borderRadius: 10,
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div
                style={{
                  padding: 8,
                  borderRadius: 8,
                  background: "var(--badge-blue-bg)",
                  color: "var(--badge-blue-text)",
                  marginTop: 2,
                }}
              >
                <Cpu size={16} />
              </div>
              <div>
                <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>
                  Deterministic State Machine
                </strong>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>
                  Every financial division uses integer math and largest-remainder conservation. No dollar lost.
                </p>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "14px 16px",
                borderRadius: 10,
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div
                style={{
                  padding: 8,
                  borderRadius: 8,
                  background: "var(--badge-green-bg)",
                  color: "var(--badge-green-text)",
                  marginTop: 2,
                }}
              >
                <FileCheck2 size={16} />
              </div>
              <div>
                <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>
                  Clause-by-Clause Ground Truth
                </strong>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>
                  AI extraction ties every waterfall tier, threshold, and expense cap to its exact legal page and clause.
                </p>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "14px 16px",
                borderRadius: 10,
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div
                style={{
                  padding: 8,
                  borderRadius: 8,
                  background: "var(--badge-amber-bg)",
                  color: "var(--badge-amber-text)",
                  marginTop: 2,
                }}
              >
                <ShieldCheck size={16} />
              </div>
              <div>
                <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>
                  Institutional Security & Step-Up Auth
                </strong>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "3px 0 0" }}>
                  Treasury payouts require dual-custody verification. HttpOnly Strict cookies safeguard sessions.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: High-Craft Auth Card */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            className="card"
            style={{
              maxWidth: 440,
              width: "100%",
              padding: "36px 32px",
              background: "var(--bg-card)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-card)",
              boxShadow: "var(--shadow-hover)",
              position: "relative",
            }}
          >
            {/* Header in Card */}
            <div style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  margin: "0 0 6px",
                  color: "var(--text-primary)",
                  letterSpacing: "-0.02em",
                }}
              >
                {tab === "signin" ? "Welcome back" : "Create Operator Account"}
              </h2>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                {tab === "signin"
                  ? "Sign in to access your operating console"
                  : "Provision a new royalty workspace & project"}
              </p>
            </div>

            {/* Server waking notice pill if active */}
            {serverStatus === "waking" && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "var(--badge-amber-bg)",
                  border: "1px solid var(--badge-amber-border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--badge-amber-text)",
                  fontSize: 12,
                  lineHeight: 1.45,
                  marginBottom: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--badge-amber-text)",
                    boxShadow: "0 0 8px var(--badge-amber-text)",
                    flexShrink: 0,
                    animation: "ros-pulse 1.2s infinite",
                  }}
                />
                <div>
                  <strong>Cloud server is spinning up</strong> (Render cold start takes ~40s).
                  Requests will connect automatically once online.
                </div>
              </div>
            )}

            {/* Tab Switcher */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 4,
                background: "var(--bg-elevated)",
                padding: 4,
                borderRadius: "var(--radius-sm)",
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
                  background: tab === "signin" ? "var(--bg-card)" : "transparent",
                  color: tab === "signin" ? "var(--text-primary)" : "var(--text-muted)",
                  border: tab === "signin" ? "1px solid var(--border-card)" : "1px solid transparent",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: tab === "signin" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
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
                  background: tab === "signup" ? "var(--bg-card)" : "transparent",
                  color: tab === "signup" ? "var(--text-primary)" : "var(--text-muted)",
                  border: tab === "signup" ? "1px solid var(--border-card)" : "1px solid transparent",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: tab === "signup" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                  transition: "all 0.15s ease",
                }}
              >
                Create Account
              </button>
            </div>

            {/* Error Message banner */}
            {errorMessage && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "var(--badge-red-bg)",
                  border: "1px solid var(--badge-red-border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--badge-red-text)",
                  fontSize: 12,
                  lineHeight: 1.45,
                  marginBottom: 18,
                }}
              >
                {errorMessage}
              </div>
            )}

            {/* Signup Success Notice */}
            {signupSuccessNotice && (
              <div
                style={{
                  padding: "12px 14px",
                  background: "var(--badge-green-bg)",
                  border: "1px solid var(--badge-green-border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--badge-green-text)",
                  fontSize: 12,
                  lineHeight: 1.45,
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>Operator Email</label>
                    <button
                      type="button"
                      onClick={fillSandboxDemo}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--accent-primary)",
                        fontSize: 11,
                        cursor: "pointer",
                        padding: 0,
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Sparkles size={11} /> 1-Click Sandbox Fill
                    </button>
                  </div>
                  <div style={{ position: "relative" }}>
                    <input
                      type="email"
                      name="email"
                      autoComplete="username"
                      className="input"
                      style={{ width: "100%", paddingLeft: 36, background: "var(--bg-input)" }}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="operator@company.com"
                      required
                    />
                    <Mail
                      size={15}
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

                <div className="field" style={{ marginTop: 14 }}>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Password</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password"
                      autoComplete="current-password"
                      className="input"
                      style={{ width: "100%", paddingLeft: 36, paddingRight: 38, background: "var(--bg-input)" }}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                    />
                    <Lock
                      size={15}
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
                      aria-label={showPassword ? "Hide password" : "Show password"}
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
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary"
                  style={{
                    width: "100%",
                    padding: "12px 18px",
                    marginTop: 18,
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    boxShadow: "0 4px 14px var(--accent-glow)",
                    cursor: loading ? "wait" : "pointer",
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
                          animation: "ros-spin 0.6s linear infinite",
                          display: "inline-block",
                        }}
                      />
                      <span>{wakingUp ? "Waking Server (auto-signing in)..." : "Authenticating..."}</span>
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
                  <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Full Name</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      name="name"
                      autoComplete="name"
                      className="input"
                      style={{ width: "100%", paddingLeft: 36, background: "var(--bg-input)" }}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Jane Doe"
                    />
                    <User
                      size={15}
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

                <div className="field" style={{ marginTop: 14 }}>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Work Email</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      className="input"
                      style={{ width: "100%", paddingLeft: 36, background: "var(--bg-input)" }}
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                    />
                    <Mail
                      size={15}
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

                <div className="field" style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>Password</label>
                    <span style={{ fontSize: 10, color: signupPassword.length >= 10 ? "var(--badge-green-text)" : "var(--text-muted)" }}>
                      {signupPassword.length}/10 chars min
                    </span>
                  </div>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      name="new-password"
                      autoComplete="new-password"
                      className="input"
                      style={{ width: "100%", paddingLeft: 36, paddingRight: 38, background: "var(--bg-input)" }}
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      placeholder="Minimum 10 characters"
                      minLength={10}
                      required
                    />
                    <Lock
                      size={15}
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
                      aria-label={showPassword ? "Hide password" : "Show password"}
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
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || signupPassword.length < 10}
                  className="btn btn-primary"
                  style={{
                    width: "100%",
                    padding: "12px 18px",
                    marginTop: 18,
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    boxShadow: "0 4px 14px var(--accent-glow)",
                    cursor: loading || signupPassword.length < 10 ? "not-allowed" : "pointer",
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
                          animation: "ros-spin 0.6s linear infinite",
                          display: "inline-block",
                        }}
                      />
                      <span>{wakingUp ? "Waking Server (provisioning)..." : "Provisioning Account..."}</span>
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

            {/* Footer Trust Indicator */}
            <div
              style={{
                marginTop: 24,
                paddingTop: 16,
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              <ShieldCheck size={14} style={{ color: "var(--accent-primary)" }} />
              <span>Institutional Trust Model · AES-256 Encrypted</span>
            </div>
          </div>
        </div>
      </main>

      {/* Global CSS animations */}
      <style>{`
        @keyframes ros-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes ros-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
}
