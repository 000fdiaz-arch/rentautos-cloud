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
