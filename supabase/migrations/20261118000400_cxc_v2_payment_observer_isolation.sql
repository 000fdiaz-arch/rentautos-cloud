-- Reconciliation is driven only by the 2.0 application. Legacy payment writes
-- must not execute any 2.0 observer or depend on its availability.
begin;
drop trigger if exists cxc_v2_sync_route_payment_report on public.payments_cloud;
drop trigger if exists cxc_v2_sync_visual_route_bank_payment on public.payments_cloud;
create table public.cxc_v2_payment_observations (
 user_id uuid not null references auth.users(id) on delete cascade,
 id text not null,
 data jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(user_id,id)
);
alter table public.cxc_v2_payment_observations enable row level security;
revoke all on public.cxc_v2_payment_observations from public, anon, authenticated;
create trigger cxc_v2_sync_route_payment_report after insert or update or delete
 on public.cxc_v2_payment_observations for each row execute function public.cxc_v2_sync_route_payment_report();
create trigger cxc_v2_sync_visual_route_bank_payment after insert or update or delete
 on public.cxc_v2_payment_observations for each row execute function public.cxc_v2_sync_visual_route_bank_payment();
create function public.cxc_v2_refresh_payment_observations(p_owner uuid)
 returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not (
   coalesce(public.can_view_owner_screen(p_owner,'receivables'),false) or
   coalesce(public.can_view_owner_screen(p_owner,'route_search'),false)
 ) then raise exception 'No tienes permiso para consultar esta cartera.'; end if;
 delete from public.cxc_v2_payment_observations o where o.user_id=p_owner
   and not exists(select 1 from public.payments_cloud p where p.user_id=o.user_id and p.id=o.id);
 insert into public.cxc_v2_payment_observations(user_id,id,data,updated_at)
 select p.user_id,p.id,p.data,p.updated_at from public.payments_cloud p
 where p.user_id=p_owner and exists(
   select 1 from public.cxc_v2_route_payment_reports r
   where r.user_id=p.user_id and r.client_id=p.data->>'clientId'
     and r.status<>'cancelled' and (p.data->>'createdAt')::timestamptz>=r.reported_at
 )
 order by p.data->>'createdAt',p.id
 on conflict(user_id,id) do update set data=excluded.data,updated_at=excluded.updated_at
 where cxc_v2_payment_observations.data is distinct from excluded.data;
end;
$$;
revoke all on function public.cxc_v2_refresh_payment_observations(uuid) from public,anon;
grant execute on function public.cxc_v2_refresh_payment_observations(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
