-- Evita que "Confirmado en banco" recorra todos los pagos del owner.
-- La conciliacion conserva las mismas reglas, pero primero reduce el conjunto
-- a pagos bancarios regulares del cliente correspondiente.

create index if not exists payments_cloud_route_bank_settlement_candidates_idx
  on public.payments_cloud (user_id, (data->>'clientId'))
  where coalesce(data->>'paymentContext', 'regular') = 'regular'
    and data->>'paymentMethod' in (
      'ACH Express',
      'Deposito Bancario',
      'Transferencia Bancaria'
    );

-- El cambio de review a confirmed elimina el aviso enlazado. Este indice evita
-- otro recorrido completo durante la misma transaccion de confirmacion.
create index if not exists notified_payments_cloud_route_report_idx
  on public.notified_payments_cloud (user_id, (data->>'routeReportId'))
  where nullif(data->>'routeReportId', '') is not null;

create or replace function public.settle_visual_route_bank_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.route_payment_reports;
  v_payment_id text;
begin
  select * into v_report
  from public.route_payment_reports
  where id = p_report_id
  for update;

  if not found
    or v_report.status = 'cancelled'
    or v_report.bank_confirmed_visually_at is null
    or v_report.bank_settled_payment_id is not null then
    return;
  end if;

  select p.id into v_payment_id
  from public.payments_cloud p
  where p.user_id = v_report.user_id
    and p.data->>'clientId' = v_report.client_id
    and p.data->>'paymentMethod' in (
      'ACH Express',
      'Deposito Bancario',
      'Transferencia Bancaria'
    )
    and coalesce(p.data->>'paymentContext', 'regular') = 'regular'
    and public.visual_route_bank_report_matches_payment(v_report, p.data)
    and not exists (
      select 1
      from public.route_payment_reports other_report
      where other_report.user_id = p.user_id
        and other_report.id <> v_report.id
        and (
          other_report.confirmed_payment_id = p.id
          or other_report.bank_settled_payment_id = p.id
        )
    )
    and not exists (
      select 1
      from public.route_report_payment_links link
      where link.user_id = p.user_id
        and link.payment_id = p.id
        and link.report_id <> v_report.id
    )
  order by (p.data->>'createdAt')::timestamptz, p.id
  limit 1
  for update of p skip locked;

  if v_payment_id is null then return; end if;

  update public.route_payment_reports
  set bank_settled_payment_id = v_payment_id,
      bank_settled_at = clock_timestamp()
  where id = v_report.id
    and bank_settled_payment_id is null;
end;
$$;

revoke all on function public.settle_visual_route_bank_report(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
