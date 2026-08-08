-- Rentautos: lectura compacta y segura del ultimo pago para Cuentas por Cobrar.
-- Evita que el navegador dependa de consultas IN extensas o de acceso directo
-- a latest_payments_by_client_cloud.

create or replace function public.latest_payments_for_active_receivables(
  p_owner_user_id uuid
)
returns table(client_id text, payment_id text, data jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_access_owner_data(p_owner_user_id) then
    raise exception 'No autorizado para consultar los ultimos pagos de este propietario.'
      using errcode = '42501';
  end if;

  return query
  select
    latest.client_id,
    latest.payment_id,
    latest.data
  from public.latest_payments_by_client_cloud latest
  where latest.user_id = p_owner_user_id
  order by latest.client_id;
end;
$$;

revoke execute on function public.latest_payments_for_active_receivables(uuid) from public;
revoke execute on function public.latest_payments_for_active_receivables(uuid) from anon;
grant execute on function public.latest_payments_for_active_receivables(uuid) to authenticated;

notify pgrst, 'reload schema';
