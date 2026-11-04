-- Ruta necesita leer la retencion vigente para calcular un cobro en efectivo.
-- El permiso es deliberadamente de solo lectura: los operadores de Ruta no
-- pueden cambiar la configuracion de Otros cargos.

drop policy if exists "other_charges_retention_route_read"
  on public.other_charges_retention_cloud;

create policy "other_charges_retention_route_read"
on public.other_charges_retention_cloud
for select
to authenticated
using ((select public.can_view_owner_screen(user_id, 'route_search')));

grant select on public.other_charges_retention_cloud to authenticated;
