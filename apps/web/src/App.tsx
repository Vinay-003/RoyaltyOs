import React, { useState, useEffect } from "react";
import { useApp } from "./lib/context.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Topbar } from "./components/Topbar.tsx";
import { ToastContainer } from "./components/Toast.tsx";
import { StepUpModal } from "./components/StepUpModal.tsx";

import { DashboardPage } from "./pages/DashboardPage.tsx";
import { ContractsPage } from "./pages/ContractsPage.tsx";
import { RuleGraphPage } from "./pages/RuleGraphPage.tsx";
import { SimulatorPage } from "./pages/SimulatorPage.tsx";
import { SettlementsPage } from "./pages/SettlementsPage.tsx";
import { InvoicesPage } from "./pages/InvoicesPage.tsx";
import { PayoutsPage } from "./pages/PayoutsPage.tsx";
import { RoyaltiesPage } from "./pages/RoyaltiesPage.tsx";
import { RecipientsPage } from "./pages/RecipientsPage.tsx";
import { InsightsPage } from "./pages/InsightsPage.tsx";
import { PayPalAIPage } from "./pages/PayPalAIPage.tsx";
import { AuditPage } from "./pages/AuditPage.tsx";
import { TeamPage } from "./pages/TeamPage.tsx";
import { NotificationsPage } from "./pages/NotificationsPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";

const ROUTE_TITLES: Record<string, string> = {
  "/app": "Overview",
  "/app/insights": "Insights",
  "/app/contracts": "Contracts",
  "/app/rule-graph": "Rule graph",
  "/app/simulator": "Simulator",
  "/app/invoices": "Invoices",
  "/app/settlements": "Settlements",
  "/app/payouts": "Payouts",
  "/app/royalties": "Royalties",
  "/app/recipients": "Recipients",
  "/app/team": "Team",
  "/app/notifications": "Notifications",
  "/app/paypal-ai": "PayPal AI",
  "/app/audit": "Audit",
  "/app/profile": "Profile",
};

export function App() {
  const { me, loading } = useApp();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handlePop = () => setCurrentPath(window.location.pathname);
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setCurrentPath(path);
    window.scrollTo(0, 0);
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg-app)" }}>
        <div style={{ textAlign: "center" }}>
          <div className="brand-icon" style={{ margin: "0 auto 16px" }}>R</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading RoyaltyOS Console...</div>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <>
        <ToastContainer />
        <LoginPage onLoginSuccess={() => navigate("/app")} />
      </>
    );
  }

  // Normalize legacy routes like /contracts to /app/contracts
  let normalized = currentPath;
  if (!normalized.startsWith("/app")) {
    normalized = `/app${normalized === "/" ? "" : normalized}`;
  }

  const pageTitle = ROUTE_TITLES[normalized] || "Operating Console";

  const renderPage = () => {
    switch (normalized) {
      case "/app":
        return <DashboardPage />;
      case "/app/contracts":
        return <ContractsPage />;
      case "/app/rule-graph":
        return <RuleGraphPage />;
      case "/app/simulator":
        return <SimulatorPage />;
      case "/app/settlements":
        return <SettlementsPage />;
      case "/app/invoices":
        return <InvoicesPage />;
      case "/app/payouts":
        return <PayoutsPage />;
      case "/app/royalties":
        return <RoyaltiesPage />;
      case "/app/recipients":
        return <RecipientsPage />;
      case "/app/insights":
        return <InsightsPage />;
      case "/app/paypal-ai":
        return <PayPalAIPage />;
      case "/app/audit":
        return <AuditPage />;
      case "/app/team":
        return <TeamPage />;
      case "/app/notifications":
        return <NotificationsPage />;
      case "/app/profile":
        return <ProfilePage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        currentPath={normalized}
        onNavigate={navigate}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <div className="app-main">
        <Topbar
          pageTitle={pageTitle}
          onToggleMobile={() => setMobileOpen(!mobileOpen)}
        />
        <main className="app-content">
          {renderPage()}
        </main>
      </div>
      <ToastContainer />
      <StepUpModal />
    </div>
  );
}
