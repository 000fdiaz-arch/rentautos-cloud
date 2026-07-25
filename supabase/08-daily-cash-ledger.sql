-- Rentautos: modulo de caja diaria (sucursal unica)
-- Requiere haber ejecutado al menos:
--   1) 01-auth-roles.sql
--   2) 07-shared-data-owner-rls.sql (o equivalente con can_access_owner_data)

create extension if not exists "pgcrypto";

-- Helpers de acceso compartido por owner (defensivo)
create or replace function public.current_data_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select coalesce(up.data_owner_user_id, up.id)
      from public.user_profiles up
      where up.id = auth.uid()
      limit 1
    ),
    auth.uid()
  );
$$;

create or replace function public.can_access_owner_data(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_user_id = auth.uid()
    or public.has_role('admin')
    or target_user_id = public.current_data_owner_user_id();
$$;

-- Tipos del modulo de caja
do $$
begin
  if not exists (select 1 from pg_type where typname = 'cash_movement_type') then
    create type public.cash_movement_type as enum ('income', 'expense');
  end if;

  if not exists (select 1 from pg_type where typname = 'cash_adjustment_type') then
    create type public.cash_adjustment_type as enum ('income_adjustment', 'expense_adjustment');
  end if;

  if not exists (select 1 from pg_type where typname = 'cash_day_status') then
    create type public.cash_day_status as enum ('open', 'closed');
  end if;
end $$;

create table if not exists public.cash_day_openings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  opening_date date not null,
  opening_balance numeric(14,2) not null check (opening_balance >= 0),
  source text not null check (source in ('manual_seed', 'carry_over')),
  source_closing_id uuid,
  note text,
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, opening_date)
);

create table if not exists public.cash_day_movements (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  opening_date date not null,
  movement_type public.cash_movement_type not null,
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  description text,
  reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_day_adjustments (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  opening_date date not null,
  adjustment_type public.cash_adjustment_type not null,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null,
  reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_day_closings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  opening_date date not null,
  status public.cash_day_status not null default 'open',
  expected_balance numeric(14,2),
  counted_balance numeric(14,2),
  difference_balance numeric(14,2),
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  close_note text,
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopen_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, opening_date)
);

create table if not exists public.cash_audit_log (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  opening_date date,
  table_name text not null,
  record_id text,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cash_day_openings_owner_date_idx
  on public.cash_day_openings (owner_user_id, opening_date);

create index if not exists cash_day_movements_owner_date_idx
  on public.cash_day_movements (owner_user_id, opening_date);

create index if not exists cash_day_adjustments_owner_date_idx
  on public.cash_day_adjustments (owner_user_id, opening_date);

create index if not exists cash_day_closings_owner_date_idx
  on public.cash_day_closings (owner_user_id, opening_date);

create index if not exists cash_audit_log_owner_date_idx
  on public.cash_audit_log (owner_user_id, opening_date, created_at desc);

alter table public.cash_day_openings enable row level security;
alter table public.cash_day_movements enable row level security;
alter table public.cash_day_adjustments enable row level security;
alter table public.cash_day_closings enable row level security;
alter table public.cash_audit_log enable row level security;

create or replace function public.set_cash_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_cash_day_closed(p_owner_user_id uuid, p_opening_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cash_day_closings c
    where c.owner_user_id = p_owner_user_id
      and c.opening_date = p_opening_date
      and c.status = 'closed'
  );
$$;

create or replace function public.enforce_cash_open_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_opening_date date;
begin
  v_owner_user_id := coalesce(new.owner_user_id, old.owner_user_id);
  v_opening_date := coalesce(new.opening_date, old.opening_date);

  if public.is_cash_day_closed(v_owner_user_id, v_opening_date) then
    raise exception 'La caja de % esta cerrada y no permite cambios.', v_opening_date;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.prevent_opening_balance_update()
returns trigger
language plpgsql
as $$
begin
  if old.opening_balance is distinct from new.opening_balance then
    raise exception 'El saldo inicial es inmutable. Usa ajustes contables.';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_opening_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'No se puede eliminar la apertura de caja diaria.';
end;
$$;

create or replace function public.log_cash_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_date date;
  v_record_id text;
begin
  if tg_op = 'DELETE' then
    v_owner := old.owner_user_id;
    v_date := old.opening_date;
    v_record_id := old.id::text;

    insert into public.cash_audit_log (
      owner_user_id, opening_date, table_name, record_id, action, actor_user_id, old_data, new_data
    ) values (
      v_owner, v_date, tg_table_name, v_record_id, tg_op, auth.uid(), to_jsonb(old), null
    );

    return old;
  end if;

  v_owner := new.owner_user_id;
  v_date := new.opening_date;
  v_record_id := new.id::text;

  insert into public.cash_audit_log (
    owner_user_id, opening_date, table_name, record_id, action, actor_user_id, old_data, new_data
  ) values (
    v_owner, v_date, tg_table_name, v_record_id, tg_op, auth.uid(), to_jsonb(old), to_jsonb(new)
  );

  return new;
end;
$$;

create or replace function public.cash_day_totals(
  p_owner_user_id uuid,
  p_opening_date date
)
returns table (
  opening_balance numeric,
  income_total numeric,
  expense_total numeric,
  adjustment_income_total numeric,
  adjustment_expense_total numeric,
  expected_balance numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with opening as (
    select o.opening_balance
    from public.cash_day_openings o
    where o.owner_user_id = p_owner_user_id
      and o.opening_date = p_opening_date
  ),
  movements as (
    select
      coalesce(sum(case when movement_type = 'income' then amount else 0 end), 0) as income_total,
      coalesce(sum(case when movement_type = 'expense' then amount else 0 end), 0) as expense_total
    from public.cash_day_movements m
    where m.owner_user_id = p_owner_user_id
      and m.opening_date = p_opening_date
  ),
  adjustments as (
    select
      coalesce(sum(case when adjustment_type = 'income_adjustment' then amount else 0 end), 0) as adjustment_income_total,
      coalesce(sum(case when adjustment_type = 'expense_adjustment' then amount else 0 end), 0) as adjustment_expense_total
    from public.cash_day_adjustments a
    where a.owner_user_id = p_owner_user_id
      and a.opening_date = p_opening_date
  )
  select
    o.opening_balance,
    m.income_total,
    m.expense_total,
    a.adjustment_income_total,
    a.adjustment_expense_total,
    (o.opening_balance + m.income_total + a.adjustment_income_total - m.expense_total - a.adjustment_expense_total)
  from opening o
  cross join movements m
  cross join adjustments a;
$$;

create or replace function public.open_cash_day(
  p_opening_date date default ((now() at time zone 'America/Panama')::date),
  p_seed_opening_balance numeric default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid := public.current_data_owner_user_id();
  v_existing_id uuid;
  v_previous_date date := (p_opening_date - 1);
  v_previous_status public.cash_day_status;
  v_previous_counted numeric(14,2);
  v_previous_expected numeric(14,2);
  v_opening_balance numeric(14,2);
  v_source text;
begin
  if not public.has_role('admin') then
    raise exception 'Solo admin puede abrir caja diaria.';
  end if;

  select id
  into v_existing_id
  from public.cash_day_openings o
  where o.owner_user_id = v_owner_user_id
    and o.opening_date = p_opening_date
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select c.status, c.counted_balance, c.expected_balance
  into v_previous_status, v_previous_counted, v_previous_expected
  from public.cash_day_closings c
  where c.owner_user_id = v_owner_user_id
    and c.opening_date = v_previous_date
  limit 1;

  if v_previous_status = 'closed' and coalesce(v_previous_counted, v_previous_expected) is not null then
    v_opening_balance := coalesce(v_previous_counted, v_previous_expected);
    v_source := 'carry_over';
  elsif p_seed_opening_balance is not null then
    v_opening_balance := p_seed_opening_balance;
    v_source := 'manual_seed';
  else
    raise exception 'No existe cierre previo para % y no se envio saldo inicial manual.', p_opening_date;
  end if;

  insert into public.cash_day_openings (
    owner_user_id, opening_date, opening_balance, source, note, opened_by
  ) values (
    v_owner_user_id, p_opening_date, v_opening_balance, v_source, p_note, auth.uid()
  )
  returning id into v_existing_id;

  insert into public.cash_day_closings (
    owner_user_id, opening_date, status, expected_balance
  ) values (
    v_owner_user_id, p_opening_date, 'open', v_opening_balance
  )
  on conflict (owner_user_id, opening_date) do nothing;

  -- Hereda el conteo fisico del dia anterior (si existe tabla de conteo y registros previos).
  if to_regclass('public.cash_day_counts') is not null then
    insert into public.cash_day_counts (
      owner_user_id,
      opening_date,
      denomination_type,
      denomination_value,
      qty,
      created_by
    )
    select
      v_owner_user_id,
      p_opening_date,
      prev.denomination_type,
      prev.denomination_value,
      prev.qty,
      auth.uid()
    from public.cash_day_counts prev
    where prev.owner_user_id = v_owner_user_id
      and prev.opening_date = v_previous_date
      and prev.qty > 0
    on conflict (owner_user_id, opening_date, denomination_type, denomination_value)
    do nothing;
  end if;

  return v_existing_id;
end;
$$;

create or replace function public.close_cash_day(
  p_opening_date date,
  p_counted_balance numeric,
  p_close_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid := public.current_data_owner_user_id();
  v_closing_id uuid;
  v_totals record;
begin
  if not public.has_role('admin') then
    raise exception 'Solo admin puede cerrar caja diaria.';
  end if;

  if p_counted_balance is null or p_counted_balance < 0 then
    raise exception 'El efectivo contado debe ser >= 0.';
  end if;

  perform 1
  from public.cash_day_openings o
  where o.owner_user_id = v_owner_user_id
    and o.opening_date = p_opening_date;

  if not found then
    raise exception 'No existe apertura para la fecha %.', p_opening_date;
  end if;

  select *
  into v_totals
  from public.cash_day_totals(v_owner_user_id, p_opening_date);

  insert into public.cash_day_closings (
    owner_user_id,
    opening_date,
    status,
    expected_balance,
    counted_balance,
    difference_balance,
    closed_by,
    closed_at,
    close_note
  ) values (
    v_owner_user_id,
    p_opening_date,
    'closed',
    v_totals.expected_balance,
    p_counted_balance,
    (p_counted_balance - v_totals.expected_balance),
    auth.uid(),
    now(),
    p_close_note
  )
  on conflict (owner_user_id, opening_date)
  do update set
    status = 'closed',
    expected_balance = excluded.expected_balance,
    counted_balance = excluded.counted_balance,
    difference_balance = excluded.difference_balance,
    closed_by = excluded.closed_by,
    closed_at = excluded.closed_at,
    close_note = excluded.close_note,
    updated_at = now()
  returning id into v_closing_id;

  return v_closing_id;
end;
$$;

create or replace function public.reopen_cash_day(
  p_opening_date date,
  p_reopen_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid := public.current_data_owner_user_id();
  v_closing_id uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Solo admin puede reabrir caja diaria.';
  end if;

  if coalesce(trim(p_reopen_note), '') = '' then
    raise exception 'Debes indicar motivo para reabrir caja.';
  end if;

  update public.cash_day_closings
  set
    status = 'open',
    reopened_by = auth.uid(),
    reopened_at = now(),
    reopen_note = p_reopen_note,
    updated_at = now()
  where owner_user_id = v_owner_user_id
    and opening_date = p_opening_date
    and status = 'closed'
  returning id into v_closing_id;

  if v_closing_id is null then
    raise exception 'La caja de % no esta cerrada.', p_opening_date;
  end if;

  return v_closing_id;
end;
$$;

-- Triggers

drop trigger if exists cash_day_openings_set_updated_at on public.cash_day_openings;
create trigger cash_day_openings_set_updated_at
before update on public.cash_day_openings
for each row execute function public.set_cash_updated_at();

drop trigger if exists cash_day_movements_set_updated_at on public.cash_day_movements;
create trigger cash_day_movements_set_updated_at
before update on public.cash_day_movements
for each row execute function public.set_cash_updated_at();

drop trigger if exists cash_day_adjustments_set_updated_at on public.cash_day_adjustments;
create trigger cash_day_adjustments_set_updated_at
before update on public.cash_day_adjustments
for each row execute function public.set_cash_updated_at();

drop trigger if exists cash_day_closings_set_updated_at on public.cash_day_closings;
create trigger cash_day_closings_set_updated_at
before update on public.cash_day_closings
for each row execute function public.set_cash_updated_at();

drop trigger if exists cash_day_openings_immutable_balance on public.cash_day_openings;
create trigger cash_day_openings_immutable_balance
before update on public.cash_day_openings
for each row execute function public.prevent_opening_balance_update();

drop trigger if exists cash_day_openings_no_delete on public.cash_day_openings;
create trigger cash_day_openings_no_delete
before delete on public.cash_day_openings
for each row execute function public.prevent_opening_delete();

drop trigger if exists cash_day_movements_require_open on public.cash_day_movements;
create trigger cash_day_movements_require_open
before insert or update or delete on public.cash_day_movements
for each row execute function public.enforce_cash_open_day();

drop trigger if exists cash_day_adjustments_require_open on public.cash_day_adjustments;
create trigger cash_day_adjustments_require_open
before insert or update or delete on public.cash_day_adjustments
for each row execute function public.enforce_cash_open_day();

drop trigger if exists cash_day_openings_audit_log on public.cash_day_openings;
create trigger cash_day_openings_audit_log
after insert or update or delete on public.cash_day_openings
for each row execute function public.log_cash_audit();

drop trigger if exists cash_day_movements_audit_log on public.cash_day_movements;
create trigger cash_day_movements_audit_log
after insert or update or delete on public.cash_day_movements
for each row execute function public.log_cash_audit();

drop trigger if exists cash_day_adjustments_audit_log on public.cash_day_adjustments;
create trigger cash_day_adjustments_audit_log
after insert or update or delete on public.cash_day_adjustments
for each row execute function public.log_cash_audit();

drop trigger if exists cash_day_closings_audit_log on public.cash_day_closings;
create trigger cash_day_closings_audit_log
after insert or update or delete on public.cash_day_closings
for each row execute function public.log_cash_audit();

-- RLS

drop policy if exists "cash_day_openings_owner_access" on public.cash_day_openings;
create policy "cash_day_openings_owner_access"
on public.cash_day_openings
for all
to authenticated
using (public.can_access_owner_data(owner_user_id))
with check (public.can_access_owner_data(owner_user_id));

drop policy if exists "cash_day_movements_owner_access" on public.cash_day_movements;
create policy "cash_day_movements_owner_access"
on public.cash_day_movements
for all
to authenticated
using (public.can_access_owner_data(owner_user_id))
with check (public.can_access_owner_data(owner_user_id));

drop policy if exists "cash_day_adjustments_owner_access" on public.cash_day_adjustments;
create policy "cash_day_adjustments_owner_access"
on public.cash_day_adjustments
for all
to authenticated
using (public.can_access_owner_data(owner_user_id))
with check (public.can_access_owner_data(owner_user_id));

drop policy if exists "cash_day_closings_owner_access" on public.cash_day_closings;
create policy "cash_day_closings_owner_access"
on public.cash_day_closings
for all
to authenticated
using (public.can_access_owner_data(owner_user_id))
with check (public.can_access_owner_data(owner_user_id));

drop policy if exists "cash_audit_log_owner_access" on public.cash_audit_log;
create policy "cash_audit_log_owner_access"
on public.cash_audit_log
for select
to authenticated
using (public.can_access_owner_data(owner_user_id));

-- Vista resumen para reportes diario/semanal/mensual
create or replace view public.cash_day_summary_vw
with (security_invoker = true) as
select
  o.owner_user_id,
  o.opening_date,
  o.opening_balance,
  coalesce(m.income_total, 0) as income_total,
  coalesce(m.expense_total, 0) as expense_total,
  coalesce(a.adjustment_income_total, 0) as adjustment_income_total,
  coalesce(a.adjustment_expense_total, 0) as adjustment_expense_total,
  (o.opening_balance + coalesce(m.income_total, 0) + coalesce(a.adjustment_income_total, 0)
   - coalesce(m.expense_total, 0) - coalesce(a.adjustment_expense_total, 0)) as expected_balance,
  c.counted_balance,
  c.difference_balance,
  c.status,
  c.closed_at
from public.cash_day_openings o
left join lateral (
  select
    sum(case when m.movement_type = 'income' then m.amount else 0 end) as income_total,
    sum(case when m.movement_type = 'expense' then m.amount else 0 end) as expense_total
  from public.cash_day_movements m
  where m.owner_user_id = o.owner_user_id
    and m.opening_date = o.opening_date
) m on true
left join lateral (
  select
    sum(case when a.adjustment_type = 'income_adjustment' then a.amount else 0 end) as adjustment_income_total,
    sum(case when a.adjustment_type = 'expense_adjustment' then a.amount else 0 end) as adjustment_expense_total
  from public.cash_day_adjustments a
  where a.owner_user_id = o.owner_user_id
    and a.opening_date = o.opening_date
) a on true
left join public.cash_day_closings c
  on c.owner_user_id = o.owner_user_id and c.opening_date = o.opening_date;

comment on function public.open_cash_day(date, numeric, text)
is 'Abre una caja diaria: usa cierre anterior (carry_over) o semilla manual (solo arranque).';

comment on function public.close_cash_day(date, numeric, text)
is 'Cierra caja diaria calculando saldo esperado y diferencia contra efectivo contado.';
