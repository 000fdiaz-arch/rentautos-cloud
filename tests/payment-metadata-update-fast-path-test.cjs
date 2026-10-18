const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260926000200_payment_metadata_update_fast_path.sql"),
  "utf8"
);
const manual = fs.readFileSync(
  path.join(root, "supabase", "90-payment-metadata-update-fast-path.sql"),
  "utf8"
);
const historyPanel = fs.readFileSync(
  path.join(root, "src", "pages", "payments", "PaymentHistoryPanel.tsx"),
  "utf8"
);

assert.equal(migration, manual, "La migracion y el script manual deben permanecer identicos.");
assert.match(migration, /if tg_op = 'UPDATE'[\s\S]*old\.data->>'dateApplied' is not distinct from new\.data->>'dateApplied'/);
assert.match(migration, /update public\.latest_payments_by_client_cloud[\s\S]*payment_id = new\.id/);

const copyHandler = historyPanel.slice(
  historyPanel.indexOf("async function handleCopyHistoryReceipt"),
  historyPanel.indexOf("async function handleRefreshHistory")
);
assert.match(copyHandler, /await prepareHistoryPaymentReceiptDelivery\(/,
  "Por enviar debe preparar el recibo para compartir en celular.");
assert.match(copyHandler, /setHistoryDeliveryConfirmation\(/,
  "Compartir no debe marcar el recibo como enviado sin confirmacion.");
assert.match(copyHandler, /await onPaymentsChange\(/, "La pantalla debe esperar la confirmacion del guardado.");
assert.ok(
  copyHandler.indexOf("await onPaymentsChange(") < copyHandler.indexOf("setHistoryCopiedPaymentIds("),
  "El estado Enviado solo debe mostrarse despues de guardar."
);
assert.match(copyHandler, /continúa \"Por enviar\"/,
  "Cancelar o rechazar la confirmacion debe conservar el estado pendiente.");
assert.match(copyHandler, /confirmado como \"Enviado\"/,
  "La confirmacion explicita debe informar el cambio de estado.");

console.log("OK recibos: UPDATE de metadata usa fast path y la UI espera el guardado.");
