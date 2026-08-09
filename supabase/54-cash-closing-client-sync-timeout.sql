-- Rentautos: avoid statement timeout while cash closing updates many clients.
-- Safe to run after 51-receivables-latest-payment-active-client.sql.

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

  select p.id, p.data
    into v_latest
  from (
    select direct_payment.id, direct_payment.data
    from public.payments_cloud direct_payment
    where direct_payment.user_id = p_owner_user_id
      and direct_payment.data->>'clientId' = p_client_id

    union all

    select unit_payment.id, unit_payment.data
    from public.payments_cloud unit_payment
    where unit_payment.user_id = p_owner_user_id
      and public.receivable_identity_unit(unit_payment.data->>'clientUnit') = public.receivable_identity_unit(v_client->>'unitId')
      and public.receivable_payment_matches_client(unit_payment.data, p_client_id, v_client)
  ) p
  order by
    p.data->>'dateApplied' desc nulls last,
    p.data->>'createdAt' desc nulls last,
    p.id desc
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

create or replace function public.refresh_latest_payment_for_client_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.user_id is not distinct from new.user_id
    and old.id is not distinct from new.id
    and public.receivable_identity_unit(old.data->>'unitId') is not distinct from public.receivable_identity_unit(new.data->>'unitId')
    and public.receivable_identity_cedula(old.data->>'cedula') is not distinct from public.receivable_identity_cedula(new.data->>'cedula')
    and public.receivable_identity_name(old.data->>'name') is not distinct from public.receivable_identity_name(new.data->>'name')
    and coalesce(lower(old.data->>'status'), 'activo') is not distinct from coalesce(lower(new.data->>'status'), 'activo')
    and coalesce(old.data->>'archivedAt', '') is not distinct from coalesce(new.data->>'archivedAt', '')
  then
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and (
    tg_op = 'DELETE'
    or old.user_id is distinct from new.user_id
    or old.id is distinct from new.id
  ) then
    delete from public.latest_payments_by_client_cloud
    where user_id = old.user_id
      and client_id = old.id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform public.rebuild_latest_payment_for_client(new.user_id, new.id);
    return new;
  end if;

  return old;
end;
$$;

analyze public.clients_cloud;
analyze public.payments_cloud;
