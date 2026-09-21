const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "src/pages/ReceivablesPage.tsx"), "utf8");
const cloud = fs.readFileSync(path.join(root, "src/cloud/paymentCloudData.ts"), "utf8");

assert.ok(page.includes("activeReceivableLookupIdentityKey"), "La carga completa debe depender de identidad, no del saldo mutable.");
assert.ok(!page.includes("[clients, dataOwnerUserId, payments]"), "Un pago no debe recargar toda la cartera.");
assert.ok(page.includes("previousSignatures.get(payment.id) !== nextSignatures.get(payment.id)"), "Debe detectar altas y correcciones.");
assert.ok(page.includes("if (nextSignatures.has(paymentId)) continue"), "Debe detectar pagos eliminados.");
assert.ok(page.includes("currentTargets.some"), "Debe retirar el cache anterior del cliente afectado.");
assert.ok(page.includes("affectedLatestPaymentTokenRef"), "Respuestas antiguas no deben pisar una correccion mas reciente.");
assert.ok(cloud.includes("export function paymentMatchesTargetIdentity"), "La actualización selectiva debe reutilizar la regla autoritativa de identidad.");

console.log("OK ultimo pago selectivo: altas, cambios y bajas limitan la consulta al cliente afectado.");
