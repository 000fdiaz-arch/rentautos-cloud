-- Rentautos: tabla liviana de ultimo pago por cliente.
-- Objetivo: Cuentas por Cobrar consulta una fila por cliente en vez de escanear payments_cloud.
-- Ejecutar despues de 48-payments-cloud-latest-payment-indexes.sql.

create table if not exists public.latest_payments_by_client_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  payment_id text not null,
  client_unit text,
  date_applied text,
  created_at_payment text,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

alter table public.latest_payments_by_client_cloud enable row level security;

drop policy if exists "latest_payments_select_owner_data" on public.latest_payments_by_client_cloud;
create policy "latest_payments_select_owner_data"
on public.latest_payments_by_client_cloud
for select
to authenticated
using (public.can_access_owner_data(user_id));

drop policy if exists "latest_payments_insert_owner_data" on public.latest_payments_by_client_cloud;
create policy "latest_payments_insert_owner_data"
on public.latest_payments_by_client_cloud
for insert
to authenticated
with check (public.can_access_owner_data(user_id));

drop policy if exists "latest_payments_update_owner_data" on public.latest_payments_by_client_cloud;
create policy "latest_payments_update_owner_data"
on public.latest_payments_by_client_cloud
for update
to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

drop policy if exists "latest_payments_delete_owner_data" on public.latest_payments_by_client_cloud;
create policy "latest_payments_delete_owner_data"
on public.latest_payments_by_client_cloud
for delete
to authenticated
using (public.can_access_owner_data(user_id));

create index if not exists latest_payments_by_client_user_unit_idx
on public.latest_payments_by_client_cloud (user_id, client_unit);

create or replace function public.payment_latest_sort_key(p_data jsonb, p_id text)
returns text
language sql
immutable
as $$
  select concat_ws('|',
    coalesce(p_data->>'dateApplied', ''),
    coalesce(p_data->>'createdAt', ''),
    coalesce(p_id, '')
  );
$$;

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
  v_latest record;
begin
  if coalesce(p_client_id, '') = '' then
    return;
  end if;

  select p.id, p.data
    into v_latest
  from public.payments_cloud p
  where p.user_id = p_owner_user_id
    and p.data->>'clientId' = p_client_id
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
    nullif(v_latest.data->>'clientUnit', ''),
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

create or replace function public.refresh_latest_payment_for_payment_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_client_id text;
  v_new_client_id text;
begin
  if tg_op = 'DELETE' then
    v_old_client_id := old.data->>'clientId';
    perform public.rebuild_latest_payment_for_client(old.user_id, v_old_client_id);
    return old;
  end if;

  v_new_client_id := new.data->>'clientId';

  if tg_op = 'UPDATE' then
    v_old_client_id := old.data->>'clientId';
    if v_old_client_id is distinct from v_new_client_id then
      perform public.rebuild_latest_payment_for_client(old.user_id, v_old_client_id);
    end if;
  end if;

  perform public.rebuild_latest_payment_for_client(new.user_id, v_new_client_id);
  return new;
end;
$$;

drop trigger if exists refresh_latest_payment_for_payment_row on public.payments_cloud;
create trigger refresh_latest_payment_for_payment_row
after insert or update or delete on public.payments_cloud
for each row execute function public.refresh_latest_payment_for_payment_row();

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
select distinct on (p.user_id, p.data->>'clientId')
  p.user_id,
  p.data->>'clientId' as client_id,
  p.id as payment_id,
  nullif(p.data->>'clientUnit', '') as client_unit,
  nullif(p.data->>'dateApplied', '') as date_applied,
  nullif(p.data->>'createdAt', '') as created_at_payment,
  p.data,
  now()
from public.payments_cloud p
where nullif(p.data->>'clientId', '') is not null
order by
  p.user_id,
  p.data->>'clientId',
  p.data->>'dateApplied' desc nulls last,
  p.data->>'createdAt' desc nulls last,
  p.id desc
on conflict (user_id, client_id) do update
set payment_id = excluded.payment_id,
    client_unit = excluded.client_unit,
    date_applied = excluded.date_applied,
    created_at_payment = excluded.created_at_payment,
    data = excluded.data,
    updated_at = now();

analyze public.latest_payments_by_client_cloud;
