import React from "react";
import {
  LayoutDashboard,
  BarChart3,
  FileText,
  Network,
  PlayCircle,
  Receipt,
  Scale,
  Send,
  Coins,
  Users,
  ShieldCheck,
  Bell,
  Bot,
  FileCheck,
  User,
  LogOut,
} from "lucide-react";
import { useApp } from "../lib/context.tsx";

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

export function Sidebar({ currentPath, onNavigate, mobileOpen, setMobileOpen }: SidebarProps) {
  const { currentWorkspace, currentProject, logout } = useApp();

  const navItems = [
    { path: "/app", label: "Overview", icon: LayoutDashboard },
    { path: "/app/insights", label: "Insights", icon: BarChart3 },
    { path: "/app/contracts", label: "Contracts", icon: FileText },
    { path: "/app/rule-graph", label: "Rule graph", icon: Network },
    { path: "/app/simulator", label: "Simulator", icon: PlayCircle },
    { path: "/app/invoices", label: "Invoices", icon: Receipt },
    { path: "/app/settlements", label: "Settlements", icon: Scale },
    { path: "/app/payouts", label: "Payouts", icon: Send },
    { path: "/app/royalties", label: "Royalties", icon: Coins },
    { path: "/app/recipients", label: "Recipients", icon: Users },
    { path: "/app/team", label: "Team", icon: ShieldCheck },
    { path: "/app/notifications", label: "Notifications", icon: Bell },
    { path: "/app/paypal-ai", label: "PayPal AI", icon: Bot },
    { path: "/app/audit", label: "Audit", icon: FileCheck },
    { path: "/app/profile", label: "Profile", icon: User },
  ];

  return (
    <>
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 35 }}
        />
      )}
      <aside className={`app-sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand-icon">R</div>
          <div>
            <div className="brand-title">RoyaltyOS</div>
            <div className="brand-sub">Financial Intelligence</div>
          </div>
        </div>

        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 4 }}>
            Project Scope
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentProject?.name || "Default Project"}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {currentWorkspace?.name || "Workspace"} · {currentProject?.currency || "USD"}
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPath === item.path || (item.path !== "/app" && currentPath.startsWith(item.path));
            return (
              <a
                key={item.path}
                href={item.path}
                className={`nav-link ${active ? "active" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(item.path);
                  setMobileOpen(false);
                }}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>v1.0.2 · Sandbox</span>
            <button
              onClick={logout}
              title="Sign Out"
              style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, padding: 4 }}
            >
              <LogOut size={13} />
            </button>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4 }}>
            Financial boundary: AI interprets. Deterministic rules calculate.
          </div>
        </div>
      </aside>
    </>
  );
}
