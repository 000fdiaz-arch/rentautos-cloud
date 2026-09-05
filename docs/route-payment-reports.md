# Reportes de pagos en Ruta en calle

## Instalación

Aplicar en orden `supabase/migrations/20260904000100_route_payment_reports.sql` y `supabase/migrations/20260904000200_route_mixed_payment_reports.sql` al proyecto Supabase antes de publicar el frontend. Los archivos `supabase/69-route-payment-reports.sql` y `supabase/70-route-mixed-payment-reports.sql` contienen el mismo SQL para instalaciones manuales por SQL Editor. Si ya se aplicó la primera, aplicar únicamente la segunda. Requiere las tablas y permisos actuales de Ruta en calle y Pagos. Las migraciones no modifican saldos ni pagos existentes.

## Flujo

- Trabajo muestra las unidades activas sin reporte vigente de esa publicación de ruta y las que tienen una decisión «Debe pagar más» para el importe aplicado a renta del día, mientras no alcancen el mínimo de liberación. El reporte confirmado se conserva; no se permite duplicarlo desde Trabajo.
- Pagos parciales a revisar es una pestaña independiente y usa la misma selección que el contador del menú. Incluye unidades activas con pagos parciales pendientes de decisión, aunque su reporte esté en En revisión o Pagos confirmados. Marcar «Debe pagar más» elimina ese pendiente y permite continuar el cobro desde Trabajo. Si cambia el importe aplicado a renta del día, se requiere otra decisión.
- Reportar que pagó exige monto positivo con hasta dos decimales y medio (efectivo/banca/mixto). En mixto se indican ambos importes y el total se calcula automáticamente; ambos deben ser positivos. No crea pagos, recibos ni movimientos bancarios.
- En revisión muestra monto, medio, autor y fecha. El autor del reporte o un editor de Ruta puede devolverlo. Se conserva el registro cancelado para auditoría.
- Un reporte pendiente de la publicación activa tiene prioridad sobre «Debe pagar más»: la unidad queda fuera de Trabajo mientras esté En revisión, incluso si se reabre un reporte por una corrección del pago. Los reportes de otras publicaciones no bloquean la ruta actual.
- Pagos confirmados conserva la tarjeta aunque se quite de la ruta o se vuelva a publicar la unidad.
- Un pago nuevo aplicado confirma automáticamente un único reporte si coinciden propietario, cliente, unidad, monto y medio. La fecha de recepción (`fundsReceivedDate`, o `dateApplied` si no existe) debe corresponder al día del reporte en Panamá. Su `createdAt` debe ser posterior al reporte. No se usan avisos bancarios en hold, pagos históricos, pagos provisionales ni sumas aproximadas.
- Los pagos sin coincidencia quedan pendientes de revisión. Un reporte no significa que se haya cubierto toda la deuda o el mínimo de liberación.
- Mixto requiere un pago de efectivo por el importe de efectivo y un pago bancario por el importe de banca. Cada parte muestra Pendiente/Confirmado; el reporte permanece en revisión hasta tener ambas. Los pagos pueden llegar en cualquier orden. Cada pago aplicado se vincula una sola vez. No se confirma el total mixto con un único pago de efectivo, ni se cuentan dos veces pagos repetidos del mismo medio.
- Si se elimina el pago vinculado o se cambian sus datos de modo que ya no coincidan, el reporte vuelve a revisión.

## Permisos

### Efectivo por entregar (WC y PTY)

Ruta en calle incluye dos filas compactas WC/PTY, desplegables para consultar unidad, cliente, recibo, fecha y monto. Reutiliza el mismo estado `payments` de AppShell que recibe Ingresos del día y la misma función `buildPendingCashRows` que utiliza “Falta entregar”. No realiza consultas, recorridos del historial ni suscripciones adicionales. Cada entrega o cambio recibido por la sincronización común se refleja automáticamente en el resumen. Incluye los pendientes antiguos presentes en los pagos compartidos y excluye entregados, banca y fechas futuras. El alcance del historial es el mismo que en Ingresos del día; no se replica su filtro de búsqueda o selección de fecha (Ruta usa el día actual). Es de solo lectura, sin nuevas autorizaciones ni migración adicional.

### Reportes del buscador

El buscador activo con acceso de lectura a Ruta recibe exclusivamente las RPC de reporte `report_route_payment_split` (y la compatible `report_route_payment`) y `cancel_route_payment_report`. Los editores de Ruta también pueden usarlas. Un usuario de lectura sin edición no puede reportar. La base de datos vuelve a validar rol, estado activo, acceso al propietario y pantalla en cada operación. El frontend usa la misma regla en `canReportRoutePayment`. Los vínculos de confirmación son internos y no admiten lectura ni escritura directa del usuario.

La tabla tiene RLS de lectura y no concede escritura directa a `authenticated`. El cliente nunca puede suministrar estado confirmado, autor, fecha, snapshot ni ID de pago. Esos campos los asigna el servidor. No se amplían los permisos existentes de pagos, clientes ni rutas. La restricción única evita reportes duplicados incluso desde dos sesiones.

## Validación

- `npm run build`
- `node tests/route-payment-reports-db-test.mjs` (usa el PGlite disponible en `.tmp/lead-portal-tests/node_modules`, como las otras pruebas de BD del proyecto).
- `node tests/route-payment-reports-ui-test.mjs` (Playwright, solicitudes simuladas y datos ficticios).

Las pruebas no escriben en Supabase remoto. La prueba de BD ejecuta realmente la migración, RLS, RPC y triggers en PostgreSQL local (PGlite). La prueba visual recorre el formulario, fallo de guardado, archivo, devolución y restricciones de buscador.

## Cambio de ruta WC/PTY

El buscador activo o editor de Ruta puede cambiar WC/PTY en las tarjetas de Trabajo mediante `change_active_route_assignment` (migración 71). La RPC valida propietario, acceso, rol, publicación vigente y ruta anterior para evitar sobrescribir cambios concurrentes. Solo modifica la asignación activa y registra autor y fecha; conserva zona, importes, pagos y snapshots de reportes. El selector muestra errores sin cambiar la ruta local cuando falla el guardado. No concede escritura directa ni edición general.
