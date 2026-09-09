-- El lugar de la colisión deja de ser obligatorio; conserva los datos existentes.
-- Impide concluir un expediente judicial sin la información mínima del siniestro.
-- Los avances parciales y el cierre administrativo continúan permitidos.

create or replace function public.guard_collision_case_completion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  new_status text := upper(coalesce(new.data ->> 'status', ''));
  old_status text := case when tg_op = 'UPDATE' then upper(coalesce(old.data ->> 'status', '')) else '' end;
  missing_requirements text[] := array[]::text[];
begin
  if new_status not in ('ABSUELTO', 'CULPABLE') or old_status = new_status then
    return new;
  end if;

  if btrim(coalesce(new.data ->> 'incidentDate', '')) = '' then missing_requirements := array_append(missing_requirements, 'Fecha de la colisión'); end if;
  if btrim(coalesce(new.data ->> 'unit', '')) = '' then missing_requirements := array_append(missing_requirements, 'Unidad'); end if;
  if btrim(coalesce(new.data ->> 'driver', '')) = '' then missing_requirements := array_append(missing_requirements, 'Conductor'); end if;
  if btrim(coalesce(new.data ->> 'plate', '')) = '' then missing_requirements := array_append(missing_requirements, 'Placa'); end if;
  if btrim(coalesce(new.data ->> 'vehicleDamage', '')) = '' then missing_requirements := array_append(missing_requirements, 'Descripción de los daños'); end if;
  if btrim(coalesce(new.data ->> 'trialDate', '')) = '' then missing_requirements := array_append(missing_requirements, 'Fecha del juicio'); end if;
  if btrim(coalesce(new.data ->> 'ticketStub', '')) = '' then missing_requirements := array_append(missing_requirements, 'Número o referencia de la colilla'); end if;
  if btrim(coalesce(new.data ->> 'placeTime', '')) = '' then missing_requirements := array_append(missing_requirements, 'Hora del juicio'); end if;
  if btrim(coalesce(new.data ->> 'court', '')) = '' then missing_requirements := array_append(missing_requirements, 'Juzgado'); end if;
  if lower(coalesce(new.data ->> 'documentationPending', 'false')) = 'true' then missing_requirements := array_append(missing_requirements, 'Documentación marcada como pendiente'); end if;

  if coalesce(jsonb_typeof(new.data -> 'expenseInvoice'), '') <> 'object' then
    missing_requirements := array_append(missing_requirements, 'Saldo de colisión');
  end if;
  if btrim(coalesce(new.data #>> '{judicialOutcomeEvidence,path}', '')) = '' then
    missing_requirements := array_append(missing_requirements, 'Evidencia del resultado');
  end if;

  if cardinality(missing_requirements) > 0 then
    raise exception 'No se puede concluir el expediente. Falta completar: %.', array_to_string(missing_requirements, ', ')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists collision_case_completion_guard on public.collision_cases_cloud;
create trigger collision_case_completion_guard
before insert or update of data on public.collision_cases_cloud
for each row execute function public.guard_collision_case_completion();

