-- Attribution and repeat history for the shared seller consultation portal.
begin;
set local lock_timeout = '5s';

create table if not exists public.seller_lead_consultations (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references public.seller_lead_portals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cedula text not null,
  cedula_key text not null,
  seller_name text not null,
  consultation_kind text not null check (consultation_kind in ('original', 'follow_up')),
  consulted_at timestamptz not null default now(),
  constraint seller_lead_consultations_cedula_check check (
    cedula ~ '^[0-9-]{4,32}$' and cedula_key ~ '^[0-9]{4,32}$'
  ),
  constraint seller_lead_consultations_seller_name_check check (
    char_length(btrim(seller_name)) between 3 and 80
  )
);

create unique index if not exists seller_lead_consultations_original_uidx
  on public.seller_lead_consultations (user_id, cedula_key)
  where consultation_kind = 'original';

create index if not exists seller_lead_consultations_user_recent_idx
  on public.seller_lead_consultations (user_id, consulted_at desc, id desc);

alter table public.seller_lead_consultations enable row level security;
revoke all on public.seller_lead_consultations from anon;
grant select on public.seller_lead_consultations to authenticated;

drop policy if exists seller_lead_consultations_owner_read on public.seller_lead_consultations;
create policy seller_lead_consultations_owner_read
  on public.seller_lead_consultations
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.lookup_seller_lead_attributed(
  p_portal_id uuid,
  p_cedula text,
  p_seller_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  target_cedula_key text;
  normalized_cedula text;
  normalized_seller_name text;
  already_consulted boolean;
  consultation_count integer;
  public_result jsonb;
begin
  select user_id into owner_id
  from public.seller_lead_portals
  where id = p_portal_id and enabled;
  if not found then raise exception 'PORTAL_UNAVAILABLE'; end if;

  perform public.check_seller_lead_portal_limit(p_portal_id, 'lookup');

  normalized_cedula := upper(btrim(coalesce(p_cedula, '')));
  target_cedula_key := public.seller_lead_cedula_key(normalized_cedula);
  if normalized_cedula !~ '^[0-9-]{4,32}$' or length(target_cedula_key) < 4 then
    raise exception 'Cedula no valida';
  end if;

  normalized_seller_name := regexp_replace(btrim(coalesce(p_seller_name, '')), '\s+', ' ', 'g');
  if char_length(normalized_seller_name) < 3 or char_length(normalized_seller_name) > 80 then
    raise exception 'Vendedor no valido';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':' || target_cedula_key, 0));

  select exists (
    select 1
    from public.seller_lead_consultations consultations
    where consultations.user_id = owner_id and consultations.cedula_key = target_cedula_key
      and consultations.consultation_kind = 'original'
  ) into already_consulted;

  insert into public.seller_lead_consultations (
    portal_id, user_id, cedula, cedula_key, seller_name, consultation_kind
  ) values (
    p_portal_id, owner_id, normalized_cedula, target_cedula_key, normalized_seller_name,
    case when already_consulted then 'follow_up' else 'original' end
  );

  select count(*)::integer into consultation_count
  from public.seller_lead_consultations consultations
  where consultations.user_id = owner_id and consultations.cedula_key = target_cedula_key;

  public_result := public.seller_lead_public_result(owner_id, target_cedula_key);
  return public_result || jsonb_build_object(
    'alreadyConsulted', already_consulted,
    'consultationCount', consultation_count
  );
end;
$$;

revoke all on function public.lookup_seller_lead_attributed(uuid, text, text) from public;
grant execute on function public.lookup_seller_lead_attributed(uuid, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
