-- Rentautos: rutas rapidas para el mantenimiento derivado al eliminar pagos.
-- Evita reconstruir historiales y retenciones que la fila eliminada no puede afectar.

create index if not exists latest_payments_owner_payment_idx
  on public.latest_payments_by_client_cloud (user_id, payment_id);

create or replace function public.refresh_latest_payment_for_payment_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_client_id text;
  v_old_client_id text;
  v_old_unit text;
  v_new_client_id text;
  v_new_unit text;
begin
  v_owner_user_id := coalesce(new.user_id, old.user_id);
  v_old_client_id := case when tg_op in ('UPDATE', 'DELETE') then old.data->>'clientId' else null end;
  v_old_unit := case when tg_op in ('UPDATE', 'DELETE') then public.receivable_identity_unit(old.data->>'clientUnit') else null end;
  v_new_client_id := case when tg_op in ('INSERT', 'UPDATE') then new.data->>'clientId' else null end;
  v_new_unit := case when tg_op in ('INSERT', 'UPDATE') then public.receivable_identity_unit(new.data->>'clientUnit') else null end;

  -- Una eliminacion solo cambia el cache si la fila borrada era el ultimo pago
  -- de algun cliente. El indice directo evita buscar clientes por identidad y
  -- evita recorrer el historial cuando se elimina una factura anterior.
  if tg_op = 'DELETE' then
    for v_client_id in
      select latest.client_id
      from public.latest_payments_by_client_cloud latest
      where latest.user_id = old.user_id
        and latest.payment_id = old.id
      order by latest.client_id
    loop
      perform public.rebuild_latest_payment_for_client(old.user_id, v_client_id);
    end loop;
    return old;
  end if;

  -- Un pago nuevo puede actualizar el cache directamente sin recorrer el
  -- historial completo del cliente.
  if tg_op = 'INSERT'
     and coalesce(v_new_client_id, '') <> ''
     and exists (
       select 1
       from public.clients_cloud client
       where client.user_id = new.user_id
         and client.id = v_new_client_id
         and coalesce(lower(client.data->>'status'), 'activo') <> 'archivado'
         and nullif(client.data->>'archivedAt', '') is null
     )
  then
    insert into public.latest_payments_by_client_cloud (
      user_id,
      client_id,
      payment_id,
      client_unit,
      date_applied,
      created_at_payment,
      data,
      updated_at
    )
    values (
      new.user_id,
      v_new_client_id,
      new.id,
      nullif(new.data->>'clientUnit', ''),
      nullif(new.data->>'dateApplied', ''),
      nullif(new.data->>'createdAt', ''),
      new.data,
      now()
    )
    on conflict (user_id, client_id) do update
    set payment_id = excluded.payment_id,
        client_unit = excluded.client_unit,
        date_applied = excluded.date_applied,
        created_at_payment = excluded.created_at_payment,
        data = excluded.data,
        updated_at = now()
    where (
      coalesce(excluded.date_applied, ''),
      coalesce(excluded.created_at_payment, ''),
      excluded.payment_id
    ) > (
      coalesce(latest_payments_by_client_cloud.date_applied, ''),
      coalesce(latest_payments_by_client_cloud.created_at_payment, ''),
      latest_payments_by_client_cloud.payment_id
    );

    return new;
  end if;

  -- Campos de entrega del recibo no cambian a quien pertenece el pago ni su
  -- posicion cronologica. Actualiza el cache solo si contiene esta fila.
  if tg_op = 'UPDATE'
     and old.user_id is not distinct from new.user_id
     and old.id is not distinct from new.id
     and old.data->>'clientId' is not distinct from new.data->>'clientId'
     and old.data->>'clientUnit' is not distinct from new.data->>'clientUnit'
     and old.data->>'clientCedula' is not distinct from new.data->>'clientCedula'
     and old.data->>'clientName' is not distinct from new.data->>'clientName'
     and old.data->>'dateApplied' is not distinct from new.data->>'dateApplied'
     and old.data->>'createdAt' is not distinct from new.data->>'createdAt'
  then
    update public.latest_payments_by_client_cloud
    set client_unit = nullif(new.data->>'clientUnit', ''),
        date_applied = nullif(new.data->>'dateApplied', ''),
        created_at_payment = nullif(new.data->>'createdAt', ''),
        data = new.data,
        updated_at = now()
    where user_id = new.user_id
      and payment_id = new.id;

    return new;
  end if;

  -- Un cambio real de identidad o fecha puede afectar mas de un cliente y
  -- conserva la reconstruccion historica completa.
  for v_client_id in
    select distinct c.id
    from public.clients_cloud c
    where c.user_id = v_owner_user_id
      and coalesce(lower(c.data->>'status'), 'activo') <> 'archivado'
      and nullif(c.data->>'archivedAt', '') is null
      and (
        c.id = v_old_client_id
        or c.id = v_new_client_id
        or (coalesce(v_old_unit, '') <> '' and public.receivable_identity_unit(c.data->>'unitId') = v_old_unit)
        or (coalesce(v_new_unit, '') <> '' and public.receivable_identity_unit(c.data->>'unitId') = v_new_unit)
      )
  loop
    perform public.rebuild_latest_payment_for_client(v_owner_user_id, v_client_id);
  end loop;

  return new;
end;
$$;

grant execute on function public.refresh_latest_payment_for_payment_row() to authenticated;

create or replace function public.sync_other_charges_retention_checkpoint_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_has_retention boolean := false;
  v_new_has_retention boolean := false;
  v_old_client_id text;
  v_new_client_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_client_id := old.data->>'clientId';
    v_old_has_retention := public.payment_has_other_charges_retention(old.data);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_client_id := new.data->>'clientId';
    v_new_has_retention := public.payment_has_other_charges_retention(new.data);
  end if;

  -- Una fila sin retencion no puede cambiar el punto de control. En UPDATE,
  -- refresca cada cliente afectado una sola vez aunque ambos estados apliquen.
  if v_old_has_retention then
    perform public.refresh_other_charges_retention_checkpoint(old.user_id, v_old_client_id);
  end if;
  if v_new_has_retention
     and (
       not v_old_has_retention
       or new.user_id is distinct from old.user_id
       or v_new_client_id is distinct from v_old_client_id
     ) then
    perform public.refresh_other_charges_retention_checkpoint(new.user_id, v_new_client_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_other_charges_retention_checkpoint_from_payment() from public;

analyze public.latest_payments_by_client_cloud;
analyze public.payments_cloud;
notify pgrst, 'reload schema';

