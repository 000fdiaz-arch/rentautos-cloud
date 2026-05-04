-- Archivo: grupo_a_import_postgres.sql
-- Objetivo: Cargar GRUPO A en formato staging + validacion + upsert
-- Ajusta SOLO los nombres de tabla final/columnas en la seccion 4.

BEGIN;

-- 1) STAGING
DROP TABLE IF EXISTS stg_grupo_a;
CREATE TABLE stg_grupo_a (
  unidad text,
  cliente text,
  cedula text,
  renta numeric(12,2),
  frecuencia_raw text,
  cuotas_pactadas integer,
  cuotas_restantes integer,
  otros_saldos text,
  monto_a_cobrar numeric(12,2),
  deposito numeric(12,2)
);

-- 2) IMPORTAR CSV (elige UNA opcion)
-- 2A) psql local:
-- \copy stg_grupo_a(unidad,cliente,cedula,renta,frecuencia_raw,cuotas_pactadas,cuotas_restantes,otros_saldos,monto_a_cobrar,deposito)
-- FROM 'C:/Users/Gedler3000/Documents/Playground/Cobrapp/tmp-verify/grupo_a_staging.csv'
-- WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- 2B) Si usas panel web (Supabase/otro):
-- Importa el archivo CSV directamente a stg_grupo_a con encabezado.

-- 3) VALIDACIONES
-- 3.1 Conteo esperado
SELECT COUNT(*) AS filas_staging FROM stg_grupo_a;

-- 3.2 Duplicados por unidad
SELECT unidad, COUNT(*) AS repeticiones
FROM stg_grupo_a
GROUP BY unidad
HAVING COUNT(*) > 1;

-- 3.3 Filas invalidas basicas
SELECT *
FROM stg_grupo_a
WHERE COALESCE(TRIM(unidad), '') = ''
   OR COALESCE(TRIM(cliente), '') = ''
   OR renta IS NULL
   OR monto_a_cobrar IS NULL;

-- 3.4 Frecuencias detectadas
SELECT DISTINCT frecuencia_raw
FROM stg_grupo_a
ORDER BY 1;

-- 4) UPSERT A TABLA FINAL (AJUSTAR NOMBRE/ESQUEMA)
-- Reemplaza public.clientes por tu tabla real.
-- Requisito recomendado: UNIQUE(unidad)

INSERT INTO public.clientes (
  unidad,
  nombre,
  cedula,
  renta,
  frecuencia,
  dia_cobro_semanal,
  cuotas_pactadas,
  cuotas_restantes,
  otros_saldos,
  monto_a_cobrar,
  deposito_referencia,
  updated_at
)
SELECT
  TRIM(unidad) AS unidad,
  TRIM(cliente) AS nombre,
  NULLIF(TRIM(cedula), '') AS cedula,
  COALESCE(renta, 0) AS renta,
  CASE
    WHEN UPPER(frecuencia_raw) LIKE '%DIARIO%' THEN 'daily'
    WHEN UPPER(frecuencia_raw) LIKE '%QUINCENAL%' THEN 'biweekly'
    WHEN UPPER(frecuencia_raw) LIKE '%SEMANAL%' THEN 'weekly'
    ELSE 'monthly'
  END AS frecuencia,
  CASE
    WHEN UPPER(frecuencia_raw) LIKE '%LUNES%' THEN 'monday'
    WHEN UPPER(frecuencia_raw) LIKE '%MARTES%' THEN 'tuesday'
    WHEN UPPER(frecuencia_raw) LIKE '%MIERCOLES%' OR UPPER(frecuencia_raw) LIKE '%MIÉRCOLES%' THEN 'wednesday'
    WHEN UPPER(frecuencia_raw) LIKE '%JUEVES%' THEN 'thursday'
    WHEN UPPER(frecuencia_raw) LIKE '%VIERNES%' THEN 'friday'
    WHEN UPPER(frecuencia_raw) LIKE '%SABAD%' THEN 'saturday'
    ELSE NULL
  END AS dia_cobro_semanal,
  COALESCE(cuotas_pactadas, 0) AS cuotas_pactadas,
  COALESCE(cuotas_restantes, 0) AS cuotas_restantes,
  NULLIF(TRIM(otros_saldos), '') AS otros_saldos,
  COALESCE(monto_a_cobrar, 0) AS monto_a_cobrar,
  COALESCE(deposito, 0) AS deposito_referencia,
  NOW() AS updated_at
FROM stg_grupo_a
ON CONFLICT (unidad)
DO UPDATE SET
  nombre = EXCLUDED.nombre,
  cedula = EXCLUDED.cedula,
  renta = EXCLUDED.renta,
  frecuencia = EXCLUDED.frecuencia,
  dia_cobro_semanal = EXCLUDED.dia_cobro_semanal,
  cuotas_pactadas = EXCLUDED.cuotas_pactadas,
  cuotas_restantes = EXCLUDED.cuotas_restantes,
  otros_saldos = EXCLUDED.otros_saldos,
  monto_a_cobrar = EXCLUDED.monto_a_cobrar,
  deposito_referencia = EXCLUDED.deposito_referencia,
  updated_at = NOW();

-- 5) POST-CHECK
SELECT COUNT(*) AS filas_finales_encontradas
FROM public.clientes
WHERE unidad IN (SELECT unidad FROM stg_grupo_a);

COMMIT;
