-- Rentautos: publicar datos core en Supabase Realtime.
-- Ejecutar despues de 29-fleet-status-rpc-no-partial-fallback.sql.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clients_cloud'
  ) then
    alter publication supabase_realtime add table public.clients_cloud;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'payments_cloud'
  ) then
    alter publication supabase_realtime add table public.payments_cloud;
  end if;
end $$;
