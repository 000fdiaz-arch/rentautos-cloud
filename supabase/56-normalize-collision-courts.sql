-- Normaliza los nombres de juzgados existentes y corrige el error JAUN DIAZ.
-- Ejecutar despues de 55-collisions-workflow.sql.

update public.collision_cases_cloud
set
  data = jsonb_set(
    data,
    '{court}',
    to_jsonb(
      case
        when upper(btrim(data ->> 'court')) = 'JAUN DIAZ' then 'JUAN DIAZ'
        else upper(btrim(data ->> 'court'))
      end
    ),
    true
  ),
  updated_at = now()
where jsonb_typeof(data -> 'court') = 'string'
  and data ->> 'court' is distinct from
    case
      when upper(btrim(data ->> 'court')) = 'JAUN DIAZ' then 'JUAN DIAZ'
      else upper(btrim(data ->> 'court'))
    end;
