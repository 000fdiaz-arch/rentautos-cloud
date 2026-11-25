# Rentautos + Supabase (pasos rapidos)

1. Crea un proyecto en Supabase.
2. Ve a `Project Settings > API` y copia:
   - `Project URL`
   - `anon public key`
3. Crea un archivo `.env` en la raiz del proyecto con:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_SUPABASE_ANON_KEY
```

4. En Supabase SQL Editor, ejecuta estos scripts:
   - `supabase/01-auth-roles.sql`
   - `supabase/02-cloud-data.sql`
   - `supabase/03-street-management-cloud.sql`
   - `supabase/03-cloud-extended.sql`
   - `supabase/05-payment-promises-cloud.sql`
   - `supabase/06-collection-closures-cloud.sql`
   - `supabase/07-shared-data-owner-rls.sql`
   - `supabase/08-daily-cash-ledger.sql`
   - `supabase/09-cash-day-counts.sql`
   - `supabase/11-daily-collection-cloud.sql`
   - `supabase/10-assign-ambar-operator.sql` (si aplica)
   - `supabase/12-performance-optimization.sql`
   - `supabase/13-multiuser-hardening.sql`
   - `supabase/14-receipt-sequence-rpc.sql`
   - `supabase/15-receipt-sequence-resync.sql`

Para instalaciones existentes que ya ejecutaron las migraciones de cuentas por cobrar, ejecuta tambien:

- `supabase/54-cash-closing-client-sync-timeout.sql` (evita recalcular el ultimo pago durante actualizaciones financieras masivas del cierre de caja)
- `supabase/57-active-route-zones.sql` (habilita las zonas temporales editables en Ruta en calle)
- `supabase/62-route-operator-actions.sql` (habilita comentarios y decisiones para usuarios con permiso de editar Ruta en calle)
- `supabase/63-provisional-rental-workflow.sql` (habilita la asignacion atomica de autos provisionales desde Clientes)
- `supabase/64-provisional-rental-payment-balance.sql` (valida los pagos provisionales contra el saldo del alquiler sin tocar el saldo regular pausado)
- `supabase/87-fleet-status-timeout-fast-path.sql` (evita el timeout 57014 al cambiar el estado operativo desde Autos)
- `supabase/88-payment-insert-latest-fast-path.sql` (evita recorrer el historial completo al registrar pagos nuevos)
- `supabase/90-payment-metadata-update-fast-path.sql` (evita recorrer el historial al marcar recibos como enviados)
- `supabase/91-dynamic-route-assignment.sql` (habilita rutas personalizadas en Ruta en calle)
- `supabase/92-notified-route-review-sync.sql` (comparte Pago notificado entre Pagos y Ruta en calle)
- `supabase/93-notified-route-review-backfill.sql` (vincula avisos existentes con unidades activas de Ruta y mantiene la relación automáticamente)
- `supabase/94-route-cash-receipt-delete-cancels-report.sql` (al eliminar en Pagos un recibo de efectivo creado desde Ruta, cancela también la notificación y devuelve la unidad a Trabajo)
- `supabase/98-notified-payment-atomic-consumption.sql` (consume Pago notificado junto con el pago bancario e impide que una sesión desactualizada lo restaure)
- `supabase/100-guarded-client-delta-sync.sql` (evita que una sesión desactualizada sobrescriba saldos o datos recientes de clientes)
- `supabase/101-admin-route-bank-confirmation.sql` (base histórica de la confirmación bancaria administrativa; queda reemplazada por el script 107)
- `supabase/105-route-bank-receipt-upsert.sql` (permite copiar y marcar como enviado un recibo bancario de Ruta ya existente sin confundirlo con una confirmación nueva)
- `supabase/106-route-cash-report-link.sql` (vincula cada recibo de efectivo con su aviso de Ruta por identificador, sin depender del reloj del navegador)
- `supabase/107-visual-route-bank-confirmation.sql` (convierte la confirmación bancaria de Ruta en una validación visual sin pago ni recibo y resuelve la salida o decisión pendiente)
- `supabase/108-route-visual-bank-payment-settlement.sql` (mantiene la confirmación visual en Pago notificado hasta que una factura bancaria coincidente la liquide)
- `supabase/109-route-capture-control.sql` (registra cada captación por Delta y ruta, conserva su historial y permite confirmación administrativa)
- `supabase/110-route-bank-confirmation-timeout-fast-path.sql` (evita timeouts al confirmar banca limitando la conciliación a pagos candidatos del cliente)
- `supabase/111-route-bank-savings-settlement.sql` (concilia confirmaciones visuales descontando los centavos de ahorro)
- `supabase/115-atomic-payment-deletion.sql` (elimina facturas y revierte el saldo del cliente una sola vez, incluso ante doble clic o reintentos)
- `supabase/116-payment-deletion-fast-paths.sql` (evita reconstrucciones de historial y retencion cuando la factura eliminada no puede afectar esos caches)
- `supabase/117-client-portal.sql` (habilita acceso por cedula y PIN, sesiones privadas, multiples unidades y comprobantes de pago del portal del cliente)
- `supabase/119-active-route-delta-availability.sql` (evita asignar carros a cuentas Delta inactivas y reasigna sus rutas pendientes al desactivarlas)
- `supabase/127-route-delta-removal-guard.sql` (impide que las cuentas Delta saquen autos de Ruta y registra al editor responsable de cada retiro manual)
- `supabase/128-route-delta-by-route.sql` (sincroniza WC con Delta 2 y PTY con Delta 1 al cambiar la ruta, conservando la reasignacion manual posterior)
- `supabase/129-receivables-collector-workday.sql` (configura los PIN de Cobrador 1 y 2 para separar las carteras ACE y BDT durante la jornada)
- `supabase/130-remove-receivables-daily-fleet-review.sql` (solo si aplicaste una versión anterior de la 129; elimina la tabla de revisión diaria que ya no utiliza la aplicación)
- `supabase/120-seller-consultation-attribution.sql` (identifica al vendedor, conserva al responsable original y registra los seguimientos de cada cedula consultada)
- `supabase/132-allow-fleet-retirement-with-open-incidents.sql` (permite dar de baja autos con reclamos de seguro o expedientes de colision abiertos; conserva los datos y estados de siniestros y mantiene los bloqueos por clientes, alquileres, rutas y promesas pendientes)

Despues de aplicar la 117, despliega la funcion que atiende el portal sin exponer la
clave de servicio en el navegador:

```bash
supabase functions deploy client-portal
```

El acceso se configura por cliente desde **Clientes → Editar → Portal** y la URL para
el cliente es `/portal-cliente`. Los registros que comparten la misma cedula usan un
solo PIN y el portal separa saldos, pagos y comprobantes por unidad.

En Vercel, produccion debe usar `VITE_PERSISTENCE_MODE=SUPABASE_ONLY`. `LOCAL_ONLY` queda limitado a desarrollo, salvo que se habilite deliberadamente `VITE_ALLOW_PRODUCTION_LOCAL_ONLY=1`.
5. Crea una cuenta desde la pantalla de registro de la app.
6. En SQL Editor, promueve tu usuario principal a admin:

```sql
update public.user_profiles
set role = 'admin'
where email = 'tu-correo@empresa.com';
```

Roles disponibles:
- `admin`: acceso total
- `operador`: operativo
- `lectura`: solo consulta

Modo dataset compartido (ejemplo admin + ambar):

```sql
update public.user_profiles ambar
set data_owner_user_id = admin.id
from public.user_profiles admin
where ambar.email = 'ambar@auth.rentautos.local'
  and admin.email = 'admin@auth.rentautos.local';
```

## Cuentas por cobrar 2.0 — separación (18 nov 2026)

- `/cuentas-por-cobrar`: vista del despliegue `e4541d2`, con sus tablas y claves de gestión originales. Los componentes y cálculos de esa versión se conservan por separado; el CSS de producción queda limitado a `.cxc-production`.
- `/cuentas-por-cobrar-2`: nuevo flujo individual, cobradores, PIN, GPS/estados, promesas, dos intentos, seguimiento, pagos recibidos y resumen. En navegación móvil está en **Más → Cuentas 2.0**.
- Los clientes, autos, saldos y pagos contables siguen siendo comunes. Corregir el estado real de un auto o registrar un pago real actualiza ese dato compartido. Las promesas, intentos, revisiones, cierres y rutas de gestión son independientes.
- Migración `20261118000300_cxc_v2_isolated_management.sql`: tablas/RPC de gestión con prefijo `cxc_v2_`, RLS y permisos equivalentes a los originales. No copia ni borra registros previos.
- Migración `20261118000400_cxc_v2_payment_observer_isolation.sql`: reconcilia pagos reales con las rutas 2.0 a petición de la pantalla. No deja observadores 2.0 sobre la tabla original de pagos; utiliza `cxc_v2_payment_observations`. El acceso al RPC comprueba propietario y permiso de pantalla.
- Borradores/progreso: `cxc.v2.workday.v1:*`; sesión del cobrador: `rentautos.receivables-v2.collector-session.v1:*`; almacenamiento de gestión: `cobrapp.cxc-v2.*`. El guardado 2.0 no encola el espejo de sincronización de gestión original.
- Las tablas 2.0 empiezan vacías. No se migran registros mezclados de las pruebas anteriores. La demostración sigue siendo únicamente en memoria.
- Ambas migraciones fueron aplicadas a la base conectada. No se desplegó el sitio a producción. Se comprobaron los mismos conteos y huellas de las 11 tablas originales antes/después de la separación.
- Verificaciones: `node tests/receivables-v2-isolation.mjs`, pruebas de historial/seguimiento/progreso/pagos y `npm run build`. Las pruebas con datos simulados se ejecutan fuera de la base real.
- Pendiente obligatorio antes del lanzamiento de 2.0: reactivar `ENFORCE_REQUIRED_NAVIGATION` en `src/pages/receivablesV2/ReceivablesLedgerTable.tsx`, como pidió el usuario. Continúa desactivado durante esta iteración local.
