# Seguridad Paso 1 (antes de publicar)

## 1) Reemplazar y revocar una clave administrativa expuesta
1. En Supabase, `Settings` -> `API Keys`, crea una clave secreta nueva (`sb_secret_...`).
2. Actualiza la variable de servidor `SUPABASE_SERVICE_ROLE_KEY` de Vercel y los archivos locales `.env`, `.env.staging.local` y `.env.txt` que correspondan al proyecto. El nombre historico de esta variable se conserva por compatibilidad con los scripts, pero su valor debe ser una clave secreta nueva.
3. Actualiza el secreto `RENTAUTOS_SECRET_KEY` de Edge Functions y publica `client-portal` y `submit-seller-lead-document`. Ambas funciones usan esta variable; conserva sus controles de acceso existentes.
4. Comprueba el acceso administrativo con la nueva clave antes de retirar la anterior.
5. Si la expuesta es una clave JWT antigua `service_role`, desactiva las API keys antiguas y revoca su clave de firma heredada. Crear una clave nueva no invalida la anterior. Conserva la clave de firma de las sesiones actuales.
6. Verifica que la antigua reciba HTTP 401 o 403 tanto como `apikey` como en `Authorization: Bearer` junto con la clave publica. Comprueba tambien la nueva clave, Auth y la app publicada.
7. No subas archivos `.env` ni valores secretos al repositorio o a los registros.

Guia oficial: https://supabase.com/docs/guides/security/rotate-leaked-api-keys

Rotacion del 19 de noviembre de 2026: completada y verificada para el proyecto de Rentautos. Las API keys antiguas estan desactivadas y la clave de firma heredada esta revocada. La clave de firma actual se conservo. La evidencia sin valores secretos esta en `.tmp/key-rotation/verification.json`.

## 2) Confirmar variables locales
Tu `.env` local debe conservar:
- `VITE_SUPABASE_URL=...`
- `VITE_SUPABASE_ANON_KEY=...`
- `SUPABASE_SERVICE_ROLE_KEY=...` (nueva)

No uses `VITE_PERSISTENCE_MODE=LOCAL_ONLY` en publicacion. Ese modo queda reservado para pruebas locales aisladas; produccion debe operar en `SUPABASE_ONLY` (valor por defecto).

`VITE_SUPABASE_ANON_KEY` debe contener una clave publica (`sb_publishable_...`). La configuracion de Vite rechaza claves `sb_secret_...` o JWT con rol `service_role` para impedir que lleguen al navegador.

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
