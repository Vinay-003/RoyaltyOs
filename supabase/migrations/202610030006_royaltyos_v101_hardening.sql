-- RoyaltyOS v1.0.1 hardening migration
--
-- 1. Payout reservation is enforced in the database, not only in TypeScript:
--    one batch per settlement/version, deterministic version increments, in-flight
--    reuse, retry restricted to definitively failed items, SUCCESS items permanently
--    excluded, canonical idempotency key assertion.
-- 2. Legacy (pre-chain) audit events are classified separately from cryptographically
--    verified events instead of breaking or silently counting as verified.
--
-- This file is wrapped in a transaction so a failure never leaves a half-applied release.

begin;

-- ---------------------------------------------------------------------------
-- Payout idempotency hardening
-- ---------------------------------------------------------------------------

-- One payout item per settlement line per batch (belt and braces next to the
-- globally unique sender_item_id).
create unique index if not exists uniq_payout_item_line_per_batch
  on payout_items(payout_batch_id, settlement_line_id);

-- v0.2 shipped `royaltyos_mark_payout_submitted(uuid,text)` and v0.5 added a
-- three-parameter variant with a default. Two candidates make a two-argument call
-- ambiguous for both psql and PostgREST, which would leave a submitted payout
-- unmarked. Keep exactly one signature (the defaulted one).
drop function if exists royaltyos_mark_payout_submitted(uuid, text);

-- Replace the reservation function. Semantics:
--  * lock the settlement row (serializes concurrent execute/retry callers)
--  * an exact-key match for THIS settlement returns the existing batch
--  * a key already used by another settlement is rejected
--  * if any batch already exists, execute returns it when it is still sendable
--    (READY/SUBMITTED/PENDING) or finished (SUCCESS) and otherwise demands the
--    retry path -- it can never mint a parallel full-value batch
--  * a new batch may only be created when no batch exists at all (version 1),
--    and only with the canonical idempotency key
create or replace function royaltyos_reserve_payout(
  p_settlement_id uuid,
  p_actor_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_settlement settlements;
  v_batch payout_batches;
  v_line settlement_lines;
  v_canonical text;
begin
  select * into v_settlement from settlements where id=p_settlement_id for update;
  if not found then raise exception 'settlement not found'; end if;
  if v_settlement.status not in ('APPROVED','PAYOUT_SUBMITTED','PROCESSING','PARTIAL_FAILURE','RECONCILIATION_REQUIRED') then
    raise exception 'settlement is not eligible for payout';
  end if;
  if not exists(select 1 from workspace_memberships where workspace_id=v_settlement.workspace_id and user_id=p_actor_id and role in ('OWNER','FINANCE_APPROVER')) then
    raise exception 'not authorized to execute payout';
  end if;

  -- Resolve the governing batch: the caller's key for this settlement if it exists,
  -- otherwise the latest batch for this settlement. A key owned by a different
  -- settlement is never silently reused.
  select * into v_batch from payout_batches where idempotency_key=p_idempotency_key and settlement_id=p_settlement_id;
  if not found then
    if exists(select 1 from payout_batches where idempotency_key=p_idempotency_key) then
      raise exception 'payout idempotency key belongs to a different settlement';
    end if;
    select * into v_batch from payout_batches where settlement_id=p_settlement_id order by payout_version desc limit 1;
  end if;

  -- Reuse it while it can still move money; otherwise demand the retry reservation
  -- so already-paid recipients are never re-sent by a fresh key.
  if found then
    if v_batch.status in ('READY','SUBMITTED','PENDING','SUCCESS') then
      return to_jsonb(v_batch);
    end if;
    raise exception 'settlement payout requires retry reservation';
  end if;

  v_canonical := 'payout:' || v_settlement.workspace_id::text || ':' || p_settlement_id::text || ':v1';
  if p_idempotency_key is distinct from v_canonical then
    raise exception 'payout idempotency key does not match the canonical format';
  end if;

  insert into payout_batches(workspace_id,settlement_id,payout_version,status,idempotency_key)
  values(v_settlement.workspace_id,p_settlement_id,1,'READY',p_idempotency_key) returning * into v_batch;

  if exists(select 1 from settlement_lines where settlement_id=p_settlement_id and payable_minor>0 and payout_email is null) then
    raise exception 'payout email missing for one or more payable lines';
  end if;

  for v_line in
    select sl.* from settlement_lines sl
    where sl.settlement_id=p_settlement_id
      and sl.payable_minor>0
      and sl.line_kind in ('PAYABLE','FIXED')
      and not exists (select 1 from payout_items pi where pi.settlement_line_id=sl.id and pi.status='SUCCESS')
    order by sl.id
  loop
    insert into payout_items(payout_batch_id,settlement_line_id,sender_item_id,recipient_email,amount_minor,currency,status)
    values(v_batch.id,v_line.id,v_line.id::text||':v1',v_line.payout_email,v_line.payable_minor,v_settlement.currency,'READY');
  end loop;

  if not exists(select 1 from payout_items where payout_batch_id=v_batch.id) then
    raise exception 'no unpaid payable lines to payout';
  end if;

  perform royaltyos_append_audit(v_settlement.workspace_id,p_actor_id,'PAYOUT_RESERVED','PAYOUT_BATCH',v_batch.id::text,'Payout batch reserved with canonical idempotency key',null);
  return to_jsonb(v_batch);
end $$;

-- Retry reservation. Semantics:
--  * only after reconciliation marked the settlement PARTIAL_FAILURE or
--    RECONCILIATION_REQUIRED
--  * reuses an existing next-version batch instead of creating a parallel one
--  * copies ONLY definitively failed items from the latest batch; PENDING/ONHOLD/
--    UNCLAIMED/READY/SUBMITTED items are never retried automatically
--  * a line that ever reached SUCCESS in any batch is permanently excluded
--  * version increments deterministically under the settlement row lock
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
  v_item payout_items;
  v_version integer;
  v_canonical text;
  v_retryable text[] := array['FAILED','RETURNED','BLOCKED','CANCELED'];
begin
  select * into v_settlement from settlements where id=p_settlement_id for update;
  if not found then raise exception 'settlement not found'; end if;
  if v_settlement.status not in ('PARTIAL_FAILURE','RECONCILIATION_REQUIRED') then
    raise exception 'settlement is not eligible for retry';
  end if;
  if not exists(select 1 from workspace_memberships where workspace_id=v_settlement.workspace_id and user_id=p_actor_id and role in ('OWNER','FINANCE_APPROVER')) then
    raise exception 'not authorized to retry payout';
  end if;

  select * into v_latest from payout_batches where idempotency_key=p_idempotency_key and settlement_id=p_settlement_id;
  if not found then
    if exists(select 1 from payout_batches where idempotency_key=p_idempotency_key) then
      raise exception 'payout idempotency key belongs to a different settlement';
    end if;
  end if;
  if not found then
    select * into v_latest from payout_batches where settlement_id=p_settlement_id order by payout_version desc limit 1;
    if not found then raise exception 'no prior payout batch'; end if;
  end if;

  -- An existing retry batch that is still in flight (or fully succeeded) is returned
  -- as-is: a second retry click cannot create version n+1.
  if v_latest.status in ('READY','SUBMITTED','PENDING','SUCCESS') then
    return to_jsonb(v_latest);
  end if;

  v_version := v_latest.payout_version + 1;
  v_canonical := 'payout:' || v_settlement.workspace_id::text || ':' || p_settlement_id::text || ':v' || v_version;
  -- The requested key must identify the version we are about to create. A caller that
  -- derives keys differently (the historical `payout:<settlementId>:v<n>` shape) fails
  -- here instead of reserving a parallel batch.
  if p_idempotency_key is distinct from v_canonical then
    raise exception 'payout idempotency key does not match the canonical format';
  end if;

  insert into payout_batches(workspace_id,settlement_id,payout_version,status,idempotency_key)
  values(v_settlement.workspace_id,p_settlement_id,v_version,'READY',p_idempotency_key) returning * into v_batch;

  for v_item in
    select pi.* from payout_items pi
    where pi.payout_batch_id=v_latest.id
      and pi.status = any (v_retryable)
      and not exists (
        select 1 from payout_items done
        where done.settlement_line_id = pi.settlement_line_id and done.status='SUCCESS'
      )
    order by pi.id
  loop
    insert into payout_items(payout_batch_id,settlement_line_id,sender_item_id,recipient_email,amount_minor,currency,status)
    values(v_batch.id,v_item.settlement_line_id,v_item.settlement_line_id::text||':v'||v_version,v_item.recipient_email,v_item.amount_minor,v_item.currency,'READY');
  end loop;

  if not exists(select 1 from payout_items where payout_batch_id=v_batch.id) then
    raise exception 'no failed payout items to retry';
  end if;

  perform royaltyos_append_audit(v_settlement.workspace_id,p_actor_id,'PAYOUT_RETRY_RESERVED','PAYOUT_BATCH',v_batch.id::text,'Retry batch reserved for definitively failed payout items only',null);
  return to_jsonb(v_batch);
end $$;

-- ---------------------------------------------------------------------------
-- Legacy (pre-chain) audit event classification
-- ---------------------------------------------------------------------------
-- Legacy events are audit rows written before the hash chain existed: they carry no
-- event_hash. They are reported separately and are never presented as cryptographically
-- verified, but they do not invalidate the chain as long as they all predate the first
-- hashed (genesis) event. A hash-less event AFTER the genesis event means someone
-- removed a link, so verification fails with reason 'missing chain link'.

alter table audit_events alter column event_hash drop not null;

create or replace function royaltyos_verify_audit_chain(p_workspace_id uuid)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_row audit_events;
  v_prev text := null;
  v_expected text;
  v_verified integer := 0;
  v_legacy integer := 0;
  v_genesis uuid := null;
  v_genesis_seen boolean := false;
begin
  for v_row in select * from audit_events where workspace_id=p_workspace_id order by created_at, id loop
    if v_row.event_hash is null or btrim(v_row.event_hash) = '' then
      if v_genesis_seen then
        return jsonb_build_object(
          'valid',false,'verifiedEvents',v_verified,'legacyEvents',v_legacy,'checked',v_verified,
          'chainGenesisEventId',v_genesis,'brokenAt',v_row.id,'reason','missing chain link');
      end if;
      v_legacy := v_legacy + 1;
      continue;
    end if;

    if not v_genesis_seen then
      v_genesis_seen := true;
      v_genesis := v_row.id;
      if v_row.previous_hash is not null then
        return jsonb_build_object(
          'valid',false,'verifiedEvents',v_verified,'legacyEvents',v_legacy,'checked',v_verified,
          'chainGenesisEventId',v_genesis,'brokenAt',v_row.id,'reason','missing chain link');
      end if;
    elsif v_row.previous_hash is distinct from v_prev then
      return jsonb_build_object(
        'valid',false,'verifiedEvents',v_verified,'legacyEvents',v_legacy,'checked',v_verified,
        'chainGenesisEventId',v_genesis,'brokenAt',v_row.id,'reason','previous_hash mismatch');
    end if;

    v_expected := encode(digest(coalesce(v_prev,'GENESIS') || '|' || v_row.workspace_id::text || '|' || coalesce(v_row.actor_id::text,'') || '|' || v_row.action || '|' || v_row.resource_type || '|' || v_row.resource_id || '|' || v_row.detail || '|' || coalesce(v_row.correlation_id,'') || '|' || v_row.created_at::text,'sha256'),'hex');
    if v_expected <> v_row.event_hash then
      return jsonb_build_object(
        'valid',false,'verifiedEvents',v_verified,'legacyEvents',v_legacy,'checked',v_verified,
        'chainGenesisEventId',v_genesis,'brokenAt',v_row.id,'reason','event_hash mismatch');
    end if;

    v_prev := v_row.event_hash;
    v_verified := v_verified + 1;
  end loop;

  return jsonb_build_object(
    'valid',true,'verifiedEvents',v_verified,'legacyEvents',v_legacy,'checked',v_verified,
    'chainGenesisEventId',v_genesis,'brokenAt',null,'reason',null);
end $$;

-- ---------------------------------------------------------------------------
-- RPC execution privileges
-- ---------------------------------------------------------------------------
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default, so despite the
-- v0.2 comment ("no grants to anon/authenticated are added") every royaltyos_* RPC
-- was reachable by anyone holding the public anon key through PostgREST, and the
-- SECURITY DEFINER bodies run with owner privileges that bypass RLS. Financial RPCs
-- are service-role only. The API always calls them with the service-role key.
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
    execute 'revoke execute on function ' || fn || ' from public, anon, authenticated';
    execute 'grant execute on function ' || fn || ' to service_role';
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Release record
-- ---------------------------------------------------------------------------
insert into app_versions(version, notes)
values ('1.0.1','Payout reservation idempotency hardened in the database, legacy audit event classification, behavioral database test suite, route/service refactor and operator UX fixes')
on conflict (version) do nothing;

commit;
