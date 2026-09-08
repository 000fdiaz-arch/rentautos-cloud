-- Confirma pagos bancarios por su monto operativo, excluyendo los centavos
-- identificadores que se guardan como ahorro. Conserva la igualdad exacta:
-- no introduce tolerancias ni acepta faltantes.

alter table public.route_payment_reports
  add column if not exists confirmed_bank_received_amount numeric(12,2) not null default 0;
alter table public.route_payment_reports
  add column if not exists confirmed_bank_savings_amount numeric(12,2) not null default 0;

create or replace function public.route_report_matches_payment(r public.route_payment_reports,p jsonb)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p->>'clientId'=r.client_id
    and p->>'clientUnit'=r.snapshot->>'unitId'
    and coalesce(p->>'paymentContext','regular')='regular'
    and coalesce(nullif(p->>'fundsReceivedDate',''),p->>'dateApplied')=to_char(r.reported_at at time zone 'America/Panama','YYYY-MM-DD')
    and ((p->>'paymentMethod'='Efectivo' and r.cash_amount>0 and (p->>'amountReceived')::numeric=r.cash_amount)
      or (p->>'paymentMethod' in ('ACH Express','Deposito Bancario','Transferencia Bancaria')
        and r.bank_amount>0
        and (p->>'amountReceived')::numeric-coalesce((nullif(p->>'centavosAhorro',''))::numeric,0)=r.bank_amount)),false);
$$;

create or replace function public.refresh_route_report_confirmation(p_report_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.route_payment_reports;
  v_cash boolean;
  v_bank boolean;
  v_complete boolean;
  v_bank_payment jsonb;
begin
  select * into r from public.route_payment_reports where id=p_report_id for update;
  if not found or r.status='cancelled' then return; end if;

  select exists(select 1 from public.route_report_payment_links where report_id=r.id and method='cash'),
    exists(select 1 from public.route_report_payment_links where report_id=r.id and method='bank') into v_cash,v_bank;
  if v_bank then
    select p.data into v_bank_payment
    from public.route_report_payment_links l
    join public.payments_cloud p on p.user_id=l.user_id and p.id=l.payment_id
    where l.report_id=r.id and l.method='bank'
    limit 1;
  end if;

  v_complete:=(r.cash_amount=0 or v_cash) and (r.bank_amount=0 or v_bank);
  update public.route_payment_reports set
    confirmed_cash_amount=case when v_cash then cash_amount else 0 end,
    confirmed_bank_amount=case when v_bank then bank_amount else 0 end,
    confirmed_bank_received_amount=case when v_bank then coalesce((v_bank_payment->>'amountReceived')::numeric,bank_amount) else 0 end,
    confirmed_bank_savings_amount=case when v_bank then coalesce((nullif(v_bank_payment->>'centavosAhorro',''))::numeric,0) else 0 end,
    status=case when v_complete then 'confirmed' else 'review' end,
    confirmed_at=case when v_complete then coalesce(confirmed_at,clock_timestamp()) else null end,
    confirmed_payment_id=case when v_complete and method<>'mixed' then
      (select payment_id from public.route_report_payment_links where report_id=r.id limit 1) else null end
  where id=r.id;
end;
$$;

-- Completa el detalle visible de confirmaciones anteriores.
do $$
declare v_report_id uuid;
begin
  for v_report_id in select distinct report_id from public.route_report_payment_links loop
    perform public.refresh_route_report_confirmation(v_report_id);
  end loop;
end;
$$;

-- Reprocesa pagos bancarios existentes en el orden en que fueron registrados.
-- Cada pago conserva la exclusividad de un solo reporte y cada reporte usa
-- como máximo un vínculo bancario, igual que el trigger en tiempo real.
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
