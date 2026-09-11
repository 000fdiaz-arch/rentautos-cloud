const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const baseUrl = process.env.RENTAUTOS_WORKFLOWS_BASE_URL ?? "http://127.0.0.1:5174/";
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const now = new Date().toISOString();
  const client = {
    id: "client-assigned",
    unitId: "A57",
    name: "CLIENTE ASIGNADO",
    cedula: "8-100-200",
    rentAmount: 20,
    frequency: "daily",
    balance: 100,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 10,
    installmentsRemaining: 5,
    installmentsPaid: 5,
    otherCharges: [],
    createdAt: now,
    status: "active"
  };
  const pending = [
    {
      folio: "ASSIGNED-1",
      dateApplied: "2026-09-11",
      amountReceived: 20,
      capitalPart: 20,
      centsPart: 0,
      extractedName: "NOMBRE PARCIAL",
      description: "PAGO SIN COINCIDENCIA EXACTA 1",
      importedAt: now,
      accountNumber: "0116607400",
      mappedGroup: "A",
      suggestedClientId: client.id,
      suggestedClientName: client.name
    },
    {
      folio: "ASSIGNED-2",
      dateApplied: "2026-09-11",
      amountReceived: 20,
      capitalPart: 20,
      centsPart: 0,
      extractedName: "OTRO NOMBRE PARCIAL",
      description: "PAGO SIN COINCIDENCIA EXACTA 2",
      importedAt: now,
      accountNumber: "0116607400",
      mappedGroup: "A",
      suggestedClientId: client.id,
      suggestedClientName: client.name
    },
    {
      folio: "UNASSIGNED-1",
      dateApplied: "2026-09-11",
      amountReceived: 30,
      capitalPart: 30,
      centsPart: 0,
      extractedName: "SIN CLIENTE",
      description: "PAGO SIN CLIENTE",
      importedAt: now,
      accountNumber: "0116607400",
      mappedGroup: "A"
    }
  ];

  await page.evaluate(({ client, pending }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([client]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify(pending));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
  }, { client, pending });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /^Pagos$/i }).click();
  await page.getByRole("tab", { name: "Ver pendientes" }).click();

  const panel = page.getByRole("tabpanel", { name: "Ver pendientes" });
  const applyAll = panel.getByRole("button", { name: "Aplicar todos los asignados (2)" });
  await applyAll.waitFor();
  assert.equal(await panel.getByText("Alta similitud", { exact: true }).count(), 0,
    "Los pagos asignados de baja similitud deben seguir disponibles para el lote.");

  await applyAll.click();
  await page.waitForFunction(() => {
    const remaining = JSON.parse(localStorage.getItem("cobrapp.module2.pending_bank.v1") || "[]");
    const payments = JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]");
    return remaining.length === 1 && payments.length === 2;
  });

  assert.equal(await panel.getByText("UNASSIGNED-1", { exact: true }).count(), 1,
    "El pago sin unidad debe permanecer pendiente.");
  assert.equal(await panel.getByText("ASSIGNED-1", { exact: true }).count(), 0);
  assert.equal(await panel.getByText("ASSIGNED-2", { exact: true }).count(), 0);

  const saved = await page.evaluate(() => ({
    clients: JSON.parse(localStorage.getItem("cobrapp.module1.clients.v1") || "[]"),
    payments: JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]")
  }));
  assert.equal(saved.payments.length, 2);
  assert.equal(saved.payments[0].clientId, "client-assigned");
  assert.equal(saved.payments[1].clientId, "client-assigned");
  assert.equal(Number(saved.clients[0].balance), 60,
    "Dos pagos asignados al mismo cliente deben aplicarse secuencialmente.");

  console.log("OK aplicar asignados: procesa baja similitud en un clic, conserva sin unidad y soporta dos pagos del mismo cliente.");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

