-- Hotfix: reparar corrimiento de fechas en pagos/cierres (27 -> 28/29)
-- Contexto:
--   Algunos registros quedaron con dateApplied/date = '2026-05-27'
--   aunque se crearon el 28/29 en hora local de Panama.
--
-- Uso recomendado:
--   1) Ejecuta primero los SELECT de "preview" y valida conteos.
--   2) Si todo luce correcto, ejecuta los UPDATE.
--   3) Vuelve a correr los SELECT para verificar.

-- =========================
-- PREVIEW: payments_cloud
-- =========================
with candidates as (
  select
    p.user_id,
    p.id,
    p.data->>'dateApplied' as stored_date_applied,
    p.data->>'createdAt' as created_at_utc,
    ((p.data->>'createdAt')::timestamptz at time zone 'America/Panama')::date as created_at_pa_date
  from public.payments_cloud p
  where p.data ? 'dateApplied'
    and p.data ? 'createdAt'
    and p.data->>'dateApplied' = '2026-05-27'
    and ((p.data->>'createdAt')::timestamptz at time zone 'America/Panama')::date in ('2026-05-28', '2026-05-29')
)
select user_id, created_at_pa_date, count(*) as rows_to_fix
from candidates
group by user_id, created_at_pa_date
order by user_id, created_at_pa_date;

-- =========================
-- APPLY: payments_cloud
-- =========================
update public.payments_cloud p
set
  data = jsonb_set(
    p.data,
    '{dateApplied}',
    to_jsonb((((p.data->>'createdAt')::timestamptz at time zone 'America/Panama')::date)::text),
    true
  ),
  updated_at = now()
where p.data ? 'dateApplied'
  and p.data ? 'createdAt'
  and p.data->>'dateApplied' = '2026-05-27'
  and ((p.data->>'createdAt')::timestamptz at time zone 'America/Panama')::date in ('2026-05-28', '2026-05-29');

-- =========================
-- PREVIEW: cash_closings_cloud
-- =========================
with candidates as (
  select
    c.user_id,
    c.id,
    c.data->>'date' as stored_closing_date,
    c.data->>'closedAt' as closed_at_utc,
    ((c.data->>'closedAt')::timestamptz at time zone 'America/Panama')::date as closed_at_pa_date
  from public.cash_closings_cloud c
  where c.data ? 'date'
    and c.data ? 'closedAt'
    and c.data->>'date' = '2026-05-27'
    and ((c.data->>'closedAt')::timestamptz at time zone 'America/Panama')::date in ('2026-05-28', '2026-05-29')
)
select user_id, closed_at_pa_date, count(*) as rows_to_fix
from candidates
group by user_id, closed_at_pa_date
order by user_id, closed_at_pa_date;

-- =========================
-- APPLY: cash_closings_cloud
-- =========================
update public.cash_closings_cloud c
set
  data = jsonb_set(
    c.data,
    '{date}',
    to_jsonb((((c.data->>'closedAt')::timestamptz at time zone 'America/Panama')::date)::text),
    true
  ),
  updated_at = now()
where c.data ? 'date'
  and c.data ? 'closedAt'
  and c.data->>'date' = '2026-05-27'
  and ((c.data->>'closedAt')::timestamptz at time zone 'America/Panama')::date in ('2026-05-28', '2026-05-29');

-- =========================
-- PREVIEW: cash_closing_audit_cloud
-- =========================
with candidates as (
  select
    a.user_id,
    a.id,
    a.data->>'date' as stored_audit_date,
    a.data->>'createdAt' as created_at_utc,
    ((a.data->>'createdAt')::timestamptz at time zone 'America/Panama')::date as created_at_pa_date
  from public.cash_closing_audit_cloud a
  where a.data ? 'date'
    and a.data ? 'createdAt'
    and a.data->>'date' = '2026-05-27'
    and ((a.data->>'createdAt')::timestamptz at time zone 'America/Panama')::date in ('2026-05-28', '2026-05-29')
)
select user_id, created_at_pa_date, count(*) as rows_to_fix
from candidates
group by user_id, created_at_pa_date
order by user_id, created_at_pa_date;

-- =========================
-- APPLY: cash_closing_audit_cloud
-- =========================
update public.cash_closing_audit_cloud a
set
  data = jsonb_set(
    a.data,
    '{date}',
    to_jsonb((((a.data->>'createdAt')::timestamptz at time zone 'America/Panama')::date)::text),
    true
  ),
  updated_at = now()
where a.data ? 'date'
  and a.data ? 'createdAt'
  and a.data->>'date' = '2026-05-27'
  and ((a.data->>'createdAt')::timestamptz at time zone 'America/Panama')::date in ('2026-05-28', '2026-05-29');

