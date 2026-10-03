begin;

-- RoyaltyOS v0.5.0 transactional webhook/outbox + payout reconciliation hardening.

insert into app_versions(version, notes)
values ('0.5.0', 'Transactional PayPal webhook ingestion/outbox, atomic payout reconciliation enqueue, workspace-scoped webhook metrics and secure-cookie production hardening')
on conflict (version) do nothing;

alter table webhook_events add column if not exists workspace_id uuid references workspaces(id) on delete set null;
create index if not exists idx_webhook_events_workspace_received on webhook_events(workspace_id, received_at desc);

-- Verified PayPal webhooks and their asynchronous processing intent are committed atomically.
-- p_workspace_id is nullable for a cryptographically verified event that cannot yet be mapped
-- to a local tenant; those events remain visible for reconciliation but are not queued.
create or replace function royaltyos_store_verified_paypal_webhook(
  p_workspace_id uuid,
  p_paypal_event_id text,
  p_event_type text,
  p_resource_id text,
  p_transmission_id text,
  p_raw_payload jsonb,
  p_raw_payload_hash text,
  p_correlation_id text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_inserted text;
  v_processing text := case when p_workspace_id is null then 'RECONCILIATION_REQUIRED' else 'STORED' end;
begin
  insert into webhook_events(
    paypal_event_id, workspace_id, event_type, resource_id, transmission_id,
    verification_status, processing_status, raw_payload, raw_payload_hash, correlation_id
  ) values (
    p_paypal_event_id, p_workspace_id, p_event_type, p_resource_id, p_transmission_id,
    'SUCCESS', v_processing, p_raw_payload, p_raw_payload_hash, p_correlation_id
  )
  on conflict(paypal_event_id) do nothing
  returning paypal_event_id into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('duplicate',true,'queued',false,'processingStatus',
      coalesce((select processing_status from webhook_events where paypal_event_id=p_paypal_event_id),'STORED'));
  end if;

  if p_workspace_id is not null then
    insert into outbox_events(workspace_id,topic,aggregate_type,aggregate_id,payload,correlation_id)
    values(
      p_workspace_id,'paypal.webhook','WEBHOOK_EVENT',p_paypal_event_id,
      jsonb_build_object('paypalEventId',p_paypal_event_id),p_correlation_id
    );
  end if;

  return jsonb_build_object('duplicate',false,'queued',p_workspace_id is not null,'processingStatus',v_processing);
end $$;

-- Provider acknowledgement and reconciliation work are committed together after the outbound
-- PayPal request returns a batch id. A worker may safely retry the resulting outbox event.
create or replace function royaltyos_mark_payout_submitted(
  p_batch_id uuid,
  p_paypal_batch_id text,
  p_correlation_id text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_settlement uuid;
  v_workspace uuid;
begin
  select workspace_id,settlement_id into v_workspace,v_settlement
  from payout_batches where id=p_batch_id for update;
  if not found then raise exception 'payout batch not found'; end if;

  update payout_batches
  set status='SUBMITTED',paypal_batch_id=p_paypal_batch_id,updated_at=now()
  where id=p_batch_id;
  update payout_items
  set status='SUBMITTED',updated_at=now()
  where payout_batch_id=p_batch_id and status='READY';
  update settlements set status='PAYOUT_SUBMITTED' where id=v_settlement;

  insert into outbox_events(workspace_id,topic,aggregate_type,aggregate_id,payload,correlation_id)
  select v_workspace,'payout.reconcile','PAYOUT_BATCH',p_batch_id::text,
    jsonb_build_object('payoutBatchId',p_batch_id,'paypalBatchId',p_paypal_batch_id),p_correlation_id
  where not exists(
    select 1 from outbox_events
    where topic='payout.reconcile'
      and aggregate_id=p_batch_id::text
      and coalesce(payload->>'paypalBatchId','')=p_paypal_batch_id
  );

  return p_batch_id;
end $$;

-- Reconciliation integrity: a payout SUCCESS ledger event may only be written once per item.
create unique index if not exists uniq_payout_success_ledger_per_batch_item
on ledger_transactions(payout_batch_id, external_ref)
where event_type='PAYOUT_SUCCESS' and external_ref is not null;

-- The private storage bucket must remain non-public after later migrations/config changes.
update storage.buckets
set public=false, file_size_limit=10485760, allowed_mime_types=array['application/pdf']
where id='royaltyos-contracts';
commit;
