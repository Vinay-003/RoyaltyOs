-- RoyaltyOS Supabase keepalive ping table for Cloudflare Worker cron.
--
-- Pings the database every 3 days to prevent free-tier 7-day inactivity pause.
-- Rows are inserted and immediately cleaned up 5 minutes later so the table stays empty.

begin;

create table if not exists keepalive_pings (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'cloudflare-cron',
  created_at timestamptz not null default now()
);

alter table keepalive_pings enable row level security;

-- Only service_role access; anon and authenticated have no access.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on keepalive_pings from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on keepalive_pings from authenticated';
  end if;
end $$;

commit;
