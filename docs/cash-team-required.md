# Equipo obligatorio para efectivo pendiente

Los pagos en efectivo con `moneyDelivered: false` deben tener `collectionTeam: PTY | WC`.

- Registro manual: selector obligatorio para efectivo pendiente; validación del formulario y del constructor de transacciones. Incluye pagos normales y alquileres provisionales.
- Ruta: el equipo elegido se entrega al constructor antes de crear el pago.
- Ingresos: no permite quitar el equipo a un pendiente. Para pasar un pago entregado sin equipo a pendiente, pide equipo y guarda los dos cambios juntos con auditoría.
- Persistencia de la aplicación: rechaza pagos pendientes nuevos o modificados sin equipo antes de cambiar el estado local o enviarlo a la nube. Los registros anteriores que no se modifican pueden seguir cargándose y acompañar otras operaciones.

No se adivina el equipo de recibos existentes ni se modifican sus datos automáticamente. Los incompletos se muestran como **SIN EQUIPO** en rojo, con aviso visible fuera de los desplegables y botón **Asignar equipo**. El efectivo entregado puede no tener equipo.

Validación: 19 escenarios de navegador en `tests/daily-income-cash-ui-test.mjs`, incluidos registro real, asignación de equipo, intento de quitarlo, cambio a pendiente y guardas del constructor/persistencia. Compilación TypeScript y build aislado desde la versión publicada. Datos de prueba sintéticos; no se cambiaron pagos reales durante las pruebas.
