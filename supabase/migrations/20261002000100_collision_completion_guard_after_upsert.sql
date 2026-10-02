-- Permite actualizar expedientes ya concluidos mediante upsert sin volver a
-- exigir los requisitos que solo corresponden a la transición de estado.
--
-- Un trigger BEFORE INSERT se ejecuta antes de que PostgreSQL resuelva el
-- ON CONFLICT DO UPDATE. Al moverlo a AFTER, un upsert de una fila existente
-- llega como UPDATE y guard_collision_case_completion puede comparar OLD/NEW.

drop trigger if exists collision_case_completion_guard on public.collision_cases_cloud;

create trigger collision_case_completion_guard
after insert or update of data on public.collision_cases_cloud
for each row execute function public.guard_collision_case_completion();
