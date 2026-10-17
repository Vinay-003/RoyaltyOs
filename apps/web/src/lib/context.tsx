import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, showToast } from "./api.ts";

export interface UserMe {
  id: string;
  email: string;
  workspaces: Array<{
    id: string;
    name: string;
    role: string;
    projects: Array<{ id: string; name: string; currency: string }>;
  }>;
}

interface AppContextValue {
  me: UserMe | null;
  loading: boolean;
  workspaceId: string | null;
  projectId: string | null;
  currentWorkspace: UserMe["workspaces"][number] | null;
  currentProject: { id: string; name: string; currency: string } | null;
  setWorkspaceId: (id: string) => void;
  setProjectId: (id: string) => void;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(
    localStorage.getItem("royaltyos_workspace_id")
  );
  const [projectId, setProjectIdState] = useState<string | null>(
    localStorage.getItem("royaltyos_project_id")
  );

  const setWorkspaceId = (id: string) => {
    setWorkspaceIdState(id);
    localStorage.setItem("royaltyos_workspace_id", id);
    // Auto-select first project if available
    const ws = me?.workspaces.find((w) => w.id === id);
    if (ws?.projects?.[0]) {
      setProjectId(ws.projects[0].id);
    }
  };

  const setProjectId = (id: string) => {
    setProjectIdState(id);
    localStorage.setItem("royaltyos_project_id", id);
  };

  const refreshMe = async () => {
    try {
      const data = await api<UserMe>("/api/v1/auth/me");
      setMe(data);
      if (data.workspaces.length > 0) {
        const currentWs = data.workspaces.find((w) => w.id === workspaceId) || data.workspaces[0];
        if (currentWs) {
          setWorkspaceIdState(currentWs.id);
          localStorage.setItem("royaltyos_workspace_id", currentWs.id);
          if (currentWs.projects.length > 0) {
            const currentProj = currentWs.projects.find((p) => p.id === projectId) || currentWs.projects[0];
            if (currentProj) {
              setProjectIdState(currentProj.id);
              localStorage.setItem("royaltyos_project_id", currentProj.id);
            }
          }
        }
      }
    } catch (err) {
      setMe(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api("/api/v1/auth/logout", { method: "POST" });
    } catch {}
    setMe(null);
    localStorage.removeItem("royaltyos_workspace_id");
    localStorage.removeItem("royaltyos_project_id");
    showToast("Signed out successfully", "info");
  };

  useEffect(() => {
    refreshMe();
    const handleExpired = () => {
      setMe(null);
      showToast("Session expired. Please sign in again.", "warn");
    };
    window.addEventListener("royaltyos:session-expired", handleExpired);
    return () => window.removeEventListener("royaltyos:session-expired", handleExpired);
  }, []);

  const currentWorkspace = me?.workspaces.find((w) => w.id === workspaceId) || null;
  const currentProject = currentWorkspace?.projects.find((p) => p.id === projectId) || null;

  return (
    <AppContext.Provider
      value={{
        me,
        loading,
        workspaceId,
        projectId,
        currentWorkspace,
        currentProject,
        setWorkspaceId,
        setProjectId,
        refreshMe,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within an AppProvider");
  return ctx;
}
