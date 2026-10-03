import { createHash, randomUUID } from "node:crypto";
import { one, q } from "./_client.ts";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hash64(seed: string): string {
  return sha256(seed).slice(0, 64);
}

function assertSeeded(account: { remaining_minor: string } | null, expected: number) {
  if (!account) throw new Error("recoupment account was not seeded by rule activation");
  if (Number(account.remaining_minor) !== expected) {
    throw new Error(`recoupment account seeded with ${account.remaining_minor}, expected ${expected}`);
  }
}

export interface Fixture {
  userId: string;
  workspaceId: string;
  projectId: string;
}

/** Creates a user + workspace + project through the real bootstrap RPC. */
export async function createWorkspace(label = "db-test"): Promise<Fixture> {
  const userId = randomUUID();
  await q(`insert into auth.users(id, email) values ($1, $2)`, [userId, `${label}-${userId}@audit.local`]);
  const boot = await one<{ boot: { workspaceId: string; projectId: string } | string }>(
    `select royaltyos_bootstrap_workspace($1::uuid) as boot`,
    [userId],
  );
  const parsed = (typeof boot!.boot === "string" ? JSON.parse(boot!.boot) : boot!.boot) as {
    workspaceId: string;
    projectId: string;
  };
  return { userId, workspaceId: parsed.workspaceId, projectId: parsed.projectId };
}

export async function membershipRole(fixture: Fixture, role: string): Promise<void> {
  await q(
    `insert into workspace_memberships(workspace_id, user_id, role) values ($1,$2,$3)
     on conflict (workspace_id, user_id) do update set role = excluded.role`,
    [fixture.workspaceId, fixture.userId, role],
  );
}

/** Adds another user to the workspace with the given role (used by RBAC tests). */
export async function createMember(fixture: Fixture, role: string): Promise<string> {
  const userId = randomUUID();
  await q(`insert into auth.users(id, email) values ($1, $2)`, [userId, `${role}-${userId}@audit.local`]);
  await q(`insert into workspace_memberships(workspace_id, user_id, role) values ($1,$2,$3)`, [
    fixture.workspaceId,
    userId,
    role,
  ]);
  return userId;
}

/** Activates a ruleset that contains a RECOUPMENT rule and seeds its advance balance. */
export async function activateRecoupmentRuleset(
  fixture: Fixture,
  contractVersionId: string,
  advanceMinor: number,
): Promise<{ rulesetId: string; rulesetHash: string; ruleId: string }> {
  const rulesetHash = hash64(`recoup-${contractVersionId}`);
  const rulesetId = await one<{ id: string }>(
    `select royaltyos_activate_ruleset($1::uuid,$2::uuid,$3::uuid,$4::int,$5::text,$6::jsonb,$7::uuid) as id`,
    [
      fixture.workspaceId,
      fixture.projectId,
      contractVersionId,
      1,
      rulesetHash,
      JSON.stringify([
        { type: "RECOUPMENT", beneficiaryKey: "producer", base: "NET_REVENUE", rateBasisPoints: 1500, priority: 10,
          config: { advanceMinor, preRecoupmentBasisPoints: 2500, postRecoupmentBasisPoints: 1500 } },
        { type: "PERCENTAGE", beneficiaryKey: "artist", base: "NET_REVENUE", rateBasisPoints: 6000, priority: 20 },
      ]),
      fixture.userId,
    ],
  );
  const rule = await one<{ id: string }>(
    `select id from rules where ruleset_id=$1 and rule_type='RECOUPMENT' limit 1`,
    [rulesetId!.id],
  );
  // Activation seeds the recoupment account from config.advanceMinor; assert it did.
  const account = await one<{ remaining_minor: string }>(
    `select remaining_minor::text from recoupment_accounts where rule_id=$1`,
    [rule!.id],
  );
  assertSeeded(account, advanceMinor);
  return { rulesetId: rulesetId!.id, rulesetHash, ruleId: rule!.id };
}

export async function createContract(fixture: Fixture): Promise<{ contractId: string; contractVersionId: string }> {
  const contract = await one<{ id: string }>(
    `insert into contracts(workspace_id, project_id, title, created_by, status)
     values ($1,$2,$3,$4,'ACTIVE') returning id`,
    [fixture.workspaceId, fixture.projectId, `Contract ${randomUUID().slice(0, 8)}`, fixture.userId],
  );
  const version = await one<{ id: string }>(
    `insert into contract_versions(workspace_id, contract_id, version, title, created_by)
     values ($1,$2,1,$3,$4) returning id`,
    [fixture.workspaceId, contract!.id, "Agreement v1", fixture.userId],
  );
  return { contractId: contract!.id, contractVersionId: version!.id };
}

/** Activates a minimal RuleSet through the real activation RPC (RBAC enforced inside). */
export async function activateRuleset(
  fixture: Fixture,
  contractVersionId: string,
  seed = randomUUID(),
): Promise<{ rulesetId: string; rulesetHash: string }> {
  const rulesetHash = hash64(seed);
  const rulesetId = await one<{ id: string }>(
    `select royaltyos_activate_ruleset($1::uuid,$2::uuid,$3::uuid,$4::int,$5::text,$6::jsonb,$7::uuid) as id`,
    [
      fixture.workspaceId,
      fixture.projectId,
      contractVersionId,
      1,
      rulesetHash,
      JSON.stringify([
        { type: "PERCENTAGE", beneficiaryKey: "artist", base: "NET_REVENUE", rateBasisPoints: 6000, priority: 10 },
        { type: "PERCENTAGE", beneficiaryKey: "producer", base: "NET_REVENUE", rateBasisPoints: 1500, priority: 20 },
        { type: "PERCENTAGE", beneficiaryKey: "manager", base: "NET_REVENUE", rateBasisPoints: 1000, priority: 30 },
        {
          type: "REVENUE_CATEGORY",
          beneficiaryKey: "featured_creator",
          base: "NET_REVENUE",
          rateBasisPoints: 500,
          priority: 40,
          conditions: [{ kind: "REVENUE_CATEGORY", value: "VIDEO" }],
        },
      ]),
      fixture.userId,
    ],
  );
  return { rulesetId: rulesetId!.id, rulesetHash };
}

export async function createBeneficiaries(fixture: Fixture): Promise<void> {
  const rows: Array<[string, string, string]> = [
    ["artist", "Artist", `artist-${randomUUID().slice(0, 8)}@sandbox.example`],
    ["producer", "Producer", `producer-${randomUUID().slice(0, 8)}@sandbox.example`],
    ["manager", "Manager", `manager-${randomUUID().slice(0, 8)}@sandbox.example`],
    ["featured_creator", "Featured", `featured-${randomUUID().slice(0, 8)}@sandbox.example`],
  ];
  for (const [key, name, email] of rows) {
    await q(
      `insert into beneficiaries(workspace_id, project_id, beneficiary_key, display_name, payout_email)
       values ($1,$2,$3,$4,$5)`,
      [fixture.workspaceId, fixture.projectId, key, name, email],
    );
  }
}

export async function createRevenueEvent(
  fixture: Fixture,
  options: { amountMinor: number; category?: string; externalId?: string } = { amountMinor: 1_000_000 },
): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into revenue_events(workspace_id, project_id, source, external_id, gross_minor, distributable_minor, currency, revenue_category, received_at)
     values ($1,$2,'PAYPAL_INVOICE',$3,$4,$4,'USD',$5,now()) returning id`,
    [
      fixture.workspaceId,
      fixture.projectId,
      options.externalId ?? `INV-${randomUUID()}`,
      options.amountMinor,
      options.category ?? "VIDEO",
    ],
  );
  return row!.id;
}

export interface SettlementLineInput {
  key: string;
  beneficiaryKey: string;
  beneficiaryName: string;
  amountMinor: number;
  payableMinor: number;
  kind: string;
  metadata?: Record<string, unknown>;
}

/** The canonical $10,000 VIDEO demo allocation (recoupment + four royalties + reserve). */
export function canonicalLines(): SettlementLineInput[] {
  return [
    { key: "artist:PAYABLE", beneficiaryKey: "artist", beneficiaryName: "Artist", amountMinor: 564_000, payableMinor: 564_000, kind: "PAYABLE" },
    { key: "producer:RECOUPMENT", beneficiaryKey: "producer", beneficiaryName: "Producer", amountMinor: 60_000, payableMinor: 0, kind: "RECOUPMENT", metadata: { recoupmentAppliedMinor: 60_000 } },
    { key: "producer:PAYABLE", beneficiaryKey: "producer", beneficiaryName: "Producer", amountMinor: 141_000, payableMinor: 141_000, kind: "PAYABLE" },
    { key: "manager:PAYABLE", beneficiaryKey: "manager", beneficiaryName: "Manager", amountMinor: 94_000, payableMinor: 94_000, kind: "PAYABLE" },
    { key: "featured:PAYABLE", beneficiaryKey: "featured_creator", beneficiaryName: "Featured Creator", amountMinor: 47_000, payableMinor: 47_000, kind: "PAYABLE" },
    { key: "reserve:RESERVE", beneficiaryKey: "reserve", beneficiaryName: "Reserve", amountMinor: 94_000, payableMinor: 0, kind: "RESERVE" },
  ];
}

export async function commitSettlement(
  fixture: Fixture,
  args: { revenueEventId: string; rulesetId: string; rulesetHash: string; lines: SettlementLineInput[]; seed?: string },
): Promise<string> {
  const settlementHash = hash64(args.seed ?? `${args.revenueEventId}-settlement`);
  const row = await one<{ id: string }>(
    `select royaltyos_commit_settlement($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::jsonb,$9::uuid) as id`,
    [
      fixture.workspaceId,
      fixture.projectId,
      args.revenueEventId,
      args.rulesetId,
      args.rulesetHash,
      "royalty-engine-v1",
      settlementHash,
      JSON.stringify(args.lines),
      fixture.userId,
    ],
  );
  return row!.id;
}

/** Builds the full happy path: workspace → beneficiaries → ruleset → revenue → settlement. */
export async function preparedSettlement(options?: { amountMinor?: number }): Promise<{
  fixture: Fixture;
  settlementId: string;
  rulesetId: string;
  rulesetHash: string;
  revenueEventId: string;
}> {
  const fixture = await createWorkspace();
  await createBeneficiaries(fixture);
  const { contractVersionId } = await createContract(fixture);
  const ruleset = await activateRuleset(fixture, contractVersionId);
  const revenueEventId = await createRevenueEvent(fixture, { amountMinor: options?.amountMinor ?? 1_000_000 });
  const settlementId = await commitSettlement(fixture, {
    revenueEventId,
    rulesetId: ruleset.rulesetId,
    rulesetHash: ruleset.rulesetHash,
    lines: canonicalLines(),
  });
  return { fixture, settlementId, rulesetId: ruleset.rulesetId, rulesetHash: ruleset.rulesetHash, revenueEventId };
}
