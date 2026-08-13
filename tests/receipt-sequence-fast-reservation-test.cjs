const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sql = fs.readFileSync(path.resolve(__dirname, "..", "supabase", "61-receipt-sequence-fast-reservation.sql"), "utf8");

assert(sql.includes("select seq + 1"), "La reserva debe partir de la secuencia persistida.");
assert(!sql.includes("max(public.parse_payment_receipt_sequence"), "La reserva no debe recorrer todo el historial.");
assert(sql.includes("pg_advisory_xact_lock"), "La reserva debe seguir siendo atómica.");
assert(sql.includes("else next_seq::text"), "No debe truncar recibos de cinco o más dígitos.");
assert(sql.includes("data->>'receiptNumber' = next_receipt"), "Debe comprobar colisiones mediante el índice único de recibos.");
assert(sql.includes("nullif(btrim(coalesce(data->>'receiptNumber', '')), '') is not null"), "Debe incluir el predicado del índice parcial de recibos.");
assert(sql.includes("set seq = next_seq - 1"), "Debe guardar el último número reservado.");
assert(sql.includes("return reserved_receipts[1]"), "La reserva individual debe devolver el recibo completo.");

console.log("OK recibos: reserva atómica sin escaneo completo del historial.");
