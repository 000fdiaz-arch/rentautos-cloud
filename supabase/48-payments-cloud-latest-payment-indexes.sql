-- Rentautos: indices para aligerar consultas de ultimos pagos en Cuentas por Cobrar.
-- Objetivo: evitar timeouts 57014 al consultar payments_cloud por user_id + campos JSON.
-- Ejecutar en Supabase SQL Editor. No modifica datos.

create index if not exists payments_cloud_user_client_id_latest_idx
on public.payments_cloud (
  user_id,
  (data->>'clientId'),
  (data->>'dateApplied') desc,
  (data->>'createdAt') desc,
  id desc
)
where nullif(data->>'clientId', '') is not null;

create index if not exists payments_cloud_user_client_unit_latest_idx
on public.payments_cloud (
  user_id,
  (data->>'clientUnit'),
  (data->>'dateApplied') desc,
  (data->>'createdAt') desc,
  id desc
)
where nullif(data->>'clientUnit', '') is not null;

create index if not exists payments_cloud_user_updated_at_idx
on public.payments_cloud (
  user_id,
  updated_at desc,
  id desc
);

create index if not exists payments_cloud_user_id_scan_idx
on public.payments_cloud (
  user_id,
  id asc
);

analyze public.payments_cloud;
