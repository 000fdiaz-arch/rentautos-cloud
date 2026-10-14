-- Exposes only whether an unguessable shared seller portal identifier is active.
begin;

create or replace function public.is_seller_lead_portal_available(p_portal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.seller_lead_portals
    where id = p_portal_id and enabled
  )
$$;

revoke all on function public.is_seller_lead_portal_available(uuid) from public;
grant execute on function public.is_seller_lead_portal_available(uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
