import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  server: { middlewareMode: true },
  logLevel: "silent"
});

try {
  const { computeManualPaymentAllocation } = await server.ssrLoadModule("/src/pages/payments/paymentRules.ts");
  const client = {
    id: "a13-route-test",
    unitId: "A13",
    name: "CLIENTE A13",
    cedula: "TEST-A13",
    rentAmount: 192,
    frequency: "weekly",
    weeklyChargeDay: "monday",
    chargeFirstSunday: false,
    balance: 176,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 162,
    installmentsRemaining: 111,
    installmentsPaid: 51,
    otherCharges: [{
      id: "repair-a13",
      label: "REPARACION",
      amount: 1444,
      createdAt: "2021-01-22"
    }],
    createdAt: "2021-01-22T00:00:00.000Z",
    status: "activo"
  };

  const allocation = computeManualPaymentAllocation(
    client,
    40,
    {},
    { [client.id]: { cycle: "weekly", amount: 0 } },
    [],
    "2026-10-24"
  );

  assert.equal(allocation.appliedToRent, 40, "Con retencion 0, los $40 completos deben aplicarse a renta.");
  assert.equal(allocation.balanceAfter, 136, "El saldo de renta debe bajar de $176 a $136.");
  assert.equal(allocation.totalOtherCharges, 0, "No debe aplicarse dinero a REPARACION.");
  assert.deepEqual(allocation.otherChargesApplied, [], "El pago no debe incluir cargos de reparacion.");
  assert.equal(allocation.otherChargesRetentionEvent, undefined, "No debe generarse un evento automatico de retencion.");

  console.log("OK Ruta A13: retencion semanal 0 aplica $40 a renta y $0 a REPARACION.");
} finally {
  await server.close();
}
