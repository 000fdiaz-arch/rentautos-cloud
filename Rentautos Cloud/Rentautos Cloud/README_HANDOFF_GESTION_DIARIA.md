# Rentautos Cloud - Handoff Operativo (Clientes + Gestión Diaria)

Este documento resume **todo lo implementado e iterado** en esta sesión para continuar en otra ventana sin perder contexto.

## 1) Objetivo General
Unificar operación + cobranza en la pantalla de clientes, con flujo por bloques diarios:
- AM
- PM
- CIERRE

y mantener visibilidad de unidades/clientes sin ocultar información crítica.

---

## 2) Pantalla principal actual
Se trabaja sobre:
- `src/pages/ClientsPage.tsx`

Columnas visibles principales en tabla:
- `GENERALES`
- `ESTADO DE CUENTA`
- `JORNADA DE GESTION`

Se eliminaron pruebas/baterías manuales del UI para evitar ruido operativo.

---

## 3) Bloques de gestión (AM / PM / CIERRE)
### Estados utilizados en gestión
- `no_responde`
- `recordatorio` (solo AM)
- `llamar_mas_tarde`
- `promesa_pago`
- `pago_confirmado` (AM)
- `pago_realizado` (PM)

### Reglas principales
1. **AM debe completarse 100%** para poder cerrar AM.
2. **PM depende de AM**:
   - Si AM no está cerrado, PM no está activo.
3. **CIERRE depende de PM**:
   - Si PM no está cerrado, CIERRE no está activo.
4. Si hay pago real del día, se usa data real de pagos (no pagos ficticios).

---

## 4) Sellado/Cierre de bloques
Implementado sellado diario por bloque con persistencia local:
- AM: `cobrapp.clients.daily_collection_am_seals.v1`
- PM: `cobrapp.clients.daily_collection_pm_seals.v1`
- CIERRE: `cobrapp.clients.daily_collection_close_seals.v1`

También persisten:
- Gestión diaria: `cobrapp.clients.daily_collection.v1`
- Promesas: `cobrapp.clients.daily_collection_promises.v1`

Botones implementados:
- `Terminar bloque AM`
- `Terminar bloque PM`
- `Terminar bloque Cierre`

Validaciones:
- No permite terminar un bloque si faltan unidades sin estado en ese bloque.

---

## 5) Estado operativo por bloque (dashboard)
Lógica actual:
- AM: `En curso` / `Finalizado`
- PM:
  - `Pendiente` si AM no está finalizado
  - `En curso` si AM finalizado y PM no finalizado
  - `Finalizado` si PM finalizado
- CIERRE:
  - `Pendiente` si PM no finalizado
  - `En curso` si PM finalizado y CIERRE no finalizado
  - `Finalizado` si CIERRE finalizado

---

## 6) Descargas de reportes
Se agregó botón `Descargar` en cabecera de cada bloque:
- AM
- PM
- CIERRE

Exportador ajustado para etiqueta dinámica por bloque:
- `src/exporters.ts`

Función usada:
- `exportAmClosureToPdf("AM" | "PM" | "CIERRE", summary, detailRows)`

---

## 7) Pagos del día y badges
- Se muestra `PAGÓ HOY` en estado de cuenta cuando aplica.
- Hora mostrada corresponde al `createdAt` real del pago procesado en sistema.
- Si no pagó hoy, no se muestra badge.

---

## 8) Promesas de pago
Incluida en el flujo.

Campos en promesa:
- Fecha/hora promesa (preset con fecha/hora actual al seleccionar)
- Monto prometido (obligatorio)

Comportamientos:
- Puede bloquear/reabrir gestión según estado de promesa.
- Maneja caso de promesa incumplida.
- Se contempló `promesa incumplida (pago parcial)` en iteraciones.

---

## 9) Baterías de prueba
Se **eliminaron**:
- lógica `seedAmTestBattery`
- lógica `seedPmTestBattery`
- lógica `seedFullAmPmBattery`
- botones UI de carga de baterías

Motivo: operar solo con flujo real y pagos reales del día.

---

## 10) Flujo pendiente a implementar (siguiente fase)
### CIERRE -> Envío a cobrador de calle
Requerimiento aprobado por negocio:

Cuando no hay pago/resolución al final de CIERRE, se debe pasar a gestión de calle con dos estados:
1. `COBRAR / QUITAR`
2. `SOLO COBRAR`

Regla crítica:
- En ambos estados, la cobradora debe ingresar **monto mínimo a pagar** (obligatorio).

Propuesta funcional acordada:
- Acción `Enviar a calle` en CIERRE.
- Modal con:
  - Tipo (`COBRAR / QUITAR` | `SOLO COBRAR`)
  - Monto mínimo obligatorio
  - Nota opcional
- KPI nuevos en CIERRE:
  - Enviados a calle
  - Solo cobrar
  - Cobrar/quitar
  - Monto mínimo total enviado
- No permitir `Terminar bloque Cierre` si hay casos elegibles sin definición de calle.

---

## 11) Archivos clave tocados
- `src/pages/ClientsPage.tsx`
- `src/exporters.ts`
- `src/styles.css`

---

## 12) Estado técnico
- Build compila correctamente:
  - `npm run build` ✅

---

## 13) Nota para siguiente ventana
Pendiente más importante para arrancar:
1. Implementar módulo de salida a calle en CIERRE (2 estados + monto mínimo obligatorio).
2. Amarrar su impacto en KPIs y cierre de bloque CIERRE.
3. Reflejarlo en reporte PDF de CIERRE.

