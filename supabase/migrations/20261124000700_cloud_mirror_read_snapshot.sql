-- A single read-only statement for mirror bootstrap. SECURITY INVOKER keeps
-- every table's existing grants and RLS in force for the calling user.
-- JSON aggregation returns every row, beyond PostgREST's per-response row limit.
begin;
set local lock_timeout = '3s';

create or replace function public.read_cloud_mirror_snapshot(p_user_id uuid, p_keys text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  requested_key text;
  target_table text;
  is_array boolean;
  payload jsonb;
  result jsonb := '{}'::jsonb;
begin
  if p_user_id is null then
    raise exception 'An owner is required' using errcode = '22004';
  end if;
  foreach requested_key in array coalesce(p_keys, array[]::text[]) loop
    case requested_key
      when 'cobrapp.module1.clients.v1' then target_table := 'clients_cloud'; is_array := true;
      when 'cobrapp.module2.pending_bank.v1' then target_table := 'pending_bank_items_cloud'; is_array := true;
      when 'cobrapp.module2.pending_card.v1' then target_table := 'pending_card_items_cloud'; is_array := true;
      when 'cobrapp.settings.bank_rules.v1' then target_table := 'bank_rules_cloud'; is_array := true;
      when 'cobrapp.module2.manual_assignment_audit.v1' then target_table := 'manual_assignment_audit_cloud'; is_array := true;
      when 'cobrapp.module2.late_fee_ledger.v1' then target_table := 'late_fee_ledger_cloud'; is_array := true;
      when 'cobrapp.module2.notified.v1' then target_table := 'notified_payments_cloud'; is_array := true;
      when 'cobrapp.module2.cash_closings.v1' then target_table := 'cash_closings_cloud'; is_array := true;
      when 'cobrapp.module2.cash_closing_audit.v1' then target_table := 'cash_closing_audit_cloud'; is_array := true;
      when 'cobrapp.module2.charge_runs.v1' then target_table := 'charge_runs_cloud'; is_array := true;
      when 'cobrapp.payments.seq.v1' then target_table := 'receipt_sequences_cloud'; is_array := false;
      when 'cobrapp.settings.late_fee_settings.v1' then target_table := 'late_fee_settings_cloud'; is_array := false;
      when 'cobrapp.settings.other_charges_retention.v1' then target_table := 'other_charges_retention_cloud'; is_array := false;
      when 'cobrapp.clients.status_filter.v1' then target_table := 'client_ui_prefs_cloud'; is_array := false;
      when 'cobrapp.module3.collection_closures.v1' then target_table := 'collection_closures_cloud'; is_array := false;
      when 'cobrapp.clients.daily_collection.v1' then target_table := 'clients_daily_collection_cloud'; is_array := false;
      when 'cobrapp.clients.daily_collection_am_seals.v1' then target_table := 'clients_daily_collection_am_seals_cloud'; is_array := false;
      when 'cobrapp.clients.daily_collection_pm_seals.v1' then target_table := 'clients_daily_collection_pm_seals_cloud'; is_array := false;
      when 'cobrapp.clients.daily_collection_close_seals.v1' then target_table := 'clients_daily_collection_close_seals_cloud'; is_array := false;
      when 'cobrapp.clients.daily_collection_promises.v1' then target_table := 'clients_daily_collection_promises_cloud'; is_array := false;
      when 'cobrapp.clients.daily_collection_street_actions.v1' then target_table := 'clients_daily_collection_street_actions_cloud'; is_array := false;
      else raise exception 'Unknown mirror key' using errcode = '22023';
    end case;
    if is_array then
      execute format('select coalesce(jsonb_agg(t.data), ''[]''::jsonb) from public.%I t where t.user_id = $1', target_table)
        into payload using p_user_id;
    else
      execute format('select to_jsonb(t) from public.%I t where t.user_id = $1', target_table)
        into payload using p_user_id;
    end if;
    result := jsonb_set(result, array[requested_key], coalesce(payload, 'null'::jsonb));
  end loop;
  return jsonb_build_object('version', 1, 'values', result);
end;
$function$;

revoke all on function public.read_cloud_mirror_snapshot(uuid, text[]) from public, anon;
grant execute on function public.read_cloud_mirror_snapshot(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
commit;
