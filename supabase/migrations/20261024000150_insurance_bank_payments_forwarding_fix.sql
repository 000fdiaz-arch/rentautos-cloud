-- Corrige el envio a Seguros para que la operacion use los movimientos
-- seleccionados como fuente atomica. Esto evita depender de que el espejo
-- local->nube de pendientes haya terminado antes de pulsar Enviar.

drop function if exists public.forward_bank_items_to_insurance(uuid, text[], text);

create or replace function public.forward_bank_items_to_insurance(
  p_owner_user_id uuid,
  p_items jsonb,
  p_actor_label text default null
)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folios text[];
  v_item_count integer;
  v_unique_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'payments'), false) then
    raise exception 'No tienes permiso para enviar pagos bancarios a Seguros.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Los movimientos seleccionados no son validos.';
  end if;

  select
    count(*),
    count(distinct normalized.folio),
    coalesce(array_agg(normalized.folio order by normalized.folio), array[]::text[])
  into v_item_count, v_unique_count, v_folios
  from (
    select nullif(upper(regexp_replace(coalesce(item->>'folio', ''), '\s+', '', 'g')), '') as folio
    from jsonb_array_elements(p_items) as source(item)
  ) normalized;

  if v_item_count = 0 or v_unique_count <> v_item_count or array_position(v_folios, null) is not null then
    raise exception 'Selecciona movimientos bancarios validos y sin folios repetidos.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as source(item)
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'amountReceived') <> 'number'
       or coalesce((item->>'amountReceived')::numeric, 0) <= 0
  ) then
    raise exception 'Uno de los movimientos no contiene un monto valido.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text || ':insurance-bank', 0));

  if exists (
    select 1
    from public.insurance_bank_payments_cloud payment
    where payment.user_id = p_owner_user_id
      and (
        upper(regexp_replace(coalesce(payment.data->'bankItem'->>'folio', ''), '\s+', '', 'g')) = any(v_folios)
        or regexp_replace(upper(regexp_replace(payment.id, '\s+', '', 'g')), '^FOLIO-', '') = any(v_folios)
      )
  ) then
    raise exception 'Uno de los folios seleccionados ya fue enviado a Seguros.';
  end if;

  insert into public.insurance_bank_payments_cloud(user_id, id, data, created_at, updated_at)
  select
    p_owner_user_id,
    'folio-' || normalized.folio,
    jsonb_build_object(
      'id', 'folio-' || normalized.folio,
      'bankItem', normalized.item,
      'status', 'pending',
      'forwardedAt', v_now,
      'forwardedBy', auth.uid(),
      'forwardedByLabel', nullif(btrim(coalesce(p_actor_label, '')), ''),
      'history',
        (case
          when jsonb_typeof(normalized.item->'insuranceRoutingHistory') = 'array' then normalized.item->'insuranceRoutingHistory'
          else '[]'::jsonb
        end) || jsonb_build_array(jsonb_build_object(
          'action', 'forwarded',
          'at', v_now,
          'by', auth.uid(),
          'byLabel', nullif(btrim(coalesce(p_actor_label, '')), '')
        )),
      'updatedAt', v_now
    ),
    v_now,
    v_now
  from (
    select
      item,
      upper(regexp_replace(item->>'folio', '\s+', '', 'g')) as folio
    from jsonb_array_elements(p_items) as source(item)
  ) normalized;

  delete from public.pending_bank_items_cloud pending
  where pending.user_id = p_owner_user_id
    and (
      upper(regexp_replace(coalesce(pending.data->>'folio', ''), '\s+', '', 'g')) = any(v_folios)
      or regexp_replace(upper(regexp_replace(pending.id, '\s+', '', 'g')), '^FOLIO-', '') = any(v_folios)
    );

  return query
  select payment.data
  from public.insurance_bank_payments_cloud payment
  where payment.user_id = p_owner_user_id
    and upper(regexp_replace(coalesce(payment.data->'bankItem'->>'folio', ''), '\s+', '', 'g')) = any(v_folios)
  order by payment.created_at, payment.id;
end;
$$;

revoke all on function public.forward_bank_items_to_insurance(uuid, jsonb, text) from public, anon;
grant execute on function public.forward_bank_items_to_insurance(uuid, jsonb, text) to authenticated;

create or replace function public.find_existing_processed_payment_folios(
  p_owner_user_id uuid,
  p_folios text[]
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with input_folios as (
    select distinct nullif(upper(regexp_replace(coalesce(raw_folio, ''), '\s+', '', 'g')), '') as folio
    from unnest(coalesce(p_folios, array[]::text[])) as raw_folio
  )
  select coalesce(array_agg(i.folio order by i.folio), array[]::text[])
  from input_folios i
  where i.folio is not null
    and public.can_access_owner_data(p_owner_user_id)
    and (
      exists (
        select 1
        from public.payments_cloud p
        where p.user_id = p_owner_user_id
          and public.extract_payment_folio(p.data->>'reference') = i.folio
          and (
            p.data->>'paymentMethod' in ('ACH Express', 'Deposito Bancario', 'Transferencia Bancaria')
            or (p.data->>'paymentMethod' = 'Tarjeta' and upper(coalesce(p.data->>'reference', '')) like '%TARJETA-CONCILIADA%')
          )
      )
      or exists (
        select 1
        from public.insurance_bank_payments_cloud payment
        where payment.user_id = p_owner_user_id
          and (
            upper(regexp_replace(coalesce(payment.data->'bankItem'->>'folio', ''), '\s+', '', 'g')) = i.folio
            or regexp_replace(upper(regexp_replace(payment.id, '\s+', '', 'g')), '^FOLIO-', '') = i.folio
          )
      )
    );
$$;

notify pgrst, 'reload schema';
