-- Rentautos: checklist de contacto atomico y confirmado por Supabase.
-- Conserva street_management_items_cloud como respaldo y migra los ganchos existentes.

create table if not exists public.daily_contact_attempts_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  contact_date date not null,
  shift text not null check (shift in ('morning', 'afternoon', 'night')),
  result text not null check (result in ('contacted', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id, contact_date, shift)
);

create index if not exists daily_contact_attempts_cloud_user_date_idx
  on public.daily_contact_attempts_cloud (user_id, contact_date, client_id);

create or replace function public.set_daily_contact_attempt_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists daily_contact_attempt_updated_at on public.daily_contact_attempts_cloud;
create trigger daily_contact_attempt_updated_at
before update on public.daily_contact_attempts_cloud
for each row execute function public.set_daily_contact_attempt_updated_at();

alter table public.daily_contact_attempts_cloud enable row level security;

drop policy if exists "daily_contact_attempts_receivables_read" on public.daily_contact_attempts_cloud;
create policy "daily_contact_attempts_receivables_read"
on public.daily_contact_attempts_cloud
for select
to authenticated
using ((select public.can_view_owner_screen(user_id, 'receivables')));

drop policy if exists "daily_contact_attempts_receivables_insert" on public.daily_contact_attempts_cloud;
create policy "daily_contact_attempts_receivables_insert"
on public.daily_contact_attempts_cloud
for insert
to authenticated
with check ((select public.can_edit_owner_screen(user_id, 'receivables')));

drop policy if exists "daily_contact_attempts_receivables_update" on public.daily_contact_attempts_cloud;
create policy "daily_contact_attempts_receivables_update"
on public.daily_contact_attempts_cloud
for update
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'receivables')))
with check ((select public.can_edit_owner_screen(user_id, 'receivables')));

drop policy if exists "daily_contact_attempts_receivables_delete" on public.daily_contact_attempts_cloud;
create policy "daily_contact_attempts_receivables_delete"
on public.daily_contact_attempts_cloud
for delete
to authenticated
using ((select public.can_edit_owner_screen(user_id, 'receivables')));

grant select, insert, update, delete on public.daily_contact_attempts_cloud to authenticated;

insert into public.daily_contact_attempts_cloud (
  user_id,
  client_id,
  contact_date,
  shift,
  result,
  created_at,
  updated_at
)
select
  management.user_id,
  management.client_id,
  to_date(contact_day.date_key, 'YYYY-MM-DD'),
  contact_shift.shift_key,
  'contacted',
  management.created_at,
  management.updated_at
from public.street_management_items_cloud as management
cross join lateral jsonb_each(
  case
    when jsonb_typeof(management.data -> 'dailyContactAttemptsByDate') = 'object'
      then management.data -> 'dailyContactAttemptsByDate'
    else '{}'::jsonb
  end
) as contact_day(date_key, shifts)
cross join lateral jsonb_each(
  case
    when jsonb_typeof(contact_day.shifts) = 'object' then contact_day.shifts
    else '{}'::jsonb
  end
) as contact_shift(shift_key, attempt)
where contact_day.date_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  and to_char(to_date(contact_day.date_key, 'YYYY-MM-DD'), 'YYYY-MM-DD') = contact_day.date_key
  and contact_shift.shift_key in ('morning', 'afternoon', 'night')
  and jsonb_typeof(contact_shift.attempt) = 'object'
  and contact_shift.attempt ->> 'result' = 'contacted'
on conflict (user_id, client_id, contact_date, shift) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'daily_contact_attempts_cloud'
  )
  then
    alter publication supabase_realtime add table public.daily_contact_attempts_cloud;
  end if;
end $$;

