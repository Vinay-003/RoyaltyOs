import test from "node:test";
import assert from "node:assert/strict";
import { asRole, one } from "./_client.ts";
import { createWorkspace } from "./_fixtures.ts";

test("one PayPal account per workspace with reconnect upsert", async () => {
  const fixture = await createWorkspace("ws-paypal");
  const row = await one<{ workspace_id: string }>(
    `insert into workspace_paypal_accounts(workspace_id, environment, paypal_client_id, paypal_client_secret_enc, paypal_webhook_id, created_by)
     values ($1,'sandbox','ws-id-1','v1:n:c','WH-1',$2) returning workspace_id`,
    [fixture.workspaceId, fixture.userId],
  );
  assert.equal(row!.workspace_id, fixture.workspaceId);

  const second = await one<{ workspace_id: string }>(
    `insert into workspace_paypal_accounts(workspace_id, environment, paypal_client_id, paypal_client_secret_enc, created_by)
     values ($1,'sandbox','ws-id-2','v1:n:c',$2)
     on conflict (workspace_id) do update set paypal_client_id=excluded.paypal_client_id returning workspace_id`,
    [fixture.workspaceId, fixture.userId],
  );
  assert.equal(second!.workspace_id, fixture.workspaceId, "reconnect upserts the single row");

  const count = await one<{ count: string }>(
    `select count(*) from workspace_paypal_accounts where workspace_id=$1`,
    [fixture.workspaceId],
  );
  assert.equal(Number(count!.count), 1, "never two rows per workspace");
});

test("browser keys have no access to workspace PayPal accounts", async () => {
  const fixture = await createWorkspace("ws-paypal-rls");
  await one(
    `insert into workspace_paypal_accounts(workspace_id, paypal_client_id, paypal_client_secret_enc, created_by)
     values ($1,'ws-id','v1:n:c',$2) returning workspace_id`,
    [fixture.workspaceId, fixture.userId],
  );
  for (const role of ["anon", "authenticated"]) {
    // Grants are revoked on top of RLS (defense in depth for secrets), so
    // browser roles fail at the permission layer instead of filtering rows.
    await assert.rejects(
      asRole(role, async (query) => query(`select count(*) from workspace_paypal_accounts`)),
      /permission denied/,
      `${role} cannot read PayPal accounts`,
    );
    await assert.rejects(
      asRole(role, async (query) =>
        query(`insert into workspace_paypal_accounts(workspace_id, paypal_client_id, paypal_client_secret_enc) values ($1,'x','y')`, [
          fixture.workspaceId,
        ]),
      ),
      /row-level security|permission denied/,
      `${role} cannot write PayPal accounts`,
    );
  }
});
