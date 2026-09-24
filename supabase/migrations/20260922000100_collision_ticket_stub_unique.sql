-- Evita que una misma colilla cree dos expedientes judiciales para el mismo owner.
-- La comparación ignora mayúsculas, espacios y guiones.

create or replace function public.prevent_duplicate_collision_ticket_stub()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_ticket_stub text;
  previous_normalized_ticket_stub text;
begin
  normalized_ticket_stub := upper(regexp_replace(coalesce(new.data ->> 'ticketStub', ''), '[[:space:]-]+', '', 'g'));
  if normalized_ticket_stub = '' then
    return new;
  end if;

  -- Los duplicados que existían antes de esta regla pueden seguir corrigiéndose.
  -- La unicidad se exige al registrar o modificar la colilla.
  if tg_op = 'UPDATE' then
    previous_normalized_ticket_stub := upper(regexp_replace(coalesce(old.data ->> 'ticketStub', ''), '[[:space:]-]+', '', 'g'));
    if previous_normalized_ticket_stub = normalized_ticket_stub then
      return new;
    end if;
  end if;

  -- Serializa intentos concurrentes para el mismo owner y la misma colilla.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || normalized_ticket_stub, 0));

  if exists (
    select 1
    from public.collision_cases_cloud existing
    where existing.user_id = new.user_id
      and existing.id <> new.id
      and upper(regexp_replace(coalesce(existing.data ->> 'ticketStub', ''), '[[:space:]-]+', '', 'g')) = normalized_ticket_stub
  ) then
    raise exception 'El número de colilla % ya está registrado.', new.data ->> 'ticketStub'
      using errcode = '23505', constraint = 'collision_cases_cloud_user_ticket_stub_unique';
  end if;

  return new;
end;
$$;

drop trigger if exists collision_cases_cloud_unique_ticket_stub on public.collision_cases_cloud;
create trigger collision_cases_cloud_unique_ticket_stub
before insert or update of user_id, data
on public.collision_cases_cloud
for each row
execute function public.prevent_duplicate_collision_ticket_stub();

revoke all on function public.prevent_duplicate_collision_ticket_stub() from public, anon, authenticated;
