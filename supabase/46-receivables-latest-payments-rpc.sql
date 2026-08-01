-- Rentautos: lectura rapida de ultimos pagos para Cuentas por Cobrar.
-- Solo agrega indices y una funcion SELECT; no modifica saldos ni pagos.
-- Ejecutar despues de 24-unique-receipt-number.sql.

create index if not exists payments_cloud_user_client_id_applied_idx
on public.payments_cloud (
  user_id,
  (data->>'clientId'),
  (data->>'dateApplied') desc,
  (data->>'createdAt') desc,
  id desc
)
where nullif(data->>'clientId', '') is not null;

create index if not exists payments_cloud_user_client_unit_applied_idx
on public.payments_cloud (
  user_id,
  (data->>'clientUnit'),
  (data->>'dateApplied') desc,
  (data->>'createdAt') desc,
  id desc
)
where nullif(data->>'clientUnit', '') is not null;

create or replace function public.latest_payments_for_receivable_targets(
  p_owner_user_id uuid,
  p_client_ids text[],
  p_unit_ids text[] default array[]::text[]
)
returns table(id text, data jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with target_client_ids as (
    select distinct nullif(trim(value), '') as client_id
    from unnest(coalesce(p_client_ids, array[]::text[])) as value
  ),
  target_unit_ids as (
    select distinct nullif(trim(value), '') as unit_id
    from unnest(coalesce(p_unit_ids, array[]::text[])) as value
  ),
  direct_latest as (
    select distinct on (p.data->>'clientId')
      p.id,
      p.data
    from public.payments_cloud p
    join target_client_ids t
      on t.client_id = p.data->>'clientId'
    where p.user_id = p_owner_user_id
      and t.client_id is not null
      and public.can_access_owner_data(p_owner_user_id)
    order by
      p.data->>'clientId',
      p.data->>'dateApplied' desc nulls last,
      p.data->>'createdAt' desc nulls last,
      p.id desc
  ),
  unit_latest as (
    select distinct on (p.data->>'clientUnit')
      p.id,
      p.data
    from public.payments_cloud p
    join target_unit_ids t
      on t.unit_id = p.data->>'clientUnit'
    where p.user_id = p_owner_user_id
      and t.unit_id is not null
      and public.can_access_owner_data(p_owner_user_id)
    order by
      p.data->>'clientUnit',
      p.data->>'dateApplied' desc nulls last,
      p.data->>'createdAt' desc nulls last,
      p.id desc
  )
  select distinct on (candidate.id)
    candidate.id,
    candidate.data
  from (
    select * from direct_latest
    union all
    select * from unit_latest
  ) candidate
  order by candidate.id;
$$;

grant execute on function public.latest_payments_for_receivable_targets(uuid, text[], text[]) to authenticated;

analyze public.payments_cloud;
