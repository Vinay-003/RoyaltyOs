import test from "node:test";
import assert from "node:assert/strict";
import { createRoyaltyServer } from "../../apps/api/server.ts";
import { testConfig } from "../helpers.ts";

test("API Endpoints Audit: all system, auth, project, contract, finance, and assistant routes succeed", async () => {
  const mockUser = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "operator@royaltyos.org",
    user_metadata: { display_name: "Lead Operator" },
  };

  const mockWorkspace = {
    id: "00000000-0000-4000-8000-000000000010",
    name: "RoyaltyOS Default Workspace",
    created_at: new Date().toISOString(),
  };

  const mockProject = {
    id: "00000000-0000-4000-8000-000000000020",
    workspace_id: mockWorkspace.id,
    name: "Master Recording Vault",
    currency: "USD",
    created_at: new Date().toISOString(),
  };

  const mockContract = {
    id: "00000000-0000-4000-8000-000000000030",
    workspace_id: mockWorkspace.id,
    project_id: mockProject.id,
    title: "Commercial Licensing Agreement",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
  };

  const mockContractVersion = {
    id: "00000000-0000-4000-8000-000000000031",
    workspace_id: mockWorkspace.id,
    contract_id: mockContract.id,
    version: 1,
    title: "Version 1.0",
    created_at: new Date().toISOString(),
  };

  const mockAnalysis = {
    id: "00000000-0000-4000-8000-000000000032",
    workspace_id: mockWorkspace.id,
    contract_version_id: mockContractVersion.id,
    status: "COMPLETED",
    warnings: [],
    conflicts: [],
    created_at: new Date().toISOString(),
  };

  const mockRuleset = {
    id: "00000000-0000-4000-8000-000000000040",
    workspace_id: mockWorkspace.id,
    project_id: mockProject.id,
    contract_version_id: mockContractVersion.id,
    version: 1,
    status: "ACTIVE",
    ruleset_hash: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    rules: [
      {
        id: "00000000-0000-4000-8000-000000000041",
        workspace_id: mockWorkspace.id,
        ruleset_id: "00000000-0000-4000-8000-000000000040",
        rule_type: "PERCENTAGE",
        beneficiary_key: "creator",
        base: "NET_REVENUE",
        rate_basis_points: 5000,
        fixed_minor: null,
        priority: 10,
        conditions: [],
        config: {},
        dependencies: [],
      },
    ],
    created_at: new Date().toISOString(),
  };

  const mockSettlement = {
    id: "00000000-0000-4000-8000-000000000050",
    workspace_id: mockWorkspace.id,
    revenue_event_id: "00000000-0000-4000-8000-000000000060",
    status: "APPROVED",
    distributable_minor: 100000,
    created_at: new Date().toISOString(),
  };

  const ctx: any = {
    config: testConfig(),
    supabase: {
      verifyUser: async () => mockUser,
      signIn: async () => ({ session: { access_token: "mock.jwt" }, user: mockUser }),
      adminGetUser: async () => mockUser,
      adminUpdateUser: async () => mockUser,
      signedObjectUrl: async () => "https://storage.example.com/mock.pdf",
      select: async (table: string, filters: any = {}) => {
        if (table === "workspace_memberships") {
          return [{ id: "mem-1", workspace_id: mockWorkspace.id, user_id: mockUser.id, role: "OWNER" }];
        }
        if (table === "workspaces") return [mockWorkspace];
        if (table === "projects") return [mockProject];
        if (table === "contracts") return [mockContract];
        if (table === "contract_versions") return [mockContractVersion];
        if (table === "contract_analyses") return [mockAnalysis];
        if (table === "candidate_rules") return [];
        if (table === "rulesets") return [mockRuleset];
        if (table === "rules") return mockRuleset.rules;
        if (table === "beneficiaries") return [{ id: "ben-1", beneficiary_key: "creator", name: "Lead Creator", payout_email: "creator@example.com" }];
        if (table === "invoices") return [{ id: "inv-1", workspace_id: mockWorkspace.id, status: "DRAFT", amount_minor: 50000, currency: "USD" }];
        if (table === "revenue_events") return [{ id: "00000000-0000-4000-8000-000000000060", workspace_id: mockWorkspace.id, project_id: mockProject.id, distributable_minor: 100000, currency: "USD" }];
        if (table === "settlements") return [mockSettlement];
        if (table === "settlement_lines") return [{ id: "line-1", settlement_id: mockSettlement.id, beneficiary_key: "creator", amount_minor: 50000, payable_minor: 50000, currency: "USD" }];
        if (table === "payout_batches") return [{ id: "batch-1", workspace_id: mockWorkspace.id, settlement_id: mockSettlement.id, status: "SUCCESS", total_amount_minor: 50000, currency: "USD" }];
        if (table === "payout_items") return [{ id: "item-1", payout_batch_id: "batch-1", beneficiary_key: "creator", amount_minor: 50000, currency: "USD", status: "SUCCESS" }];
        if (table === "recoupment_accounts") return [{ id: "rec-1", beneficiary_key: "creator", remaining_minor: 0, original_minor: 10000 }];
        if (table === "ledger_transactions") return [{ id: "tx-1", workspace_id: mockWorkspace.id, amount_minor: 100000 }];
        if (table === "webhook_events") return [];
        if (table === "reconciliation_issues") return [];
        if (table === "notifications") return [{ id: "notif-1", workspace_id: mockWorkspace.id, channel: "EMAIL", event_type: "PAYOUT_COMPLETED", subject: "Payout Complete", status: "SENT", created_at: new Date().toISOString() }];
        return [];
      },
      insert: async (table: string, record: any) => [record],
      update: async (table: string, patch: any) => [patch],
      delete: async () => [],
      rpc: async (fn: string) => {
        if (fn === "royaltyos_financial_integrity") return [{ valid: true, issues: [] }];
        if (fn === "royaltyos_verify_audit_chain") return [{ valid: true, unbroken: true }];
        return { ok: true };
      },
    },
    repo: {
      sessionRevokedBefore: async () => null,
      requireRole: async () => ({ role: "OWNER" }),
      requireRecentStepUp: async () => {},
      markStepUp: async () => new Date().toISOString(),
      recordStepUp: async () => {},
      memberships: async () => [{ workspace_id: mockWorkspace.id, role: "OWNER" }],
    },
    paypal: {
      health: async () => ({ oauthOk: true, environment: "sandbox" }),
      listInvoices: async () => ({ items: [], total_count: 0 }),
    },
    fetchImpl: async (input: any, init: any) => {
      const url = String(input);
      if (url.includes("/responses") || url.includes("/chat/completions")) {
        return new Response(JSON.stringify({
          output_text: "Reserve holdback is currently $0.00.",
          choices: [{ message: { content: "Reserve holdback is currently $0.00." } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return fetch(input, init);
    },
  };

  const server = createRoyaltyServer(ctx);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const authHeaders = {
      Authorization: "Bearer mock.jwt.token",
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    };

    // 1. System routes
    const sysRoutes = ["/api/version", "/api/health", "/api/readiness", "/api/providers/health"];
    for (const r of sysRoutes) {
      const res = await fetch(base + r);
      assert.equal(res.status, 200, `System route ${r} failed`);
    }

    // 2. Auth routes
    const meRes = await fetch(base + "/api/v1/auth/me", { headers: authHeaders });
    assert.equal(meRes.status, 200, "/api/v1/auth/me");
    const meData = await meRes.json();
    assert.ok(meData.user, "Me data missing user");

    const meAlias = await fetch(base + "/api/v1/me", { headers: authHeaders });
    assert.equal(meAlias.status, 200, "/api/v1/me alias");

    const stepUpRes = await fetch(base + "/api/v1/auth/step-up", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ password: "ValidPassword123" }),
    });
    assert.equal(stepUpRes.status, 200, "/api/v1/auth/step-up");

    const pwChangeRes = await fetch(base + "/api/v1/auth/change-password", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ currentPassword: "OldPassword123", newPassword: "NewPassword456!" }),
    });
    assert.equal(pwChangeRes.status, 200, "/api/v1/auth/change-password");

    // 3. Profile & Workspaces
    const profileRes = await fetch(base + "/api/v1/profile", { headers: authHeaders });
    assert.equal(profileRes.status, 200, "/api/v1/profile");
    const profileData = await profileRes.json();
    assert.ok(Array.isArray(profileData.workspaces), "Workspaces must be array");

    const wsRes = await fetch(base + "/api/v1/workspaces", { headers: authHeaders });
    assert.equal(wsRes.status, 200, "/api/v1/workspaces");

    const wsProjects = await fetch(base + `/api/v1/workspaces/${mockWorkspace.id}/projects`, { headers: authHeaders });
    assert.equal(wsProjects.status, 200, "workspace projects");

    const wsMembers = await fetch(base + `/api/v1/workspaces/${mockWorkspace.id}/members`, { headers: authHeaders });
    assert.equal(wsMembers.status, 200, "workspace members");

    // 4. Projects & Dashboards
    const projRes = await fetch(base + `/api/v1/projects/${mockProject.id}`, { headers: authHeaders });
    assert.equal(projRes.status, 200, "project detail");

    const dashRes = await fetch(base + `/api/v1/projects/${mockProject.id}/dashboard`, { headers: authHeaders });
    assert.equal(dashRes.status, 200, "project dashboard");

    const insightsProjRes = await fetch(base + `/api/v1/projects/${mockProject.id}/insights`, { headers: authHeaders });
    assert.equal(insightsProjRes.status, 200, "project insights");

    const royaltiesProjRes = await fetch(base + `/api/v1/projects/${mockProject.id}/royalties`, { headers: authHeaders });
    assert.equal(royaltiesProjRes.status, 200, "project royalties");

    // 5. Contracts & Rulesets
    const contractsWs = await fetch(base + `/api/v1/contracts?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(contractsWs.status, 200, "contracts by workspaceId");

    const contractsProj = await fetch(base + `/api/v1/contracts?projectId=${mockProject.id}`, { headers: authHeaders });
    assert.equal(contractsProj.status, 200, "contracts by projectId");

    const contractDetail = await fetch(base + `/api/v1/contracts/${mockContract.id}`, { headers: authHeaders });
    assert.equal(contractDetail.status, 200, "contract detail");

    const rulesetWs = await fetch(base + `/api/v1/rulesets/active?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(rulesetWs.status, 200, "active ruleset by workspaceId");

    const rulesetProj = await fetch(base + `/api/v1/rulesets/active?projectId=${mockProject.id}`, { headers: authHeaders });
    assert.equal(rulesetProj.status, 200, "active ruleset by projectId");

    const simulateRes = await fetch(base + `/api/v1/rulesets/${mockRuleset.id}/simulate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ revenueMinor: 100000, currency: "USD" }),
    });
    assert.equal(simulateRes.status, 200, "simulate scenario");

    // 6. Beneficiaries
    const benWs = await fetch(base + `/api/v1/beneficiaries?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(benWs.status, 200, "beneficiaries by workspaceId");

    const benProj = await fetch(base + `/api/v1/beneficiaries?projectId=${mockProject.id}`, { headers: authHeaders });
    assert.equal(benProj.status, 200, "beneficiaries by projectId");

    // 7. Invoices, Revenues, Settlements, Payouts, Audit, Notifications, Insights
    const invWs = await fetch(base + `/api/v1/invoices?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(invWs.status, 200, "invoices by workspaceId");

    const invProj = await fetch(base + `/api/v1/invoices?projectId=${mockProject.id}`, { headers: authHeaders });
    assert.equal(invProj.status, 200, "invoices by projectId");

    const revWs = await fetch(base + `/api/v1/revenue-events?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(revWs.status, 200, "revenue events by workspaceId");

    const revProj = await fetch(base + `/api/v1/revenue-events?projectId=${mockProject.id}`, { headers: authHeaders });
    assert.equal(revProj.status, 200, "revenue events by projectId");

    const setWs = await fetch(base + `/api/v1/settlements?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(setWs.status, 200, "settlements by workspaceId");

    const payoutsWs = await fetch(base + `/api/v1/payouts?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(payoutsWs.status, 200, "payouts by workspaceId");

    const repWs = await fetch(base + `/api/v1/reports/royalties?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(repWs.status, 200, "royalties report by workspaceId");

    const auditWs = await fetch(base + `/api/v1/audit?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(auditWs.status, 200, "audit by workspaceId");

    const notifWs = await fetch(base + `/api/v1/notifications?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(notifWs.status, 200, "notifications by workspaceId");

    const notifProj = await fetch(base + `/api/v1/notifications?projectId=${mockProject.id}`, { headers: authHeaders });
    assert.equal(notifProj.status, 200, "notifications by projectId");

    const insightsWs = await fetch(base + `/api/v1/insights?workspaceId=${mockWorkspace.id}`, { headers: authHeaders });
    assert.equal(insightsWs.status, 200, "insights by workspaceId");

    // 8. PayPal AI Assistant routes
    const aiRes = await fetch(base + "/api/v1/assistant/paypal", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: mockWorkspace.id, question: "What is the reserve holdback?" }),
    });
    assert.equal(aiRes.status, 200, "/api/v1/assistant/paypal");

    const aiAliasRes = await fetch(base + "/api/v1/paypal-agent/ask", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ workspaceId: mockWorkspace.id, question: "What is the reserve holdback?" }),
    });
    assert.equal(aiAliasRes.status, 200, "/api/v1/paypal-agent/ask");

  } finally {
    await new Promise<void>((resolve, reject) => server.close((err: any) => err ? reject(err) : resolve()));
  }
});
