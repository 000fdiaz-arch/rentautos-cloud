-- Rentautos: evita timeout 57014 al cambiar el estado operativo desde Autos.
-- Ejecutar despues de 86-receivables-route-read-indexes.sql.
--
-- El ultimo pago depende de la identidad del cliente, no de que su estado
-- operativo cambie entre activo, taller, chapisteria o custodia. La funcion
-- anterior reconstruia el ultimo pago y recorria el historial innecesariamente
-- en cada uno de esos cambios.

create or replace function public.refresh_latest_payment_for_client_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_active boolean;
  v_new_active boolean;
  v_identity_changed boolean;
begin
  if tg_op = 'DELETE' then
    delete from public.latest_payments_by_client_cloud
    where user_id = old.user_id
      and client_id = old.id;
    return old;
  end if;

  v_new_active := coalesce(lower(new.data->>'status'), 'activo') <> 'archivado'
    and nullif(new.data->>'archivedAt', '') is null;

  if tg_op = 'INSERT' then
    if v_new_active then
      perform public.rebuild_latest_payment_for_client(new.user_id, new.id);
    end if;
    return new;
  end if;

  v_old_active := coalesce(lower(old.data->>'status'), 'activo') <> 'archivado'
    and nullif(old.data->>'archivedAt', '') is null;
  v_identity_changed := old.user_id is distinct from new.user_id
    or old.id is distinct from new.id
    or public.receivable_identity_unit(old.data->>'unitId') is distinct from public.receivable_identity_unit(new.data->>'unitId')
    or public.receivable_identity_cedula(old.data->>'cedula') is distinct from public.receivable_identity_cedula(new.data->>'cedula')
    or public.receivable_identity_name(old.data->>'name') is distinct from public.receivable_identity_name(new.data->>'name');

  -- Los cambios financieros u operativos no alteran la identidad que enlaza
  -- al cliente con sus pagos. Si se archiva, basta con retirar la fila cacheada.
  if not v_identity_changed then
    if v_old_active and not v_new_active then
      delete from public.latest_payments_by_client_cloud
      where user_id = new.user_id
        and client_id = new.id;
    elsif not v_old_active and v_new_active then
      perform public.rebuild_latest_payment_for_client(new.user_id, new.id);
    end if;
    return new;
  end if;

  delete from public.latest_payments_by_client_cloud
  where user_id = old.user_id
    and client_id = old.id;

  if v_new_active then
    perform public.rebuild_latest_payment_for_client(new.user_id, new.id);
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
