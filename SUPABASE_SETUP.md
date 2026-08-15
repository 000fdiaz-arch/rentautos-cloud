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
