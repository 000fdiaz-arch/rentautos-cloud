-- Rentautos: realtime para Cuentas por cobrar.
-- Ejecutar despues de 35-receivables-screen-permissions.sql.

do $$
begin
  if to_regclass('public.street_management_cloud') is not null
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'street_management_cloud'
    )
  then
    alter publication supabase_realtime add table public.street_management_cloud;
  end if;

  if to_regclass('public.collection_closures_cloud') is not null
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'collection_closures_cloud'
    )
  then
    alter publication supabase_realtime add table public.collection_closures_cloud;
  end if;

  if to_regclass('public.street_management_items_cloud') is not null
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'street_management_items_cloud'
    )
  then
    alter publication supabase_realtime add table public.street_management_items_cloud;
  end if;
end $$;
