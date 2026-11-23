# Reportes de pagos en Ruta en calle

## Declaración de custodia por Delta

- El botón visible de cada tarjeta dice **Declarar en custodia**, con la indicación **Solo si el auto fue despojado del conductor**.
- La vista previa desde Admin muestra el botón y la confirmación, con aviso y guardado deshabilitado. La declaración real se realiza desde la cuenta del Delta.
- El Delta confirma la unidad antes de guardar. Pasa de Trabajo a Gestionados hoy como En custodia, pendiente de revisión administrativa, con atribución al usuario autenticado.
- La RPC valida la asignación actual del Delta, la publicación y el estado esperado. El Delta no puede sacar el auto de custodia ni declarar autos de otro Delta.
- El recorrido se inicia con la primera captación y se reutiliza aunque las unidades asignadas estén en varias rutas. Cada captación conserva su propia ruta.
- Aplicar únicamente 20261123000300_route_delta_custody_declaration.sql. Pruebas: route-delta-custody-db-test.mjs y route-delta-custody-ui-test.mjs, con datos sintéticos.

## Administración y filtros

- Vista se cambia con Admin, Delta 1, Delta 2 o Delta 3. La vista previa es de lectura y conserva el alcance de cada Delta al filtrar por ruta.
- Ruta utiliza un selector junto al buscador. Las zonas permanecen visibles.
- Admin puede cambiar la acción solicitada desde la etiqueta de la tarjeta; se comprueba publicación y acción anterior y se guarda auditoría.
- Las declaraciones de dinero son exclusivas de buscadores. Admin conserva revisión y conciliación. Aplicar `20261123000200_route_admin_actions_and_declarations.sql`.
- Validación de roles y concurrencia: `tests/route-admin-actions-db-test.mjs`; vistas y tamaños de 360 a 1366 px: `tests/route-admin-controls-ui-test.mjs`.

## Declaraciones y vista de los Deltas

- Arriba se declara efectivo, transferencia o pago mixto. Transferencias y mixtos se limitan a unidades en ruta y se vuelven a validar antes de guardar.
- El efectivo fuera de ruta utiliza el pago y recibo habituales y conserva Delta, equipo, autor y fecha en `outsideRouteCollection`. No publica la unidad en ruta.
- El efectivo genera recibo y queda pendiente de entrega; la transferencia espera confirmación. Los mixtos conservan ambas partes.
- Los Deltas ven Trabajo y Gestionados hoy. La lista compacta filtra resultados y métodos; un pago con ambos métodos aparece en ambos filtros sin duplicar el total.
- Las zonas están visibles, con conteos por asignación y orden de mayor a menor para los Deltas. La tarjeta destaca acción, monto, comentarios, zona y tiempo.
- Datos del auto consulta placa, color y marca/modelo al abrir el bloque. Aplicar `supabase/migrations/20261123000100_route_vehicle_details.sql`: lectura de tres campos por unidad, dueño, publicación y Delta, sin acceso general a Autos.
- Compartir por ruta y el botón Marcar inactivo quedan ocultos. El resumen del equipo excluye cuentas Delta desactivadas.

Pruebas: `tests/route-payment-declarations-ui-test.mjs`, `tests/outside-route-cash-ui-test.mjs`, `tests/route-vehicle-zones-ui-test.mjs`, `tests/route-vehicle-details-db-test.mjs`. Los fixtures usan datos sintéticos y bloquean solicitudes externas.

## Instalación

Aplicar en orden `supabase/migrations/20260904000100_route_payment_reports.sql` y `supabase/migrations/20260904000200_route_mixed_payment_reports.sql` al proyecto Supabase antes de publicar el frontend. Los archivos `supabase/69-route-payment-reports.sql` y `supabase/70-route-mixed-payment-reports.sql` contienen el mismo SQL para instalaciones manuales por SQL Editor. Si ya se aplicó la primera, aplicar únicamente la segunda. Requiere las tablas y permisos actuales de Ruta en calle y Pagos. Las migraciones no modifican saldos ni pagos existentes.

## Flujo

- Trabajo muestra las unidades activas sin reporte vigente de esa publicación de ruta y las que tienen una decisión «Debe pagar más» para el importe aplicado a renta del día, mientras no alcancen el mínimo de liberación. El reporte confirmado se conserva; no se permite duplicarlo desde Trabajo.
- Pagos parciales a revisar es una pestaña independiente y usa la misma selección que el contador del menú. Incluye unidades activas con pagos parciales pendientes de decisión, aunque su reporte esté en En revisión o Pagos confirmados. Marcar «Debe pagar más» elimina ese pendiente y permite continuar el cobro desde Trabajo. Si cambia el importe aplicado a renta del día, se requiere otra decisión.
- Reportar que pagó exige monto positivo con hasta dos decimales y medio (efectivo/banca/mixto). En mixto se indican ambos importes y el total se calcula automáticamente; ambos deben ser positivos. No crea pagos, recibos ni movimientos bancarios.
- En revisión muestra monto, medio, autor y fecha. El autor del reporte o un editor de Ruta puede devolverlo. Se conserva el registro cancelado para auditoría.
- Los editores de Ruta pueden registrar un reporte pendiente de efectivo desde En revisión: el monto y medio se toman del reporte, se exige PTY/WC y se genera el recibo por el flujo habitual. La fecha de recepción del efectivo conserva el día del reporte; la aplicación a la cuenta usa el día operativo actual. Se vuelve a consultar el reporte antes de registrar, se bloquean dobles clics y se recarga su confirmación al terminar. Esta opción no se ofrece para banca, mixtos, reportes confirmados ni usuarios de consulta.
- El menú cuenta las unidades con decisiones parciales o reportes de efectivo pendientes, sin duplicar la misma unidad/publicación. Los cambios de reportes actualizan el aviso. Un aviso «Efectivo por registrar» abre En revisión filtrada a efectivo; en Todos se muestran primero los reportes de efectivo, con monto y acción Registrar pago destacados al inicio de la tarjeta.
- Un reporte pendiente de la publicación activa tiene prioridad sobre «Debe pagar más»: la unidad queda fuera de Trabajo mientras esté En revisión, incluso si se reabre un reporte por una corrección del pago. Los reportes de otras publicaciones no bloquean la ruta actual.
- Pagos confirmados conserva la tarjeta aunque se quite de la ruta o se vuelva a publicar la unidad.
- Un pago nuevo aplicado confirma automáticamente un único reporte si coinciden propietario, cliente, unidad, monto y medio. La fecha de recepción (`fundsReceivedDate`, o `dateApplied` si no existe) debe corresponder al día del reporte en Panamá. Su `createdAt` debe ser posterior al reporte. No se usan avisos bancarios en hold, pagos históricos, pagos provisionales ni sumas aproximadas.
- Los pagos sin coincidencia quedan pendientes de revisión. Un reporte no significa que se haya cubierto toda la deuda o el mínimo de liberación.
- Un reporte bancario pendiente no ofrece acciones al buscador. Solo un administrador con acceso a Pagos y Ruta puede marcar «Confirmado en banco» o «No confirmado». La confirmación es exclusivamente visual: deja auditoría en el reporte y no crea pagos, facturas ni recibos. El registro permanece visible en Pagos → Pago notificado con el estado «Confirmado en banco» hasta que un pago bancario real con factura haga match; entonces sale de la lista. Si ese pago se elimina o deja de coincidir, el registro reaparece. Si el monto confirmado cubre el mínimo solicitado, la unidad sale de Ruta; si no lo cubre, pasa a «Decisión pendiente».
- Mixto requiere un pago con recibo por la parte en efectivo y una confirmación visual por la parte bancaria. Cada parte muestra Pendiente/Confirmado; el reporte permanece en revisión hasta tener ambas. No se confirma el total mixto con un único pago de efectivo ni se crea un recibo por la confirmación bancaria.
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

## Estado Inactivo, deshacer y resumen

En Trabajo, el buscador puede marcar una unidad como `Inactivo · no está encendido`. La migración 76 guarda la hora del servidor y el autor en la unidad activa; la tarjeta muestra la fecha, hora y el tiempo transcurrido, actualizado cada 30 segundos. Marcarla como disponible elimina únicamente esos dos campos. La RPC vuelve a comprobar propietario, publicación vigente, acceso y rol, sin conceder escritura directa.

Después de cambiar WC/PTY aparece `Deshacer` durante 15 segundos. La reversión usa la misma validación de concurrencia y solo funciona si la ruta aún coincide con el cambio recién realizado. El resumen del equipo aparece en Trabajo y separa WC y PTY por unidades para visitar, inactivas, en revisión y confirmadas hoy. Las vistas de revisión y pagos confirmados conservan su formato compacto y el filtro `Hoy / Ver anteriores`.
