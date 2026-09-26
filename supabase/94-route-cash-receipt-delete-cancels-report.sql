-- Un recibo de efectivo emitido por Ruta forma parte de la misma notificación.
-- Si se elimina desde Pagos, se devuelve la unidad a Trabajo en vez de dejar
-- un reporte huérfano como "Efectivo pendiente".
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
          -- La notificación y su recibo inmediato son una sola operación.
          -- Quitar el recibo desde Pagos también cierra la notificación y
          -- elimina cualquier otro vínculo del mismo reporte (por ejemplo,
          -- la parte bancaria de un pago mixto) sin borrar esos otros pagos.
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

revoke all on function public.sync_route_payment_report() from public, anon, authenticated;
notify pgrst, 'reload schema';
