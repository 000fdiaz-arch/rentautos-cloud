-- Rentautos: Cuentas por cobrar puede actualizar datos de clientes usados por cobranza.
-- Ejecutar despues de 39-receivables-core-read-and-settings-read.sql.

drop policy if exists "clients_cloud_clients_update" on public.clients_cloud;

create policy "clients_cloud_clients_update"
on public.clients_cloud
for update
to authenticated
using (
  (select public.can_edit_owner_screen(user_id, 'clients'))
  or (select public.can_edit_owner_screen(user_id, 'payments'))
  or (select public.can_edit_owner_screen(user_id, 'receivables'))
)
with check (
  (select public.can_edit_owner_screen(user_id, 'clients'))
  or (select public.can_edit_owner_screen(user_id, 'payments'))
  or (select public.can_edit_owner_screen(user_id, 'receivables'))
);
