-- Rentautos: evita recorrer payments_cloud cuando un UPDATE no cambia la
-- identidad ni el orden cronologico del pago (por ejemplo, al marcar un
-- recibo como enviado).
-- Ejecutar despues de 88-payment-insert-latest-fast-path.sql.

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

  -- Campos como receiptDeliveryStatus no cambian a que cliente pertenece el
  -- pago ni su posicion cronologica. Si el pago es el ultimo del cliente,
  -- actualiza solo esa fila del cache; si no lo es, no hay nada que recalcular.
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

  -- Los cambios de identidad/fecha y las eliminaciones si pueden invalidar el
  -- ultimo pago, por lo que conservan la reconstruccion historica segura.
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

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

grant execute on function public.refresh_latest_payment_for_payment_row() to authenticated;

notify pgrst, 'reload schema';
