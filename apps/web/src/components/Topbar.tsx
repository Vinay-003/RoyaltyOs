import React from "react";
import { Menu, FolderGit2, Building2, Sun, Moon } from "lucide-react";
import { useApp } from "../lib/context.tsx";

interface TopbarProps {
  pageTitle: string;
  onToggleMobile: () => void;
}

export function Topbar({ pageTitle, onToggleMobile }: TopbarProps) {
  const { me, workspaceId, projectId, theme, toggleTheme, setWorkspaceId, setProjectId } = useApp();

  const currentWorkspace = me?.workspaces.find((w) => w.id === workspaceId);

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        <button
          onClick={onToggleMobile}
          className="btn btn-secondary"
          style={{ display: "none", padding: "6px 8px" }}
          id="mobileMenuBtn"
        >
          <Menu size={16} />
        </button>
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.06em", fontWeight: 700 }}>
            RoyaltyOS / App
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: "2px 0 0", color: "var(--text-primary)" }}>
            {pageTitle}
          </h1>
        </div>
      </div>

      <div className="topbar-right">
        {me && me.workspaces.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-input)", padding: "4px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-card)" }}>
              <Building2 size={13} color="var(--text-muted)" />
              <select
                value={workspaceId || ""}
                onChange={(e) => setWorkspaceId(e.target.value)}
                style={{ background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 12, outline: "none", cursor: "pointer" }}
              >
                {me.workspaces.map((w) => (
                  <option key={w.id} value={w.id} style={{ background: "var(--bg-card)", color: "#fff" }}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            {currentWorkspace && currentWorkspace.projects.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-input)", padding: "4px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-card)" }}>
                <FolderGit2 size={13} color="var(--text-muted)" />
                <select
                  value={projectId || ""}
                  onChange={(e) => setProjectId(e.target.value)}
                  style={{ background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 12, outline: "none", cursor: "pointer" }}
                >
                  {currentWorkspace.projects.map((p) => (
                    <option key={p.id} value={p.id} style={{ background: "var(--bg-card)", color: "#fff" }}>
                      {p.name} ({p.currency})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <button
          onClick={toggleTheme}
          className="btn btn-secondary"
          title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          style={{ padding: "6px 10px", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
        >
          {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
          <span style={{ fontSize: 11 }}>{theme === "light" ? "Dark" : "Light"}</span>
        </button>

        <div style={{ padding: "5px 12px", background: "var(--bg-card)", borderRadius: 999, border: "1px solid var(--border-subtle)", fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>
          {me?.email || "sandbox@royaltyos.internal"}
        </div>
      </div>
    </header>
  );
}
