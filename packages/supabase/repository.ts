import type { SupabaseClient } from "./client.ts";

export type AuthPrincipal = { id: string; email: string | null };

export class Repository {
  readonly db: SupabaseClient;
  constructor(db: SupabaseClient) { this.db = db; }

  async memberships(userId: string) {
    return this.db.select<ArrayRecord>("workspace_memberships", {
      select: "workspace_id,role,beneficiary_key,workspaces(id,name)",
      user_id: `eq.${userId}`,
      order: "created_at.asc",
    });
  }


  async sessionRevokedBefore(userId: string) {
    const rows = await this.db.select<ArrayRecord>("user_security_state", {
      select: "session_revoked_before",
      user_id: `eq.${userId}`,
      limit: "1",
    });
    const value = rows[0]?.session_revoked_before;
    return typeof value === "string" ? value : null;
  }

  async revokeSessions(userId: string) {
    const now = new Date().toISOString();
    const existing = await this.db.select<ArrayRecord>("user_security_state", {
      select: "user_id",
      user_id: `eq.${userId}`,
      limit: "1",
    });
    if (existing.length) {
      await this.db.update("user_security_state", { session_revoked_before: now, updated_at: now }, { user_id: `eq.${userId}` }, false);
    } else {
      await this.db.insert("user_security_state", { user_id: userId, session_revoked_before: now }, false);
    }
    return now;
  }

  async requireRole(userId: string, workspaceId: string, allowed: string[]) {
    const rows = await this.db.select<ArrayRecord>("workspace_memberships", {
      select: "workspace_id,user_id,role,beneficiary_key",
      workspace_id: `eq.${workspaceId}`,
      user_id: `eq.${userId}`,
      limit: "1",
    });
    const membership = rows[0];
    if (!membership || !allowed.includes(String(membership.role))) {
      const error = new Error("Forbidden: workspace role is not authorized");
      (error as Error & { status?: number }).status = 403;
      throw error;
    }
    return membership;
  }

  async requireRecentStepUp(userId: string, ttlSeconds: number) {
    const rows = await this.db.select<ArrayRecord>("user_security_state", {
      select: "step_up_at",
      user_id: `eq.${userId}`,
      limit: "1",
    });
    const value = rows[0]?.step_up_at;
    const time = typeof value === "string" ? Date.parse(value) : 0;
    if (!time || Date.now() - time > ttlSeconds * 1000) {
      const error = new Error("Recent authentication required");
      (error as Error & { status?: number }).status = 428;
      throw error;
    }
  }

  async markStepUp(userId: string) {
    const now = new Date().toISOString();
    const existing = await this.db.select<ArrayRecord>("user_security_state", {
      select: "user_id",
      user_id: `eq.${userId}`,
      limit: "1",
    });
    if (existing.length) {
      await this.db.update("user_security_state", { step_up_at: now }, { user_id: `eq.${userId}` }, false);
    } else {
      await this.db.insert("user_security_state", { user_id: userId, step_up_at: now }, false);
    }
    return now;
  }
}

type ArrayRecord = Record<string, unknown>;
