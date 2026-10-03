import test from "node:test";
import assert from "node:assert/strict";
import { expectError, one, q } from "./_client.ts";
import { createWorkspace } from "./_fixtures.ts";

interface ChainResult {
  valid: boolean;
  verifiedEvents: number;
  legacyEvents: number;
  checked: number;
  chainGenesisEventId: string | null;
  brokenAt: string | null;
  reason: string | null;
}

async function verify(workspaceId: string): Promise<ChainResult> {
  const row = await one<{ royaltyos_verify_audit_chain: ChainResult }>(
    `select royaltyos_verify_audit_chain($1::uuid) as royaltyos_verify_audit_chain`,
    [workspaceId],
  );
  return row!.royaltyos_verify_audit_chain;
}

async function append(workspaceId: string, actorId: string, detail: string): Promise<{ id: string; event_hash: string }> {
  const row = await one<{ id: string; event_hash: string }>(
    `select audit_row.id, audit_row.event_hash
     from royaltyos_append_audit($1::uuid,$2::uuid,'TEST.ACTION','TEST','resource',$3,'corr') as audit_row`,
    [workspaceId, actorId, detail],
  );
  return row!;
}

test("audit chain verifies, is append-only, and detects tampering at the exact event", async () => {
  const fixture = await createWorkspace("audit");
  await append(fixture.workspaceId, fixture.userId, "second event");
  await append(fixture.workspaceId, fixture.userId, "third event");

  const before = await verify(fixture.workspaceId);
  assert.equal(before.valid, true);
  assert.equal(before.brokenAt, null);
  assert.equal(before.legacyEvents, 0);
  assert.ok(before.verifiedEvents >= 3, "bootstrap event plus appended events are verified");
  assert.ok(before.chainGenesisEventId, "a genesis event is reported");

  const updateError = await expectError(`update audit_events set detail='tampered' where workspace_id=$1`, [
    fixture.workspaceId,
  ]);
  assert.match(updateError, /immutable/);
  const deleteError = await expectError(`delete from audit_events where workspace_id=$1`, [fixture.workspaceId]);
  assert.match(deleteError, /immutable/);

  // An elevated database user bypasses the trigger; the hash chain must still notice.
  const target = await one<{ id: string }>(
    `select id from audit_events where workspace_id=$1 order by created_at, id limit 1 offset 2`,
    [fixture.workspaceId],
  );
  await q(`alter table audit_events disable trigger trg_immutable_audit_events`);
  try {
    await q(`update audit_events set detail='tampered by elevated user' where id=$1`, [target!.id]);
  } finally {
    await q(`alter table audit_events enable trigger trg_immutable_audit_events`);
  }

  const after = await verify(fixture.workspaceId);
  assert.equal(after.valid, false, "tampering breaks verification");
  assert.equal(after.brokenAt, target!.id, "verification reports the exact broken event");
  assert.equal(after.reason, "event_hash mismatch");
  assert.ok(after.verifiedEvents >= 1, "events before the tampered one stay verified");
});

test("legacy pre-chain events are classified separately and do not invalidate the chain", async () => {
  const fixture = await createWorkspace("legacy");
  // Legacy rows predate the hash chain: no event_hash at all.
  for (const index of [1, 2, 3]) {
    await q(
      `insert into audit_events(workspace_id, actor_id, action, resource_type, resource_id, detail, previous_hash, event_hash, created_at)
       values ($1,$2,'LEGACY.IMPORT','LEGACY',$3,$4,null,null, now() - interval '1 day' + ($3 || ' second')::interval)`,
      [fixture.workspaceId, fixture.userId, String(index), `imported legacy event ${index}`],
    );
  }
  await append(fixture.workspaceId, fixture.userId, "modern event after legacy import");

  const result = await verify(fixture.workspaceId);
  assert.equal(result.valid, true, "legacy events do not invalidate a legitimate chain");
  assert.equal(result.legacyEvents, 3, "legacy events are reported as their own category");
  assert.ok(result.verifiedEvents >= 2, "only hashed events count as cryptographically verified");
  assert.notEqual(result.verifiedEvents, result.legacyEvents + result.verifiedEvents, "counts are distinct fields");
  assert.ok(result.chainGenesisEventId, "the chain genesis boundary is identified");

  // Legacy events are still append-only.
  const deleteError = await expectError(`delete from audit_events where workspace_id=$1 and action='LEGACY.IMPORT'`, [
    fixture.workspaceId,
  ]);
  assert.match(deleteError, /immutable/);
});

test("a hash removed after the genesis boundary is reported as a broken link", async () => {
  const fixture = await createWorkspace("broken-link");
  const second = await append(fixture.workspaceId, fixture.userId, "event that will lose its link");

  await q(`alter table audit_events disable trigger trg_immutable_audit_events`);
  try {
    await q(`update audit_events set event_hash=null where id=$1`, [second.id]);
  } finally {
    await q(`alter table audit_events enable trigger trg_immutable_audit_events`);
  }

  const result = await verify(fixture.workspaceId);
  assert.equal(result.valid, false, "a missing link after genesis fails verification");
  assert.equal(result.brokenAt, second.id);
  assert.equal(result.reason, "missing chain link");
  assert.equal(result.legacyEvents, 0, "a stripped modern event is never counted as legacy");
});

test("an altered previous_hash breaks the chain link check", async () => {
  const fixture = await createWorkspace("prev-hash");
  await append(fixture.workspaceId, fixture.userId, "event A");
  const eventB = await append(fixture.workspaceId, fixture.userId, "event B");

  await q(`alter table audit_events disable trigger trg_immutable_audit_events`);
  try {
    await q(`update audit_events set previous_hash=repeat('0',64) where id=$1`, [eventB.id]);
  } finally {
    await q(`alter table audit_events enable trigger trg_immutable_audit_events`);
  }

  const result = await verify(fixture.workspaceId);
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, eventB.id);
  assert.equal(result.reason, "previous_hash mismatch");
});
