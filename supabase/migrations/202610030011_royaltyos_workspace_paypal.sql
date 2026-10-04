-- RoyaltyOS workspace PayPal accounts (no version bump: pure feature table).
--
-- Lets each workspace connect its own PayPal REST app (pasted credentials)
-- instead of sharing the global server credentials. Only the client secret is
-- sensitive: it is stored AES-256-GCM encrypted (see
-- packages/security/paypal-vault.ts); the client ID and webhook ID are
-- public-ish values kept plaintext for debuggability. Reads and writes go
-- through the service-role API after server-side OWNER authorization; anon
-- and authenticated have no access at all.
--
-- This file is wrapped in a transaction so a failure never leaves a half-applied release.

begin;

create table if not exists workspace_paypal_accounts (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'live')),
  paypal_client_id text not null,
  paypal_client_secret_enc text not null,
  paypal_webhook_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workspace_paypal_accounts enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on workspace_paypal_accounts from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on workspace_paypal_accounts from authenticated';
  end if;
end $$;

commit;
