begin;

-- RoyaltyOS v1.0.0 release hardening
-- Reconciliation issue tracking, durable outbox dedupe, and final architecture baseline marker.

insert into app_versions(version, notes)
values ('1.0.0', 'Hackathon-complete modular-monolith release: Supabase storage/auth, OpenAI contract intelligence, deterministic settlement/recoupment/ledger, PayPal invoicing+payouts+verified webhooks, audit, notifications, Insights and Render deployment')
on conflict (version) do nothing;

create table if not exists reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  resource_type text not null,
  resource_id text not null,
  provider text not null default 'PAYPAL',
  issue_type text not null,
  severity text not null check (severity in ('INFO','WARNING','HIGH','CRITICAL')),
  expected jsonb not null default '{}'::jsonb,
  observed jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','ACKNOWLEDGED','RESOLVED')),
  correlation_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(workspace_id, resource_type, resource_id, issue_type, status)
);
alter table reconciliation_issues enable row level security;
create index if not exists idx_reconciliation_workspace_status on reconciliation_issues(workspace_id,status,created_at desc);

alter table outbox_events add column if not exists dedupe_key text;
create unique index if not exists uniq_outbox_dedupe on outbox_events(dedupe_key) where dedupe_key is not null;

alter table invoices add column if not exists last_reconciled_at timestamptz;
alter table invoices add column if not exists reconciliation_status text not null default 'PENDING'
  check (reconciliation_status in ('PENDING','MATCHED','MISMATCH','REQUIRES_REVIEW'));

-- Keep the service-role-only model explicit for the v1.0 table too. Supabase
-- PostgreSQL always has these roles; guard the reference so the migration also
-- applies to a bare PostgreSQL used for behavioral testing.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on reconciliation_issues from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on reconciliation_issues from authenticated';
  end if;
end $$;

-- Financial observability helper used by Insights/operations.
create or replace function royaltyos_financial_integrity(p_workspace_id uuid)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_bad_settlements integer;
  v_bad_ledgers integer;
  v_open_issues integer;
begin
  select count(*) into v_bad_settlements
  from settlements s
  where s.workspace_id=p_workspace_id
    and (select coalesce(sum(sl.amount_minor),0) from settlement_lines sl where sl.settlement_id=s.id) <> s.distributable_minor;

  select count(*) into v_bad_ledgers
  from (
    select lt.id,
      coalesce(sum(le.debit_minor),0) debits,
      coalesce(sum(le.credit_minor),0) credits
    from ledger_transactions lt
    join ledger_entries le on le.transaction_id=lt.id
    where lt.workspace_id=p_workspace_id
    group by lt.id
    having coalesce(sum(le.debit_minor),0) <> coalesce(sum(le.credit_minor),0)
  ) bad;

  select count(*) into v_open_issues from reconciliation_issues where workspace_id=p_workspace_id and status='OPEN';

  return jsonb_build_object(
    'valid', v_bad_settlements=0 and v_bad_ledgers=0,
    'settlementMismatchCount',v_bad_settlements,
    'ledgerMismatchCount',v_bad_ledgers,
    'openReconciliationIssues',v_open_issues
  );
end $$;
commit;
