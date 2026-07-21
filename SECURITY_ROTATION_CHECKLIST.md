# Seguridad Paso 1 (antes de publicar)

## 1) Rotar `SUPABASE_SERVICE_ROLE_KEY` (accion en Supabase)
1. Entra a tu proyecto de Supabase.
2. Ve a `Project Settings` -> `API`.
3. Rota/regenera la llave `service_role` (secreta).
4. Reemplaza la llave vieja en tu `.env` local:
   - `SUPABASE_SERVICE_ROLE_KEY=...nueva...`
5. No subas `.env` al repositorio.

## 2) Confirmar variables locales
Tu `.env` local debe conservar:
- `VITE_SUPABASE_URL=...`
- `VITE_SUPABASE_ANON_KEY=...`
- `SUPABASE_SERVICE_ROLE_KEY=...` (nueva)

No uses `VITE_PERSISTENCE_MODE=LOCAL_ONLY` en publicacion. Ese modo queda reservado para pruebas locales aisladas; produccion debe operar en `SUPABASE_ONLY` (valor por defecto).

## 3) Verificacion rapida (local)
Ejecuta:

```powershell
npm.cmd run build
```

Si usas scripts de migracion/reconciliacion, confirma que funcionan con la nueva llave.

## 4) Reglas aplicadas en Git (ya hecho)
Se ignoran y desversionan rutas sensibles:
- `RESPALDO COBRAPP/`
- `exports/`
- `tmp-verify/`
- `tmp-backup-retention-check/`
- `supabase/.temp/`
- `tests/screenshots/`
- `tests/validation-output/`
- `*.log`, `*.out.log`, `*.err.log`

Los archivos siguen en tu disco local; solo se quitaron del control de versiones.
