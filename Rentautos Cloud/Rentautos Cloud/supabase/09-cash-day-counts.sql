-- Rentautos: conteo fisico de caja por denominacion
-- Ejecutar despues de 08-daily-cash-ledger.sql

create table if not exists public.cash_day_counts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  opening_date date not null,
  denomination_type text not null check (denomination_type in ('coin', 'bill')),
  denomination_value numeric(14,2) not null check (denomination_value > 0),
  qty integer not null check (qty >= 0),
  total_amount numeric(14,2) generated always as (denomination_value * qty) stored,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, opening_date, denomination_type, denomination_value)
);

create index if not exists cash_day_counts_owner_date_idx
  on public.cash_day_counts (owner_user_id, opening_date);

alter table public.cash_day_counts enable row level security;

drop policy if exists "cash_day_counts_owner_access" on public.cash_day_counts;
create policy "cash_day_counts_owner_access"
on public.cash_day_counts
for all
to authenticated
using (public.can_access_owner_data(owner_user_id))
with check (public.can_access_owner_data(owner_user_id));

-- Bloquea cambios cuando la caja del dia esta cerrada

drop trigger if exists cash_day_counts_require_open on public.cash_day_counts;
create trigger cash_day_counts_require_open
before insert or update or delete on public.cash_day_counts
for each row execute function public.enforce_cash_open_day();

-- Updated_at

drop trigger if exists cash_day_counts_set_updated_at on public.cash_day_counts;
create trigger cash_day_counts_set_updated_at
before update on public.cash_day_counts
for each row execute function public.set_cash_updated_at();

-- Auditoria

drop trigger if exists cash_day_counts_audit_log on public.cash_day_counts;
create trigger cash_day_counts_audit_log
after insert or update or delete on public.cash_day_counts
for each row execute function public.log_cash_audit();
