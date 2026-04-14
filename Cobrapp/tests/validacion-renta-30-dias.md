# Validacion manual de cobro de renta (30 dias)

## Objetivo
Validar que, despues de cada cierre diario, el sistema genera el cargo de renta correcto por cliente segun su frecuencia.

## Rango de prueba
- Desde: `2026-04-01`
- Hasta: `2026-04-30`

## Clientes de control sugeridos
- `D1`: Diario (no cobra domingo).
- `D2`: Diario (si cobra el primer domingo del mes).
- `S_LUN`: Semanal lunes.
- `S_MAR`: Semanal martes.
- `S_MIE`: Semanal miercoles.
- `S_JUE`: Semanal jueves.
- `S_VIE`: Semanal viernes.
- `S_SAB`: Semanal sabado.
- `S_DOM`: Semanal domingo.
- `Q1`: Quincenal (cobra 15 y 30; en febrero 28/29).
- `M10`: Mensual dia 10.
- `M30`: Mensual dia 30.

## Como validar cada dia
1. Ejecuta el cierre del dia.
2. Revisa los cargos de renta generados.
3. Compara contra la columna **Esperado**.
4. Completa **Observado** y **Resultado**.

## Matriz de validacion (30 dias)

| Fecha | Dia | Esperado (clientes con cargo) | Observado | Resultado |
|---|---|---|---|---|
| 2026-04-01 | Mie | D1, D2, S_MIE |  |  |
| 2026-04-02 | Jue | D1, D2, S_JUE |  |  |
| 2026-04-03 | Vie | D1, D2, S_VIE |  |  |
| 2026-04-04 | Sab | D1, D2, S_SAB |  |  |
| 2026-04-05 | Dom (primer domingo) | D2, S_DOM |  |  |
| 2026-04-06 | Lun | D1, D2, S_LUN |  |  |
| 2026-04-07 | Mar | D1, D2, S_MAR |  |  |
| 2026-04-08 | Mie | D1, D2, S_MIE |  |  |
| 2026-04-09 | Jue | D1, D2, S_JUE |  |  |
| 2026-04-10 | Vie | D1, D2, S_VIE, M10 |  |  |
| 2026-04-11 | Sab | D1, D2, S_SAB |  |  |
| 2026-04-12 | Dom | S_DOM |  |  |
| 2026-04-13 | Lun | D1, D2, S_LUN |  |  |
| 2026-04-14 | Mar | D1, D2, S_MAR |  |  |
| 2026-04-15 | Mie | D1, D2, S_MIE, Q1 |  |  |
| 2026-04-16 | Jue | D1, D2, S_JUE |  |  |
| 2026-04-17 | Vie | D1, D2, S_VIE |  |  |
| 2026-04-18 | Sab | D1, D2, S_SAB |  |  |
| 2026-04-19 | Dom | S_DOM |  |  |
| 2026-04-20 | Lun | D1, D2, S_LUN |  |  |
| 2026-04-21 | Mar | D1, D2, S_MAR |  |  |
| 2026-04-22 | Mie | D1, D2, S_MIE |  |  |
| 2026-04-23 | Jue | D1, D2, S_JUE |  |  |
| 2026-04-24 | Vie | D1, D2, S_VIE |  |  |
| 2026-04-25 | Sab | D1, D2, S_SAB |  |  |
| 2026-04-26 | Dom | S_DOM |  |  |
| 2026-04-27 | Lun | D1, D2, S_LUN |  |  |
| 2026-04-28 | Mar | D1, D2, S_MAR |  |  |
| 2026-04-29 | Mie | D1, D2, S_MIE |  |  |
| 2026-04-30 | Jue | D1, D2, S_JUE, Q1, M30 |  |  |

## Criterio de aprobacion
- Aprobado si para cada fecha:
  - Se generan exactamente los clientes esperados.
  - No hay clientes faltantes.
  - No hay clientes extra.
  - No hay duplicados de cargo para el mismo cliente y fecha.
