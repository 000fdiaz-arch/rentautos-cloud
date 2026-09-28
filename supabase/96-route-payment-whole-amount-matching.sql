-- Concilia la notificacion de Ruta en calle contra el dinero realmente recibido.
-- Los centavos se conservan en el pago y el recibo, pero no participan en la
-- comparacion: ambos importes se comparan por su parte entera.

create or replace function public.route_report_matches_payment(r public.route_payment_reports,p jsonb)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p->>'clientId'=r.client_id
    and p->>'clientUnit'=r.snapshot->>'unitId'
    and coalesce(p->>'paymentContext','regular')='regular'
    and coalesce(nullif(p->>'fundsReceivedDate',''),p->>'dateApplied')=to_char(r.reported_at at time zone 'America/Panama','YYYY-MM-DD')
    and ((p->>'paymentMethod'='Efectivo'
        and r.cash_amount>0
        and trunc((p->>'amountReceived')::numeric)=trunc(r.cash_amount))
      or (p->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria')
        and r.bank_amount>0
        and trunc((p->>'amountReceived')::numeric)=trunc(r.bank_amount))),false);
$$;

-- Reprocesa notificaciones bancarias pendientes con la nueva regla. Cada pago
-- y cada componente bancario mantienen la exclusividad aplicada por el trigger.
do $$
declare
  v_payment record;
  v_report public.route_payment_reports;
  v_inserted integer;
begin
  for v_payment in
    select p.user_id,p.id,p.data
    from public.payments_cloud p
    where p.data->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria')
      and exists (
        select 1 from public.route_payment_reports r
        where r.user_id=p.user_id and r.status='review'
          and public.route_report_matches_payment(r,p.data)
          and (p.data->>'createdAt')::timestamptz>=r.reported_at
      )
    order by (p.data->>'createdAt')::timestamptz,p.updated_at,p.id
  loop
    select r.* into v_report
    from public.route_payment_reports r
    where r.user_id=v_payment.user_id and r.status='review'
      and public.route_report_matches_payment(r,v_payment.data)
      and (v_payment.data->>'createdAt')::timestamptz>=r.reported_at
      and not exists (
        select 1 from public.route_report_payment_links l
        where l.user_id=v_payment.user_id and l.payment_id=v_payment.id
      )
      and not exists (
        select 1 from public.route_report_payment_links l
        where l.report_id=r.id and l.method='bank'
      )
    order by r.reported_at desc
    limit 1
    for update;

    if found then
      insert into public.route_report_payment_links(report_id,user_id,payment_id,method)
        values(v_report.id,v_payment.user_id,v_payment.id,'bank')
        on conflict do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted>0 then perform public.refresh_route_report_confirmation(v_report.id); end if;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
