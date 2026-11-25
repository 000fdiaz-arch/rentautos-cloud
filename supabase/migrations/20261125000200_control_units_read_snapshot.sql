-- Read the existing view and its catalog/key details in one request.
-- No business writes, view changes, grants on tables, or RLS changes.
begin;
set local lock_timeout = '3s';
create or replace function public.read_control_units_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
  select jsonb_build_object('version', 1, 'owner', p_user_id, 'rows',
    coalesce(jsonb_agg(
      to_jsonb(v) || case when f.fleet_id is null then '{}'::jsonb else
        jsonb_build_object(
          'key_coded', coalesce(f.key_coded, (to_jsonb(v)->>'key_coded')::boolean),
          'catalog_contract_months', f.catalog_contract_months,
          'catalog_daily_rate', f.catalog_daily_rate,
          'catalog_weekly_rate', f.catalog_weekly_rate,
          'catalog_biweekly_rate', f.catalog_biweekly_rate,
          'catalog_daily_management_fee', f.catalog_daily_management_fee,
          'catalog_weekly_management_fee', f.catalog_weekly_management_fee,
          'catalog_biweekly_management_fee', f.catalog_biweekly_management_fee,
          'catalog_photo_path', f.catalog_photo_path
        ) end
      order by v.unit_id), '[]'::jsonb))
  from public.vw_control_unidades v
  left join public.fleet_units_cloud f
    on f.user_id = v.user_id and f.fleet_id = v.fleet_id and f.retired_at is null
  where v.user_id = p_user_id;
$function$;
revoke all on function public.read_control_units_snapshot(uuid) from public, anon;
grant execute on function public.read_control_units_snapshot(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
