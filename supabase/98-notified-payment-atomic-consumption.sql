-- Consume Pago notificado en la misma transaccion que registra el pago bancario.
-- La lapida impide que una sesion con una copia vieja vuelva a crear el aviso.

create table if not exists public.notified_payment_tombstones (
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_id text not null,
  consumed_by_payment_id text,
  reason text not null default 'deleted',
  consumed_at timestamptz not null default clock_timestamp(),
  primary key (user_id, notice_id)
);

create unique index if not exists notified_payment_tombstones_payment_uq
  on public.notified_payment_tombstones(user_id, consumed_by_payment_id)
  where consumed_by_payment_id is not null;

alter table public.notified_payment_tombstones enable row level security;
revoke all on public.notified_payment_tombstones from public, anon, authenticated;

create or replace function public.notified_payment_matches_bank_payment(
  p_notice jsonb,
  p_payment jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_notice_amount numeric;
  v_payment_amount numeric;
  v_notice_created_at timestamptz;
  v_payment_created_at timestamptz;
  v_notice_date date;
  v_payment_date date;
begin
  if coalesce(p_payment->>'paymentMethod', '') not in (
    'ACH Express',
    'Deposito Bancario',
    'Transferencia Bancaria'
  ) then return false; end if;
  if coalesce(p_payment->>'paymentContext', 'regular') <> 'regular' then return false; end if;
  if nullif(p_notice->>'clientId', '') is null
    or (p_notice->>'clientId') is distinct from (p_payment->>'clientId') then
    return false;
  end if;

  v_notice_amount := (p_notice->>'amount')::numeric;
  v_payment_amount := (p_payment->>'amountReceived')::numeric;
  v_notice_created_at := (p_notice->>'createdAt')::timestamptz;
  v_payment_created_at := (p_payment->>'createdAt')::timestamptz;
  v_notice_date := (v_notice_created_at at time zone 'America/Panama')::date;
  v_payment_date := coalesce(
    nullif(p_payment->>'fundsReceivedDate', ''),
    nullif(p_payment->>'dateApplied', '')
  )::date;

  return abs(round(v_notice_amount, 2) - round(v_payment_amount, 2)) <= 0.02
    and abs(v_payment_date - v_notice_date) <= 7
    and v_payment_created_at >= v_notice_created_at;
exception when others then
  return false;
end;
$$;

create or replace function public.consume_notified_payment_for_bank_payment(
  p_user_id uuid,
  p_payment_id text,
  p_payment jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice_id text;
  v_claimed integer;
begin
  if p_user_id is null or nullif(p_payment_id, '') is null then return null; end if;
  if exists (
    select 1
    from public.notified_payment_tombstones t
    where t.user_id = p_user_id
      and t.consumed_by_payment_id = p_payment_id
  ) then return null; end if;

  select n.id into v_notice_id
  from public.notified_payments_cloud n
  where n.user_id = p_user_id
    and coalesce(n.data->>'routeReportId', '') = ''
    and public.notified_payment_matches_bank_payment(n.data, p_payment)
  order by n.created_at, n.id
  limit 1
  for update skip locked;

  if v_notice_id is null then return null; end if;

  insert into public.notified_payment_tombstones(
    user_id,
    notice_id,
    consumed_by_payment_id,
    reason
  ) values (
    p_user_id,
    v_notice_id,
    p_payment_id,
    'bank_payment_applied'
  )
  on conflict do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then return null; end if;

  delete from public.notified_payments_cloud
  where user_id = p_user_id and id = v_notice_id;
  return v_notice_id;
end;
$$;

create or replace function public.consume_notified_payment_after_payment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.consume_notified_payment_for_bank_payment(new.user_id, new.id, new.data);
  return new;
end;
$$;

drop trigger if exists consume_notified_payment_after_payment_insert on public.payments_cloud;
create trigger consume_notified_payment_after_payment_insert
after insert on public.payments_cloud
for each row execute function public.consume_notified_payment_after_payment_insert();

create or replace function public.record_notified_payment_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notified_payment_tombstones(user_id, notice_id, reason)
  values(old.user_id, old.id, 'deleted')
  on conflict (user_id, notice_id) do nothing;
  return old;
end;
$$;

drop trigger if exists record_notified_payment_tombstone on public.notified_payments_cloud;
create trigger record_notified_payment_tombstone
after delete on public.notified_payments_cloud
for each row execute function public.record_notified_payment_tombstone();

create or replace function public.block_consumed_notified_payment_restore()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id text;
  v_claimed integer;
begin
  if exists (
    select 1
    from public.notified_payment_tombstones t
    where t.user_id = new.user_id and t.notice_id = new.id
  ) then return null; end if;

  if tg_op = 'INSERT' then
    select p.id into v_payment_id
    from public.payments_cloud p
    where p.user_id = new.user_id
      and public.notified_payment_matches_bank_payment(new.data, p.data)
      and not exists (
        select 1
        from public.notified_payment_tombstones t
        where t.user_id = p.user_id
          and t.consumed_by_payment_id = p.id
      )
    order by (p.data->>'createdAt')::timestamptz, p.id
    limit 1
    for update;

    if v_payment_id is not null then
      insert into public.notified_payment_tombstones(
        user_id,
        notice_id,
        consumed_by_payment_id,
        reason
      ) values (
        new.user_id,
        new.id,
        v_payment_id,
        'bank_payment_already_applied'
      )
      on conflict do nothing;
      get diagnostics v_claimed = row_count;
      if v_claimed > 0 then return null; end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists block_consumed_notified_payment_restore on public.notified_payments_cloud;
create trigger block_consumed_notified_payment_restore
before insert or update on public.notified_payments_cloud
for each row execute function public.block_consumed_notified_payment_restore();

revoke all on function public.notified_payment_matches_bank_payment(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.consume_notified_payment_for_bank_payment(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.consume_notified_payment_after_payment_insert() from public, anon, authenticated;
revoke all on function public.record_notified_payment_tombstone() from public, anon, authenticated;
revoke all on function public.block_consumed_notified_payment_restore() from public, anon, authenticated;

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notified_payments_cloud'
    ) then
    alter publication supabase_realtime add table public.notified_payments_cloud;
  end if;
end;
$publication$;

notify pgrst, 'reload schema';
