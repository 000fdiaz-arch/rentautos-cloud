-- Reconcilia avisos de Pagos con Pago notificado de Ruta cuando la unidad está activa.
-- La ruta activa, el cliente, la publicación y el monto bancario son la fuente de verdad.
create or replace function public.reconcile_notified_payment_route(p_user_id uuid, p_notice_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_notice jsonb;
  v_item jsonb;
  v_client_id text;
  v_published_at text;
  v_amount numeric;
  v_report public.route_payment_reports;
  v_reporter uuid;
  v_reporter_name text;
begin
  select n.data into v_notice
  from public.notified_payments_cloud n
  where n.user_id = p_user_id and n.id = p_notice_id
  for update;

  if not found then return null; end if;

  if coalesce(v_notice->>'routeReportId', '') <> '' then
    select r.* into v_report
    from public.route_payment_reports r
    where r.user_id = p_user_id
      and r.id::text = v_notice->>'routeReportId'
      and r.status = 'review';
    if found then return v_report.id; end if;
  end if;

  v_client_id := nullif(v_notice->>'clientId', '');
  if v_client_id is null then return null; end if;
  begin
    v_amount := (v_notice->>'amount')::numeric;
  exception when others then
    return null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount > 9999999999.99 or v_amount <> round(v_amount, 2) then
    return null;
  end if;

  select a.data into v_item
  from public.active_route_items_cloud a
  where a.user_id = p_user_id and a.client_id = v_client_id
  for update;

  if not found or coalesce(v_item->>'removedAt', '') <> '' then return null; end if;
  v_published_at := nullif(v_item->>'publishedAt', '');
  if v_published_at is null then return null; end if;

  select r.* into v_report
  from public.route_payment_reports r
  where r.user_id = p_user_id
    and r.client_id = v_client_id
    and r.published_at = v_published_at
    and r.status = 'review'
  order by r.reported_at desc, r.id
  limit 1
  for update;

  if found then
    if v_report.method <> 'bank' or v_report.bank_amount <> v_amount then return null; end if;
  else
    v_reporter := coalesce(auth.uid(), p_user_id);
    select coalesce(nullif(p.email, ''), 'Pagos') into v_reporter_name
    from public.user_profiles p where p.id = v_reporter;
    v_reporter_name := coalesce(v_reporter_name, 'Pagos');

    insert into public.route_payment_reports(
      user_id, client_id, published_at, snapshot, amount, method,
      cash_amount, bank_amount, reported_by, reporter_name
    ) values (
      p_user_id, v_client_id, v_published_at, v_item, v_amount, 'bank',
      0, v_amount, v_reporter, v_reporter_name
    )
    returning * into v_report;
  end if;

  -- Un reporte representa un solo aviso. Los duplicados permanecen solo en Pagos.
  if exists (
    select 1 from public.notified_payments_cloud n
    where n.user_id = p_user_id
      and n.id <> p_notice_id
      and n.data->>'routeReportId' = v_report.id::text
  ) then return null; end if;

  update public.notified_payments_cloud
  set data = data || jsonb_build_object(
    'routeReportId', v_report.id::text,
    'routePaymentMethod', 'bank',
    'routeAssignment', coalesce(v_item->>'routeAssignment', '')
  ),
  updated_at = clock_timestamp()
  where user_id = p_user_id and id = p_notice_id;

  return v_report.id;
end;
$$;

revoke all on function public.reconcile_notified_payment_route(uuid, text) from public, anon, authenticated;

create or replace function public.link_notified_payment_to_active_route(p_user_id uuid, p_notice_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.can_edit_owner_screen(p_user_id, 'payments'), false) then
    raise exception 'No tienes permiso para vincular este pago notificado.';
  end if;
  return public.reconcile_notified_payment_route(p_user_id, p_notice_id);
end;
$$;
revoke all on function public.link_notified_payment_to_active_route(uuid, text) from public, anon;
grant execute on function public.link_notified_payment_to_active_route(uuid, text) to authenticated;

create or replace function public.reconcile_notified_payment_route_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.data->>'routeReportId', '') = '' then
    perform public.reconcile_notified_payment_route(new.user_id, new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.reconcile_notified_payment_route_trigger() from public, anon, authenticated;

drop trigger if exists notified_payment_reconcile_route on public.notified_payments_cloud;
create trigger notified_payment_reconcile_route
after insert or update of data on public.notified_payments_cloud
for each row execute function public.reconcile_notified_payment_route_trigger();

create or replace function public.reconcile_notices_when_route_activates()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_notice_id text;
begin
  if coalesce(new.data->>'removedAt', '') <> '' then return new; end if;
  for v_notice_id in
    select n.id
    from public.notified_payments_cloud n
    where n.user_id = new.user_id
      and n.data->>'clientId' = new.client_id
      and coalesce(n.data->>'routeReportId', '') = ''
    order by coalesce(n.data->>'createdAt', '') desc, n.id
  loop
    perform public.reconcile_notified_payment_route(new.user_id, v_notice_id);
  end loop;
  return new;
end;
$$;
revoke all on function public.reconcile_notices_when_route_activates() from public, anon, authenticated;

drop trigger if exists active_route_reconcile_notices on public.active_route_items_cloud;
create trigger active_route_reconcile_notices
after insert or update of data on public.active_route_items_cloud
for each row execute function public.reconcile_notices_when_route_activates();

create or replace function public.cancel_route_report_when_notice_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_report_id uuid;
begin
  begin
    v_report_id := nullif(old.data->>'routeReportId', '')::uuid;
  exception when others then
    return old;
  end;
  if v_report_id is null then return old; end if;

  update public.route_payment_reports
  set status = 'cancelled',
      cancelled_by = coalesce(auth.uid(), old.user_id),
      cancelled_at = clock_timestamp()
  where user_id = old.user_id and id = v_report_id and status = 'review';
  return old;
end;
$$;
revoke all on function public.cancel_route_report_when_notice_deleted() from public, anon, authenticated;

drop trigger if exists notified_payment_cancel_route_report on public.notified_payments_cloud;
create trigger notified_payment_cancel_route_report
after delete on public.notified_payments_cloud
for each row execute function public.cancel_route_report_when_notice_deleted();

-- Repara avisos existentes, incluyendo A91, sin crear reportes para unidades fuera de Ruta.
do $$
declare v_notice record;
begin
  for v_notice in
    select n.user_id, n.id
    from public.notified_payments_cloud n
    where coalesce(n.data->>'routeReportId', '') = ''
    order by coalesce(n.data->>'createdAt', '') desc, n.id
  loop
    perform public.reconcile_notified_payment_route(v_notice.user_id, v_notice.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
