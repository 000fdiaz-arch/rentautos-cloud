-- Persiste el número de Panapass de cada auto y lo expone en el flujo de Control de Unidades.

alter table public.fleet_units_cloud
  add column if not exists panapass_number text;

comment on column public.fleet_units_cloud.panapass_number is
  'Número de Panapass leído del contrato de afiliación o capturado manualmente.';

create or replace view public.vw_control_unidades
with (security_invoker = true) as
with active_clients as (
  select distinct on (c.user_id, upper(trim(c.data->>'unitId')))
    c.user_id,
    c.id as client_id,
    upper(trim(c.data->>'unitId')) as unit_id,
    c.data as client_data,
    c.updated_at
  from public.clients_cloud c
  where nullif(trim(c.data->>'unitId'), '') is not null
    and lower(coalesce(c.data->>'status', 'activo')) <> 'archivado'
  order by c.user_id, upper(trim(c.data->>'unitId')), c.updated_at desc
)
select
  f.fleet_id,
  f.user_id,
  f.unit_id,
  f.company,
  f.brand_model,
  f.engine_serial,
  f.chassis_serial,
  f.plate,
  f.cupo,
  f.observation,
  f.is_exception,
  f.exception_note,
  ac.client_id,
  ac.client_data->>'name' as client_name,
  ac.client_data->>'cedula' as client_cedula,
  coalesce(ac.client_data->>'status', f.operational_status, 'libre') as operational_status,
  case
    when nullif(ac.client_data->>'balance', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (ac.client_data->>'balance')::numeric
    else null
  end as financial_balance,
  case
    when ac.client_id is null then 'sin_cliente'
    when nullif(ac.client_data->>'balance', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      and (ac.client_data->>'balance')::numeric > 0 then 'moroso'
    else 'al_dia'
  end as financial_status,
  null::text as last_payment_date,
  f.model_year as year,
  f.model_year,
  f.color,
  f.transmission_type as transmission,
  f.transmission_type,
  f.mileage,
  f.mileage as kilometrage,
  f.mileage as kilometraje,
  f.created_at,
  f.updated_at,
  f.panapass_number
from public.fleet_units_cloud f
left join active_clients ac
  on ac.user_id = f.user_id
 and ac.unit_id = upper(trim(f.unit_id))
where f.retired_at is null;

grant select on public.vw_control_unidades to authenticated;

create or replace function public.save_fleet_unit(p_owner_user_id uuid, p_unit jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_id text := upper(trim(coalesce(p_unit->>'unit_id', '')));
  v_group text;
  v_number integer;
  v_company text;
  v_model_year integer;
  v_mileage numeric;
  v_fleet_id uuid;
  v_rule_found boolean := false;
begin
  if not public.can_edit_owner_screen(p_owner_user_id, 'control_units') then raise exception 'No autorizado para guardar autos de este owner'; end if;
  if v_unit_id !~ '^[A-Z][0-9]{1,3}$' then raise exception 'Formato de unidad invalido: %', v_unit_id; end if;
  v_group := substring(v_unit_id from 1 for 1);
  v_number := substring(v_unit_id from 2)::integer;
  if v_number < 1 or v_number > 100 then raise exception 'Unidad fuera de rango: %', v_unit_id; end if;

  select nullif(trim(rule.data->>'accountName'), '') into v_company
  from public.bank_rules_cloud rule
  where rule.user_id = p_owner_user_id
    and lower(coalesce(rule.data->>'active', 'false')) = 'true'
    and upper(trim(coalesce(rule.data->>'groupCode', ''))) = v_group
  order by rule.updated_at desc limit 1;
  v_rule_found := found;
  if not v_rule_found then raise exception 'El grupo % no tiene una regla bancaria activa', v_group; end if;

  if nullif(p_unit->>'model_year', '') is not null then v_model_year := (p_unit->>'model_year')::integer; end if;
  if nullif(p_unit->>'mileage', '') is not null then v_mileage := (p_unit->>'mileage')::numeric; end if;

  select fleet_id into v_fleet_id from public.fleet_units_cloud
  where user_id = p_owner_user_id and retired_at is null and upper(btrim(unit_id)) = v_unit_id
  for update;

  if v_fleet_id is null then
    insert into public.fleet_units_cloud (
      user_id, unit_id, company, brand_model, engine_serial, chassis_serial, plate, panapass_number,
      cupo, observation, operational_status, model_year, color, transmission_type, mileage, updated_at
    ) values (
      p_owner_user_id, v_unit_id, coalesce(v_company, nullif(trim(coalesce(p_unit->>'company', '')), '')),
      nullif(trim(coalesce(p_unit->>'brand_model', '')), ''), nullif(trim(coalesce(p_unit->>'engine_serial', '')), ''),
      nullif(trim(coalesce(p_unit->>'chassis_serial', '')), ''), nullif(trim(coalesce(p_unit->>'plate', '')), ''),
      nullif(regexp_replace(coalesce(p_unit->>'panapass_number', ''), '[^0-9]', '', 'g'), ''),
      nullif(trim(coalesce(p_unit->>'cupo', '')), ''), nullif(trim(coalesce(p_unit->>'observation', '')), ''),
      coalesce(nullif(trim(p_unit->>'operational_status'), ''), 'libre'), v_model_year,
      nullif(trim(coalesce(p_unit->>'color', '')), ''), nullif(trim(coalesce(p_unit->>'transmission_type', '')), ''),
      v_mileage, now()
    ) returning fleet_id into v_fleet_id;
  else
    update public.fleet_units_cloud set
      company = coalesce(v_company, nullif(trim(coalesce(p_unit->>'company', '')), ''), company),
      brand_model = nullif(trim(coalesce(p_unit->>'brand_model', '')), ''),
      engine_serial = nullif(trim(coalesce(p_unit->>'engine_serial', '')), ''),
      chassis_serial = nullif(trim(coalesce(p_unit->>'chassis_serial', '')), ''),
      plate = nullif(trim(coalesce(p_unit->>'plate', '')), ''),
      panapass_number = nullif(regexp_replace(coalesce(p_unit->>'panapass_number', ''), '[^0-9]', '', 'g'), ''),
      cupo = nullif(trim(coalesce(p_unit->>'cupo', '')), ''),
      observation = nullif(trim(coalesce(p_unit->>'observation', '')), ''),
      operational_status = coalesce(nullif(trim(p_unit->>'operational_status'), ''), 'libre'),
      model_year = v_model_year,
      color = nullif(trim(coalesce(p_unit->>'color', '')), ''),
      transmission_type = nullif(trim(coalesce(p_unit->>'transmission_type', '')), ''),
      mileage = v_mileage,
      updated_at = now()
    where fleet_id = v_fleet_id;
  end if;

  return jsonb_build_object('fleet_id', v_fleet_id, 'unit_id', v_unit_id, 'company', v_company, 'saved', true);
end;
$$;

revoke all on function public.save_fleet_unit(uuid, jsonb) from public;
grant execute on function public.save_fleet_unit(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
