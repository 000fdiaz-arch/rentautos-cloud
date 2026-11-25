-- Rentautos: evita timeout al reconstruir el ultimo pago despues de eliminar.
-- Cada rama obtiene como maximo un candidato mediante los indices parciales
-- existentes, en vez de unir y ordenar todo el historial del owner.

create index if not exists payments_cloud_user_client_id_latest_nl_idx
on public.payments_cloud (
  user_id,
  (data->>'clientId'),
  (data->>'dateApplied') desc nulls last,
  (data->>'createdAt') desc nulls last,
  id desc
)
where nullif(data->>'clientId', '') is not null;

create index if not exists payments_cloud_user_receivable_unit_latest_nl_idx
on public.payments_cloud (
  user_id,
  public.receivable_identity_unit(data->>'clientUnit'),
  (data->>'dateApplied') desc nulls last,
  (data->>'createdAt') desc nulls last,
  id desc
)
where nullif(data->>'clientUnit', '') is not null;

create or replace function public.rebuild_latest_payment_for_client(
  p_owner_user_id uuid,
  p_client_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client jsonb;
  v_client_unit text;
  v_latest record;
begin
  if coalesce(p_client_id, '') = '' then
    return;
  end if;

  select c.data
    into v_client
  from public.clients_cloud c
  where c.user_id = p_owner_user_id
    and c.id = p_client_id
    and coalesce(lower(c.data->>'status'), 'activo') <> 'archivado'
    and nullif(c.data->>'archivedAt', '') is null
  limit 1;

  if v_client is null then
    delete from public.latest_payments_by_client_cloud
    where user_id = p_owner_user_id
      and client_id = p_client_id;
    return;
  end if;

  v_client_unit := public.receivable_identity_unit(v_client->>'unitId');

  select candidate.id, candidate.data
    into v_latest
  from (
    (
      select direct_payment.id, direct_payment.data
      from public.payments_cloud direct_payment
      where direct_payment.user_id = p_owner_user_id
        and nullif(direct_payment.data->>'clientId', '') is not null
        and direct_payment.data->>'clientId' = p_client_id
      order by
        direct_payment.data->>'dateApplied' desc nulls last,
        direct_payment.data->>'createdAt' desc nulls last,
        direct_payment.id desc
      limit 1
    )

    union all

    (
      select unit_payment.id, unit_payment.data
      from public.payments_cloud unit_payment
      where v_client_unit <> ''
        and unit_payment.user_id = p_owner_user_id
        and nullif(unit_payment.data->>'clientUnit', '') is not null
        and public.receivable_identity_unit(unit_payment.data->>'clientUnit') = v_client_unit
        and public.receivable_payment_matches_client(unit_payment.data, p_client_id, v_client)
      order by
        unit_payment.data->>'dateApplied' desc nulls last,
        unit_payment.data->>'createdAt' desc nulls last,
        unit_payment.id desc
      limit 1
    )
  ) candidate
  order by
    candidate.data->>'dateApplied' desc nulls last,
    candidate.data->>'createdAt' desc nulls last,
    candidate.id desc
  limit 1;

  if v_latest.id is null then
    delete from public.latest_payments_by_client_cloud
    where user_id = p_owner_user_id
      and client_id = p_client_id;
    return;
  end if;

  insert into public.latest_payments_by_client_cloud (
    user_id,
    client_id,
    payment_id,
    client_unit,
    date_applied,
    created_at_payment,
    data,
    updated_at
  )
  values (
    p_owner_user_id,
    p_client_id,
    v_latest.id,
    nullif(v_client->>'unitId', ''),
    nullif(v_latest.data->>'dateApplied', ''),
    nullif(v_latest.data->>'createdAt', ''),
    v_latest.data,
    now()
  )
  on conflict (user_id, client_id) do update
  set payment_id = excluded.payment_id,
      client_unit = excluded.client_unit,
      date_applied = excluded.date_applied,
      created_at_payment = excluded.created_at_payment,
      data = excluded.data,
      updated_at = now();
end;
$$;

analyze public.payments_cloud;
notify pgrst, 'reload schema';
