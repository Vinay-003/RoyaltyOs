import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, showToast } from "./api.ts";

export interface ProjectInfo {
  id: string;
  name: string;
  currency: string;
  workspace_id?: string | undefined;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  role: string;
  projects: ProjectInfo[];
}

export interface UserMe {
  id: string;
  email: string;
  displayName?: string | null | undefined;
  workspaces: WorkspaceInfo[];
  version?: string | undefined;
}

interface AppContextValue {
  me: UserMe | null;
  loading: boolean;
  workspaceId: string | null;
  projectId: string | null;
  currentWorkspace: WorkspaceInfo | null;
  currentProject: ProjectInfo | null;
  theme: "light" | "dark";
  toggleTheme: () => void;
  setWorkspaceId: (id: string) => void;
  setProjectId: (id: string) => void;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("royaltyos_theme") as "light" | "dark") || "light";
  });
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(
    localStorage.getItem("royaltyos_workspace_id")
  );
  const [projectId, setProjectIdState] = useState<string | null>(
    localStorage.getItem("royaltyos_project_id")
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("royaltyos_theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const setWorkspaceId = (id: string) => {
    setWorkspaceIdState(id);
    localStorage.setItem("royaltyos_workspace_id", id);
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
      const hasPriorSession = localStorage.getItem("royaltyos_has_session") === "true";
      let meRes: any;
      try {
        meRes = await api("/api/v1/me", { maxRetries: hasPriorSession ? 5 : 1 });
      } catch (err: any) {
        if (err.status === 401 || err.status === 502 || err.status === 503 || err.status === 504) {
          setMe(null);
          return;
        }
        throw err;
      }

      if (!meRes || !meRes.user) {
        setMe(null);
        return;
      }
      localStorage.setItem("royaltyos_has_session", "true");

      let memberships = Array.isArray(meRes.memberships) ? meRes.memberships : [];
      if (memberships.length === 0) {
        try {
          const boot = await api<{ workspaceId: string; projectId: string }>("/api/v1/bootstrap", {
            method: "POST",
            json: {},
          });
          if (boot?.workspaceId) localStorage.setItem("royaltyos_workspace_id", boot.workspaceId);
          if (boot?.projectId) localStorage.setItem("royaltyos_project_id", boot.projectId);
          meRes = await api("/api/v1/me");
          memberships = Array.isArray(meRes.memberships) ? meRes.memberships : [];
        } catch (bootErr) {
          console.warn("Bootstrap workspace error:", bootErr);
        }
      }

      // Fetch projects across accessible workspaces
      let projects: ProjectInfo[] = [];
      try {
        projects = await api<ProjectInfo[]>("/api/v1/projects");
      } catch (projErr) {
        console.warn("Projects fetch error:", projErr);
      }

      // Construct workspace map with projects
      const wsMap = new Map<string, WorkspaceInfo>();
      for (const m of memberships) {
        const wsId = String(m.workspace_id);
        const wsName = m.workspaces?.name || (Array.isArray(m.workspaces) ? m.workspaces[0]?.name : null) || "RoyaltyOS Workspace";
        wsMap.set(wsId, {
          id: wsId,
          name: wsName,
          role: m.role || "OWNER",
          projects: [],
        });
      }

      // If user has workspaces but no projects, trigger bootstrap to ensure real DB records
      if (wsMap.size > 0 && projects.length === 0) {
        try {
          await api<{ workspaceId: string; projectId: string }>("/api/v1/bootstrap", {
            method: "POST",
            json: {},
          });
          projects = await api<ProjectInfo[]>("/api/v1/projects");
        } catch (bootErr) {
          console.warn("Bootstrap projects error:", bootErr);
        }
      }

      for (const p of projects) {
        if (!p.id || p.id === "proj-default") continue;
        const targetWs = wsMap.get(p.workspace_id || "") || Array.from(wsMap.values())[0];
        if (targetWs) {
          targetWs.projects.push({
            id: p.id,
            name: p.name || "Main Production Project",
            currency: p.currency || "USD",
            ...(p.workspace_id ? { workspace_id: p.workspace_id } : {}),
          });
        }
      }

      const workspaces = Array.from(wsMap.values());

      // Clean up legacy/corrupted localStorage values
      const rawWsId = localStorage.getItem("royaltyos_workspace_id");
      const rawProjId = localStorage.getItem("royaltyos_project_id");
      if (rawWsId === "ws-default") localStorage.removeItem("royaltyos_workspace_id");
      if (rawProjId === "proj-default") localStorage.removeItem("royaltyos_project_id");

      // Determine active workspace
      const savedWsId = localStorage.getItem("royaltyos_workspace_id");
      const currentWs = workspaces.find((w) => w.id === savedWsId) ?? workspaces[0];
      if (currentWs) {
        setWorkspaceIdState(currentWs.id);
        localStorage.setItem("royaltyos_workspace_id", currentWs.id);

        // Determine active project
        const savedProjId = localStorage.getItem("royaltyos_project_id");
        const currentProj = currentWs.projects.find((p) => p.id === savedProjId);
        const firstProj = currentWs.projects[0];
        if (currentProj) {
          setProjectIdState(currentProj.id);
          localStorage.setItem("royaltyos_project_id", currentProj.id);
        } else if (firstProj) {
          setProjectIdState(firstProj.id);
          localStorage.setItem("royaltyos_project_id", firstProj.id);
        } else {
          setProjectIdState(null);
        }
      } else {
        setWorkspaceIdState(null);
        setProjectIdState(null);
      }

      setMe({
        id: meRes.user.id,
        email: meRes.user.email,
        displayName: meRes.user.user_metadata?.display_name || meRes.user.email.split("@")[0],
        workspaces,
        version: meRes.version,
      });
    } catch (err) {
      console.error("refreshMe fatal error:", err);
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
    localStorage.removeItem("royaltyos_has_session");
    localStorage.removeItem("royaltyos_workspace_id");
    localStorage.removeItem("royaltyos_project_id");
    showToast("Signed out successfully", "info");
  };

  useEffect(() => {
    refreshMe();
    const handleExpired = () => {
      setMe(null);
      localStorage.removeItem("royaltyos_has_session");
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
        theme,
        toggleTheme,
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
