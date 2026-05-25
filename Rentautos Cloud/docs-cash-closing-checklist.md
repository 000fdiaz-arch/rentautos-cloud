# Cuadre de Caja - QA y Operacion Diaria

## 1) Preparacion
- Verificar que la fecha operativa sea la correcta.
- Confirmar que el estado de jornada sea `ABIERTA` o `CERRADA` segun corresponda.
- Confirmar conectividad con Supabase.

## 2) Flujo base (diario)
- Abrir jornada (solo admin):
  - Si hay cierre anterior, validar arrastre automatico de caja inicial.
  - Si es arranque, ingresar saldo semilla manual.
- Registrar ingresos y egresos manuales.
- Registrar conteo fisico (monedas/billetes).
- Guardar cambios.
- Cerrar caja con efectivo real contado.

## 3) Validaciones funcionales
- Caja inicial debe ser solo lectura (inmutable).
- En dia cerrado no debe permitir editar movimientos ni conteo.
- Reapertura solo admin y con motivo.
- Diferencia debe calcularse: `real - esperado`.
- Reportes dia/semana/mes deben cargar sin error.
- Auditoria del dia debe reflejar eventos (insert/update/delete).

## 4) Exportaciones
- `Vista previa` abre modal correctamente.
- JPG incluye detalle completo de ingresos/egresos.
- En detalle de ingresos del JPG, pagos cliente deben mostrar `unidad` (no recibo).
- PDF descarga sin recortes criticos.
- Excel descarga con resumen + detalle + conteo.

## 5) UX visual (aceptacion)
- Barra KPI visible y legible.
- Tabs internos funcionan: Operacion / Conteo / Reportes / Auditoria.
- No hay tablas desbordadas fuera de su card.
- Botones clave visibles: Guardar cambios, Cerrar/Reabrir, Vista previa, Exportar.

## 6) Incidencias comunes
- "No existe cierre previo...": abrir con saldo semilla manual.
- "Caja cerrada...": reabrir (admin) o cambiar fecha.
- Error RLS/permisos: validar rol `admin` y dataset owner.

## 7) Criterio de salida
- Jornada cerrada con diferencia validada.
- Exportes generados y compartidos.
- Auditoria visible para la fecha.
- Sin errores en consola durante flujo principal.
