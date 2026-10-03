begin;

-- RoyaltyOS v0.3.0 hardening migration
-- Adds database-enforced immutability/state-transition constraints to the v0.2.0 schema.

insert into app_versions(version, notes)
values ('0.3.0', 'Financial immutability, settlement state guards, append-only ledger/audit, terminal rule review guards')
on conflict (version) do nothing;

alter table settlement_lines
  drop constraint if exists settlement_lines_payable_lte_amount;
alter table settlement_lines
  add constraint settlement_lines_payable_lte_amount check (payable_minor <= amount_minor);

create or replace function royaltyos_guard_ruleset_update() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then
    raise exception 'activated RuleSet records cannot be deleted';
  end if;

  if new.workspace_id is distinct from old.workspace_id
     or new.project_id is distinct from old.project_id
     or new.contract_version_id is distinct from old.contract_version_id
     or new.version is distinct from old.version
     or new.ruleset_hash is distinct from old.ruleset_hash
     or new.algorithm_compatibility is distinct from old.algorithm_compatibility
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'activated RuleSet financial/version fields are immutable';
  end if;

  if old.status='ACTIVE' and new.status='SUPERSEDED' then
    return new;
  end if;
  if old.status=new.status then
    return new;
  end if;
  raise exception 'invalid RuleSet state transition % -> %', old.status, new.status;
end $$;

drop trigger if exists trg_guard_rulesets on rulesets;
create trigger trg_guard_rulesets
before update or delete on rulesets
for each row execute function royaltyos_guard_ruleset_update();

create or replace function royaltyos_guard_candidate_rule_update() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' and old.status in ('APPROVED','REJECTED') then
    raise exception 'reviewed candidate rules are immutable';
  end if;
  if tg_op='UPDATE' and old.status in ('APPROVED','REJECTED') then
    if new is distinct from old then
      raise exception 'reviewed candidate rules are immutable';
    end if;
  end if;
  return coalesce(new,old);
end $$;

drop trigger if exists trg_guard_candidate_rules on candidate_rules;
create trigger trg_guard_candidate_rules
before update or delete on candidate_rules
for each row execute function royaltyos_guard_candidate_rule_update();

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
  if old.status='APPROVAL_REQUIRED' and new.status='APPROVED' then return new; end if;
  if old.status='APPROVED' and new.status='PAYOUT_SUBMITTED' then return new; end if;
  if old.status='PAYOUT_SUBMITTED' and new.status in ('PROCESSING','SUCCESS','PARTIAL_FAILURE','RECONCILIATION_REQUIRED') then return new; end if;
  if old.status='PROCESSING' and new.status in ('SUCCESS','PARTIAL_FAILURE','RECONCILIATION_REQUIRED') then return new; end if;
  if old.status in ('PARTIAL_FAILURE','RECONCILIATION_REQUIRED') and new.status in ('PAYOUT_SUBMITTED','PROCESSING','SUCCESS','PARTIAL_FAILURE','RECONCILIATION_REQUIRED') then return new; end if;
  raise exception 'invalid settlement state transition % -> %', old.status, new.status;
end $$;

drop trigger if exists trg_guard_settlements on settlements;
create trigger trg_guard_settlements
before update or delete on settlements
for each row execute function royaltyos_guard_settlement_update();

drop trigger if exists trg_immutable_settlement_lines on settlement_lines;
create trigger trg_immutable_settlement_lines
before update or delete on settlement_lines
for each row execute function royaltyos_block_immutable_mutation();

drop trigger if exists trg_immutable_revenue_events on revenue_events;
create trigger trg_immutable_revenue_events
before update or delete on revenue_events
for each row execute function royaltyos_block_immutable_mutation();

drop trigger if exists trg_immutable_ledger_transactions on ledger_transactions;
create trigger trg_immutable_ledger_transactions
before update or delete on ledger_transactions
for each row execute function royaltyos_block_immutable_mutation();

drop trigger if exists trg_immutable_ledger_entries on ledger_entries;
create trigger trg_immutable_ledger_entries
before update or delete on ledger_entries
for each row execute function royaltyos_block_immutable_mutation();

drop trigger if exists trg_immutable_audit_events on audit_events;
create trigger trg_immutable_audit_events
before update or delete on audit_events
for each row execute function royaltyos_block_immutable_mutation();

-- Additional indexes used by webhook reconciliation and reporting.
create index if not exists idx_invoices_project_created on invoices(project_id, created_at desc);
create index if not exists idx_webhook_events_type_received on webhook_events(event_type, received_at desc);
create index if not exists idx_revenue_events_project_received on revenue_events(project_id, received_at desc);
create index if not exists idx_settlements_workspace_created on settlements(workspace_id, created_at desc);
create index if not exists idx_settlement_lines_settlement on settlement_lines(settlement_id);
create index if not exists idx_payout_batches_workspace_created on payout_batches(workspace_id, created_at desc);
create index if not exists idx_candidate_rules_workspace_status on candidate_rules(workspace_id, status);
commit;
