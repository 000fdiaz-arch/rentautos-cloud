-- Vincula el recibo inmediato de efectivo con su reporte de Ruta mediante un
-- identificador explícito. La conciliación deja de depender del reloj del
-- navegador; la búsqueda histórica por fecha y monto queda como respaldo para
-- clientes anteriores.

create or replace function public.sync_route_payment_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_report_id uuid;
  v_method text;
  v_link_method text;
  v_report public.route_payment_reports;
begin
  if tg_op in ('UPDATE','DELETE') then
    select report_id, method into v_report_id, v_link_method
    from public.route_report_payment_links
    where user_id = old.user_id and payment_id = old.id;

    if v_report_id is not null then
      select * into v_report
      from public.route_payment_reports
      where id = v_report_id
      for update;

      if tg_op = 'DELETE' then
        if v_link_method = 'cash' and coalesce(old.data->>'source', '') = 'route' then
          delete from public.route_report_payment_links
          where report_id = v_report_id;

          update public.route_payment_reports
          set status = 'cancelled',
              cancelled_by = coalesce(auth.uid(), old.user_id),
              cancelled_at = clock_timestamp(),
              confirmed_cash_amount = 0,
              confirmed_bank_amount = 0,
              confirmed_payment_id = null,
              confirmed_at = null
          where id = v_report_id;
        else
          delete from public.route_report_payment_links
          where user_id = old.user_id and payment_id = old.id;
          perform public.refresh_route_report_confirmation(v_report_id);
        end if;
      else
        v_method := case
          when new.data->>'paymentMethod' = 'Efectivo' then 'cash'
          when new.data->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria') then 'bank'
        end;
        if new.user_id is distinct from old.user_id
          or new.id is distinct from old.id
          or v_method is distinct from v_link_method
          or not public.route_report_matches_payment(v_report, new.data) then
          delete from public.route_report_payment_links
          where user_id = old.user_id and payment_id = old.id;
        end if;
        perform public.refresh_route_report_confirmation(v_report_id);
      end if;
    end if;

    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_method := case
    when new.data->>'paymentMethod' = 'Efectivo' then 'cash'
    when new.data->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria') then 'bank'
  end;
  if v_method is null then return new; end if;

  -- El efectivo generado desde el mismo formulario de Ruta identifica su
  -- reporte de forma inequívoca. Se conservan las validaciones de cliente,
  -- unidad, fecha, método y monto antes de crear el vínculo.
  if v_method = 'cash'
     and coalesce(new.data->>'source', '') = 'route'
     and coalesce(new.data->>'routeReportId', '') <> '' then
    select * into v_report
    from public.route_payment_reports r
    where r.id::text = new.data->>'routeReportId'
      and r.user_id = new.user_id
      and r.status = 'review'
    for update;

    if not found or not public.route_report_matches_payment(v_report, new.data) then
      raise exception 'El recibo de efectivo no coincide con su aviso de Ruta. Actualiza y vuelve a intentar.';
    end if;

    insert into public.route_report_payment_links(report_id, user_id, payment_id, method)
    values(v_report.id, new.user_id, new.id, 'cash');
    perform public.refresh_route_report_confirmation(v_report.id);
    return new;
  end if;

  -- Compatibilidad para pagos creados por versiones anteriores.
  for v_report in
    select r.*
    from public.route_payment_reports r
    where r.user_id = new.user_id
      and r.status = 'review'
      and public.route_report_matches_payment(r, new.data)
      and (new.data->>'createdAt')::timestamptz >= r.reported_at
    order by r.reported_at desc
    for update
  loop
    if not exists (
      select 1 from public.route_report_payment_links
      where report_id = v_report.id and method = v_method
    ) then
      insert into public.route_report_payment_links(report_id, user_id, payment_id, method)
      values(v_report.id, new.user_id, new.id, v_method);
      perform public.refresh_route_report_confirmation(v_report.id);
      exit;
    end if;
  end loop;
  return new;
end;
$$;

-- Repara reportes de efectivo recientes afectados por una diferencia pequeña
-- entre el reloj del navegador y el reloj de Supabase. updated_at confirma que
-- el pago llegó a la base después de crearse el reporte.
do $$
declare
  v_report public.route_payment_reports;
  v_payment record;
  v_inserted integer;
begin
  for v_report in
    select r.*
    from public.route_payment_reports r
    where r.status = 'review'
      and r.cash_amount > r.confirmed_cash_amount
    order by r.reported_at
    for update
  loop
    select p.user_id, p.id, p.data into v_payment
    from public.payments_cloud p
    where p.user_id = v_report.user_id
      and coalesce(p.data->>'source', '') = 'route'
      and p.data->>'paymentMethod' = 'Efectivo'
      and public.route_report_matches_payment(v_report, p.data)
      and (p.data->>'createdAt')::timestamptz >= v_report.reported_at - interval '5 minutes'
      and p.updated_at >= v_report.reported_at
      and not exists (
        select 1 from public.route_report_payment_links l
        where l.user_id = p.user_id and l.payment_id = p.id
      )
      and not exists (
        select 1 from public.route_report_payment_links l
        where l.report_id = v_report.id and l.method = 'cash'
      )
    order by abs(extract(epoch from ((p.data->>'createdAt')::timestamptz - v_report.reported_at))), p.id
    limit 1;

    if found then
      insert into public.route_report_payment_links(report_id, user_id, payment_id, method)
      values(v_report.id, v_payment.user_id, v_payment.id, 'cash')
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted > 0 then
        perform public.refresh_route_report_confirmation(v_report.id);
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.sync_route_payment_report() from public, anon, authenticated;
notify pgrst, 'reload schema';
