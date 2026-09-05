-- Reportes de buscadores: no conceden escritura sobre pagos, clientes ni rutas.
create table if not exists public.route_payment_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  published_at text not null,
  snapshot jsonb not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','bank')),
  status text not null default 'review' check (status in ('review','confirmed','cancelled')),
  reported_by uuid not null,
  reporter_name text not null,
  reported_at timestamptz not null default clock_timestamp(),
  confirmed_payment_id text,
  confirmed_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz
);
create unique index if not exists route_report_active_unique
  on public.route_payment_reports(user_id,client_id,published_at) where status <> 'cancelled';
create unique index if not exists route_report_payment_unique
  on public.route_payment_reports(user_id,confirmed_payment_id) where confirmed_payment_id is not null;
create index if not exists route_report_owner_idx on public.route_payment_reports(user_id,reported_at desc);
alter table public.route_payment_reports enable row level security;
drop policy if exists route_report_read on public.route_payment_reports;
create policy route_report_read on public.route_payment_reports for select to authenticated
  using (public.can_view_owner_screen(user_id,'route_search'));
revoke all on public.route_payment_reports from anon, authenticated;
grant select on public.route_payment_reports to authenticated;

create or replace function public.can_report_route_payment(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(public.can_view_owner_screen(p_user_id,'route_search'),false)
    and exists (select 1 from public.user_profiles p where p.id=auth.uid() and p.is_active
      and (p.role::text='buscador' or public.can_edit_owner_screen(p_user_id,'route_search')));
$$;

create or replace function public.report_route_payment(p_user_id uuid,p_client_id text,p_published_at text,p_amount numeric,p_method text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_name text;
begin
  if not coalesce(public.can_report_route_payment(p_user_id),false) then raise exception 'No tienes permiso para reportar pagos.'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount,2)
    or p_method is null or p_method not in ('cash','bank') then raise exception 'Indica un monto válido y cómo pagó.'; end if;
  select data into v_item from public.active_route_items_cloud
    where user_id=p_user_id and client_id=p_client_id for update;
  if v_item is null or coalesce(v_item->>'removedAt','')<>'' or (v_item->>'publishedAt') is distinct from p_published_at then
    raise exception 'La unidad cambió o ya no está activa. Actualiza la ruta.';
  end if;
  select coalesce(nullif(email,''),'Buscador') into v_name from public.user_profiles where id=auth.uid();
  insert into public.route_payment_reports(user_id,client_id,published_at,snapshot,amount,method,reported_by,reporter_name)
    values(p_user_id,p_client_id,p_published_at,v_item,p_amount,p_method,auth.uid(),v_name);
exception when unique_violation then raise exception 'Esta unidad ya tiene un reporte. Actualiza la ruta.';
end;
$$;

create or replace function public.cancel_route_payment_report(p_report_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_report public.route_payment_reports;
begin
  select * into v_report from public.route_payment_reports where id=p_report_id for update;
  if not found or not coalesce(public.can_report_route_payment(v_report.user_id),false)
    or (v_report.reported_by<>auth.uid() and not coalesce(public.can_edit_owner_screen(v_report.user_id,'route_search'),false)) then
    raise exception 'No tienes permiso para devolver este reporte.';
  end if;
  if v_report.status<>'review' then raise exception 'Solo puedes devolver reportes pendientes.'; end if;
  update public.route_payment_reports set status='cancelled',cancelled_by=auth.uid(),cancelled_at=clock_timestamp() where id=p_report_id;
end;
$$;

-- Un pago nuevo, de la misma unidad, fecha, monto y medio confirma un único reporte.
-- Los avisos bancarios en hold nunca entran en esta tabla de pagos aplicados.
create or replace function public.route_report_matches_payment(r public.route_payment_reports,p jsonb)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p->>'clientId'=r.client_id
    and p->>'clientUnit'=r.snapshot->>'unitId'
    and coalesce(p->>'paymentContext','regular')='regular'
    and coalesce(nullif(p->>'fundsReceivedDate',''),p->>'dateApplied')=to_char(r.reported_at at time zone 'America/Panama','YYYY-MM-DD')
    and (p->>'amountReceived')::numeric=r.amount
    and (case when p->>'paymentMethod'='Efectivo' then 'cash'
      when p->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria') then 'bank' end)=r.method,false);
$$;

create or replace function public.sync_route_payment_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_report_id uuid;
begin
  if tg_op='DELETE' then
    update public.route_payment_reports set status='review',confirmed_payment_id=null,confirmed_at=null
      where user_id=old.user_id and confirmed_payment_id=old.id;
    return old;
  end if;
  if tg_op='UPDATE' then
    update public.route_payment_reports r set status='review',confirmed_payment_id=null,confirmed_at=null
      where r.user_id=old.user_id and r.confirmed_payment_id=old.id
      and (new.user_id is distinct from old.user_id or new.id is distinct from old.id
        or not public.route_report_matches_payment(r,new.data));
    return new;
  end if;
  select r.id into v_report_id from public.route_payment_reports r
    where r.user_id=new.user_id and r.status='review'
      and public.route_report_matches_payment(r,new.data)
      and (new.data->>'createdAt')::timestamptz >= r.reported_at
    order by r.reported_at desc limit 1 for update;
  if v_report_id is not null then
    update public.route_payment_reports set status='confirmed',confirmed_payment_id=new.id,confirmed_at=clock_timestamp()
      where id=v_report_id;
  end if;
  return new;
end;
$$;
drop trigger if exists sync_route_payment_report on public.payments_cloud;
create trigger sync_route_payment_report after insert or update or delete on public.payments_cloud
  for each row execute function public.sync_route_payment_report();

revoke all on function public.can_report_route_payment(uuid) from public;
revoke all on function public.report_route_payment(uuid,text,text,numeric,text) from public;
revoke all on function public.cancel_route_payment_report(uuid) from public;
revoke all on function public.route_report_matches_payment(public.route_payment_reports,jsonb) from public;
revoke all on function public.sync_route_payment_report() from public;
grant execute on function public.can_report_route_payment(uuid) to authenticated;
grant execute on function public.report_route_payment(uuid,text,text,numeric,text) to authenticated;
grant execute on function public.cancel_route_payment_report(uuid) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='route_payment_reports'
  ) then alter publication supabase_realtime add table public.route_payment_reports; end if;
end $$;
