# COBRAPP

Primera base del MVP para una web interna de cobros.

## Que ya hace

- Ver clientes con su saldo actual.
- Guardar movimientos por cliente: cargo, abono y ajuste.
- Ver historial de movimientos.
- Cargar un CSV del banco para sugerir conciliaciones.
- Registrar un abono desde el banco o conciliar uno ya anotado.
- Guardar el estado en el navegador con `localStorage`.

## Palabras simples de la app

- `Cargo`: sube lo que el cliente debe.
- `Abono`: baja lo que el cliente debe.
- `Ajuste`: corrige el saldo, puede subir o bajar.
- `Banco`: filas del CSV pendientes por revisar.

## Como correr

```bash
npm.cmd install
npm.cmd run dev
```

## CSV sugerido

COBRAPP reconoce mejor estos encabezados:

- `fecha`
- `referencia`
- `cliente`
- `monto`

Tambien acepta variantes simples como `importe`, `credito` y `debito`.

## Siguiente paso recomendado

Conectar esto a una base de datos para guardar clientes y movimientos compartidos por todo el equipo.
