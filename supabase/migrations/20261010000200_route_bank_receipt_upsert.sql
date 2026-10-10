-- Permite que un UPSERT de un pago bancario de Ruta ya existente llegue a su
-- fase UPDATE. PostgreSQL ejecuta los triggers BEFORE INSERT antes de resolver
-- ON CONFLICT; la fase UPDATE vuelve a ejecutar este guard y conserva los
-- permisos normales de Pagos. Las confirmaciones bancarias nuevas siguen
-- requiriendo un administrador.

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
     and new.data->>'paymentMethod' in (
       'ACH Express',
       'Deposito Bancario',
       'Transferencia Bancaria'
     ) then
    -- Supabase usa INSERT ... ON CONFLICT DO UPDATE para cambios de metadatos,
    -- por ejemplo receiptDeliveryStatus al copiar un recibo. Si la fila ya
    -- existe, permitimos alcanzar la fase UPDATE, que valida los permisos otra
    -- vez mediante este mismo trigger.
    if exists (
      select 1
      from public.payments_cloud existing
      where existing.user_id = new.user_id
        and existing.id = new.id
    ) then
      return new;
    end if;

    if public.is_valid_admin_route_bank_confirmation(new.user_id, new.data) then
      return new;
    end if;
    raise exception 'Solo el administrador puede confirmar pagos bancarios de Ruta';
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

revoke all on function public.guard_payment_write_scope() from public, anon, authenticated;
notify pgrst, 'reload schema';
