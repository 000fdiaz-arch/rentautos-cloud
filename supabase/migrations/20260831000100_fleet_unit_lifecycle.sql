-- Identidad permanente, bajas y cambios de nomenclatura de autos.

drop view if exists public.vw_control_unidades;

alter table public.fleet_units_cloud
  add column if not exists fleet_id uuid default gen_random_uuid(),
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text,
  add column if not exists retired_note text,
  add column if not exists retired_by uuid,
  add column if not exists retired_by_email text,
  add column if not exists retired_client_id text,
  add column if not exists retired_client_name text;

update public.fleet_units_cloud
set fleet_id = gen_random_uuid()
where fleet_id is null;

alter table public.fleet_units_cloud
  alter column fleet_id set default gen_random_uuid(),
  alter column fleet_id set not null;

alter table public.fleet_units_cloud
  drop constraint if exists fleet_units_cloud_pkey;

alter table public.fleet_units_cloud
  add constraint fleet_units_cloud_pkey primary key (fleet_id);

drop index if exists public.fleet_units_cloud_active_unit_uq;
create unique index fleet_units_cloud_active_unit_uq
  on public.fleet_units_cloud (user_id, upper(btrim(unit_id)))
  where retired_at is null;

create index if not exists fleet_units_cloud_user_retired_idx
  on public.fleet_units_cloud (user_id, retired_at desc)
  where retired_at is not null;

create table if not exists public.fleet_unit_events_cloud (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fleet_id uuid not null references public.fleet_units_cloud(fleet_id) on delete restrict,
  event_type text not null check (event_type in ('renamed', 'retired', 'restored')),
  previous_unit_id text,
  next_unit_id text,
  reason text not null,
  note text,
  vehicle_snapshot jsonb not null default '{}'::jsonb,
  performed_by uuid,
  performed_by_email text,
  occurred_at timestamptz not null default now()
);

create index if not exists fleet_unit_events_user_fleet_idx
  on public.fleet_unit_events_cloud (user_id, fleet_id, occurred_at desc);

alter table public.fleet_unit_events_cloud enable row level security;

drop policy if exists "fleet_unit_events_read" on public.fleet_unit_events_cloud;
create policy "fleet_unit_events_read" on public.fleet_unit_events_cloud
for select to authenticated
using (public.can_view_owner_screen(user_id, 'control_units'));

drop policy if exists "fleet_unit_events_write" on public.fleet_unit_events_cloud;
create policy "fleet_unit_events_write" on public.fleet_unit_events_cloud
for insert to authenticated
with check (public.can_edit_owner_screen(user_id, 'control_units'));

grant select, insert on public.fleet_unit_events_cloud to authenticated;

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
  f.updated_at
from public.fleet_units_cloud f
left join active_clients ac
  on ac.user_id = f.user_id
 and ac.unit_id = upper(trim(f.unit_id))
where f.retired_at is null;

grant select on public.vw_control_unidades to authenticated;

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

  select * into v_unit
  from public.fleet_units_cloud
  where user_id = p_owner_user_id and fleet_id = p_fleet_id;
  if not found then raise exception 'Auto no encontrado'; end if;
  v_old_unit := upper(btrim(v_unit.unit_id));

  select count(*) into v_active_clients
  from public.clients_cloud c
  where c.user_id = p_owner_user_id
    and lower(coalesce(c.data->>'status', 'activo')) <> 'archivado'
    and (
      upper(btrim(coalesce(c.data->>'unitId', ''))) = v_old_unit
      or upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,unitId}', ''))) = v_old_unit
      or upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,regularUnitId}', ''))) = v_old_unit
    );

  select count(*) into v_active_routes
  from public.active_route_items_cloud r
  where r.user_id = p_owner_user_id
    and upper(btrim(coalesce(r.data->>'unitId', ''))) = v_old_unit
    and coalesce(r.data->>'removedAt', '') = '';

  select count(*) into v_pending_promises
  from public.payment_promises_cloud p
  where p.user_id = p_owner_user_id
    and upper(btrim(coalesce(p.data->>'clientUnit', ''))) = v_old_unit
    and lower(coalesce(p.data->>'status', 'pending')) in ('pending', 'incomplete', 'overdue', 'rescheduled');

  select count(*) into v_open_insurance
  from public.insurance_claims_cloud i
  where i.user_id = p_owner_user_id
    and upper(btrim(coalesce(i.data->>'unit', ''))) = v_old_unit
    and lower(coalesce(i.data->>'status', 'activo')) <> 'finalizado';

  select count(*) into v_open_collisions
  from public.collision_cases_cloud c
  where c.user_id = p_owner_user_id
    and upper(btrim(coalesce(c.data->>'unit', ''))) = v_old_unit
    and upper(coalesce(c.data->>'status', 'PENDIENTE')) not in ('ABSUELTO', 'CULPABLE');

  if v_next_unit <> '' then
    select exists (
      select 1 from public.fleet_units_cloud f
      where f.user_id = p_owner_user_id
        and f.retired_at is null
        and f.fleet_id <> p_fleet_id
        and upper(btrim(f.unit_id)) = v_next_unit
    ) into v_destination_occupied;

    select nullif(btrim(rule.data->>'accountName'), '') into v_destination_company
    from public.bank_rules_cloud rule
    where rule.user_id = p_owner_user_id
      and lower(coalesce(rule.data->>'active', 'false')) = 'true'
      and upper(btrim(coalesce(rule.data->>'groupCode', ''))) = substring(v_next_unit from 1 for 1)
    order by rule.updated_at desc
    limit 1;
    v_destination_rule_found := found;
  end if;

  return jsonb_build_object(
    'fleetId', v_unit.fleet_id,
    'unitId', v_unit.unit_id,
    'retired', v_unit.retired_at is not null,
    'activeClients', v_active_clients,
    'activeRoutes', v_active_routes,
    'pendingPromises', v_pending_promises,
    'openInsuranceClaims', v_open_insurance,
    'openCollisionCases', v_open_collisions,
    'destinationOccupied', v_destination_occupied,
    'destinationCompany', v_destination_company,
    'destinationHasBankRule', v_destination_rule_found
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
  if not public.can_edit_owner_screen(p_owner_user_id, 'control_units') then
    raise exception 'No autorizado para cambiar nomenclaturas';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'El motivo es obligatorio'; end if;
  if v_next_unit !~ '^[A-Z][0-9]{1,3}$' then raise exception 'Formato de unidad invalido: %', v_next_unit; end if;
  v_group := substring(v_next_unit from 1 for 1);
  v_number := substring(v_next_unit from 2)::integer;
  if v_number < 1 or v_number > 100 then raise exception 'Unidad fuera de rango: %', v_next_unit; end if;

  select * into v_unit
  from public.fleet_units_cloud
  where user_id = p_owner_user_id and fleet_id = p_fleet_id
  for update;
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
  order by rule.updated_at desc
  limit 1;
  v_rule_found := found;
  if not v_rule_found then raise exception 'El grupo % no tiene una regla bancaria activa', v_group; end if;
  select email into v_actor_email from public.user_profiles where id = auth.uid();

  update public.fleet_units_cloud
  set unit_id = v_next_unit, company = coalesce(v_company, v_unit.company), updated_at = now()
  where fleet_id = p_fleet_id;

  update public.clients_cloud c
  set data = jsonb_set(
        jsonb_set(
          jsonb_set(
            c.data,
            '{unitId}',
            case when upper(btrim(coalesce(c.data->>'unitId', ''))) = v_old_unit then to_jsonb(v_next_unit) else coalesce(c.data->'unitId', 'null'::jsonb) end,
            true
          ),
          '{activeProvisionalRental,unitId}',
          case when upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,unitId}', ''))) = v_old_unit then to_jsonb(v_next_unit) else coalesce(c.data #> '{activeProvisionalRental,unitId}', 'null'::jsonb) end,
          true
        ),
        '{activeProvisionalRental,regularUnitId}',
        case when upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,regularUnitId}', ''))) = v_old_unit then to_jsonb(v_next_unit) else coalesce(c.data #> '{activeProvisionalRental,regularUnitId}', 'null'::jsonb) end,
        true
      ),
      updated_at = now()
  where c.user_id = p_owner_user_id
    and lower(coalesce(c.data->>'status', 'activo')) <> 'archivado'
    and (
      upper(btrim(coalesce(c.data->>'unitId', ''))) = v_old_unit
      or upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,unitId}', ''))) = v_old_unit
      or upper(btrim(coalesce(c.data #>> '{activeProvisionalRental,regularUnitId}', ''))) = v_old_unit
    );
  get diagnostics v_clients = row_count;

  update public.active_route_items_cloud
  set data = jsonb_set(data, '{unitId}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id
    and upper(btrim(coalesce(data->>'unitId', ''))) = v_old_unit
    and coalesce(data->>'removedAt', '') = '';
  get diagnostics v_routes = row_count;

  update public.payment_promises_cloud
  set data = jsonb_set(data, '{clientUnit}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id
    and upper(btrim(coalesce(data->>'clientUnit', ''))) = v_old_unit
    and lower(coalesce(data->>'status', 'pending')) in ('pending', 'incomplete', 'overdue', 'rescheduled');
  get diagnostics v_promises = row_count;

  update public.pending_card_items_cloud
  set data = jsonb_set(data, '{clientUnit}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id
    and upper(btrim(coalesce(data->>'clientUnit', ''))) = v_old_unit
    and coalesce(data->>'appliedPaymentId', '') = '';

  update public.insurance_claims_cloud
  set data = jsonb_set(data, '{unit}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id
    and upper(btrim(coalesce(data->>'unit', ''))) = v_old_unit
    and lower(coalesce(data->>'status', 'activo')) <> 'finalizado';
  get diagnostics v_insurance = row_count;

  update public.collision_cases_cloud
  set data = jsonb_set(data, '{unit}', to_jsonb(v_next_unit), true), updated_at = now()
  where user_id = p_owner_user_id
    and upper(btrim(coalesce(data->>'unit', ''))) = v_old_unit
    and upper(coalesce(data->>'status', 'PENDIENTE')) not in ('ABSUELTO', 'CULPABLE');
  get diagnostics v_collisions = row_count;

  update public.late_fee_settings_cloud s
  set data = jsonb_set(
    s.data,
    '{selectedUnits}',
    coalesce((
      select jsonb_agg(case when upper(btrim(value)) = v_old_unit then v_next_unit else value end)
      from jsonb_array_elements_text(coalesce(s.data->'selectedUnits', '[]'::jsonb)) as item(value)
    ), '[]'::jsonb),
    true
  ), updated_at = now()
  where s.user_id = p_owner_user_id
    and exists (
      select 1 from jsonb_array_elements_text(coalesce(s.data->'selectedUnits', '[]'::jsonb)) as item(value)
      where upper(btrim(value)) = v_old_unit
    );

  insert into public.fleet_unit_events_cloud (
    user_id, fleet_id, event_type, previous_unit_id, next_unit_id, reason, note, vehicle_snapshot, performed_by, performed_by_email
  ) values (
    p_owner_user_id, p_fleet_id, 'renamed', v_old_unit, v_next_unit, btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''), to_jsonb(v_unit), auth.uid(), v_actor_email
  );

  return jsonb_build_object(
    'fleetId', p_fleet_id, 'previousUnitId', v_old_unit, 'nextUnitId', v_next_unit,
    'company', coalesce(v_company, v_unit.company), 'clientsUpdated', v_clients, 'routesUpdated', v_routes,
    'promisesUpdated', v_promises, 'insuranceUpdated', v_insurance, 'collisionsUpdated', v_collisions
  );
end;
$$;

create or replace function public.retire_fleet_unit(
  p_owner_user_id uuid,
  p_fleet_id uuid,
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
  v_unit_id text;
  v_impact jsonb;
  v_last_client_id text;
  v_last_client_name text;
  v_actor_email text;
begin
  if not public.can_edit_owner_screen(p_owner_user_id, 'control_units') then
    raise exception 'No autorizado para dar de baja autos';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'El motivo de baja es obligatorio'; end if;

  select * into v_unit
  from public.fleet_units_cloud
  where user_id = p_owner_user_id and fleet_id = p_fleet_id
  for update;
  if not found then raise exception 'Auto no encontrado'; end if;
  if v_unit.retired_at is not null then raise exception 'El auto ya fue dado de baja'; end if;
  v_unit_id := upper(btrim(v_unit.unit_id));
  v_impact := public.preview_fleet_unit_lifecycle(p_owner_user_id, p_fleet_id, null);

  if coalesce((v_impact->>'activeClients')::integer, 0) > 0 then
    raise exception 'No se puede dar de baja: la unidad tiene cliente o alquiler provisional activo';
  end if;
  if coalesce((v_impact->>'activeRoutes')::integer, 0) > 0 then
    raise exception 'No se puede dar de baja: la unidad esta publicada en una ruta activa';
  end if;
  if coalesce((v_impact->>'pendingPromises')::integer, 0) > 0 then
    raise exception 'No se puede dar de baja: la unidad tiene promesas de pago pendientes';
  end if;
  if coalesce((v_impact->>'openInsuranceClaims')::integer, 0) > 0
     or coalesce((v_impact->>'openCollisionCases')::integer, 0) > 0 then
    raise exception 'No se puede dar de baja: la unidad tiene siniestros o expedientes abiertos';
  end if;

  select c.id, c.data->>'name'
  into v_last_client_id, v_last_client_name
  from public.clients_cloud c
  where c.user_id = p_owner_user_id
    and upper(btrim(coalesce(c.data->>'unitId', ''))) = v_unit_id
  order by c.updated_at desc
  limit 1;
  select email into v_actor_email from public.user_profiles where id = auth.uid();

  update public.fleet_units_cloud
  set retired_at = now(), retired_reason = btrim(p_reason),
      retired_note = nullif(btrim(coalesce(p_note, '')), ''), retired_by = auth.uid(), retired_by_email = v_actor_email,
      retired_client_id = v_last_client_id, retired_client_name = v_last_client_name,
      operational_status = 'archivado', updated_at = now()
  where fleet_id = p_fleet_id;

  insert into public.fleet_unit_events_cloud (
    user_id, fleet_id, event_type, previous_unit_id, reason, note, vehicle_snapshot, performed_by, performed_by_email
  ) values (
    p_owner_user_id, p_fleet_id, 'retired', v_unit_id, btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''), to_jsonb(v_unit), auth.uid(), v_actor_email
  );

  return jsonb_build_object('fleetId', p_fleet_id, 'unitId', v_unit_id, 'retired', true);
end;
$$;

create or replace function public.restore_fleet_unit(
  p_owner_user_id uuid,
  p_fleet_id uuid,
  p_unit_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.fleet_units_cloud%rowtype;
  v_unit_id text := upper(btrim(coalesce(p_unit_id, '')));
  v_group text;
  v_number integer;
  v_company text;
  v_rule_found boolean := false;
  v_actor_email text;
begin
  if not public.can_edit_owner_screen(p_owner_user_id, 'control_units') then raise exception 'No autorizado para reactivar autos'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'El motivo es obligatorio'; end if;
  if v_unit_id !~ '^[A-Z][0-9]{1,3}$' then raise exception 'Formato de unidad invalido: %', v_unit_id; end if;
  v_group := substring(v_unit_id from 1 for 1);
  v_number := substring(v_unit_id from 2)::integer;
  if v_number < 1 or v_number > 100 then raise exception 'Unidad fuera de rango: %', v_unit_id; end if;

  select * into v_unit from public.fleet_units_cloud
  where user_id = p_owner_user_id and fleet_id = p_fleet_id for update;
  if not found then raise exception 'Auto no encontrado'; end if;
  if v_unit.retired_at is null then raise exception 'El auto ya esta activo'; end if;
  if exists (
    select 1 from public.fleet_units_cloud f
    where f.user_id = p_owner_user_id and f.retired_at is null and upper(btrim(f.unit_id)) = v_unit_id
  ) then raise exception 'La unidad % ya esta ocupada; selecciona otra nomenclatura', v_unit_id; end if;

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
  set unit_id = v_unit_id, company = coalesce(v_company, v_unit.company), operational_status = 'libre',
      retired_at = null, retired_reason = null, retired_note = null, retired_by = null, retired_by_email = null,
      retired_client_id = null, retired_client_name = null, updated_at = now()
  where fleet_id = p_fleet_id;

  insert into public.fleet_unit_events_cloud (
    user_id, fleet_id, event_type, previous_unit_id, next_unit_id, reason, vehicle_snapshot, performed_by, performed_by_email
  ) values (
    p_owner_user_id, p_fleet_id, 'restored', v_unit.unit_id, v_unit_id, btrim(p_reason), to_jsonb(v_unit), auth.uid(), v_actor_email
  );

  return jsonb_build_object('fleetId', p_fleet_id, 'unitId', v_unit_id, 'company', coalesce(v_company, v_unit.company), 'restored', true);
end;
$$;

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
      user_id, unit_id, company, brand_model, engine_serial, chassis_serial, plate,
      cupo, observation, operational_status, model_year, color, transmission_type, mileage, updated_at
    ) values (
      p_owner_user_id, v_unit_id, coalesce(v_company, nullif(trim(coalesce(p_unit->>'company', '')), '')),
      nullif(trim(coalesce(p_unit->>'brand_model', '')), ''), nullif(trim(coalesce(p_unit->>'engine_serial', '')), ''),
      nullif(trim(coalesce(p_unit->>'chassis_serial', '')), ''), nullif(trim(coalesce(p_unit->>'plate', '')), ''),
      nullif(trim(coalesce(p_unit->>'cupo', '')), ''), nullif(trim(coalesce(p_unit->>'observation', '')), ''),
      coalesce(nullif(trim(p_unit->>'operational_status'), ''), 'libre'), v_model_year,
      nullif(trim(coalesce(p_unit->>'color', '')), ''), nullif(trim(coalesce(p_unit->>'transmission_type', '')), ''),
      v_mileage, now()
    ) returning fleet_id into v_fleet_id;
  else
    update public.fleet_units_cloud set
      company = coalesce(v_company, nullif(trim(coalesce(p_unit->>'company', '')), ''), company), brand_model = nullif(trim(coalesce(p_unit->>'brand_model', '')), ''),
      engine_serial = nullif(trim(coalesce(p_unit->>'engine_serial', '')), ''),
      chassis_serial = nullif(trim(coalesce(p_unit->>'chassis_serial', '')), ''),
      plate = nullif(trim(coalesce(p_unit->>'plate', '')), ''), cupo = nullif(trim(coalesce(p_unit->>'cupo', '')), ''),
      observation = nullif(trim(coalesce(p_unit->>'observation', '')), ''),
      operational_status = coalesce(nullif(trim(p_unit->>'operational_status'), ''), 'libre'),
      model_year = v_model_year, color = nullif(trim(coalesce(p_unit->>'color', '')), ''),
      transmission_type = nullif(trim(coalesce(p_unit->>'transmission_type', '')), ''), mileage = v_mileage,
      updated_at = now()
    where fleet_id = v_fleet_id;
  end if;

  return jsonb_build_object('fleet_id', v_fleet_id, 'unit_id', v_unit_id, 'company', v_company, 'saved', true);
end;
$$;

-- Las sincronizaciones antiguas buscan por nomenclatura. Cuando una nomenclatura
-- se reutiliza, una actualización operacional nunca debe alterar la ficha dada de baja.
create or replace function public.preserve_retired_fleet_unit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.retired_at is not null and new.retired_at is not null then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists fleet_units_preserve_retired on public.fleet_units_cloud;
create trigger fleet_units_preserve_retired
before update on public.fleet_units_cloud
for each row execute function public.preserve_retired_fleet_unit();

create or replace function public.save_provisional_rental_state(
  p_owner_user_id uuid,
  p_client_id text,
  p_client_data jsonb,
  p_unit_id text,
  p_fleet_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_id text := upper(btrim(coalesce(p_unit_id, '')));
  v_current_status text;
  v_previous_client jsonb;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesion.'; end if;
  if not public.can_edit_owner_screen(p_owner_user_id, 'clients') then raise exception 'No tienes permiso para editar Clientes.'; end if;
  if v_unit_id = '' then raise exception 'La unidad provisional es obligatoria.'; end if;
  if p_fleet_status not in ('provisional_rental', 'libre') then raise exception 'Estado provisional no permitido.'; end if;

  select data into v_previous_client from public.clients_cloud
  where user_id = p_owner_user_id and id = p_client_id for update;
  if v_previous_client is null then raise exception 'Cliente no encontrado.'; end if;

  select lower(coalesce(operational_status, 'libre')) into v_current_status
  from public.fleet_units_cloud
  where user_id = p_owner_user_id and retired_at is null and upper(unit_id) = v_unit_id for update;
  if v_current_status is null then raise exception 'Auto provisional no encontrado.'; end if;

  if p_fleet_status = 'provisional_rental' then
    if v_current_status not in ('libre', 'provisional_rental') then raise exception 'El auto ya no esta libre.'; end if;
    if upper(coalesce(p_client_data #>> '{activeProvisionalRental,unitId}', '')) <> v_unit_id then
      raise exception 'Los datos del alquiler no corresponden a la unidad seleccionada.';
    end if;
    if exists (
      select 1 from public.clients_cloud c
      where c.user_id = p_owner_user_id and c.id <> p_client_id
        and upper(coalesce(c.data #>> '{activeProvisionalRental,unitId}', '')) = v_unit_id
    ) then raise exception 'El auto provisional ya fue asignado a otro cliente.'; end if;
  elsif upper(coalesce(v_previous_client #>> '{activeProvisionalRental,unitId}', '')) <> v_unit_id then
    raise exception 'El cliente no tiene activa esa unidad provisional.';
  end if;

  update public.clients_cloud set data = p_client_data, updated_at = now()
  where user_id = p_owner_user_id and id = p_client_id;
  update public.fleet_units_cloud set operational_status = p_fleet_status, updated_at = now()
  where user_id = p_owner_user_id and retired_at is null and upper(unit_id) = v_unit_id;
  return p_client_data;
end;
$$;

revoke all on function public.preview_fleet_unit_lifecycle(uuid, uuid, text) from public;
revoke all on function public.rename_fleet_unit(uuid, uuid, text, text, text) from public;
revoke all on function public.retire_fleet_unit(uuid, uuid, text, text) from public;
revoke all on function public.restore_fleet_unit(uuid, uuid, text, text) from public;
grant execute on function public.preview_fleet_unit_lifecycle(uuid, uuid, text) to authenticated;
grant execute on function public.rename_fleet_unit(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.retire_fleet_unit(uuid, uuid, text, text) to authenticated;
grant execute on function public.restore_fleet_unit(uuid, uuid, text, text) to authenticated;
grant execute on function public.save_fleet_unit(uuid, jsonb) to authenticated;
grant execute on function public.save_provisional_rental_state(uuid, text, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';
