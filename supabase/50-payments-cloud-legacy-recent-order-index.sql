-- Rentautos: cubrir builds/cache viejos que aun ordenan pagos recientes por campos JSON.
-- Objetivo: eliminar timeouts 57014 en consultas legacy a payments_cloud con
-- order=data->>startDate/dateApplied mientras todos los clientes reciben el build nuevo.
-- Ejecutar despues de 48-payments-cloud-latest-payment-indexes.sql.

create index if not exists payments_cloud_user_start_date_recent_idx
on public.payments_cloud (
  user_id,
  (data->>'startDate') asc,
  (data->>'dateApplied') desc,
  (data->>'createdAt') desc,
  id desc
);

analyze public.payments_cloud;
