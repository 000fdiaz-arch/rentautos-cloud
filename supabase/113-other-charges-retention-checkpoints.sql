-- Punto de control global para la retencion de Otros cargos.
-- Evita depender del historial parcial de pagos que carga la interfaz.

create table if not exists public.other_charges_retention_checkpoints_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  payment_id text not null,
  date_applied text not null,
  payment_created_at text not null,
  retention_event jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

create index if not exists other_charges_retention_checkpoints_user_date_idx
  on public.other_charges_retention_checkpoints_cloud (user_id, date_applied desc, payment_created_at desc);

alter table public.other_charges_retention_checkpoints_cloud enable row level security;

drop policy if exists "other_charges_retention_checkpoints_shared_owner_access"
  on public.other_charges_retention_checkpoints_cloud;
create policy "other_charges_retention_checkpoints_shared_owner_access"
on public.other_charges_retention_checkpoints_cloud
for all to authenticated
using (public.can_access_owner_data(user_id))
with check (public.can_access_owner_data(user_id));

grant select on public.other_charges_retention_checkpoints_cloud to authenticated;

create or replace function public.payment_has_other_charges_retention(p_data jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_charge jsonb;
  v_label text;
  v_amount numeric;
begin
  if jsonb_typeof(p_data->'otherChargesRetentionEvent') = 'object' then
    return true;
  end if;

  if jsonb_typeof(p_data->'otherChargesApplied') <> 'array' then
    return false;
  end if;

  for v_charge in select value from jsonb_array_elements(p_data->'otherChargesApplied')
  loop
    v_label := upper(btrim(coalesce(v_charge->>'label', '')));
    v_amount := case
      when coalesce(v_charge->>'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (v_charge->>'amount')::numeric
      else 0
    end;
    if v_amount > 0
       and not (v_label like '%RECARGO%' and (v_label like '%MORA%' or v_label like '%TARDANZA%')) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

create index if not exists payments_cloud_user_client_retention_latest_idx
  on public.payments_cloud (
    user_id,
    (data->>'clientId'),
    (data->>'dateApplied') desc,
    (data->>'createdAt') desc,
    id desc
  )
  where public.payment_has_other_charges_retention(data);

create or replace function public.refresh_other_charges_retention_checkpoint(
  p_user_id uuid,
  p_client_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id text;
  v_data jsonb;
begin
  if coalesce(p_client_id, '') = '' then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':other-charges-retention:' || p_client_id, 0)
  );

  select payment.id, payment.data
    into v_payment_id, v_data
  from public.payments_cloud payment
  where payment.user_id = p_user_id
    and payment.data->>'clientId' = p_client_id
    and public.payment_has_other_charges_retention(payment.data)
  order by
    payment.data->>'dateApplied' desc,
    payment.data->>'createdAt' desc,
    payment.id desc
  limit 1;

  if v_payment_id is null then
    delete from public.other_charges_retention_checkpoints_cloud
    where user_id = p_user_id and client_id = p_client_id;
    return;
  end if;

  insert into public.other_charges_retention_checkpoints_cloud (
    user_id,
    client_id,
    payment_id,
    date_applied,
    payment_created_at,
    retention_event,
    updated_at
  ) values (
    p_user_id,
    p_client_id,
    v_payment_id,
    coalesce(v_data->>'dateApplied', ''),
    coalesce(v_data->>'createdAt', ''),
    case
      when jsonb_typeof(v_data->'otherChargesRetentionEvent') = 'object'
        then v_data->'otherChargesRetentionEvent'
      else null
    end,
    now()
  )
  on conflict (user_id, client_id) do update
  set payment_id = excluded.payment_id,
      date_applied = excluded.date_applied,
      payment_created_at = excluded.payment_created_at,
      retention_event = excluded.retention_event,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.refresh_other_charges_retention_checkpoint(uuid, text) from public;

create or replace function public.sync_other_charges_retention_checkpoint_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_other_charges_retention_checkpoint(old.user_id, old.data->>'clientId');
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_other_charges_retention_checkpoint(new.user_id, new.data->>'clientId');
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_other_charges_retention_checkpoint_from_payment() from public;

-- Rellena todos los clientes existentes una sola vez antes de activar el trigger.
insert into public.other_charges_retention_checkpoints_cloud (
  user_id,
  client_id,
  payment_id,
  date_applied,
  payment_created_at,
  retention_event,
  updated_at
)
select distinct on (payment.user_id, payment.data->>'clientId')
  payment.user_id,
  payment.data->>'clientId',
  payment.id,
  coalesce(payment.data->>'dateApplied', ''),
  coalesce(payment.data->>'createdAt', ''),
  case
    when jsonb_typeof(payment.data->'otherChargesRetentionEvent') = 'object'
      then payment.data->'otherChargesRetentionEvent'
    else null
  end,
  now()
from public.payments_cloud payment
where nullif(payment.data->>'clientId', '') is not null
  and public.payment_has_other_charges_retention(payment.data)
order by
  payment.user_id,
  payment.data->>'clientId',
  payment.data->>'dateApplied' desc,
  payment.data->>'createdAt' desc,
  payment.id desc
on conflict (user_id, client_id) do update
set payment_id = excluded.payment_id,
    date_applied = excluded.date_applied,
    payment_created_at = excluded.payment_created_at,
    retention_event = excluded.retention_event,
    updated_at = excluded.updated_at;

drop trigger if exists payments_cloud_other_charges_retention_checkpoint
  on public.payments_cloud;
create trigger payments_cloud_other_charges_retention_checkpoint
after insert or update or delete on public.payments_cloud
for each row execute function public.sync_other_charges_retention_checkpoint_from_payment();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'other_charges_retention_checkpoints_cloud'
  ) then
    alter publication supabase_realtime add table public.other_charges_retention_checkpoints_cloud;
  end if;
end;
$$;

analyze public.other_charges_retention_checkpoints_cloud;
