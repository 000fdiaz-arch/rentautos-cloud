-- Permite editar fichas históricas con números internos de tres dígitos,
-- sin ampliar el rango que la interfaz ofrece para unidades nuevas.
begin;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.save_fleet_unit(uuid,jsonb)'::regprocedure)
  into v_definition;

  if position('v_number > 100' in v_definition) = 0 then
    raise exception 'No se encontro la validacion esperada en save_fleet_unit';
  end if;

  v_definition := replace(v_definition, 'v_number > 100', 'v_number > 999');
  execute v_definition;
end;
$$;

notify pgrst, 'reload schema';
commit;
