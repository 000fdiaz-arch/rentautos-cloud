const assert = require("node:assert/strict");
const { chromium } = require("playwright");

function dateKeyFor(offsetDays = 0) {
  const value = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function payment(id, receiptNumber, dateApplied, paymentMethod, amountReceived, unit) {
  const capital = Math.floor(amountReceived);
  return {
    id,
    receiptNumber,
    clientId: `client-${unit}`,
    clientName: `Cliente ${unit}`,
    clientUnit: unit,
    dateApplied,
    paymentMethod,
    amountReceived,
    appliedToRent: capital,
    centavosAhorro: Math.round((amountReceived - capital) * 100) / 100,
    installmentsDeducted: 1,
    balanceBefore: 100,
    balanceAfter: 100 - capital,
    savingsBefore: 0,
    savingsAfter: Math.round((amountReceived - capital) * 100) / 100,
    installmentsPaidAfter: 1,
    installmentsRemainingAfter: 4,
    rentAmount: 20,
    frequency: "daily",
    createdAt: `${dateApplied}T12:00:00.000Z`
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const baseUrl = process.env.RENTAUTOS_WORKFLOWS_BASE_URL ?? "http://127.0.0.1:5174/";
  const today = dateKeyFor();
  const yesterday = dateKeyFor(-1);
  const payments = [
    payment("whole-1", "REC-WHOLE-1", today, "ACH Express", 20, "A57"),
    payment("whole-2", "REC-WHOLE-2", today, "Transferencia Bancaria", 31, "A58"),
    payment("cents", "REC-CENTS", today, "ACH Express", 20.37, "A59"),
    payment("cash", "REC-CASH", today, "Efectivo", 40, "A60"),
    payment("yesterday", "REC-YESTERDAY", yesterday, "Deposito Bancario", 30, "A61")
  ];

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((seedPayments) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify(seedPayments));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
  }, payments);
  await page.goto(new URL("pagos", baseUrl).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Historial pagos" }).click();

  const panel = page.getByRole("tabpanel", { name: "Historial pagos" });
  const filter = panel.getByRole("button", { name: /Sin centavos de hoy 2/ });
  await filter.click();
  await panel.getByText("2 pagos bancarios sin centavos de hoy").waitFor();

  assert.equal(await panel.locator("tbody > tr").count(), 2, "Solo deben mostrarse los pagos bancarios de hoy con monto entero.");
  await panel.getByText("REC-WHOLE-1", { exact: true }).waitFor();
  await panel.getByText("REC-WHOLE-2", { exact: true }).waitFor();
  assert.equal(await panel.getByText("REC-CENTS", { exact: true }).count(), 0, "Debe excluir pagos con centavos.");
  assert.equal(await panel.getByText("REC-CASH", { exact: true }).count(), 0, "Debe excluir pagos en efectivo.");
  assert.equal(await panel.getByText("REC-YESTERDAY", { exact: true }).count(), 0, "Debe excluir pagos de días anteriores.");

  const firstRow = panel.locator("tbody > tr").filter({ has: page.getByText("REC-WHOLE-1", { exact: true }) });
  await firstRow.getByRole("checkbox", { name: "Marcar llamado para A57 Cliente A57" }).check();
  await firstRow.getByText("Llamado", { exact: true }).waitFor();
  await panel.getByText(/Pendientes de llamado:\s*1\s*·\s*Llamados:\s*1/).waitFor();

  await filter.click();
  assert.equal(await panel.locator("tbody > tr").count(), 5, "Al quitar el filtro debe regresar el historial normal.");

  console.log("OK historial UI: filtro diario bancario sin centavos y ganchito por pago funcionan sin alterar el historial.");
  await browser.close();
})().catch((error) => {
  console.error("FALLO HISTORIAL SIN CENTAVOS UI:", error?.message ?? error);
  process.exit(1);
});
