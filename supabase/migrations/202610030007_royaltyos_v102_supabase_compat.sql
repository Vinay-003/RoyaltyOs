-- RoyaltyOS v1.0.2 Supabase compatibility: pgcrypto visibility.
--
-- Fresh Supabase projects pre-install pgcrypto into the `extensions` schema, so
-- migration 001's `create extension if not exists pgcrypto` is a silent no-op
-- there and `public.digest()` does not exist. Every royaltyos_* function runs
-- with `set search_path=public`, so bootstrap/audit calls failed on hosted
-- Supabase with `function digest(text, unknown) does not exist` while passing on
-- vanilla PostgreSQL (where the extension lands in public). This migration:
--   1. relocates pgcrypto into public when public.digest is missing (best effort;
--      failures are swallowed because step 2 already covers resolution);
--   2. sets search_path = public, extensions on every royaltyos_* function;
--   3. defaults new sessions on this database to public, extensions (covers column
--      defaults such as gen_random_uuid() evaluated over PostgREST roles).
-- Future migrations: define SECURITY DEFINER functions with
-- `set search_path = public, extensions`, never bare `public`.
--
-- This file is wrapped in a transaction so a failure never leaves a half-applied release.

begin;

-- ---------------------------------------------------------------------------
-- 1. Relocate pgcrypto into public when public.digest is missing
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'digest' and n.nspname = 'public'
  ) then
    if exists (select 1 from pg_extension where extname = 'pgcrypto') then
      begin
        execute 'alter extension pgcrypto set schema public';
      exception when others then
        raise notice 'pgcrypto relocation skipped (%); functions still resolve it via search_path', sqlerrm;
      end;
    else
      execute 'create extension pgcrypto with schema public';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Every royaltyos_* function sees both schemas from now on
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  for fn in
    select quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'royaltyos\_%'
  loop
    execute 'alter function ' || fn || ' set search_path = public, extensions';
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Default sessions on this database to both schemas
-- ---------------------------------------------------------------------------
do $$
begin
  execute format('alter database %I set search_path to public, extensions', current_database());
end $$;

-- ---------------------------------------------------------------------------
-- Release record
-- ---------------------------------------------------------------------------
insert into app_versions(version, notes)
values ('1.0.2','pgcrypto visibility on hosted Supabase (extensions-schema pre-install): relocate into public, royaltyos_* function search_path public plus extensions, database session default')
on conflict (version) do nothing;

commit;
