# Rentautos Cloud

Aplicacion web para gestion operativa de rentas: clientes, pagos, cuentas por cobrar, configuraciones y cuadre de caja, con autenticacion y sincronizacion en Supabase.

## Stack

- React 18 + TypeScript
- Vite 5
- Supabase (`@supabase/supabase-js`)
- Playwright (pruebas E2E)

## Modulos funcionales

- `Clientes`: alta/edicion, filtros y estados del cliente.
- `Pagos`: registro de pagos, recibos, historial, conciliacion bancaria/tarjeta.
- `Cuentas por Cobrar`: vista de deuda y gestion de cobro en ruta.
- `Configuraciones`: reglas bancarias, recargos, respaldos e importacion de backup.
- `Cuadre de Caja`: flujo de cierre diario y enlace rapido a pago en efectivo.
- `Colisiones`: gestion de choques, juicio, resolucion, facturacion y seguimiento de cobro.

## Arquitectura (resumen)

- Entrada:
  - `src/main.tsx`
  - `src/App.tsx` (sesion y rol)
  - `src/AppShell.tsx` (navegacion, estado global y persistencia)
- Persistencia local:
  - `src/storage.ts` (normalizacion y acceso a `localStorage`)
- Nube:
  - `src/lib/supabase.ts` (cliente Supabase)
  - `src/cloudData.ts` (lectura/escritura cloud)
  - `src/cloudMirror.ts` (espejo localStorage -> cloud)
- Dominio:
  - `src/types.ts`
  - `src/billing.ts`, `src/receivables.ts`, `src/lateFees.ts`, `src/paymentPromises.ts`
- UI:
  - `src/pages/*`
  - `src/components/*`

## Requisitos

- Node.js 18+ (recomendado 20+)
- npm 9+
- Proyecto Supabase activo

## Instalacion

```bash
npm install
```

## Variables de entorno

Crear `.env` en la raiz del proyecto, es decir en `Rentautos Cloud/`:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_SUPABASE_ANON_KEY
VITE_PERSISTENCE_MODE=SUPABASE_ONLY
```

Notas:
- `VITE_PERSISTENCE_MODE=SUPABASE_ONLY` es el modo recomendado y por defecto.
- Sin `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, la app no puede iniciar autenticacion cloud.
- No abras ni uses una copia anidada del proyecto dentro de `Rentautos Cloud/Rentautos Cloud/`; la app valida el `.env` solo desde la raiz real del proyecto.

## Ejecutar en desarrollo

```bash
npm run dev
```

Build de produccion:

```bash
npm run build
```

Vista previa del build:

```bash
npm run preview
```

## Configuracion Supabase

Ejecutar en SQL Editor (orden recomendado):

1. `supabase/01-auth-roles.sql`
2. `supabase/02-cloud-data.sql`
3. `supabase/03-street-management-cloud.sql`
4. `supabase/03-cloud-extended.sql`
5. `supabase/05-payment-promises-cloud.sql`
6. `supabase/06-collection-closures-cloud.sql`
7. `supabase/07-shared-data-owner-rls.sql`
8. `supabase/15-collisions-cloud.sql`
9. `supabase/11-daily-collection-cloud.sql`
10. `supabase/15-daily-collection-deltas-cloud.sql`

Despues:
- Crear usuario desde UI de login/registro.
- Promover usuario principal a `admin` en `public.user_profiles`.
- Roles soportados: `admin`, `operador`, `lectura`.

## Scripts principales

- `npm run dev`: servidor local Vite.
- `npm run build`: validacion TypeScript + build.
- `npm run preview`: servir build local.
- `npm run test:validation`: E2E Playwright de validacion principal.
- `npm run test:workflows`: ejecuta `tests/tmp-*.cjs` y genera reporte.
- `npm run release:check`: valida minima configuracion publicable.
- `npm run migrate:export`: export de datos de migracion.
- `npm run migrate:dry-run`: simulacion de importacion de migracion.
- `npm run migrate:apply`: aplicacion de importacion de migracion.
- `npm run migrate:reconcile`: reconciliacion post-migracion.
- `npm run import:bank`: importacion de CSV bancario.
- `npm run import:clients`: importacion de clientes desde hoja.

## Pruebas

### E2E principal

`test:validation` requiere:

- `RENTAUTOS_TEST_ID`
- `RENTAUTOS_TEST_PASSWORD`
- opcional: `RENTAUTOS_TEST_BASE_URL` (default `http://127.0.0.1:4173`)

Ejemplo:

```bash
RENTAUTOS_TEST_ID=usuario \
RENTAUTOS_TEST_PASSWORD=clave \
npm run test:validation
```

### Workflows de regresion

```bash
npm run test:workflows
```

Genera reporte en:
- `tests/validation-output/workflows-report.txt`

## Seguridad y datos sensibles

- `.env` esta ignorado por git.
- Directorios operativos sensibles ignorados: `RESPALDO COBRAPP/`, `exports/`, `tmp-verify/`, `tmp-backup-retention-check/`, `tests/screenshots/`, `tests/validation-output/`.
- Revisar `SECURITY_ROTATION_CHECKLIST.md` antes de publicar.

## Flujo operativo recomendado

1. Configurar `.env` y Supabase.
2. Ejecutar `npm run dev`.
3. Validar flujo critico con `npm run test:workflows`.
4. Antes de release: `npm run release:check` y `npm run build`.

## Estructura de carpetas

```text
src/
  components/
  lib/
  pages/
  App.tsx
  AppShell.tsx
  storage.ts
  cloudData.ts
  cloudMirror.ts
tests/
  validation.e2e.cjs
  run-workflows.cjs
  tmp-*.cjs
scripts/
  import-*.mjs
  migrate-*.mjs
supabase/
  01-auth-roles.sql
  ...
```

## Estado actual de persistencia

- El flujo activo trabaja en modo `SUPABASE_ONLY` para clientes/pagos y usa Supabase como fuente principal de verdad.
- El navegador queda solo como cola de reintento temporal y cache de trabajo para componentes no criticos.

