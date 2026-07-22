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

## Arquitectura (resumen)

- Entrada:
  - `src/main.tsx`
  - `src/App.tsx` (sesion y rol)
  - `src/AppShell.tsx` (navegacion, estado global y persistencia)
- Persistencia cloud:
  - `src/storage.ts` (normalizacion y cache operativa liviana)
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

Crear `.env` en la raiz:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_SUPABASE_ANON_KEY
```

Notas:
- La app corre en modo `SUPABASE_ONLY`; Supabase es la fuente canonica para la version multiusuario.
- Sin `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, la app no puede iniciar autenticacion cloud.
- Para pruebas locales aisladas se puede usar `VITE_PERSISTENCE_MODE=LOCAL_ONLY`. El bypass de login `VITE_RENTAUTOS_TEST_BYPASS_AUTH=1` y la compatibilidad `VITE_RENTAUTOS_TEST_LEGACY_LOCAL_STORAGE=1` deben limitarse a tests/desarrollo local.

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
8. `supabase/08-daily-cash-ledger.sql`
9. `supabase/09-cash-day-counts.sql`
10. `supabase/11-daily-collection-cloud.sql`
11. `supabase/12-performance-optimization.sql`
12. `supabase/13-payment-fast-paths.sql`
13. `supabase/15-receipt-sequence-resync.sql`
14. `supabase/16-lead-evaluations-cloud.sql`
15. `supabase/17-fleet-units-cloud.sql`
16. `supabase/18-secure-user-profiles-and-role-rls.sql`
17. `supabase/19-reset-role-rls-policies.sql`
18. `supabase/20-screen-permissions.sql`
19. `supabase/21-user-admin-passwords.sql`
20. `supabase/22-payment-deltas.sql`
21. `supabase/23-admin-permissions-guard.sql`
22. `supabase/24-unique-receipt-number.sql`
23. `supabase/25-fleet-unit-status-rpc.sql`

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

El runner valida `http://127.0.0.1:5174/` y, si no hay servidor, levanta Vite con `VITE_PERSISTENCE_MODE=LOCAL_ONLY`, `VITE_RENTAUTOS_TEST_BYPASS_AUTH=1` y `VITE_RENTAUTOS_TEST_LEGACY_LOCAL_STORAGE=1` para ejecutar los workflows UI sin depender de credenciales Supabase.

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

- El flujo activo trabaja en modo `SUPABASE_ONLY`.
- Supabase es la fuente canonica de clientes, pagos y datos operativos multiusuario.
- La pantalla de Autos/Control de Unidades es `SUPABASE_ONLY`: lee desde `vw_control_unidades` y escribe exclusivamente en `fleet_units_cloud`; no debe tener fallback local.
- El almacenamiento local queda limitado a cache, marcadores livianos y estado temporal de UI.

