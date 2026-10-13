# Control de captaciones en Ruta en calle

Aplicar `supabase/migrations/20261013000100_route_capture_control.sql` antes de publicar el frontend. Para instalaciones manuales por SQL Editor se puede aplicar `supabase/109-route-capture-control.sql`; ambos archivos contienen el mismo cambio.

## Flujo

- Delta 1 y Delta 3 trabajan en PTY. Delta 2 trabaja en WC.
- Cada Delta debe pulsar **Iniciar ruta** antes de registrar captaciones. El servidor impide que un Delta inicie una ruta distinta a la asignada.
- Al pulsar **Registrar captación**, el servidor toma el usuario autenticado, la unidad, el cliente, la publicación y la ruta vigente. El navegador no puede elegir ni modificar el Delta atribuido.
- La unidad pasa a custodia y la captación queda **Pendiente de administración**.
- Un administrador con permiso de edición en Ruta en calle puede pulsar **Confirmar captación**. La confirmación conserva autor y fecha.
- Al terminar, el Delta pulsa **Cerrar y enviar**. La ruta queda pendiente hasta que el administrador la revise y pulse **Confirmar ruta**.
- El panel **Control de captaciones** muestra las reportadas, pendientes y confirmadas del día separadas por Delta, aunque varios Delta compartan PTY.
- Sacar una unidad de custodia registra la fecha de salida del evento, pero no elimina una captación ya confirmada.

## Historial y seguridad

`route_capture_events` es de solo lectura para el frontend. Las altas y confirmaciones se realizan únicamente mediante funciones `security definer` que validan los permisos y usan `auth.uid()` como fuente de identidad. Los registros activos de custodia existentes al aplicar la migración se incorporan como captaciones pendientes cuando tienen autor conocido.
