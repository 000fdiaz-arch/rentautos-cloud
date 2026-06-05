-- Rentautos Cloud - Supabase Health Audit (MICRO-friendly triage)
-- Fecha: 2026-05-27
--
-- Objetivo:
-- 1) Detectar por que el proyecto puede seguir en "Unhealthy"
-- 2) Confirmar si el problema viene por writes, queries lentas, conexiones o RLS costosa
--
-- Uso:
-- - Ejecutar por secciones en SQL Editor de Supabase.
-- - Guardar resultados (capturas o CSV) para comparativo antes/despues.

-- =========================================================
-- A) Estado general: tamano, actividad, waits
-- =========================================================

select
  now() as captured_at,
  current_database() as db_name,
  pg_size_pretty(pg_database_size(current_database())) as db_size;

select
  datname,
  numbackends as active_backends,
  xact_commit,
  xact_rollback,
  blks_read,
  blks_hit,
  tup_returned,
  tup_fetched,
  tup_inserted,
  tup_updated,
  tup_deleted,
  conflicts,
  temp_files,
  temp_bytes,
  deadlocks
from pg_stat_database
where datname = current_database();

-- Sesiones y esperas activas (saturacion de conexiones / lock waits)
select
  state,
  wait_event_type,
  wait_event,
  count(*) as sessions
from pg_stat_activity
where datname = current_database()
group by 1, 2, 3
order by sessions desc;

-- Top sesiones activas largas (si aparecen, investigar esas queries)
select
  pid,
  usename,
  state,
  wait_event_type,
  wait_event,
  now() - query_start as running_for,
  left(query, 220) as query_snippet
from pg_stat_activity
where datname = current_database()
  and state <> 'idle'
order by running_for desc
limit 20;

-- =========================================================
-- B) Top queries por tiempo total (requiere pg_stat_statements)
-- =========================================================

-- Verifica si extension esta disponible
select extname
from pg_extension
where extname = 'pg_stat_statements';

-- Top queries por costo total (CPU/IO)
select
  calls,
  round(total_exec_time::numeric, 2) as total_ms,
  round(mean_exec_time::numeric, 2) as mean_ms,
  round((100 * total_exec_time / nullif(sum(total_exec_time) over (), 0))::numeric, 2) as pct_total_exec_time,
  rows,
  shared_blks_hit,
  shared_blks_read,
  temp_blks_read,
  temp_blks_written,
  left(query, 250) as query_snippet
from pg_stat_statements
order by total_exec_time desc
limit 30;

-- Top queries por frecuencia (tormentas de requests)
select
  calls,
  round(mean_exec_time::numeric, 2) as mean_ms,
  rows,
  left(query, 220) as query_snippet
from pg_stat_statements
order by calls desc
limit 30;

-- =========================================================
-- C) Hot tables: lecturas/escrituras, seq scan, dead tuples
-- =========================================================

select
  schemaname,
  relname as table_name,
  seq_scan,
  idx_scan,
  n_tup_ins,
  n_tup_upd,
  n_tup_del,
  n_dead_tup,
  vacuum_count,
  autovacuum_count,
  analyze_count,
  autoanalyze_count
from pg_stat_user_tables
where schemaname = 'public'
order by (n_tup_ins + n_tup_upd + n_tup_del) desc
limit 40;

-- Tablas cloud prioritarias: buscar seq_scan alto con idx_scan bajo
select
  relname as table_name,
  seq_scan,
  idx_scan,
  n_live_tup,
  n_dead_tup
from pg_stat_user_tables
where schemaname = 'public'
  and relname in (
    'clients_cloud',
    'payments_cloud',
    'street_management_cloud',
    'collection_closures_cloud',
    'pending_bank_items_cloud',
    'pending_card_items_cloud',
    'notified_payments_cloud',
    'cash_closings_cloud',
    'cash_closing_audit_cloud',
    'charge_runs_cloud',
    'clients_daily_collection_cloud',
    'clients_daily_collection_promises_cloud',
    'clients_daily_collection_street_actions_cloud'
  )
order by seq_scan desc;

-- =========================================================
-- D) Uso de indices (identificar faltantes o inutiles)
-- =========================================================

select
  s.schemaname,
  s.relname as table_name,
  s.indexrelname as index_name,
  s.idx_scan,
  pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size
from pg_stat_user_indexes s
join pg_index i on i.indexrelid = s.indexrelid
where s.schemaname = 'public'
order by s.idx_scan asc, pg_relation_size(s.indexrelid) desc
limit 60;

-- Verifica existencia de indices criticos por user_id + id
select
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'clients_cloud',
    'payments_cloud',
    'pending_bank_items_cloud',
    'pending_card_items_cloud'
  )
order by tablename, indexname;

-- =========================================================
-- E) Bloat / tablas candidatas a mantenimiento
-- =========================================================

select
  relname as table_name,
  n_live_tup,
  n_dead_tup,
  case when n_live_tup > 0
    then round((100.0 * n_dead_tup / n_live_tup)::numeric, 2)
    else 0 end as dead_pct
from pg_stat_user_tables
where schemaname = 'public'
order by dead_pct desc, n_dead_tup desc
limit 30;

-- =========================================================
-- F) RLS footprint (cantidad y complejidad de policies)
-- =========================================================

select
  tablename,
  count(*) as policy_count
from pg_policies
where schemaname = 'public'
group by tablename
order by policy_count desc, tablename;

-- Policies sobre tablas cloud core
select
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'clients_cloud',
    'payments_cloud',
    'street_management_cloud',
    'collection_closures_cloud',
    'pending_bank_items_cloud',
    'pending_card_items_cloud'
  )
order by tablename, policyname;

-- =========================================================
-- G) Duplicados de negocio (deberia devolver 0 filas)
-- =========================================================

-- pagos duplicados por user+id
select user_id, id, count(*) as dupes
from public.payments_cloud
group by user_id, id
having count(*) > 1
order by dupes desc
limit 20;

-- clientes duplicados por user+id
select user_id, id, count(*) as dupes
from public.clients_cloud
group by user_id, id
having count(*) > 1
order by dupes desc
limit 20;

-- =========================================================
-- H) Realtime footprint (si hay demasiados canales/sesiones)
-- =========================================================
-- Nota: pg_stat_activity + application_name ayuda a ver conexiones realtime/postgrest.
select
  coalesce(application_name, '(null)') as application_name,
  state,
  count(*) as sessions
from pg_stat_activity
where datname = current_database()
group by 1, 2
order by sessions desc;

-- =========================================================
-- I) Mini plan de remediacion guiado por evidencia
-- =========================================================
-- 1) Si top query por total_ms contiene scans a tablas cloud:
--    - agregar/ajustar indice compuesto (user_id, id) o (user_id, created_at) segun patron.
-- 2) Si calls altisimo con mean_ms bajo:
--    - reducir frecuencia cliente (debounce/poll/retry).
-- 3) Si n_dead_tup/dead_pct alto:
--    - revisar autovacuum settings y tablas con updates masivos.
-- 4) Si policy_count alto + qual compleja:
--    - simplificar funciones RLS para evitar evaluaciones costosas.
-- 5) Si sessions activas altas:
--    - limitar tabs/suscripciones, validar cierre de channels realtime.

