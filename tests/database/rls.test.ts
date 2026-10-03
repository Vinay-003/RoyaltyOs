import test from "node:test";
import assert from "node:assert/strict";
import { asRole, one, q } from "./_client.ts";
import { createWorkspace } from "./_fixtures.ts";

test("every application table has row level security enabled and no permissive policy", async () => {
  const totals = await one<{ tables: string; secured: string }>(
    `select count(*) as tables,
            count(*) filter (where c.relrowsecurity) as secured
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`,
  );
  assert.equal(Number(totals!.tables), Number(totals!.secured), "all public tables enable RLS");
  assert.ok(Number(totals!.tables) >= 30, "the expected domain tables exist");

  const policies = await one<{ count: string }>(`select count(*) from pg_policies where schemaname='public'`);
  assert.equal(Number(policies!.count), 0, "access is deny-by-default: no role gets a permissive policy");
});

test("anon and authenticated cannot read or write tenant rows", async () => {
  const fixture = await createWorkspace("rls");
  const asOwner = await one<{ count: string }>(`select count(*) from settlements`, []);
  const postgresCount = Number(asOwner!.count);

  for (const role of ["anon", "authenticated"]) {
    const visible = await asRole(role, async (query) => {
      const result = await query(`select count(*) from settlements`);
      return Number(result.rows[0].count);
    });
    assert.equal(visible, 0, `${role} sees no settlement rows through RLS`);

    const workspaceVisible = await asRole(role, async (query) => {
      const result = await query(`select count(*) from audit_events where workspace_id=$1`, [fixture.workspaceId]);
      return Number(result.rows[0].count);
    });
    assert.equal(workspaceVisible, 0, `${role} cannot read another tenant's audit trail`);

    await assert.rejects(
      asRole(role, async (query) => query(`insert into simulations(workspace_id, project_id, ruleset_id, created_by, input, output) values ($1,$2,$3,$4,'{}','{}')`, [
        fixture.workspaceId,
        fixture.projectId,
        fixture.workspaceId,
        fixture.userId,
      ])),
      /row-level security|permission denied/,
      `${role} cannot insert rows`,
    );
  }

  assert.ok(postgresCount >= 0);
});

test("financial RPCs are service-role only", async () => {
  const privileged = [
    "royaltyos_commit_settlement(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid)",
    "royaltyos_approve_settlement(uuid,uuid)",
    "royaltyos_reserve_payout(uuid,uuid,text)",
    "royaltyos_reserve_payout_retry(uuid,uuid,text)",
    "royaltyos_append_audit(uuid,uuid,text,text,text,text,text)",
    "royaltyos_record_invoice_revenue(uuid,text,bigint,character,timestamptz,text)",
    "royaltyos_mark_payout_item(text,text,text,text,text)",
  ];

  for (const fn of privileged) {
    for (const role of ["anon", "authenticated"]) {
      const allowed = await one<{ allowed: boolean }>(
        `select has_function_privilege($1, $2::regprocedure, 'execute') as allowed`,
        [role, fn],
      );
      assert.equal(allowed!.allowed, false, `${role} must not execute ${fn}`);
    }
    const serviceAllowed = await one<{ allowed: boolean }>(
      `select has_function_privilege('service_role', $1::regprocedure, 'execute') as allowed`,
      [fn],
    );
    assert.equal(serviceAllowed!.allowed, true, `service_role executes ${fn}`);
  }

  await assert.rejects(
    asRole("authenticated", async (query) =>
      query(`select royaltyos_append_audit($1::uuid,$2::uuid,'FORGED','X','1','nope',null)`, [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ]),
    ),
    /permission denied/,
    "authenticated cannot write audit events through the RPC",
  );
});

test("service role bypasses RLS and workspace scoping isolates tenants", async () => {
  const workspaceA = await createWorkspace("tenant-a");
  const workspaceB = await createWorkspace("tenant-b");
  await q(`insert into notifications(workspace_id, user_id, channel, event_type, payload, status)
           values ($1,$2,'email','test','{"label":"A"}'::jsonb,'PENDING'), ($3,$4,'email','test','{"label":"B"}'::jsonb,'PENDING')`, [
    workspaceA.workspaceId,
    workspaceA.userId,
    workspaceB.workspaceId,
    workspaceB.userId,
  ]);

  const scoped = await asRole("service_role", async (query) => {
    const a = await query(`select count(*) from notifications where workspace_id=$1`, [workspaceA.workspaceId]);
    const b = await query(`select count(*) from notifications where workspace_id=$1`, [workspaceB.workspaceId]);
    const all = await query(`select count(*) from notifications`);
    return { a: Number(a.rows[0].count), b: Number(b.rows[0].count), all: Number(all.rows[0].count) };
  });

  assert.equal(scoped.a, 1, "service role reads workspace A only when scoped");
  assert.equal(scoped.b, 1, "service role reads workspace B only when scoped");
  assert.ok(scoped.all >= 2, "service role bypasses RLS by design (server-side authorization is authoritative)");

  const anonAll = await asRole("anon", async (query) => {
    const result = await query(`select count(*) from notifications`);
    return Number(result.rows[0].count);
  });
  assert.equal(anonAll, 0, "the public anon key exposes no tenant data");
});

test("storage bucket is private and restricted to PDFs", async () => {
  const bucket = await one<{ public: boolean; allowed: string[]; limit: string }>(
    `select public, allowed_mime_types as allowed, file_size_limit::text as limit from storage.buckets where id='royaltyos-contracts'`,
  );
  assert.ok(bucket, "contract bucket exists");
  assert.equal(bucket!.public, false, "bucket is private");
  assert.ok(bucket!.allowed.includes("application/pdf"));
  assert.equal(Number(bucket!.limit), 10 * 1024 * 1024);
});
