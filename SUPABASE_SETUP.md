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
   - `supabase/10-assign-ambar-operator.sql` (si aplica)
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
