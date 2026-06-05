-- Hotfix (2026-05-27)
-- Objetivo:
-- 1) Reducir conflictos por folio duplicado.
-- 2) Reforzar policy compartida para clients_daily_collection_promises_cloud.
-- 3) Dejar indices/funciones idempotentes.
--
-- Ejecutar en Supabase SQL Editor con rol postgres.

begin;

-- ---------- Helpers de owner compartido ----------
create or replace function public.current_data_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(up.data_owner_user_id, up.id)
  from public.user_profiles up
  where up.id = auth.uid()
  limit 1;
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

-- ---------- Reaplicar policy clave (promesas diarias) ----------
drop policy if exists "clients_daily_collection_promises_shared_owner_access"
  on public.clients_daily_collection_promises_cloud;

create policy "clients_daily_collection_promises_shared_owner_access"
  on public.clients_daily_collection_promises_cloud
  for all to authenticated
  using (public.can_access_owner_data(user_id))
  with check (public.can_access_owner_data(user_id));

-- ---------- Helper de folio ----------
create or replace function public.extract_payment_folio(reference_text text)
returns text
language sql
immutable
as $$
  select nullif(
    upper(
      regexp_replace(
        coalesce(
          substring(reference_text from 'FOLIO\s*:\s*([^\s|]+)'),
          ''
        ),
        '\s+',
        '',
        'g'
      )
    ),
    ''
  );
$$;

-- ---------- Limpieza de duplicados existentes ----------
-- payments_cloud (por user_id + folio extraido de reference)
with ranked as (
  select
    user_id,
    id,
    row_number() over (
      partition by user_id, public.extract_payment_folio(data->>'reference')
      order by updated_at desc, created_at desc, id desc
    ) as rn
  from public.payments_cloud
  where public.extract_payment_folio(data->>'reference') is not null
)
delete from public.payments_cloud p
using ranked r
where p.user_id = r.user_id
  and p.id = r.id
  and r.rn > 1;

-- pending_bank_items_cloud (por user_id + folio normalizado)
with ranked as (
  select
    user_id,
    id,
    row_number() over (
      partition by user_id, upper(regexp_replace(coalesce(data->>'folio', ''), '\s+', '', 'g'))
      order by updated_at desc, created_at desc, id desc
    ) as rn
  from public.pending_bank_items_cloud
  where coalesce(data->>'folio', '') <> ''
)
delete from public.pending_bank_items_cloud p
using ranked r
where p.user_id = r.user_id
  and p.id = r.id
  and r.rn > 1;

-- pending_card_items_cloud (por user_id + folio normalizado)
with ranked as (
  select
    user_id,
    id,
    row_number() over (
      partition by user_id, upper(regexp_replace(coalesce(data->>'folio', ''), '\s+', '', 'g'))
      order by updated_at desc, created_at desc, id desc
    ) as rn
  from public.pending_card_items_cloud
  where coalesce(data->>'folio', '') <> ''
)
delete from public.pending_card_items_cloud p
using ranked r
where p.user_id = r.user_id
  and p.id = r.id
  and r.rn > 1;

-- ---------- Blindaje de unicidad ----------
create unique index if not exists payments_cloud_user_folio_uq
on public.payments_cloud (
  user_id,
  public.extract_payment_folio(data->>'reference')
)
where public.extract_payment_folio(data->>'reference') is not null;

create unique index if not exists pending_bank_items_cloud_user_folio_uq
on public.pending_bank_items_cloud (
  user_id,
  upper(regexp_replace(coalesce(data->>'folio', ''), '\s+', '', 'g'))
)
where coalesce(data->>'folio', '') <> '';

create unique index if not exists pending_card_items_cloud_user_folio_uq
on public.pending_card_items_cloud (
  user_id,
  upper(regexp_replace(coalesce(data->>'folio', ''), '\s+', '', 'g'))
)
where coalesce(data->>'folio', '') <> '';

commit;

-- Verificacion recomendada:
-- select 1;
-- select policyname from pg_policies where schemaname='public' and tablename='clients_daily_collection_promises_cloud';
