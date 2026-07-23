-- Rentautos: corregir enlace Cliente <-> Auto en vw_control_unidades.
-- Ejecutar despues de 27-fleet-units-realtime-sync.sql.

drop view if exists public.vw_control_unidades;

create view public.vw_control_unidades as
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
  f.model_year as year,
  f.model_year,
  f.color,
  f.transmission_type as transmission,
  f.transmission_type,
  f.mileage,
  f.mileage as kilometrage,
  f.mileage as kilometraje
from public.fleet_units_cloud f
left join active_clients ac
  on ac.user_id = f.user_id
 and ac.unit_id = upper(trim(f.unit_id))
left join last_payments lp
  on lp.user_id = f.user_id
 and lp.client_id = ac.client_id;

grant select on public.vw_control_unidades to authenticated;
