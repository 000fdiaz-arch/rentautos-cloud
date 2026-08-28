-- Use active bank rules as the source of truth for fleet groups and company names.

alter table public.fleet_units_cloud
  drop constraint if exists fleet_units_cloud_unit_id_format_chk;

alter table public.fleet_units_cloud
  add constraint fleet_units_cloud_unit_id_format_chk
  check (unit_id ~ '^[A-Z](0?[1-9]|[1-9][0-9]|100)$') not valid;

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
  v_now timestamptz := now();
begin
  if not public.can_edit_owner_screen(p_owner_user_id, 'control_units') then
    raise exception 'No autorizado para guardar autos de este owner';
  end if;
  if v_unit_id = '' then raise exception 'Unidad requerida'; end if;
  if v_unit_id !~ '^[A-Z][0-9]{1,3}$' then
    raise exception 'Formato de unidad invalido: %', v_unit_id;
  end if;

  v_group := substring(v_unit_id from 1 for 1);
  v_number := substring(v_unit_id from 2)::integer;
  if v_number < 1 or v_number > 100 then
    raise exception 'Unidad fuera de rango. Rango permitido: %1 a %100', v_group, v_group;
  end if;

  select nullif(trim(rule.data->>'accountName'), '') into v_company
  from public.bank_rules_cloud rule
  where rule.user_id = p_owner_user_id
    and lower(coalesce(rule.data->>'active', 'false')) = 'true'
    and upper(trim(coalesce(rule.data->>'groupCode', ''))) = v_group
  order by rule.updated_at desc
  limit 1;
  if not found then
    raise exception 'El grupo % no tiene una regla bancaria activa', v_group;
  end if;

  if nullif(p_unit->>'model_year', '') is not null then v_model_year := (p_unit->>'model_year')::integer; end if;
  if nullif(p_unit->>'mileage', '') is not null then v_mileage := (p_unit->>'mileage')::numeric; end if;

  insert into public.fleet_units_cloud (
    user_id, unit_id, company, brand_model, engine_serial, chassis_serial, plate,
    cupo, observation, operational_status, model_year, color, transmission_type,
    mileage, updated_at
  ) values (
    p_owner_user_id, v_unit_id,
    coalesce(v_company, nullif(trim(coalesce(p_unit->>'company', '')), '')),
    nullif(trim(coalesce(p_unit->>'brand_model', '')), ''),
    nullif(trim(coalesce(p_unit->>'engine_serial', '')), ''),
    nullif(trim(coalesce(p_unit->>'chassis_serial', '')), ''),
    nullif(trim(coalesce(p_unit->>'plate', '')), ''),
    nullif(trim(coalesce(p_unit->>'cupo', '')), ''),
    nullif(trim(coalesce(p_unit->>'observation', '')), ''),
    coalesce(nullif(trim(p_unit->>'operational_status'), ''), 'libre'),
    v_model_year, nullif(trim(coalesce(p_unit->>'color', '')), ''),
    nullif(trim(coalesce(p_unit->>'transmission_type', '')), ''), v_mileage, v_now
  )
  on conflict (user_id, unit_id) do update
  set company = excluded.company, brand_model = excluded.brand_model,
      engine_serial = excluded.engine_serial, chassis_serial = excluded.chassis_serial,
      plate = excluded.plate, cupo = excluded.cupo, observation = excluded.observation,
      operational_status = excluded.operational_status, model_year = excluded.model_year,
      color = excluded.color, transmission_type = excluded.transmission_type,
      mileage = excluded.mileage, updated_at = excluded.updated_at;

  return jsonb_build_object('unit_id', v_unit_id, 'company', v_company, 'saved', true);
end;
$$;

grant execute on function public.save_fleet_unit(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
