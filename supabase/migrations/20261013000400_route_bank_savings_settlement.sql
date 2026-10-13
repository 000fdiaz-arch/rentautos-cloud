-- Concilia las confirmaciones visuales de Ruta con el monto operativo del pago.
-- Los centavos identificadores se conservan como ahorro y no deben impedir que
-- una factura bancaria liquide su aviso.

create or replace function public.visual_route_bank_report_matches_payment(
  r public.route_payment_reports,
  p jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_report_amount numeric;
  v_payment_amount numeric;
  v_report_date date;
  v_payment_date date;
  v_payment_created_at timestamptz;
begin
  if r.status = 'cancelled'
    or r.bank_confirmed_visually_at is null
    or r.bank_amount <= 0
    or coalesce(p->>'paymentMethod', '') not in (
      'ACH Express',
      'Deposito Bancario',
      'Transferencia Bancaria'
    )
    or coalesce(p->>'paymentContext', 'regular') <> 'regular'
    or nullif(p->>'clientId', '') is null
    or (p->>'clientId') is distinct from r.client_id then
    return false;
  end if;

  v_report_amount := round(r.bank_amount, 2);
  v_payment_amount := round(
    (p->>'amountReceived')::numeric
      - coalesce((nullif(p->>'centavosAhorro', ''))::numeric, 0),
    2
  );
  v_report_date := (r.reported_at at time zone 'America/Panama')::date;
  v_payment_date := coalesce(
    nullif(p->>'fundsReceivedDate', ''),
    nullif(p->>'dateApplied', '')
  )::date;
  v_payment_created_at := (p->>'createdAt')::timestamptz;

  return abs(v_report_amount - v_payment_amount) <= 0.02
    and abs(v_payment_date - v_report_date) <= 7
    and v_payment_created_at >= r.reported_at;
exception when others then
  return false;
end;
$$;

-- Reprocesa confirmaciones visuales que quedaron visibles por comparar el
-- monto bruto en lugar del monto recibido menos el ahorro.
do $$
declare
  v_report_id uuid;
begin
  for v_report_id in
    select id
    from public.route_payment_reports
    where status <> 'cancelled'
      and bank_confirmed_visually_at is not null
      and bank_settled_payment_id is null
    order by reported_at, id
  loop
    perform public.settle_visual_route_bank_report(v_report_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
