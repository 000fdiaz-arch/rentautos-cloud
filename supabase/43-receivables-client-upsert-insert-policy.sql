-- Rentautos: Cuentas por cobrar usa upsert sobre clients_cloud al guardar WhatsApp.
-- PostgREST valida INSERT y UPDATE durante upsert; por eso receivables debe pasar ambas politicas.
-- No modifica datos, tablas ni flujo de la aplicacion.

drop policy if exists "clients_cloud_clients_insert" on public.clients_cloud;

create policy "clients_cloud_clients_insert"
on public.clients_cloud
for insert
to authenticated
with check (
  (select public.can_edit_owner_screen(user_id, 'clients'))
  or (select public.can_edit_owner_screen(user_id, 'payments'))
  or (select public.can_edit_owner_screen(user_id, 'receivables'))
);
