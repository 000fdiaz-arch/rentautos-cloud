-- Rentautos: ultimo pago confiable para cada cliente activo de Cuentas por Cobrar.
-- Extiende latest_payments_by_client_cloud para reconocer pagos historicos aunque
-- el registro del cliente haya cambiado de id, siempre que unidad e identidad coincidan.
-- Ejecutar despues de 49-latest-payments-by-client-cloud.sql.

create or replace function public.receivable_identity_unit(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select upper(regexp_replace(coalesce(p_value, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

create or replace function public.receivable_identity_cedula(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g');
$$;

create or replace function public.receivable_identity_name(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(
    translate(lower(coalesce(p_value, '')), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+',
    ' ',
    'g'
  ));
$$;

create or replace function public.receivable_payment_matches_client(
  p_payment jsonb,
  p_client_id text,
  p_client jsonb
)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    coalesce(p_payment->>'clientId', '') = coalesce(p_client_id, '')
    or (
      public.receivable_identity_unit(p_payment->>'clientUnit') <> ''
      and public.receivable_identity_unit(p_payment->>'clientUnit') = public.receivable_identity_unit(p_client->>'unitId')
      and (
        (
          public.receivable_identity_cedula(p_payment->>'clientCedula') <> ''
          and public.receivable_identity_cedula(p_payment->>'clientCedula') = public.receivable_identity_cedula(p_client->>'cedula')
        )
        or (
          public.receivable_identity_name(p_payment->>'clientName') <> ''
          and public.receivable_identity_name(p_payment->>'clientName') = public.receivable_identity_name(p_client->>'name')
        )
      )
    );
$$;

create index if not exists payments_cloud_user_receivable_unit_latest_idx
on public.payments_cloud (
  user_id,
  public.receivable_identity_unit(data->>'clientUnit'),
  (data->>'dateApplied') desc,
  (data->>'createdAt') desc,
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

revoke execute on function public.rebuild_latest_payment_for_client(uuid, text) from public;
revoke execute on function public.rebuild_latest_payment_for_client(uuid, text) from anon;
revoke execute on function public.rebuild_latest_payment_for_client(uuid, text) from authenticated;

create or replace function public.refresh_latest_payment_for_payment_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_client_id text;
  v_old_client_id text;
  v_old_unit text;
  v_new_client_id text;
  v_new_unit text;
begin
  v_owner_user_id := coalesce(new.user_id, old.user_id);
  v_old_client_id := case when tg_op in ('UPDATE', 'DELETE') then old.data->>'clientId' else null end;
  v_old_unit := case when tg_op in ('UPDATE', 'DELETE') then public.receivable_identity_unit(old.data->>'clientUnit') else null end;
  v_new_client_id := case when tg_op in ('INSERT', 'UPDATE') then new.data->>'clientId' else null end;
  v_new_unit := case when tg_op in ('INSERT', 'UPDATE') then public.receivable_identity_unit(new.data->>'clientUnit') else null end;

  for v_client_id in
    select distinct c.id
    from public.clients_cloud c
    where c.user_id = v_owner_user_id
      and coalesce(lower(c.data->>'status'), 'activo') <> 'archivado'
      and nullif(c.data->>'archivedAt', '') is null
      and (
        c.id = v_old_client_id
        or c.id = v_new_client_id
        or (coalesce(v_old_unit, '') <> '' and public.receivable_identity_unit(c.data->>'unitId') = v_old_unit)
        or (coalesce(v_new_unit, '') <> '' and public.receivable_identity_unit(c.data->>'unitId') = v_new_unit)
      )
  loop
    perform public.rebuild_latest_payment_for_client(v_owner_user_id, v_client_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_latest_payment_for_payment_row on public.payments_cloud;
create trigger refresh_latest_payment_for_payment_row
after insert or update or delete on public.payments_cloud
for each row execute function public.refresh_latest_payment_for_payment_row();

create or replace function public.refresh_latest_payment_for_client_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Cash closing changes balances for many clients. Those financial-only updates
  -- cannot change which historical payment belongs to the client, so avoid one
  -- payments lookup per updated row.
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

drop trigger if exists refresh_latest_payment_for_client_row on public.clients_cloud;
create trigger refresh_latest_payment_for_client_row
after insert or update or delete on public.clients_cloud
for each row execute function public.refresh_latest_payment_for_client_row();

delete from public.latest_payments_by_client_cloud latest
where not exists (
  select 1
  from public.clients_cloud client
  where client.user_id = latest.user_id
    and client.id = latest.client_id
    and coalesce(lower(client.data->>'status'), 'activo') <> 'archivado'
    and nullif(client.data->>'archivedAt', '') is null
);

do $$
declare
  v_client record;
begin
  for v_client in
    select c.user_id, c.id
    from public.clients_cloud c
    where coalesce(lower(c.data->>'status'), 'activo') <> 'archivado'
      and nullif(c.data->>'archivedAt', '') is null
  loop
    perform public.rebuild_latest_payment_for_client(v_client.user_id, v_client.id);
  end loop;
end;
$$;

analyze public.latest_payments_by_client_cloud;
