import test from "node:test";
import assert from "node:assert/strict";
import { expectError, one, q } from "./_client.ts";
import { activateRuleset, createContract, createWorkspace, preparedSettlement } from "./_fixtures.ts";

test("contract versions and documents cannot be rewritten", async () => {
  const fixture = await createWorkspace("immutable-contract");
  const { contractVersionId } = await createContract(fixture);

  const versionUpdate = await expectError(`update contract_versions set title='rewritten' where id=$1`, [
    contractVersionId,
  ]);
  assert.match(versionUpdate, /immutable/);
  const versionDelete = await expectError(`delete from contract_versions where id=$1`, [contractVersionId]);
  assert.match(versionDelete, /immutable/);

  await q(
    `insert into contract_documents(workspace_id, contract_version_id, bucket, object_path, original_filename, mime_type, file_size_bytes, page_count, sha256, malware_scan_status)
     values ($1,$2,'royaltyos-contracts','contracts/x.pdf','agreement.pdf','application/pdf',10,1,repeat('a',64),'CLEAN')`,
    [fixture.workspaceId, contractVersionId],
  );
  const documentUpdate = await expectError(`update contract_documents set sha256=repeat('b',64) where contract_version_id=$1`, [
    contractVersionId,
  ]);
  assert.match(documentUpdate, /immutable/);
  const documentDelete = await expectError(`delete from contract_documents where contract_version_id=$1`, [
    contractVersionId,
  ]);
  assert.match(documentDelete, /immutable/);
});

test("activated rulesets, rules and rule evidence cannot be rewritten", async () => {
  const fixture = await createWorkspace("immutable-rules");
  const { contractVersionId } = await createContract(fixture);
  const { rulesetId, rulesetHash } = await activateRuleset(fixture, contractVersionId);

  const hashChange = await expectError(`update rulesets set ruleset_hash=$1 where id=$2`, [
    "f".repeat(64),
    rulesetId,
  ]);
  assert.match(hashChange, /immutable|RuleSet/);
  const rulesetDelete = await expectError(`delete from rulesets where id=$1`, [rulesetId]);
  assert.match(rulesetDelete, /cannot be deleted/);

  const rule = await one<{ id: string }>(`select id from rules where ruleset_id=$1 limit 1`, [rulesetId]);
  const ruleChange = await expectError(`update rules set rate_basis_points=1 where id=$1`, [rule!.id]);
  assert.match(ruleChange, /immutable/);
  const ruleDelete = await expectError(`delete from rules where id=$1`, [rule!.id]);
  assert.match(ruleDelete, /immutable/);

  const evidence = await one<{ id: string }>(`select id from rule_evidence where rule_id=$1 limit 1`, [rule!.id]);
  if (evidence) {
    const evidenceChange = await expectError(`update rule_evidence set source_text='changed' where id=$1`, [evidence.id]);
    assert.match(evidenceChange, /immutable/);
  }
  assert.ok(rulesetHash.length === 64);
});

test("ledger history is append-only", async () => {
  const prepared = await preparedSettlement();
  const tx = await one<{ id: string }>(
    `select id from ledger_transactions where workspace_id=$1 order by created_at limit 1`,
    [prepared.fixture.workspaceId],
  );
  const txUpdate = await expectError(`update ledger_transactions set event_hash=repeat('c',64) where id=$1`, [tx!.id]);
  assert.match(txUpdate, /immutable/);
  const txDelete = await expectError(`delete from ledger_transactions where id=$1`, [tx!.id]);
  assert.match(txDelete, /immutable/);

  const entry = await one<{ id: string }>(`select id from ledger_entries where transaction_id=$1 limit 1`, [tx!.id]);
  const entryUpdate = await expectError(`update ledger_entries set debit_minor=1 where id=$1`, [entry!.id]);
  assert.match(entryUpdate, /immutable/);
  const entryDelete = await expectError(`delete from ledger_entries where id=$1`, [entry!.id]);
  assert.match(entryDelete, /immutable/);
});

test("reviewed candidate rules become immutable", async () => {
  const fixture = await createWorkspace("immutable-candidates");
  const { contractVersionId } = await createContract(fixture);
  await q(
    `insert into contract_analyses(workspace_id, contract_version_id, provider, model, provider_response_id, status, extraction, warnings, conflicts)
     values ($1,$2,'openai','test-model','resp-1','REVIEW_REQUIRED','{}'::jsonb,'[]'::jsonb,'[]'::jsonb)`,
    [fixture.workspaceId, contractVersionId],
  );
  const analysis = await one<{ id: string }>(
    `select id from contract_analyses where contract_version_id=$1 limit 1`,
    [contractVersionId],
  );
  await q(
    `insert into candidate_rules(id, workspace_id, analysis_id, contract_version_id, rule_type, beneficiary_key, base, rate_basis_points, priority, status, confidence, evidence)
     values (gen_random_uuid(),$1,$2,$3,'PERCENTAGE','artist','NET_REVENUE',6000,10,'APPROVED',0.9,'{}'::jsonb)`,
    [fixture.workspaceId, analysis!.id, contractVersionId],
  );
  const candidate = await one<{ id: string }>(`select id from candidate_rules where analysis_id=$1 limit 1`, [
    analysis!.id,
  ]);

  const change = await expectError(`update candidate_rules set rate_basis_points=1 where id=$1`, [candidate!.id]);
  assert.match(change, /immutable/);
  const remove = await expectError(`delete from candidate_rules where id=$1`, [candidate!.id]);
  assert.match(remove, /immutable/);
});
