-- El nombre de la cuenta es opcional. Una regla activa existe aunque accountName este vacio.

create or replace function public.preview_fleet_unit_lifecycle(
  p_owner_user_id uuid,
  p_fleet_id uuid,
  p_next_unit_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.fleet_units_cloud%rowtype;
  v_old_unit text;
  v_next_unit text := upper(btrim(coalesce(p_next_unit_id, '')));
  v_active_clients integer := 0;
  v_active_routes integer := 0;
  v_pending_promises integer := 0;
  v_open_insurance integer := 0;
  v_open_collisions integer := 0;
  v_destination_occupied boolean := false;
  v_destination_company text;
  v_destination_rule_found boolean := false;
begin
  if not public.can_view_owner_screen(p_owner_user_id, 'control_units') then
    raise exception 'No autorizado para consultar autos de este owner';
  end if;

  select * into v_unit from public.fleet_units_cloud
  where user_id = p_owner_user_id and fleet_id = p_fleet_id;
  if not found then raise exception 'Auto no encontrado'; end if;
  v_old_unit := upper(btrim(v_unit.unit_id));

  select count(*) into v_active_clients from public.clients_cloud c
  where c.user_id = p_owner_user_id
    and lower(coalesce(c.data->>'status', 'activo')) <> 'archivado'
    and (
      upper(btrim(coalesce(c.data->>'unitId', ''))) = v_old_unit
      or upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,unitId}', ''))) = v_old_unit
      or upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,regularUnitId}', ''))) = v_old_unit
    );

  select count(*) into v_active_routes from public.active_route_items_cloud r
  where r.user_id = p_owner_user_id
    and upper(btrim(coalesce(r.data->>'unitId', ''))) = v_old_unit
    and coalesce(r.data->>'removedAt', '') = '';

  select count(*) into v_pending_promises from public.payment_promises_cloud p
  where p.user_id = p_owner_user_id
    and upper(btrim(coalesce(p.data->>'clientUnit', ''))) = v_old_unit
    and lower(coalesce(p.data->>'status', 'pending')) in ('pending', 'incomplete', 'overdue', 'rescheduled');

  select count(*) into v_open_insurance from public.insurance_claims_cloud i
  where i.user_id = p_owner_user_id
    and upper(btrim(coalesce(i.data->>'unit', ''))) = v_old_unit
    and lower(coalesce(i.data->>'status', 'activo')) <> 'finalizado';

  select count(*) into v_open_collisions from public.collision_cases_cloud c
  where c.user_id = p_owner_user_id
    and upper(btrim(coalesce(c.data->>'unit', ''))) = v_old_unit
    and upper(coalesce(c.data->>'status', 'PENDIENTE')) not in ('ABSUELTO', 'CULPABLE');

  if v_next_unit <> '' then
    select exists (
      select 1 from public.fleet_units_cloud f
      where f.user_id = p_owner_user_id and f.retired_at is null
        and f.fleet_id <> p_fleet_id and upper(btrim(f.unit_id)) = v_next_unit
    ) into v_destination_occupied;

    select nullif(btrim(rule.data->>'accountName'), '') into v_destination_company
    from public.bank_rules_cloud rule
    where rule.user_id = p_owner_user_id
      and lower(coalesce(rule.data->>'active', 'false')) = 'true'
      and upper(btrim(coalesce(rule.data->>'groupCode', ''))) = substring(v_next_unit from 1 for 1)
    order by rule.updated_at desc limit 1;
    v_destination_rule_found := found;
  end if;

  return jsonb_build_object(
    'fleetId', v_unit.fleet_id, 'unitId', v_unit.unit_id, 'retired', v_unit.retired_at is not null,
    'activeClients', v_active_clients, 'activeRoutes', v_active_routes,
    'pendingPromises', v_pending_promises, 'openInsuranceClaims', v_open_insurance,
    'openCollisionCases', v_open_collisions, 'destinationOccupied', v_destination_occupied,
    'destinationCompany', v_destination_company, 'destinationHasBankRule', v_destination_rule_found
  );
end;
$$;

create or replace function public.rename_fleet_unit(
  p_owner_user_id uuid,
  p_fleet_id uuid,
  p_next_unit_id text,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.fleet_units_cloud%rowtype;
  v_old_unit text;
  v_next_unit text := upper(btrim(coalesce(p_next_unit_id, '')));
  v_group text;
  v_number integer;
  v_company text;
  v_rule_found boolean := false;
  v_clients integer := 0;
  v_routes integer := 0;
  v_promises integer := 0;
  v_insurance integer := 0;
  v_collisions integer := 0;
  v_actor_email text;
begin
  if not public.can_edit_owner_screen(p_owner_user_id, 'control_units') then raise exception 'No autorizado para cambiar nomenclaturas'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'El motivo es obligatorio'; end if;
  if v_next_unit !~ '^[A-Z][0-9]{1,3}$' then raise exception 'Formato de unidad invalido: %', v_next_unit; end if;
  v_group := substring(v_next_unit from 1 for 1);
  v_number := substring(v_next_unit from 2)::integer;
  if v_number < 1 or v_number > 100 then raise exception 'Unidad fuera de rango: %', v_next_unit; end if;

  select * into v_unit from public.fleet_units_cloud
  where user_id = p_owner_user_id and fleet_id = p_fleet_id for update;
  if not found then raise exception 'Auto no encontrado'; end if;
  if v_unit.retired_at is not null then raise exception 'Un auto dado de baja no puede cambiar nomenclatura'; end if;
  v_old_unit := upper(btrim(v_unit.unit_id));
  if v_old_unit = v_next_unit then raise exception 'La nueva nomenclatura debe ser diferente'; end if;

  if exists (
    select 1 from public.fleet_units_cloud f
    where f.user_id = p_owner_user_id and f.retired_at is null
      and f.fleet_id <> p_fleet_id and upper(btrim(f.unit_id)) = v_next_unit
  ) then raise exception 'La unidad % ya esta ocupada', v_next_unit; end if;

  select nullif(btrim(rule.data->>'accountName'), '') into v_company
  from public.bank_rules_cloud rule
  where rule.user_id = p_owner_user_id
    and lower(coalesce(rule.data->>'active', 'false')) = 'true'
    and upper(btrim(coalesce(rule.data->>'groupCode', ''))) = v_group
  order by rule.updated_at desc limit 1;
  v_rule_found := found;
  if not v_rule_found then raise exception 'El grupo % no tiene una regla bancaria activa', v_group; end if;
  select email into v_actor_email from public.user_profiles where id = auth.uid();

  update public.fleet_units_cloud
  set unit_id = v_next_unit, company = coalesce(v_company, v_unit.company), updated_at = now()
  where fleet_id = p_fleet_id;

  update public.clients_cloud c
  set data = jsonb_set(
        jsonb_set(
          jsonb_set(c.data, '{unitId}',
            case when upper(btrim(coalesce(c.data->>'unitId', ''))) = v_old_unit then to_jsonb(v_next_unit) else coalesce(c.data->'unitId', 'null'::jsonb) end, true),
          '{activeProvisionalRental,unitId}',
          case when upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,unitId}', ''))) = v_old_unit then to_jsonb(v_next_unit) else coalesce(c.data #> '{activeProvisionalRental,unitId}', 'null'::jsonb) end, true),
        '{activeProvisionalRental,regularUnitId}',
        case when upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,regularUnitId}', ''))) = v_old_unit then to_jsonb(v_next_unit) else coalesce(c.data #> '{activeProvisionalRental,regularUnitId}', 'null'::jsonb) end, true),
      updated_at = now()
  where c.user_id = p_owner_user_id
    and lower(coalesce(c.data->>'status', 'activo')) <> 'archivado'
    and (
      upper(btrim(coalesce(c.data->>'unitId', ''))) = v_old_unit
      or upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,unitId}', ''))) = v_old_unit
      or upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,regularUnitId}', ''))) = v_old_unit
    );
  get diagnostics v_clients = row_count;

  update public.active_route_items_cloud set data = jsonb_set(data, '{unitId}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id and upper(btrim(coalesce(data->>'unitId', ''))) = v_old_unit and coalesce(data->>'removedAt', '') = '';
  get diagnostics v_routes = row_count;

  update public.payment_promises_cloud set data = jsonb_set(data, '{clientUnit}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id and upper(btrim(coalesce(data->>'clientUnit', ''))) = v_old_unit
    and lower(coalesce(data->>'status', 'pending')) in ('pending', 'incomplete', 'overdue', 'rescheduled');
  get diagnostics v_promises = row_count;

  update public.pending_card_items_cloud set data = jsonb_set(data, '{clientUnit}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id and upper(btrim(coalesce(data->>'clientUnit', ''))) = v_old_unit and coalesce(data->>'appliedPaymentId', '') = '';

  update public.insurance_claims_cloud set data = jsonb_set(data, '{unit}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id and upper(btrim(coalesce(data->>'unit', ''))) = v_old_unit
    and lower(coalesce(data->>'status', 'activo')) <> 'finalizado';
  get diagnostics v_insurance = row_count;

  update public.collision_cases_cloud set data = jsonb_set(data, '{unit}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id and upper(btrim(coalesce(data->>'unit', ''))) = v_old_unit
    and upper(coalesce(data->>'status', 'PENDIENTE')) not in ('ABSUELTO', 'CULPABLE');
  get diagnostics v_collisions = row_count;

  update public.late_fee_settings_cloud s
  set data = jsonb_set(s.data, '{selectedUnits}', coalesce((
    select jsonb_agg(case when upper(btrim(value)) = v_old_unit then v_next_unit else value end)
    from jsonb_array_elements_text(coalesce(s.data->'selectedUnits', '[]'::jsonb)) as item(value)
  ), '[]'::jsonb), true), updated_at = now()
  where s.user_id = p_owner_user_id and exists (
    select 1 from jsonb_array_elements_text(coalesce(s.data->'selectedUnits', '[]'::jsonb)) as item(value)
    where upper(btrim(value)) = v_old_unit
  );

  insert into public.fleet_unit_events_cloud (
    user_id, fleet_id, event_type, previous_unit_id, next_unit_id, reason, note, vehicle_snapshot, performed_by, performed_by_email
  ) values (
    p_owner_user_id, p_fleet_id, 'renamed', v_old_unit, v_next_unit, btrim(p_reason),
    nullif(btrim(coalesce(p_note, '')), ''), to_jsonb(v_unit), auth.uid(), v_actor_email
  );

  return jsonb_build_object(
    'fleetId', p_fleet_id, 'previousUnitId', v_old_unit, 'nextUnitId', v_next_unit,
    'company', coalesce(v_company, v_unit.company), 'clientsUpdated', v_clients, 'routesUpdated', v_routes,
    'promisesUpdated', v_promises, 'insuranceUpdated', v_insurance, 'collisionsUpdated', v_collisions
  );
end;
$$;

revoke all on function public.preview_fleet_unit_lifecycle(uuid, uuid, text) from public;
revoke all on function public.rename_fleet_unit(uuid, uuid, text, text, text) from public;
grant execute on function public.preview_fleet_unit_lifecycle(uuid, uuid, text) to authenticated;
grant execute on function public.rename_fleet_unit(uuid, uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
