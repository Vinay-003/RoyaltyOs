begin;

-- RoyaltyOS v0.4.0 operational completion
-- Supabase Storage, distributed rate limits, notification delivery metadata, and reconciliation indexes.

insert into app_versions(version, notes)
values ('0.4.0', 'Supabase Storage bootstrap, API rate limiting, notification delivery, amendment-aware AI and Render deployment completion')
on conflict (version) do nothing;

-- Private contract bucket. Backend service-role only; no browser storage policies are created.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('royaltyos-contracts', 'royaltyos-contracts', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists api_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  hit_count integer not null check (hit_count >= 0),
  updated_at timestamptz not null default now()
);
alter table api_rate_limits enable row level security;

create or replace function royaltyos_consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start timestamptz;
  v_count integer;
  v_allowed boolean;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate-limit configuration';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  select window_started_at, hit_count into v_start, v_count from api_rate_limits where rate_key=p_key for update;
  if not found or v_start + make_interval(secs=>p_window_seconds) <= v_now then
    v_start := v_now;
    v_count := 1;
    insert into api_rate_limits(rate_key, window_started_at, hit_count, updated_at)
    values(p_key,v_start,v_count,v_now)
    on conflict(rate_key) do update set window_started_at=excluded.window_started_at,hit_count=excluded.hit_count,updated_at=excluded.updated_at;
  else
    v_count := v_count + 1;
    update api_rate_limits set hit_count=v_count,updated_at=v_now where rate_key=p_key;
  end if;
  v_allowed := v_count <= p_limit;
  return jsonb_build_object(
    'allowed',v_allowed,
    'limit',p_limit,
    'count',v_count,
    'remaining',greatest(0,p_limit-v_count),
    'resetAt',v_start + make_interval(secs=>p_window_seconds)
  );
end $$;

alter table notifications add column if not exists recipient_email text;
alter table notifications add column if not exists subject text;
alter table notifications add column if not exists provider_message_id text;
alter table notifications add column if not exists last_error text;
alter table notifications add column if not exists dedupe_key text;
create unique index if not exists uniq_notifications_dedupe on notifications(dedupe_key) where dedupe_key is not null;
create index if not exists idx_notifications_workspace_created on notifications(workspace_id, created_at desc);

-- Helpful reconciliation indexes for provider event lookup.
create index if not exists idx_payout_items_sender on payout_items(sender_item_id);
create index if not exists idx_payout_items_transaction on payout_items(transaction_id) where transaction_id is not null;
create index if not exists idx_outbox_topic_status on outbox_events(topic,status,available_at);

-- Maintain the documented relationship between invoice/revenue/payout events and audit correlation.
alter table webhook_events add column if not exists correlation_id text;
alter table outbox_events add column if not exists correlation_id text;

-- Backend-only operational objects: no anon/authenticated policies are granted.
commit;
