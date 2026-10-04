-- RoyaltyOS zero-amount settlement lines fix (no version bump: pure bug fix).
--
-- A settlement that is entirely non-cash (e.g. a small first invoice fully
-- absorbed by advance recoupment: RECOUPMENT $X plus PAYABLE/RESERVE lines of
-- $0) failed to commit with
--   new row for relation "ledger_entries" violates check constraint "ledger_entries_check"
-- because royaltyos_commit_settlement posted a debit/credit ledger pair for
-- EVERY line, and zero-amount lines produce 0/0 entries, which the ledger
-- check constraint (strictly one-sided positive amounts) rejects. The whole
-- commit rolled back, so Calculate failed and the silent auto-settle catch hid
-- it entirely.
--
-- This redefinition skips ledger postings for zero-amount lines. Settlement
-- lines themselves are still stored in full (the calculation audit trail is
-- complete); only the double-entry postings skip amounts that cannot be
-- posted. The balance check afterwards is unaffected (skipped lines add zero
-- to both sides).
--
-- This file is wrapped in a transaction so a failure never leaves a half-applied release.

begin;

-- Drops the stillborn 8-arg overload if a pre-release draft of this fix was
-- ever applied (it never matched any caller). Harmless no-op otherwise.
drop function if exists royaltyos_commit_settlement(uuid,uuid,uuid,uuid,text,text,jsonb,uuid);

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
  select id into v_existing from settlements where revenue_event_id=p_revenue_event_id;
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
  insert into ledger_transactions(workspace_id,project_id,event_type,settlement_id,revenue_event_id,event_hash)
  values(p_workspace_id,p_project_id,'SETTLEMENT_ALLOCATION',v_settlement,p_revenue_event_id,encode(digest('settlement|'||p_settlement_hash,'sha256'),'hex')) returning id into v_tx;
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
