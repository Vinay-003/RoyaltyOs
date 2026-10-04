-- RoyaltyOS void-and-recalculate (no version bump: pure workflow fix).
--
-- A settlement is a frozen proposal computed against the advance balance at
-- calculation time, but the advance only moves at approval time. Two
-- settlements calculated against the same balance can therefore promise the
-- same recoupment dollars twice (e.g. two $100 settlements plus one $10,000
-- settlement against a $2,000 advance promise $2,200). Approval already
-- refuses the overrun ('recoupment amount exceeds remaining balance'), which
-- is correct but used to strand the settlement with no recourse.
--
-- This migration adds the recourse:
--   1. settlements.status gains VOIDED (approval never touches voided rows);
--   2. royaltyos_void_settlement moves APPROVAL_REQUIRED to VOIDED with an
--      audit row and parks the dangling approval request as REJECTED;
--   3. royaltyos_commit_settlement ignores VOIDED rows when de-duplicating,
--      so the same revenue event can be recalculated fresh after a void.
-- Settlements are still immutable otherwise: voiding is a terminal state
-- change on an unapproved proposal, never an edit.
--
-- This file is wrapped in a transaction so a failure never leaves a half-applied release.

begin;

-- ---------------------------------------------------------------------------
-- 1. VOIDED status (idempotent re-runs converge: drop-then-add)
-- ---------------------------------------------------------------------------
do $$
declare
  cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'settlements'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%APPROVAL_REQUIRED%'
  limit 1;
  if cname is not null then
    execute format('alter table settlements drop constraint %I', cname);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'settlements_status_check' and conrelid = 'settlements'::regclass
  ) then
    alter table settlements add constraint settlements_status_check check (
      status in ('APPROVAL_REQUIRED','APPROVED','PAYOUT_SUBMITTED','PROCESSING','SUCCESS','PARTIAL_FAILURE','RECONCILIATION_REQUIRED','VOIDED')
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1b. Settlement state machine learns the VOIDED transition
-- ---------------------------------------------------------------------------
create or replace function royaltyos_guard_settlement_update() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then
    raise exception 'settlements cannot be deleted';
  end if;

  if new.workspace_id is distinct from old.workspace_id
     or new.project_id is distinct from old.project_id
     or new.revenue_event_id is distinct from old.revenue_event_id
     or new.ruleset_id is distinct from old.ruleset_id
     or new.ruleset_hash is distinct from old.ruleset_hash
     or new.algorithm_version is distinct from old.algorithm_version
     or new.settlement_hash is distinct from old.settlement_hash
     or new.distributable_minor is distinct from old.distributable_minor
     or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at then
    raise exception 'settlement financial snapshot fields are immutable';
  end if;

  if old.status = new.status then return new; end if;
  if old.status='APPROVAL_REQUIRED' and new.status in ('APPROVED','VOIDED') then return new; end if;
  if old.status='APPROVED' and new.status='PAYOUT_SUBMITTED' then return new; end if;
  if old.status='PAYOUT_SUBMITTED' and new.status in ('PROCESSING','SUCCESS','PARTIAL_FAILURE','RECONCILIATION_REQUIRED') then return new; end if;
  if old.status='PROCESSING' and new.status in ('SUCCESS','PARTIAL_FAILURE','RECONCILIATION_REQUIRED') then return new; end if;
  if old.status in ('PARTIAL_FAILURE','RECONCILIATION_REQUIRED') and new.status in ('PAYOUT_SUBMITTED','PROCESSING','SUCCESS','PARTIAL_FAILURE','RECONCILIATION_REQUIRED') then return new; end if;
  raise exception 'invalid settlement state transition % -> %', old.status, new.status;
end $$;

-- ---------------------------------------------------------------------------
-- 1c. One live settlement per revenue event (voided proposals do not count)
-- ---------------------------------------------------------------------------
alter table settlements drop constraint if exists settlements_revenue_event_id_key;
create unique index if not exists uniq_settlement_per_revenue
  on settlements(revenue_event_id) where status <> 'VOIDED';
alter table settlements drop constraint if exists settlements_settlement_hash_key;
create unique index if not exists uniq_settlement_hash_live
  on settlements(settlement_hash) where status <> 'VOIDED';

-- ---------------------------------------------------------------------------
-- 2. Void an unapproved settlement
-- ---------------------------------------------------------------------------
create or replace function royaltyos_void_settlement(
  p_settlement_id uuid,
  p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path=public, extensions as $$
declare
  v_settlement settlements;
begin
  select * into v_settlement from settlements where id=p_settlement_id for update;
  if not found then raise exception 'settlement not found'; end if;
  if v_settlement.status<>'APPROVAL_REQUIRED' then raise exception 'only settlements awaiting approval can be voided'; end if;
  if not exists(select 1 from workspace_memberships where workspace_id=v_settlement.workspace_id and user_id=p_actor_id and role in ('OWNER','FINANCE_APPROVER')) then raise exception 'not authorized to void settlement'; end if;
  update settlements set status='VOIDED' where id=p_settlement_id;
  update approval_requests set status='REJECTED',approved_by=p_actor_id,decided_at=now()
  where resource_type='SETTLEMENT' and resource_id=p_settlement_id and status='PENDING';
  perform royaltyos_append_audit(v_settlement.workspace_id,p_actor_id,'SETTLEMENT_VOIDED','SETTLEMENT',p_settlement_id::text,'Stale settlement voided before approval; revenue may be recalculated',null);
  return p_settlement_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Commit ignores voided rows when de-duplicating per revenue event
-- ---------------------------------------------------------------------------
create or replace function royaltyos_commit_settlement(
  p_workspace_id uuid,
  p_project_id uuid,
  p_revenue_event_id uuid,
  p_ruleset_id uuid,
  p_ruleset_hash text,
  p_algorithm_version text,
  p_settlement_hash text,
  p_lines jsonb,
  p_actor_id uuid default null
) returns uuid
language plpgsql security definer set search_path=public, extensions as $$
declare
  v_revenue revenue_events;
  v_existing uuid;
  v_settlement uuid;
  v_line jsonb;
  v_line_id uuid;
  v_sum bigint := 0;
  v_tx uuid;
  v_beneficiary beneficiaries;
  v_payable bigint;
  v_amount bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_revenue_event_id::text,0));
  select id into v_existing from settlements where revenue_event_id=p_revenue_event_id and status<>'VOIDED';
  if v_existing is not null then return v_existing; end if;
  select * into v_revenue from revenue_events where id=p_revenue_event_id for update;
  if not found then raise exception 'revenue event not found'; end if;
  if v_revenue.workspace_id<>p_workspace_id or v_revenue.project_id<>p_project_id then raise exception 'revenue tenant mismatch'; end if;
  if not exists(select 1 from rulesets where id=p_ruleset_id and project_id=p_project_id and ruleset_hash=p_ruleset_hash and status='ACTIVE') then raise exception 'active ruleset mismatch'; end if;
  select coalesce(sum((x->>'amountMinor')::bigint),0) into v_sum from jsonb_array_elements(p_lines) x;
  if v_sum <> v_revenue.distributable_minor then raise exception 'settlement lines do not reconcile'; end if;
  insert into settlements(workspace_id,project_id,revenue_event_id,ruleset_id,ruleset_hash,algorithm_version,settlement_hash,status,distributable_minor,currency)
  values(p_workspace_id,p_project_id,p_revenue_event_id,p_ruleset_id,p_ruleset_hash,p_algorithm_version,p_settlement_hash,'APPROVAL_REQUIRED',v_revenue.distributable_minor,v_revenue.currency)
  returning id into v_settlement;
  -- The ledger event hash binds the settlement id (not just its content hash)
  -- so a voided computation and its recalculation post distinct transactions
  -- instead of colliding on the unique event hash.
  insert into ledger_transactions(workspace_id,project_id,event_type,settlement_id,revenue_event_id,event_hash)
  values(p_workspace_id,p_project_id,'SETTLEMENT_ALLOCATION',v_settlement,p_revenue_event_id,encode(digest('settlement|'||v_settlement::text||'|'||p_settlement_hash,'sha256'),'hex')) returning id into v_tx;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_beneficiary from beneficiaries where project_id=p_project_id and beneficiary_key=v_line->>'beneficiaryKey' limit 1;
    v_payable := (v_line->>'payableMinor')::bigint;
    v_amount := (v_line->>'amountMinor')::bigint;
    insert into settlement_lines(workspace_id,settlement_id,line_key,beneficiary_key,beneficiary_name,payout_email,rule_id,amount_minor,payable_minor,line_kind,metadata)
    values(
      p_workspace_id,v_settlement,v_line->>'key',v_line->>'beneficiaryKey',coalesce(v_beneficiary.display_name,replace(v_line->>'beneficiaryKey','_',' ')),
      v_beneficiary.payout_email,nullif(v_line->>'ruleId','')::uuid,v_amount,v_payable,v_line->>'kind',coalesce(v_line->'metadata','{}'::jsonb)
    ) returning id into v_line_id;
    -- Zero-amount lines are stored above but post nothing: a 0/0 ledger
    -- entry violates the strictly one-sided ledger check constraint.
    if v_amount > 0 then
      insert into ledger_entries(transaction_id,account_code,debit_minor,credit_minor,currency,beneficiary_key,memo)
      values(v_tx,'REVENUE_AVAILABLE',v_amount,0,v_revenue.currency,v_line->>'beneficiaryKey','Settlement allocation debit');
      insert into ledger_entries(transaction_id,account_code,debit_minor,credit_minor,currency,beneficiary_key,memo)
      values(v_tx,case when v_line->>'kind'='RECOUPMENT' then 'RECOUPMENT_RECOVERY' when v_line->>'kind' in ('RESERVE','EXCLUSION') then 'RESERVE' else 'ROYALTY_PAYABLE' end,0,v_amount,v_revenue.currency,v_line->>'beneficiaryKey','Settlement allocation credit');
    end if;
  end loop;
  if exists(
    select 1 from ledger_transactions lt join ledger_entries le on le.transaction_id=lt.id
    where lt.id=v_tx group by lt.id having sum(le.debit_minor)<>sum(le.credit_minor)
  ) then raise exception 'ledger transaction does not balance'; end if;
  insert into approval_requests(workspace_id,resource_type,resource_id,requested_by,status,snapshot_hash)
  values(p_workspace_id,'SETTLEMENT',v_settlement,p_actor_id,'PENDING',p_settlement_hash);
  insert into outbox_events(workspace_id,topic,aggregate_type,aggregate_id,payload)
  values(p_workspace_id,'settlement.calculated','SETTLEMENT',v_settlement::text,jsonb_build_object('settlementId',v_settlement));
  perform royaltyos_append_audit(p_workspace_id,p_actor_id,'SETTLEMENT_CALCULATED','SETTLEMENT',v_settlement::text,'Deterministic settlement committed with hash '||left(p_settlement_hash,16),null);
  return v_settlement;
end $$;

commit;
