# Lectura rápida de Leads

## Publicación verificada — 2 de septiembre de 2026

- Migración aplicada y columna `summary` disponible en la base de producción.
- Comparación de solo lectura en la misma ejecución: consulta anterior, 437 filas, 4.136 ms y 222.076 bytes; primera página nueva, 21 filas, 368 ms y 12.323 bytes. Son tiempos del acceso administrativo a la base, no del inicio de sesión ni de la carga total del navegador.
- Publicada en `https://rentautos-cloud.vercel.app` mediante el despliegue `dpl_6Vexav2MjS9V9Knw6ar8niAo4SzF`.
- El paquete se construyó desde la copia verificada de la versión que estaba en producción, sustituyendo únicamente los ocho archivos de Leads necesarios. Conserva los cambios previamente publicados en Pagos y evita incluir otros cambios locales en curso.
- Se verificaron respuestas HTTP 200 y coincidencia exacta de los archivos JavaScript/CSS publicados con el paquete compilado, incluidos Leads y Pagos. También se comprobó la lectura de resúmenes sin documentos, la conservación de un documento original y el rechazo de la nueva función a usuarios anónimos.
- Las pruebas locales cubren 45 escenarios; al publicar se repitieron los 6 escenarios de base de datos y los 11 de la pantalla y AppShell. La compilación del paquete aislado pasó.
- No se pudo realizar una comprobación de navegador con sesión real de usuario: no había sesión de Rentautos ni credenciales guardadas disponibles. La autenticación, permisos y flujos de interfaz se validaron con las pruebas locales; las comprobaciones de producción fueron de solo lectura.
- Evidencia del paquete: `.tmp/leads-fast-read-release-20260902/release-check.json` y `production-verification.json`.

## Comportamiento

- La pantalla de Leads se muestra sin esperar a la sincronización de clientes y pagos.
- La primera consulta devuelve hasta 20 dictámenes y una fila adicional para saber si hay más. No descarga todo el historial ni cuenta todas las filas.
- «Ver más dictámenes» usa un cursor por fecha e ID, con orden estable cuando varias fechas coinciden.
- «Consultar» busca la cédula en el servidor, también fuera de las páginas cargadas y con o sin guiones. Un error de consulta nunca se interpreta como «no registrado».
- Los resúmenes se almacenan físicamente sin `attachmentDataUrl`. La columna generada `summary` se actualiza con las escrituras existentes; `data` y todos sus documentos permanecen intactos. Se evita descomprimir el JSON grande por cada campo solicitado.
- El dictamen abre con sus datos pequeños. «Ver documento» solicita el documento completo por ID, con los permisos existentes. Las listas de solicitudes de vendedores también omiten los documentos y cargan 20 registros por página; «Revisar» recupera solo la solicitud elegida.
- La consulta de resúmenes comprueba una vez el permiso existente de pantalla y dataset, está limitada a ese dataset, y no permite ejecución anónima. El portal público conserva su lista explícita de campos permitidos.
- Guardar y borrar trabajan sobre un solo ID. Cargar parcialmente el historial no convierte registros no vistos en eliminaciones.
- La caché es solo de la sesión en memoria, no guarda documentos, se borra al cambiar dataset/permisos y se actualiza al volver a Leads o pulsar «Actualizar dictámenes». Las respuestas anteriores no restauran eliminaciones realizadas durante una carga.

## Activación

1. Aplicar `supabase/68-leads-fast-read.sql` en el proyecto Supabase de la aplicación. La copia para el historial de migraciones es `supabase/migrations/20260902000100_leads_fast_read.sql`. Requiere las migraciones de permisos de pantalla y portal compartido (20 y 66).
2. La migración usa una transacción, no modifica los datos originales, conserva RLS y establece un límite de 5 segundos para adquirir bloqueos. Crear la columna almacenada recorre la tabla una vez; hacerlo cuando no haya una operación larga bloqueando la tabla. Si falla, resolver el error y volver a ejecutar antes de publicar.
3. Verificar como usuario autenticado con permiso Leads: primera página, búsqueda de una cédula histórica y apertura de su documento. Verificar denegación a otro dataset y a una cuenta sin permiso de pantalla.
4. Publicar la aplicación después de confirmar que existe `read_lead_evaluations_page`. La versión nueva necesita esa función. La migración es compatible con la versión anterior, de modo que puede desplegarse primero.
5. Medir en la pestaña de red del navegador autenticado. `node scripts/measure-leads-read.mjs` es una comprobación adicional de solo lectura de la base configurada: imprime tiempos, conteos y tamaños, nunca cédulas ni documentos. Usa la clave administrativa local; sus tiempos no incluyen autenticación/RLS del usuario. Su consulta antigua reproduce una vez la carga problemática.

## Evidencia antes de activar

Medición de solo lectura del 2 de septiembre de 2026 en `jysswspexennlyvqenvn.supabase.co`:

- 437 Leads en el dataset medido; contar los IDs tomó 137 ms.
- La consulta anterior de resúmenes falló con `57014` después de 8.758 ms.
- La lista de dos solicitudes sin documentos respondió en 286 ms y 441 bytes.
- La columna `summary` todavía no existía al medir; no se afirma un tiempo de producción posterior hasta aplicar la migración.

En PostgreSQL local se probaron 65 registros sintéticos con documentos de 600.022 bytes cada uno. La respuesta de 21 resúmenes ocupó 6.721 bytes. Esto es una comprobación del volumen de datos, no una promesa de latencia de red.

## Pruebas

```text
npm run build
node tests/leads-fast-read-db-test.mjs
node tests/leads-fast-read-ui-test.mjs
node tests/shared-seller-lead-db-test.mjs
node tests/shared-seller-lead-ui-test.mjs
node tests/lead-document-zoom-ui-test.mjs
```

Las pruebas de base usan el PostgreSQL local PGlite instalado en `.tmp/lead-portal-tests/node_modules`. Las pruebas de navegador usan datos ficticios y bloquean peticiones de producción. Cubren paginación, búsquedas históricas, documentos, errores/reintentos, escritura y borrado puntuales, respuestas atrasadas, cambio de dataset, portal público, permisos y visualización móvil.
