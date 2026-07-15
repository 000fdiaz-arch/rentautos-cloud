-- Rentautos: flota/autos en nube.
-- Ejecutar despues de 07-shared-data-owner-rls.sql y antes de probar Control de Unidades.

create table if not exists public.fleet_units_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  unit_id text not null,
  company text,
  brand_model text,
  engine_serial text,
  chassis_serial text,
  plate text,
  cupo text,
  observation text,
  is_exception boolean,
  exception_note text,
  operational_status text,
  year integer,
  color text,
  transmission text,
  mileage numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, unit_id)
);

create index if not exists fleet_units_cloud_user_unit_idx
  on public.fleet_units_cloud (user_id, unit_id);

alter table public.fleet_units_cloud enable row level security;

drop policy if exists "fleet_units_owner_access" on public.fleet_units_cloud;
create policy "fleet_units_owner_access"
on public.fleet_units_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

grant select, insert, update, delete on public.fleet_units_cloud to authenticated;

create or replace view public.vw_control_unidades as
with active_clients as (
  select distinct on (c.user_id, upper(c.data->>'unitId'))
    c.user_id,
    c.id as client_id,
    upper(c.data->>'unitId') as unit_id,
    c.data as client_data
  from public.clients_cloud c
  where nullif(c.data->>'unitId', '') is not null
    and coalesce(c.data->>'status', 'activo') <> 'archivado'
  order by c.user_id, upper(c.data->>'unitId'), c.updated_at desc
),
last_payments as (
  select
    p.user_id,
    p.data->>'clientId' as client_id,
    max(p.data->>'dateApplied') as last_payment_date
  from public.payments_cloud p
  where nullif(p.data->>'clientId', '') is not null
  group by p.user_id, p.data->>'clientId'
)
select
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
  lp.last_payment_date,
  f.year,
  f.year as model_year,
  f.color,
  f.transmission,
  f.transmission as transmission_type,
  f.mileage,
  f.mileage as kilometrage,
  f.mileage as kilometraje
from public.fleet_units_cloud f
left join active_clients ac
  on ac.user_id = f.user_id
 and ac.unit_id = upper(f.unit_id)
left join last_payments lp
  on lp.user_id = f.user_id
 and lp.client_id = ac.client_id;

grant select on public.vw_control_unidades to authenticated;
