-- Integra movimientos bancarios con expedientes de seguros sin convertirlos
-- en pagos de clientes. El traslado y la devolución son atómicos por folio.

create table if not exists public.insurance_bank_payments_cloud (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists insurance_bank_payments_status_idx
  on public.insurance_bank_payments_cloud (user_id, (data->>'status'), updated_at desc);

alter table public.insurance_bank_payments_cloud enable row level security;

drop policy if exists "insurance_bank_payments_incidents_read" on public.insurance_bank_payments_cloud;
create policy "insurance_bank_payments_incidents_read"
on public.insurance_bank_payments_cloud
for select to authenticated
using ((select public.can_view_owner_screen(user_id, 'incidents')));

drop policy if exists "insurance_bank_payments_incidents_update" on public.insurance_bank_payments_cloud;
create policy "insurance_bank_payments_incidents_update"
on public.insurance_bank_payments_cloud
for update to authenticated
using ((select public.can_edit_owner_screen(user_id, 'incidents')))
with check ((select public.can_edit_owner_screen(user_id, 'incidents')));

grant select, update on public.insurance_bank_payments_cloud to authenticated;

create or replace function public.forward_bank_items_to_insurance(
  p_owner_user_id uuid,
  p_folios text[],
  p_actor_label text default null
)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_found_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'payments'), false) then
    raise exception 'No tienes permiso para enviar pagos bancarios a Seguros.';
  end if;

  create temporary table if not exists pg_temp.insurance_forward_folios (
    folio text primary key
  ) on commit drop;
  truncate table pg_temp.insurance_forward_folios;

  insert into pg_temp.insurance_forward_folios(folio)
  select distinct nullif(upper(regexp_replace(coalesce(raw_folio, ''), '\s+', '', 'g')), '')
  from unnest(coalesce(p_folios, array[]::text[])) as raw_folio
  where nullif(upper(regexp_replace(coalesce(raw_folio, ''), '\s+', '', 'g')), '') is not null;

  select count(*) into v_requested_count from pg_temp.insurance_forward_folios;
  if v_requested_count = 0 then
    raise exception 'Selecciona al menos un movimiento bancario.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text || ':insurance-bank', 0));

  select count(*) into v_found_count
  from public.pending_bank_items_cloud pending
  join pg_temp.insurance_forward_folios requested
    on upper(regexp_replace(pending.id, '\s+', '', 'g')) = requested.folio
  where pending.user_id = p_owner_user_id;

  if v_found_count <> v_requested_count then
    raise exception 'Uno o más movimientos ya cambiaron. Actualiza la lista e intenta nuevamente.';
  end if;

  if exists (
    select 1
    from public.insurance_bank_payments_cloud insurance_payment
    join pg_temp.insurance_forward_folios requested
      on upper(regexp_replace(insurance_payment.id, '\s+', '', 'g')) = requested.folio
    where insurance_payment.user_id = p_owner_user_id
  ) then
    raise exception 'Uno de los folios seleccionados ya fue enviado a Seguros.';
  end if;

  insert into public.insurance_bank_payments_cloud(user_id, id, data, created_at, updated_at)
  select
    pending.user_id,
    pending.id,
    jsonb_build_object(
      'id', pending.id,
      'bankItem', pending.data,
      'status', 'pending',
      'forwardedAt', v_now,
      'forwardedBy', auth.uid(),
      'forwardedByLabel', nullif(btrim(coalesce(p_actor_label, '')), ''),
      'history',
        (case
          when jsonb_typeof(pending.data->'insuranceRoutingHistory') = 'array' then pending.data->'insuranceRoutingHistory'
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
  from public.pending_bank_items_cloud pending
  join pg_temp.insurance_forward_folios requested
    on upper(regexp_replace(pending.id, '\s+', '', 'g')) = requested.folio
  where pending.user_id = p_owner_user_id;

  delete from public.pending_bank_items_cloud pending
  using pg_temp.insurance_forward_folios requested
  where pending.user_id = p_owner_user_id
    and upper(regexp_replace(pending.id, '\s+', '', 'g')) = requested.folio;

  return query
  select insurance_payment.data
  from public.insurance_bank_payments_cloud insurance_payment
  join pg_temp.insurance_forward_folios requested
    on upper(regexp_replace(insurance_payment.id, '\s+', '', 'g')) = requested.folio
  where insurance_payment.user_id = p_owner_user_id
  order by insurance_payment.created_at, insurance_payment.id;
end;
$$;

create or replace function public.set_insurance_bank_payment_claim(
  p_owner_user_id uuid,
  p_payment_id text,
  p_claim_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_data jsonb;
begin
  if not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'incidents'), false) then
    raise exception 'No tienes permiso para vincular pagos de seguros.';
  end if;

  if nullif(btrim(coalesce(p_claim_id, '')), '') is not null and not exists (
    select 1 from public.insurance_claims_cloud claim
    where claim.user_id = p_owner_user_id and claim.id = btrim(p_claim_id)
  ) then
    raise exception 'El expediente de seguro seleccionado ya no existe.';
  end if;

  update public.insurance_bank_payments_cloud payment
  set data = case
      when nullif(btrim(coalesce(p_claim_id, '')), '') is null then
        (payment.data - 'claimId' - 'linkedAt' - 'linkedBy') || jsonb_build_object(
          'status', 'pending',
          'history',
            (case when jsonb_typeof(payment.data->'history') = 'array' then payment.data->'history' else '[]'::jsonb end)
            || jsonb_build_array(jsonb_build_object('action', 'unlinked', 'at', v_now, 'by', auth.uid())),
          'updatedAt', v_now
        )
      else
        (payment.data - 'claimId' - 'linkedAt' - 'linkedBy') || jsonb_build_object(
          'status', 'linked',
          'claimId', btrim(p_claim_id),
          'linkedAt', v_now,
          'linkedBy', auth.uid(),
          'history',
            (case when jsonb_typeof(payment.data->'history') = 'array' then payment.data->'history' else '[]'::jsonb end)
            || jsonb_build_array(jsonb_build_object('action', 'linked', 'at', v_now, 'by', auth.uid(), 'claimId', btrim(p_claim_id))),
          'updatedAt', v_now
        )
    end,
    updated_at = v_now
  where payment.user_id = p_owner_user_id and payment.id = p_payment_id
  returning payment.data into v_data;

  if v_data is null then
    raise exception 'El pago de seguro ya no está disponible.';
  end if;
  return v_data;
end;
$$;

create or replace function public.return_insurance_bank_payment_to_payments(
  p_owner_user_id uuid,
  p_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
  v_bank_item jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'incidents'), false) then
    raise exception 'No tienes permiso para devolver pagos a Pagos.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_user_id::text || ':insurance-bank', 0));

  select payment.data into v_data
  from public.insurance_bank_payments_cloud payment
  where payment.user_id = p_owner_user_id and payment.id = p_payment_id
  for update;

  if v_data is null then raise exception 'El pago de seguro ya no está disponible.'; end if;
  if coalesce(v_data->>'status', 'pending') = 'linked' then
    raise exception 'Desvincula el pago del expediente antes de devolverlo a Pagos.';
  end if;

  v_bank_item := v_data->'bankItem';
  if v_bank_item is null or jsonb_typeof(v_bank_item) <> 'object' then
    raise exception 'El movimiento bancario no contiene datos válidos.';
  end if;
  v_bank_item := (v_bank_item - 'insuranceRoutingHistory') || jsonb_build_object(
    'insuranceRoutingHistory',
      (case when jsonb_typeof(v_data->'history') = 'array' then v_data->'history' else '[]'::jsonb end)
      || jsonb_build_array(jsonb_build_object('action', 'returned', 'at', v_now, 'by', auth.uid()))
  );

  if exists (
    select 1 from public.pending_bank_items_cloud pending
    where pending.user_id = p_owner_user_id and pending.id = p_payment_id
  ) then
    raise exception 'El folio ya está nuevamente en Pagos.';
  end if;

  insert into public.pending_bank_items_cloud(user_id, id, data, created_at, updated_at)
  values (p_owner_user_id, p_payment_id, v_bank_item, v_now, v_now);

  delete from public.insurance_bank_payments_cloud payment
  where payment.user_id = p_owner_user_id and payment.id = p_payment_id;

  return v_bank_item;
end;
$$;

-- Un folio enviado a Seguros también cuenta como procesado para que una nueva
-- importación del CSV no lo vuelva a crear en Pendientes del banco.
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
        select 1 from public.insurance_bank_payments_cloud insurance_payment
        where insurance_payment.user_id = p_owner_user_id
          and upper(regexp_replace(insurance_payment.id, '\s+', '', 'g')) = i.folio
      )
    );
$$;

revoke all on function public.forward_bank_items_to_insurance(uuid, text[], text) from public, anon;
grant execute on function public.forward_bank_items_to_insurance(uuid, text[], text) to authenticated;
revoke all on function public.set_insurance_bank_payment_claim(uuid, text, text) from public, anon;
grant execute on function public.set_insurance_bank_payment_claim(uuid, text, text) to authenticated;
revoke all on function public.return_insurance_bank_payment_to_payments(uuid, text) from public, anon;
grant execute on function public.return_insurance_bank_payment_to_payments(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'insurance_bank_payments_cloud'
    ) then
    alter publication supabase_realtime add table public.insurance_bank_payments_cloud;
  end if;
end $$;
