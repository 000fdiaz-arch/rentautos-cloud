-- Estado de la llave del auto: true = codificada, false = no codificada, null = sin confirmar.

alter table public.fleet_units_cloud
  add column if not exists key_coded boolean;

create or replace function public.save_fleet_key_coded(
  p_owner_user_id uuid,
  p_fleet_id uuid,
  p_key_coded boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not coalesce(public.can_edit_owner_screen(p_owner_user_id, 'control_units'), false) then
    raise exception 'No autorizado para editar la llave del auto';
  end if;

  update public.fleet_units_cloud
  set key_coded = p_key_coded,
      updated_at = now()
  where user_id = p_owner_user_id
    and fleet_id = p_fleet_id
    and retired_at is null;

  if not found then
    raise exception 'No se encontro el auto activo solicitado';
  end if;
end;
$$;

revoke all on function public.save_fleet_key_coded(uuid, uuid, boolean) from public;
grant execute on function public.save_fleet_key_coded(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
