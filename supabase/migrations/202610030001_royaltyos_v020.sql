begin;

-- RoyaltyOS v0.2.0
-- Target: Supabase PostgreSQL
-- Canonical architecture baseline: Project Record v0.1

create extension if not exists pgcrypto;

create table if not exists app_versions (
  version text primary key,
  applied_at timestamptz not null default now(),
  notes text not null
);
insert into app_versions(version, notes)
values ('0.2.0', 'Portable RoyaltyOS implementation aligned to architecture baseline v0.1')
on conflict (version) do nothing;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists workspace_memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER','CONTRACT_MANAGER','FINANCE_APPROVER','CONTRIBUTOR','AUDITOR')),
  beneficiary_key text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists idx_workspace_memberships_user on workspace_memberships(user_id);

create table if not exists user_security_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  step_up_at timestamptz,
  session_revoked_before timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  currency char(3) not null default 'USD',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index if not exists idx_projects_workspace on projects(workspace_id);

create table if not exists beneficiaries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  beneficiary_key text not null,
  display_name text not null,
  payout_email text,
  user_id uuid references auth.users(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','HOLD','ARCHIVED')),
  updated_at timestamptz not null default now(),
  unique(project_id, beneficiary_key)
);

create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  created_by uuid not null references auth.users(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','REVIEW_REQUIRED','ACTIVE','SUPERSEDED','ARCHIVED')),
  created_at timestamptz not null default now()
);

create table if not exists contract_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  version integer not null check (version > 0),
  title text not null,
  effective_at timestamptz,
  supersedes_version_id uuid references contract_versions(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(contract_id, version)
);

create table if not exists contract_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contract_version_id uuid not null unique references contract_versions(id) on delete cascade,
  bucket text not null,
  object_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  page_count integer not null check (page_count > 0),
  sha256 text not null check (length(sha256) = 64),
  malware_scan_status text not null check (malware_scan_status in ('CLEAN','NOT_CONFIGURED')),
  malware_scan_detail text,
  created_at timestamptz not null default now()
);

create table if not exists contract_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contract_version_id uuid not null references contract_versions(id) on delete cascade,
  provider text not null,
  model text not null,
  provider_response_id text,
  status text not null default 'REVIEW_REQUIRED' check (status in ('PROCESSING','REVIEW_REQUIRED','APPROVED','FAILED')),
  extraction jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists candidate_rules (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  analysis_id uuid not null references contract_analyses(id) on delete cascade,
  contract_version_id uuid not null references contract_versions(id) on delete cascade,
  rule_type text not null,
  beneficiary_key text,
  base text not null,
  rate_basis_points integer check (rate_basis_points between 0 and 10000),
  fixed_minor bigint check (fixed_minor is null or fixed_minor >= 0),
  priority integer not null default 100,
  conditions jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  evidence jsonb not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  status text not null check (status in ('PENDING','APPROVED','REJECTED','REVIEW_REQUIRED')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_candidate_rules_analysis on candidate_rules(analysis_id, status);

create table if not exists rulesets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  contract_version_id uuid not null references contract_versions(id),
  version integer not null check (version > 0),
  status text not null check (status in ('ACTIVE','SUPERSEDED')),
  ruleset_hash text not null check (length(ruleset_hash) = 64),
  algorithm_compatibility text not null default 'royalty-engine-v1',
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  unique(project_id, version),
  unique(project_id, ruleset_hash)
);
create unique index if not exists uniq_active_ruleset_per_project on rulesets(project_id) where status='ACTIVE';

create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ruleset_id uuid not null references rulesets(id) on delete cascade,
  source_candidate_rule_id uuid references candidate_rules(id),
  rule_type text not null check (rule_type in ('PERCENTAGE','FIXED_AMOUNT','RECOUPMENT','CAP','FLOOR','EXCLUSION','RESERVE','PRIORITY','THRESHOLD','DATE_RANGE','REVENUE_CATEGORY')),
  beneficiary_key text,
  base text not null check (base in ('GROSS_REVENUE','NET_REVENUE','REMAINDER')),
  rate_basis_points integer check (rate_basis_points between 0 and 10000),
  fixed_minor bigint check (fixed_minor is null or fixed_minor >= 0),
  priority integer not null,
  conditions jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_rules_ruleset_priority on rules(ruleset_id, priority);

create table if not exists rule_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  rule_id uuid not null unique references rules(id) on delete cascade,
  source_document text not null,
  source_version integer not null,
  page integer,
  clause text,
  source_text text not null,
  extraction_model text not null,
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  paypal_invoice_id text not null unique,
  recipient_email text not null,
  item_name text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null,
  recipient_view_url text,
  request_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists webhook_events (
  paypal_event_id text primary key,
  event_type text not null,
  resource_id text,
  transmission_id text,
  verification_status text not null,
  processing_status text not null default 'STORED',
  raw_payload jsonb not null,
  raw_payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists revenue_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  source text not null,
  external_id text,
  gross_minor bigint not null check (gross_minor >= 0),
  distributable_minor bigint not null check (distributable_minor >= 0),
  currency char(3) not null,
  revenue_category text,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(workspace_id, source, external_id)
);

create table if not exists recoupment_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  rule_id uuid not null unique references rules(id),
  beneficiary_key text not null,
  original_minor bigint not null check (original_minor >= 0),
  recouped_minor bigint not null default 0 check (recouped_minor >= 0),
  remaining_minor bigint not null check (remaining_minor >= 0),
  currency char(3) not null,
  updated_at timestamptz not null default now(),
  check (recouped_minor + remaining_minor = original_minor)
);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  revenue_event_id uuid not null unique references revenue_events(id),
  ruleset_id uuid not null references rulesets(id),
  ruleset_hash text not null,
  algorithm_version text not null,
  settlement_hash text not null unique,
  status text not null check (status in ('APPROVAL_REQUIRED','APPROVED','PAYOUT_SUBMITTED','PROCESSING','SUCCESS','PARTIAL_FAILURE','RECONCILIATION_REQUIRED')),
  distributable_minor bigint not null check (distributable_minor >= 0),
  currency char(3) not null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists settlement_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  settlement_id uuid not null references settlements(id) on delete cascade,
  line_key text not null,
  beneficiary_key text not null,
  beneficiary_name text not null,
  payout_email text,
  rule_id uuid references rules(id),
  amount_minor bigint not null check (amount_minor >= 0),
  payable_minor bigint not null check (payable_minor >= 0),
  line_kind text not null check (line_kind in ('PAYABLE','RECOUPMENT','RESERVE','EXCLUSION','FIXED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(settlement_id, line_key)
);

create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  status text not null check (status in ('PENDING','APPROVED','REJECTED')),
  snapshot_hash text not null,
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists payout_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  settlement_id uuid not null references settlements(id),
  payout_version integer not null check (payout_version > 0),
  status text not null check (status in ('READY','SUBMITTED','PENDING','SUCCESS','FAILED','PARTIAL_FAILURE','RECONCILIATION_REQUIRED')),
  idempotency_key text not null unique,
  paypal_batch_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(settlement_id, payout_version)
);

create table if not exists payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_batch_id uuid not null references payout_batches(id) on delete cascade,
  settlement_line_id uuid not null references settlement_lines(id),
  sender_item_id text not null unique,
  recipient_email text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null check (status in ('READY','SUBMITTED','PENDING','SUCCESS','FAILED','UNCLAIMED','RETURNED','REFUNDED','BLOCKED','ONHOLD')),
  paypal_item_id text unique,
  transaction_id text,
  last_event_type text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_payout_items_batch on payout_items(payout_batch_id);

create table if not exists ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','MEMO')),
  created_at timestamptz not null default now(),
  unique(project_id, code)
);

create table if not exists ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  event_type text not null,
  external_ref text,
  settlement_id uuid references settlements(id),
  revenue_event_id uuid references revenue_events(id),
  payout_batch_id uuid references payout_batches(id),
  event_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references ledger_transactions(id) on delete cascade,
  account_code text not null,
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  currency char(3) not null,
  beneficiary_key text,
  memo text not null,
  created_at timestamptz not null default now(),
  check ((debit_minor = 0 and credit_minor > 0) or (credit_minor = 0 and debit_minor > 0))
);
create index if not exists idx_ledger_entries_transaction on ledger_entries(transaction_id);

create table if not exists simulations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  ruleset_id uuid not null references rulesets(id),
  created_by uuid not null references auth.users(id),
  input jsonb not null,
  output jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  resource_type text not null,
  resource_id text not null,
  detail text not null,
  correlation_id text,
  previous_hash text,
  event_hash text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_workspace_created on audit_events(workspace_id, created_at);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id),
  channel text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED','SKIPPED')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','DONE','FAILED')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists idx_outbox_ready on outbox_events(status, available_at, created_at);

-- RLS: browser keys have no direct table access. The API uses the service-role key after server-side authorization.
do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','workspace_memberships','user_security_state','projects','beneficiaries','contracts','contract_versions','contract_documents',
    'contract_analyses','candidate_rules','rulesets','rules','rule_evidence','invoices','webhook_events','revenue_events','recoupment_accounts',
    'settlements','settlement_lines','approval_requests','payout_batches','payout_items','ledger_accounts','ledger_transactions','ledger_entries',
    'simulations','audit_events','notifications','outbox_events','app_versions'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Immutable data guards.
create or replace function royaltyos_block_immutable_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'immutable RoyaltyOS record cannot be updated or deleted';
end $$;

create or replace function royaltyos_block_rule_mutation() returns trigger language plpgsql as $$
begin
  if exists (select 1 from rulesets rs where rs.id = coalesce(old.ruleset_id, new.ruleset_id) and rs.status in ('ACTIVE','SUPERSEDED')) then
    raise exception 'rules belonging to an activated RuleSet are immutable';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_immutable_contract_versions on contract_versions;
create trigger trg_immutable_contract_versions before update or delete on contract_versions for each row execute function royaltyos_block_immutable_mutation();
drop trigger if exists trg_immutable_contract_documents on contract_documents;
create trigger trg_immutable_contract_documents before update or delete on contract_documents for each row execute function royaltyos_block_immutable_mutation();
drop trigger if exists trg_immutable_rules on rules;
create trigger trg_immutable_rules before update or delete on rules for each row execute function royaltyos_block_rule_mutation();
drop trigger if exists trg_immutable_rule_evidence on rule_evidence;
create trigger trg_immutable_rule_evidence before update or delete on rule_evidence for each row execute function royaltyos_block_immutable_mutation();

-- Audit chain. All application audit inserts should use this function.
create or replace function royaltyos_append_audit(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_detail text,
  p_correlation_id text default null
) returns audit_events
language plpgsql security definer set search_path=public as $$
declare
  v_prev text;
  v_now timestamptz := clock_timestamp();
  v_hash text;
  v_row audit_events;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  select event_hash into v_prev from audit_events where workspace_id=p_workspace_id order by created_at desc, id desc limit 1;
  v_hash := encode(digest(coalesce(v_prev,'GENESIS') || '|' || p_workspace_id::text || '|' || coalesce(p_actor_id::text,'') || '|' || p_action || '|' || p_resource_type || '|' || p_resource_id || '|' || p_detail || '|' || coalesce(p_correlation_id,'') || '|' || v_now::text, 'sha256'),'hex');
  insert into audit_events(workspace_id,actor_id,action,resource_type,resource_id,detail,correlation_id,previous_hash,event_hash,created_at)
  values(p_workspace_id,p_actor_id,p_action,p_resource_type,p_resource_id,p_detail,p_correlation_id,v_prev,v_hash,v_now)
  returning * into v_row;
  return v_row;
end $$;

create or replace function royaltyos_bootstrap_workspace(
  p_user_id uuid,
  p_workspace_name text default 'RoyaltyOS Workspace',
  p_project_name text default 'Northstar Creator Campaign',
  p_currency char(3) default 'USD'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_ws uuid;
  v_project uuid;
begin
  select workspace_id into v_ws from workspace_memberships where user_id=p_user_id order by created_at limit 1;
  if v_ws is null then
    insert into workspaces(name,created_by) values(p_workspace_name,p_user_id) returning id into v_ws;
    insert into workspace_memberships(workspace_id,user_id,role) values(v_ws,p_user_id,'OWNER');
    insert into user_security_state(user_id,step_up_at) values(p_user_id,now()) on conflict(user_id) do update set step_up_at=excluded.step_up_at,updated_at=now();
    perform royaltyos_append_audit(v_ws,p_user_id,'WORKSPACE_CREATED','WORKSPACE',v_ws::text,'Initial workspace created',null);
  end if;
  select id into v_project from projects where workspace_id=v_ws and archived=false order by created_at limit 1;
  if v_project is null then
    insert into projects(workspace_id,name,currency) values(v_ws,p_project_name,p_currency) returning id into v_project;
    insert into ledger_accounts(workspace_id,project_id,code,name,account_type) values
      (v_ws,v_project,'PAYPAL_RECEIVABLE','PayPal Receivable','ASSET'),
      (v_ws,v_project,'REVENUE_AVAILABLE','Revenue Available','ASSET'),
      (v_ws,v_project,'ROYALTY_PAYABLE','Royalty Payable','LIABILITY'),
      (v_ws,v_project,'RECOUPMENT_RECOVERY','Recoupment Recovery','MEMO'),
      (v_ws,v_project,'RESERVE','Reserve','LIABILITY'),
      (v_ws,v_project,'PAYOUT_CLEARING','Payout Clearing','ASSET')
    on conflict(project_id,code) do nothing;
  end if;
  return jsonb_build_object('workspaceId',v_ws,'projectId',v_project);
end $$;

create or replace function royaltyos_activate_ruleset(
  p_workspace_id uuid,
  p_project_id uuid,
  p_contract_version_id uuid,
  p_version integer,
  p_ruleset_hash text,
  p_rules jsonb,
  p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_ruleset uuid;
  v_rule jsonb;
  v_rule_id uuid;
  v_evidence jsonb;
  v_advance bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || ':ruleset',0));
  if not exists(select 1 from workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_id and role in ('OWNER','FINANCE_APPROVER')) then
    raise exception 'not authorized to activate ruleset';
  end if;
  update rulesets set status='SUPERSEDED' where project_id=p_project_id and status='ACTIVE';
  insert into rulesets(workspace_id,project_id,contract_version_id,version,status,ruleset_hash,approved_by)
  values(p_workspace_id,p_project_id,p_contract_version_id,p_version,'ACTIVE',p_ruleset_hash,p_actor_id)
  returning id into v_ruleset;
  for v_rule in select * from jsonb_array_elements(p_rules) loop
    insert into rules(workspace_id,ruleset_id,source_candidate_rule_id,rule_type,beneficiary_key,base,rate_basis_points,fixed_minor,priority,conditions,config,dependencies)
    values(
      p_workspace_id,v_ruleset,nullif(v_rule->>'id','')::uuid,v_rule->>'type',nullif(v_rule->>'beneficiaryKey',''),v_rule->>'base',
      nullif(v_rule->>'rateBasisPoints','')::integer,nullif(v_rule->>'fixedMinor','')::bigint,(v_rule->>'priority')::integer,
      coalesce(v_rule->'conditions','[]'::jsonb),coalesce(v_rule->'config','{}'::jsonb),coalesce(v_rule->'dependencies','[]'::jsonb)
    ) returning id into v_rule_id;
    v_evidence := coalesce(v_rule->'evidence','{}'::jsonb);
    insert into rule_evidence(workspace_id,rule_id,source_document,source_version,page,clause,source_text,extraction_model)
    values(p_workspace_id,v_rule_id,coalesce(v_evidence->>'sourceDocument','Unknown'),coalesce((v_evidence->>'sourceVersion')::integer,1),nullif(v_evidence->>'page','')::integer,nullif(v_evidence->>'clause',''),coalesce(v_evidence->>'sourceText',''),coalesce(v_evidence->>'model','unknown'));
    if v_rule->>'type'='RECOUPMENT' then
      v_advance := nullif(v_rule->'config'->>'advanceMinor','')::bigint;
      if coalesce(v_advance,0) > 0 then
        insert into recoupment_accounts(workspace_id,project_id,rule_id,beneficiary_key,original_minor,recouped_minor,remaining_minor,currency)
        values(p_workspace_id,p_project_id,v_rule_id,coalesce(v_rule->>'beneficiaryKey','unknown'),v_advance,0,v_advance,(select currency from projects where id=p_project_id));
      end if;
    end if;
  end loop;
  update contracts c set status='ACTIVE' from contract_versions cv where cv.id=p_contract_version_id and cv.contract_id=c.id;
  perform royaltyos_append_audit(p_workspace_id,p_actor_id,'RULESET_ACTIVATED','RULESET',v_ruleset::text,'RuleSet v'||p_version||' activated with hash '||left(p_ruleset_hash,16),null);
  return v_ruleset;
end $$;

create or replace function royaltyos_record_invoice_revenue(
  p_invoice_id uuid,
  p_paypal_invoice_id text,
  p_amount_minor bigint,
  p_currency char(3),
  p_received_at timestamptz,
  p_revenue_category text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_invoice invoices;
  v_revenue uuid;
  v_tx uuid;
begin
  select * into v_invoice from invoices where id=p_invoice_id for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_invoice.paypal_invoice_id <> p_paypal_invoice_id or v_invoice.amount_minor <> p_amount_minor or v_invoice.currency <> p_currency then
    raise exception 'invoice reconciliation mismatch';
  end if;
  update invoices set status='PAID',updated_at=now() where id=p_invoice_id;
  insert into revenue_events(workspace_id,project_id,source,external_id,gross_minor,distributable_minor,currency,revenue_category,received_at)
  values(v_invoice.workspace_id,v_invoice.project_id,'PAYPAL_INVOICE',p_paypal_invoice_id,p_amount_minor,p_amount_minor,p_currency,p_revenue_category,p_received_at)
  on conflict(workspace_id,source,external_id) do update set external_id=excluded.external_id
  returning id into v_revenue;
  if not exists(select 1 from ledger_transactions where revenue_event_id=v_revenue and event_type='REVENUE_RECEIVED') then
    insert into ledger_transactions(workspace_id,project_id,event_type,external_ref,revenue_event_id,event_hash)
    values(v_invoice.workspace_id,v_invoice.project_id,'REVENUE_RECEIVED',p_paypal_invoice_id,v_revenue,encode(digest('revenue|'||v_revenue::text||'|'||p_paypal_invoice_id,'sha256'),'hex')) returning id into v_tx;
    insert into ledger_entries(transaction_id,account_code,debit_minor,credit_minor,currency,memo) values
      (v_tx,'PAYPAL_RECEIVABLE',p_amount_minor,0,p_currency,'PayPal invoice payment received'),
      (v_tx,'REVENUE_AVAILABLE',0,p_amount_minor,p_currency,'Revenue recognized for settlement');
  end if;
  insert into outbox_events(workspace_id,topic,aggregate_type,aggregate_id,payload)
  select v_invoice.workspace_id,'revenue.recorded','REVENUE_EVENT',v_revenue::text,jsonb_build_object('revenueEventId',v_revenue)
  where not exists(select 1 from outbox_events where topic='revenue.recorded' and aggregate_id=v_revenue::text);
  perform royaltyos_append_audit(v_invoice.workspace_id,null,'INVOICE_RECONCILED_PAID','INVOICE',p_invoice_id::text,'Authoritative PayPal invoice reconciled as PAID; revenue event created idempotently',null);
  return v_revenue;
end $$;

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
language plpgsql security definer set search_path=public as $$
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
    insert into settlement_lines(workspace_id,settlement_id,line_key,beneficiary_key,beneficiary_name,payout_email,rule_id,amount_minor,payable_minor,line_kind,metadata)
    values(
      p_workspace_id,v_settlement,v_line->>'key',v_line->>'beneficiaryKey',coalesce(v_beneficiary.display_name,replace(v_line->>'beneficiaryKey','_',' ')),
      v_beneficiary.payout_email,nullif(v_line->>'ruleId','')::uuid,(v_line->>'amountMinor')::bigint,v_payable,v_line->>'kind',coalesce(v_line->'metadata','{}'::jsonb)
    ) returning id into v_line_id;
    insert into ledger_entries(transaction_id,account_code,debit_minor,credit_minor,currency,beneficiary_key,memo)
    values(v_tx,'REVENUE_AVAILABLE',(v_line->>'amountMinor')::bigint,0,v_revenue.currency,v_line->>'beneficiaryKey','Settlement allocation debit');
    insert into ledger_entries(transaction_id,account_code,debit_minor,credit_minor,currency,beneficiary_key,memo)
    values(v_tx,case when v_line->>'kind'='RECOUPMENT' then 'RECOUPMENT_RECOVERY' when v_line->>'kind' in ('RESERVE','EXCLUSION') then 'RESERVE' else 'ROYALTY_PAYABLE' end,0,(v_line->>'amountMinor')::bigint,v_revenue.currency,v_line->>'beneficiaryKey','Settlement allocation credit');
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

create or replace function royaltyos_approve_settlement(p_settlement_id uuid,p_actor_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_settlement settlements;
  v_line settlement_lines;
  v_applied bigint;
  v_rec recoupment_accounts;
begin
  select * into v_settlement from settlements where id=p_settlement_id for update;
  if not found then raise exception 'settlement not found'; end if;
  if v_settlement.status<>'APPROVAL_REQUIRED' then raise exception 'settlement is not awaiting approval'; end if;
  if not exists(select 1 from workspace_memberships where workspace_id=v_settlement.workspace_id and user_id=p_actor_id and role in ('OWNER','FINANCE_APPROVER')) then raise exception 'not authorized to approve settlement'; end if;
  if exists(select 1 from settlement_lines where settlement_id=p_settlement_id and payable_minor>0 and payout_email is null) then raise exception 'settlement has payable lines without payout destination'; end if;
  for v_line in select * from settlement_lines where settlement_id=p_settlement_id and line_kind='RECOUPMENT' loop
    v_applied := coalesce((v_line.metadata->>'recoupmentAppliedMinor')::bigint,0);
    if v_line.rule_id is not null and v_applied>0 then
      select * into v_rec from recoupment_accounts where rule_id=v_line.rule_id for update;
      if found then
        if v_applied>v_rec.remaining_minor then raise exception 'recoupment amount exceeds remaining balance'; end if;
        update recoupment_accounts set recouped_minor=recouped_minor+v_applied,remaining_minor=remaining_minor-v_applied,updated_at=now() where id=v_rec.id;
      end if;
    end if;
  end loop;
  update settlements set status='APPROVED',approved_by=p_actor_id,approved_at=now() where id=p_settlement_id;
  update approval_requests set status='APPROVED',approved_by=p_actor_id,decided_at=now() where resource_type='SETTLEMENT' and resource_id=p_settlement_id and status='PENDING';
  insert into outbox_events(workspace_id,topic,aggregate_type,aggregate_id,payload) values(v_settlement.workspace_id,'settlement.approved','SETTLEMENT',p_settlement_id::text,jsonb_build_object('settlementId',p_settlement_id));
  perform royaltyos_append_audit(v_settlement.workspace_id,p_actor_id,'SETTLEMENT_APPROVED','SETTLEMENT',p_settlement_id::text,'Settlement approved; financial snapshot frozen',null);
  return p_settlement_id;
end $$;

create or replace function royaltyos_reserve_payout(
  p_settlement_id uuid,
  p_actor_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_settlement settlements;
  v_batch payout_batches;
  v_version integer;
  v_line settlement_lines;
begin
  select * into v_settlement from settlements where id=p_settlement_id for update;
  if not found then raise exception 'settlement not found'; end if;
  if v_settlement.status not in ('APPROVED','PAYOUT_SUBMITTED','PROCESSING','PARTIAL_FAILURE') then raise exception 'settlement is not eligible for payout'; end if;
  if not exists(select 1 from workspace_memberships where workspace_id=v_settlement.workspace_id and user_id=p_actor_id and role in ('OWNER','FINANCE_APPROVER')) then raise exception 'not authorized to execute payout'; end if;
  select * into v_batch from payout_batches where idempotency_key=p_idempotency_key;
  if found then return to_jsonb(v_batch); end if;
  select coalesce(max(payout_version),0)+1 into v_version from payout_batches where settlement_id=p_settlement_id;
  insert into payout_batches(workspace_id,settlement_id,payout_version,status,idempotency_key)
  values(v_settlement.workspace_id,p_settlement_id,v_version,'READY',p_idempotency_key) returning * into v_batch;
  for v_line in select * from settlement_lines where settlement_id=p_settlement_id and payable_minor>0 and line_kind in ('PAYABLE','FIXED') loop
    if v_line.payout_email is null then raise exception 'payout email missing for %',v_line.beneficiary_name; end if;
    insert into payout_items(payout_batch_id,settlement_line_id,sender_item_id,recipient_email,amount_minor,currency,status)
    values(v_batch.id,v_line.id,v_line.id::text||':v'||v_version,v_line.payout_email,v_line.payable_minor,v_settlement.currency,'READY');
  end loop;
  perform royaltyos_append_audit(v_settlement.workspace_id,p_actor_id,'PAYOUT_RESERVED','PAYOUT_BATCH',v_batch.id::text,'Payout batch reserved with application idempotency key',null);
  return to_jsonb(v_batch);
end $$;

create or replace function royaltyos_mark_payout_submitted(p_batch_id uuid,p_paypal_batch_id text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_settlement uuid;
begin
  update payout_batches set status='SUBMITTED',paypal_batch_id=p_paypal_batch_id,updated_at=now() where id=p_batch_id returning settlement_id into v_settlement;
  update payout_items set status='SUBMITTED',updated_at=now() where payout_batch_id=p_batch_id and status='READY';
  update settlements set status='PAYOUT_SUBMITTED' where id=v_settlement;
  return p_batch_id;
end $$;

create or replace function royaltyos_mark_payout_item(
  p_sender_item_id text,
  p_paypal_item_id text,
  p_transaction_id text,
  p_status text,
  p_event_type text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_item payout_items;
  v_batch payout_batches;
  v_settlement settlements;
  v_line settlement_lines;
  v_tx uuid;
  v_all_success boolean;
  v_any_pending boolean;
begin
  select * into v_item from payout_items where sender_item_id=p_sender_item_id for update;
  if not found and p_paypal_item_id is not null then select * into v_item from payout_items where paypal_item_id=p_paypal_item_id for update; end if;
  if not found then raise exception 'payout item not found'; end if;
  update payout_items set status=p_status,paypal_item_id=coalesce(p_paypal_item_id,paypal_item_id),transaction_id=coalesce(p_transaction_id,transaction_id),last_event_type=p_event_type,updated_at=now() where id=v_item.id returning * into v_item;
  select * into v_batch from payout_batches where id=v_item.payout_batch_id;
  select * into v_settlement from settlements where id=v_batch.settlement_id;
  if p_status='SUCCESS' and not exists(select 1 from ledger_transactions where external_ref=coalesce(p_transaction_id,p_paypal_item_id) and event_type='PAYOUT_SUCCESS') then
    select * into v_line from settlement_lines where id=v_item.settlement_line_id;
    insert into ledger_transactions(workspace_id,project_id,event_type,external_ref,settlement_id,payout_batch_id,event_hash)
    values(v_settlement.workspace_id,v_settlement.project_id,'PAYOUT_SUCCESS',coalesce(p_transaction_id,p_paypal_item_id),v_settlement.id,v_batch.id,encode(digest('payout|'||v_item.id::text||'|'||coalesce(p_transaction_id,p_paypal_item_id,''),'sha256'),'hex')) returning id into v_tx;
    insert into ledger_entries(transaction_id,account_code,debit_minor,credit_minor,currency,beneficiary_key,memo) values
      (v_tx,'ROYALTY_PAYABLE',v_item.amount_minor,0,v_item.currency,v_line.beneficiary_key,'Royalty liability cleared'),
      (v_tx,'PAYOUT_CLEARING',0,v_item.amount_minor,v_item.currency,v_line.beneficiary_key,'PayPal payout observed');
  end if;
  select bool_and(status='SUCCESS'),bool_or(status in ('READY','SUBMITTED','PENDING','ONHOLD')) into v_all_success,v_any_pending from payout_items where payout_batch_id=v_batch.id;
  if v_all_success then
    update payout_batches set status='SUCCESS',updated_at=now() where id=v_batch.id;
    update settlements set status='SUCCESS' where id=v_settlement.id;
  elsif v_any_pending then
    update payout_batches set status='PENDING',updated_at=now() where id=v_batch.id;
    update settlements set status='PROCESSING' where id=v_settlement.id;
  else
    update payout_batches set status='PARTIAL_FAILURE',updated_at=now() where id=v_batch.id;
    update settlements set status='PARTIAL_FAILURE' where id=v_settlement.id;
  end if;
  return v_item.id;
end $$;

create or replace function royaltyos_claim_outbox(p_limit integer default 20) returns setof outbox_events
language plpgsql security definer set search_path=public as $$
begin
  return query
  with picked as (
    select id from outbox_events
    where status='PENDING' and available_at<=now()
    order by created_at
    for update skip locked
    limit greatest(1,least(p_limit,100))
  ), updated as (
    update outbox_events o set status='PROCESSING',attempts=attempts+1,locked_at=now()
    from picked where o.id=picked.id returning o.*
  ) select * from updated;
end $$;

create or replace function royaltyos_finish_outbox(p_id uuid,p_success boolean,p_error text default null,p_retry_seconds integer default 30) returns void
language plpgsql security definer set search_path=public as $$
begin
  if p_success then
    update outbox_events set status='DONE',processed_at=now(),last_error=null where id=p_id;
  else
    update outbox_events set status=case when attempts>=8 then 'FAILED' else 'PENDING' end,last_error=p_error,available_at=now()+make_interval(secs=>greatest(1,p_retry_seconds)) where id=p_id;
  end if;
end $$;

-- Permissions: RPCs are backend/service-role only. No grants to anon/authenticated are added.

create or replace function royaltyos_reserve_payout_retry(
  p_settlement_id uuid,
  p_actor_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_settlement settlements;
  v_latest payout_batches;
  v_batch payout_batches;
  v_version integer;
  v_item payout_items;
begin
  select * into v_settlement from settlements where id=p_settlement_id for update;
  if not found then raise exception 'settlement not found'; end if;
  if v_settlement.status not in ('PARTIAL_FAILURE','RECONCILIATION_REQUIRED') then raise exception 'settlement is not eligible for retry'; end if;
  if not exists(select 1 from workspace_memberships where workspace_id=v_settlement.workspace_id and user_id=p_actor_id and role in ('OWNER','FINANCE_APPROVER')) then raise exception 'not authorized to retry payout'; end if;
  select * into v_latest from payout_batches where settlement_id=p_settlement_id order by payout_version desc limit 1;
  if not found then raise exception 'no prior payout batch'; end if;
  if exists(select 1 from payout_batches where idempotency_key=p_idempotency_key) then
    select * into v_batch from payout_batches where idempotency_key=p_idempotency_key;
    return to_jsonb(v_batch);
  end if;
  v_version := v_latest.payout_version + 1;
  insert into payout_batches(workspace_id,settlement_id,payout_version,status,idempotency_key)
  values(v_settlement.workspace_id,p_settlement_id,v_version,'READY',p_idempotency_key) returning * into v_batch;
  for v_item in select * from payout_items where payout_batch_id=v_latest.id and status<>'SUCCESS' loop
    insert into payout_items(payout_batch_id,settlement_line_id,sender_item_id,recipient_email,amount_minor,currency,status)
    values(v_batch.id,v_item.settlement_line_id,v_item.settlement_line_id::text||':v'||v_version,v_item.recipient_email,v_item.amount_minor,v_item.currency,'READY');
  end loop;
  if not exists(select 1 from payout_items where payout_batch_id=v_batch.id) then raise exception 'no failed payout items to retry'; end if;
  perform royaltyos_append_audit(v_settlement.workspace_id,p_actor_id,'PAYOUT_RETRY_RESERVED','PAYOUT_BATCH',v_batch.id::text,'Retry batch reserved for failed payout items only',null);
  return to_jsonb(v_batch);
end $$;

create or replace function royaltyos_verify_audit_chain(p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_row audit_events;
  v_prev text := null;
  v_expected text;
  v_count integer := 0;
begin
  for v_row in select * from audit_events where workspace_id=p_workspace_id order by created_at,id loop
    v_count := v_count + 1;
    if v_row.previous_hash is distinct from v_prev then
      return jsonb_build_object('valid',false,'checked',v_count,'brokenAt',v_row.id,'reason','previous_hash mismatch');
    end if;
    v_expected := encode(digest(coalesce(v_prev,'GENESIS') || '|' || v_row.workspace_id::text || '|' || coalesce(v_row.actor_id::text,'') || '|' || v_row.action || '|' || v_row.resource_type || '|' || v_row.resource_id || '|' || v_row.detail || '|' || coalesce(v_row.correlation_id,'') || '|' || v_row.created_at::text,'sha256'),'hex');
    if v_expected <> v_row.event_hash then
      return jsonb_build_object('valid',false,'checked',v_count,'brokenAt',v_row.id,'reason','event_hash mismatch');
    end if;
    v_prev := v_row.event_hash;
  end loop;
  return jsonb_build_object('valid',true,'checked',v_count,'brokenAt',null,'reason',null);
end $$;

create or replace function royaltyos_ledger_integrity(p_workspace_id uuid) returns jsonb
language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'valid', not exists(
      select 1 from ledger_transactions lt
      join ledger_entries le on le.transaction_id=lt.id
      where lt.workspace_id=p_workspace_id
      group by lt.id
      having sum(le.debit_minor) <> sum(le.credit_minor)
    ),
    'transactionCount', (select count(*) from ledger_transactions where workspace_id=p_workspace_id),
    'brokenTransactions', coalesce((
      select jsonb_agg(x.id) from (
        select lt.id from ledger_transactions lt join ledger_entries le on le.transaction_id=lt.id
        where lt.workspace_id=p_workspace_id group by lt.id having sum(le.debit_minor) <> sum(le.credit_minor)
      ) x
    ), '[]'::jsonb)
  );
$$;
commit;
