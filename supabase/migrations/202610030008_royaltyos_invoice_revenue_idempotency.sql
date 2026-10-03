-- RoyaltyOS invoice revenue idempotency fix (no version bump: pure bug fix).
--
-- royaltyos_record_invoice_revenue is called once per PAID signal, but PAID
-- signals repeat legitimately: PayPal redelivers webhooks under new event
-- ids, and the manual refresh route replays the same reconcile decision.
-- The old body handled repeats with
--   insert ... on conflict(workspace_id, source, external_id) do update,
-- but any UPDATE on revenue_events fires trg_immutable_revenue_events, so the
-- SECOND recording of the same invoice crashed instead of returning the
-- existing event. This redefinition returns early when the revenue event
-- already exists (no duplicate ledger posting, outbox event, or audit row),
-- making webhook redelivery and manual refresh safe to repeat.
--
-- This file is wrapped in a transaction so a failure never leaves a half-applied release.

begin;

create or replace function royaltyos_record_invoice_revenue(
  p_invoice_id uuid,
  p_paypal_invoice_id text,
  p_amount_minor bigint,
  p_currency char(3),
  p_received_at timestamptz,
  p_revenue_category text default null
) returns uuid
language plpgsql security definer set search_path=public, extensions as $$
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
  -- Idempotent re-entry: a PAID signal for an already recorded invoice
  -- returns the existing event with no further side effects. (The old
  -- on-conflict DO UPDATE tripped the append-only guard and crashed.)
  select id into v_revenue from revenue_events
  where workspace_id=v_invoice.workspace_id and source='PAYPAL_INVOICE' and external_id=p_paypal_invoice_id;
  if found then
    update invoices set status='PAID',updated_at=now() where id=p_invoice_id;
    return v_revenue;
  end if;
  update invoices set status='PAID',updated_at=now() where id=p_invoice_id;
  insert into revenue_events(workspace_id,project_id,source,external_id,gross_minor,distributable_minor,currency,revenue_category,received_at)
  values(v_invoice.workspace_id,v_invoice.project_id,'PAYPAL_INVOICE',p_paypal_invoice_id,p_amount_minor,p_amount_minor,p_currency,p_revenue_category,p_received_at)
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

commit;
