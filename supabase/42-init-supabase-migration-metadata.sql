-- Rentautos: inicializa metadata interna de migraciones Supabase CLI.
-- Esto evita logs 42P01 del dashboard cuando consulta supabase_migrations.schema_migrations.
-- No modifica tablas, politicas ni datos operativos de la aplicacion.

create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
