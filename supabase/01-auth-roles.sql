-- Rentautos: Auth + roles base (admin, operador, lectura)
-- Ejecuta este script en Supabase SQL Editor.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'app_role'
  ) then
    create type public.app_role as enum ('admin', 'operador', 'lectura');
  end if;
end $$;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  role public.app_role not null default 'lectura',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, role)
  values (new.id, new.email, 'lectura')
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

-- Helper para revisar rol del usuario actual
create or replace function public.current_user_role()
returns public.app_role
language sql
stable
as $$
  select role
  from public.user_profiles
  where id = auth.uid();
$$;

create or replace function public.has_role(required_role public.app_role)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and role = required_role
  );
$$;

-- Politicas de user_profiles
drop policy if exists "profiles_select_own_or_admin" on public.user_profiles;
create policy "profiles_select_own_or_admin"
on public.user_profiles
for select
to authenticated
using (id = auth.uid() or public.has_role('admin'));

drop policy if exists "profiles_update_own_or_admin" on public.user_profiles;
create policy "profiles_update_own_or_admin"
on public.user_profiles
for update
to authenticated
using (id = auth.uid() or public.has_role('admin'))
with check (id = auth.uid() or public.has_role('admin'));

drop policy if exists "profiles_admin_insert" on public.user_profiles;
create policy "profiles_admin_insert"
on public.user_profiles
for insert
to authenticated
with check (public.has_role('admin'));

drop policy if exists "profiles_admin_delete" on public.user_profiles;
create policy "profiles_admin_delete"
on public.user_profiles
for delete
to authenticated
using (public.has_role('admin'));

-- Para promover un usuario a admin (ejecutar manualmente una vez):
-- update public.user_profiles set role = 'admin' where email = 'tu-correo@empresa.com';
