-- La confirmacion bancaria de Ruta es visual: confirma el reporte y decide
-- la permanencia en Ruta, sin insertar pagos ni reservar recibos.

alter table public.route_payment_reports
  add column if not exists bank_confirmed_visually_at timestamptz;
alter table public.route_payment_reports
  add column if not exists bank_confirmed_visually_by uuid;

create or replace function public.can_confirm_route_bank_payment(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.user_profiles p
      where p.id = auth.uid()
        and p.is_active
        and p.role::text = 'admin'
    )
    and coalesce(public.can_access_owner_data(p_user_id), false)
    and coalesce(public.can_edit_owner_screen(p_user_id, 'payments'), false)
    and coalesce(public.can_view_owner_screen(p_user_id, 'route_search'), false);
$$;

create or replace function public.refresh_route_report_confirmation(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.route_payment_reports;
  v_cash boolean;
  v_linked_bank boolean;
  v_visual_bank boolean;
  v_bank boolean;
  v_complete boolean;
  v_bank_payment jsonb;
begin
  select * into r from public.route_payment_reports where id = p_report_id for update;
  if not found or r.status = 'cancelled' then return; end if;

  select
    exists(select 1 from public.route_report_payment_links where report_id = r.id and method = 'cash'),
    exists(select 1 from public.route_report_payment_links where report_id = r.id and method = 'bank')
  into v_cash, v_linked_bank;
  v_visual_bank := r.bank_confirmed_visually_at is not null;
  v_bank := v_linked_bank or v_visual_bank;

  if v_linked_bank then
    select p.data into v_bank_payment
    from public.route_report_payment_links l
    join public.payments_cloud p on p.user_id = l.user_id and p.id = l.payment_id
    where l.report_id = r.id and l.method = 'bank'
    limit 1;
  end if;

  v_complete := (r.cash_amount = 0 or v_cash) and (r.bank_amount = 0 or v_bank);
  update public.route_payment_reports set
    confirmed_cash_amount = case when v_cash then cash_amount else 0 end,
    confirmed_bank_amount = case when v_bank then bank_amount else 0 end,
    confirmed_bank_received_amount = case
      when v_linked_bank then coalesce((v_bank_payment->>'amountReceived')::numeric, bank_amount)
      when v_visual_bank then bank_amount
      else 0
    end,
    confirmed_bank_savings_amount = case
      when v_linked_bank then coalesce((nullif(v_bank_payment->>'centavosAhorro',''))::numeric, 0)
      else 0
    end,
    status = case when v_complete then 'confirmed' else 'review' end,
    confirmed_at = case when v_complete then coalesce(confirmed_at, clock_timestamp()) else null end,
    confirmed_payment_id = case when v_complete and method <> 'mixed' and not v_visual_bank then
      (select payment_id from public.route_report_payment_links where report_id = r.id limit 1)
      else null
    end
  where id = r.id;
end;
$$;

create or replace function public.confirm_route_bank_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.route_payment_reports;
  v_route public.active_route_items_cloud;
  v_pending_bank numeric(12,2);
  v_release_amount numeric(12,2);
  v_report_confirmed_amount numeric(12,2);
  v_previous_decision_amount numeric(12,2);
  v_confirmed_amount numeric(12,2);
  v_complete boolean;
  v_now timestamptz := clock_timestamp();
  v_outcome text := 'decision';
begin
  select * into v_report
  from public.route_payment_reports
  where id = p_report_id
  for update;

  if not found or not coalesce(public.can_confirm_route_bank_payment(v_report.user_id), false) then
    raise exception 'Solo el administrador con acceso a Pagos y Ruta puede confirmar banca.';
  end if;

  v_pending_bank := round(v_report.bank_amount - v_report.confirmed_bank_amount, 2);
  if v_report.status <> 'review' or v_pending_bank <= 0 then
    raise exception 'Este pago bancario ya fue confirmado o cambio. Actualiza la ruta.';
  end if;

  select * into v_route
  from public.active_route_items_cloud
  where user_id = v_report.user_id and client_id = v_report.client_id
  for update;

  if not found
    or coalesce(v_route.data->>'removedAt', '') <> ''
    or (v_route.data->>'publishedAt') is distinct from v_report.published_at then
    raise exception 'La unidad cambio o ya no esta activa. Actualiza la ruta.';
  end if;

  v_complete := v_report.cash_amount = 0 or v_report.confirmed_cash_amount >= v_report.cash_amount;
  update public.route_payment_reports set
    confirmed_bank_amount = bank_amount,
    confirmed_bank_received_amount = bank_amount,
    confirmed_bank_savings_amount = 0,
    bank_confirmed_visually_at = v_now,
    bank_confirmed_visually_by = auth.uid(),
    status = case when v_complete then 'confirmed' else 'review' end,
    confirmed_at = case when v_complete then v_now else null end,
    confirmed_payment_id = null
  where id = v_report.id;

  select round(coalesce(sum(
    confirmed_cash_amount
    + case when bank_confirmed_visually_at is not null then confirmed_bank_amount else 0 end
  ), 0), 2)
  into v_report_confirmed_amount
  from public.route_payment_reports
  where user_id = v_report.user_id
    and client_id = v_report.client_id
    and published_at = v_report.published_at
    and status <> 'cancelled';

  v_release_amount := round(coalesce((v_route.data->>'releaseAmount')::numeric, 0), 2);
  v_previous_decision_amount := round(coalesce((v_route.data->>'partialDecisionRentAmount')::numeric, 0), 2);
  v_confirmed_amount := greatest(
    coalesce(v_report_confirmed_amount, 0),
    v_previous_decision_amount + v_pending_bank
  );

  if v_release_amount > 0 and v_confirmed_amount >= v_release_amount then
    update public.active_route_items_cloud
    set
      data = jsonb_set(
        jsonb_set(data, '{removedAt}', to_jsonb(v_now), true),
        '{removedReason}',
        to_jsonb('bank_confirmed_amount_met'::text),
        true
      ),
      in_custody = false,
      custody_since = null,
      custody_changed_at = case when in_custody then v_now else custody_changed_at end,
      custody_changed_by = case when in_custody then auth.uid() else custody_changed_by end,
      custody_history = case
        when in_custody then custody_history || jsonb_build_array(jsonb_build_object(
          'inCustody', false,
          'at', v_now,
          'by', auth.uid(),
          'unitId', data->>'unitId',
          'publishedAt', data->>'publishedAt',
          'reason', 'bank_confirmed_amount_met'
        ))
        else custody_history
      end,
      updated_at = v_now
    where user_id = v_report.user_id and client_id = v_report.client_id;
    v_outcome := 'removed';
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'confirmedAmount', v_confirmed_amount,
    'releaseAmount', v_release_amount
  );
end;
$$;

-- Las versiones anteriores del frontend no pueden volver a convertir esta
-- confirmacion visual en un pago de Ruta con recibo.
drop policy if exists "payments_cloud_route_insert" on public.payments_cloud;
create policy "payments_cloud_route_insert"
on public.payments_cloud
for insert
to authenticated
with check (
  data->>'source' = 'route'
  and data->>'paymentMethod' = 'Efectivo'
  and (select public.can_report_route_payment(user_id))
);

create or replace function public.guard_payment_write_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT'
     and new.data->>'source' = 'route'
     and jsonb_typeof(new.data->'bankConfirmation') = 'object' then
    raise exception 'La confirmacion bancaria de Ruta es visual y no genera recibo';
  end if;

  if public.can_edit_owner_screen(new.user_id, 'payments') then
    return new;
  end if;

  if tg_op = 'INSERT'
     and public.can_report_route_payment(new.user_id)
     and new.data->>'source' = 'route'
     and new.data->>'paymentMethod' = 'Efectivo' then
    return new;
  end if;

  raise exception 'No autorizado para modificar pagos de este owner';
end;
$$;

revoke all on function public.confirm_route_bank_report(uuid) from public, anon;
grant execute on function public.confirm_route_bank_report(uuid) to authenticated;
revoke all on function public.can_confirm_route_bank_payment(uuid) from public, anon, authenticated;
revoke all on function public.refresh_route_report_confirmation(uuid) from public, anon, authenticated;
revoke all on function public.guard_payment_write_scope() from public, anon, authenticated;
revoke all on function public.is_valid_admin_route_bank_confirmation(uuid, jsonb) from authenticated;

notify pgrst, 'reload schema';
