const { chromium } = require("playwright");
const fs = require("node:fs");

(async () => {
  const baseUrl = process.env.RENTAUTOS_WORKFLOWS_BASE_URL ?? "http://127.0.0.1:5174/";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const dateApplied = "2026-08-08";
  const basePayment = {
    clientId: "income-client",
    clientName: "CLIENTE INGRESOS",
    clientUnit: "I10",
    dateApplied,
    appliedToRent: 0,
    centavosAhorro: 0,
    installmentsDeducted: 0,
    balanceBefore: 0,
    balanceAfter: 0,
    savingsBefore: 0,
    savingsAfter: 0,
    installmentsPaidAfter: 0,
    installmentsRemainingAfter: 0,
    rentAmount: 25,
    frequency: "daily",
    createdAt: "2026-08-10T14:30:00.000Z"
  };
  const payments = [
    { ...basePayment, id: "income-cash", receiptNumber: "REC-1001", paymentMethod: "Efectivo", amountReceived: 100, collectionTeam: "PTY", source: "route", incomeComment: "Cobro en Ruta · Equipo PTY" },
    { ...basePayment, id: "income-bank", receiptNumber: "REC-1002", paymentMethod: "ACH Express", amountReceived: 200, bankAccountNumber: "3380008048", bankGroupCode: "OPERACION", fundsReceivedDate: dateApplied, reference: "REF:BANCO-1" },
    { ...basePayment, id: "income-card", receiptNumber: "REC-1003", paymentMethod: "Tarjeta", amountReceived: 80, reference: "TARJETA-PENDIENTE-CONCILIACION" },
    { ...basePayment, id: "income-discount", receiptNumber: "REC-1004", paymentMethod: "Descuento", amountReceived: 50 },
    { ...basePayment, id: "income-card-received", receiptNumber: "REC-1005", paymentMethod: "Tarjeta", amountReceived: 40, fundsReceivedDate: dateApplied, bankAccountNumber: "3380008048" },
    { ...basePayment, id: "income-yappy", receiptNumber: "REC-1006", paymentMethod: "YAPPY LM", amountReceived: 30, bankAccountNumber: "3380008048" }
  ];
  const bankRules = [
    { id: "rule-a", accountNumber: "3380008048", accountName: "Cuenta principal", groupCode: "OPERACION", active: true, createdAt: basePayment.createdAt, updatedAt: basePayment.createdAt },
    { id: "rule-b", accountNumber: "9988776655", accountName: "Cuenta de ahorros", groupCode: "AHORRO", active: true, createdAt: basePayment.createdAt, updatedAt: basePayment.createdAt }
  ];

  await page.evaluate(({ payments, bankRules }) => {
    localStorage.setItem("cobrapp.module1.clients.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.payments.v1", JSON.stringify(payments));
    localStorage.setItem("cobrapp.module2.pending_bank.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.module2.pending_card.v1", JSON.stringify([]));
    localStorage.setItem("cobrapp.settings.bank_rules.v1", JSON.stringify(bankRules));
  }, { payments, bankRules });

  await page.goto(new URL("/pagos", baseUrl).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Ingresos del día/i }).click();
  const panel = page.locator("#payment-panel-income");
  await panel.waitFor({ state: "visible" });
  await panel.getByLabel("Fecha").fill("2026-08-08");

  const kpis = panel.locator(".income-day-kpis");
  if (!/\$370\.00/.test(await kpis.locator("button").nth(0).innerText())) throw new Error("Total recibido incorrecto");
  if (!/\$80\.00/.test(await kpis.locator("button").nth(1).innerText())) throw new Error("Pendiente de tarjeta incorrecto");
  if (!/\$50\.00/.test(await kpis.locator("button").nth(2).innerText())) throw new Error("Total sin entrada incorrecto");

  const pendingKpi = kpis.getByRole("button", { name: /Pendiente de acreditación/ });
  await pendingKpi.click();
  if ((await panel.getByLabel("Estado").inputValue()) !== "pending") throw new Error("El dashboard no activó el filtro pendiente");
  if (!(await panel.innerText()).includes("REC-1003")) throw new Error("El dashboard no mostró el detalle pendiente");
  await pendingKpi.click();

  await panel.getByRole("button", { name: "Compartir reporte" }).click();
  const shareDialog = page.getByRole("dialog", { name: "Compartir reporte por WhatsApp" });
  await shareDialog.waitFor({ state: "visible" });
  const shareText = await shareDialog.innerText();
  if (!shareText.includes("REPORTE DE INGRESOS") || !shareText.includes("$370.00")) throw new Error("La vista previa de WhatsApp no contiene el resumen esperado");
  if (!shareText.includes("Cuenta bancaria") || !shareText.includes("DETALLE BANCARIO") || !shareText.includes("Cuenta principal")) throw new Error("El reporte no consolidó banco con detalle por cuenta");
  if (!shareText.includes("Detalle de efectivo") || !shareText.includes("I10")) throw new Error("La vista previa no muestra el detalle del efectivo");
  if (shareText.includes("8-777-0047")) throw new Error("La vista previa no debe mostrar cédulas");
  await shareDialog.getByLabel("Contenido del reporte").selectOption("cash");
  if (!(await shareDialog.innerText()).includes("Solo efectivo")) throw new Error("No cambió el alcance del reporte para WhatsApp");
  const [reportDownload] = await Promise.all([
    page.waitForEvent("download", { predicate: (download) => download.suggestedFilename().endsWith(".png") }),
    shareDialog.getByRole("button", { name: "Descargar imágenes HD" }).click()
  ]);
  if (!reportDownload.suggestedFilename().endsWith(".png")) throw new Error("La descarga del reporte no generó un PNG HD");
  const reportBuffer = fs.readFileSync(await reportDownload.path());
  if (reportBuffer.readUInt32BE(16) !== 1080 || reportBuffer.readUInt32BE(20) !== 1350) throw new Error("El PNG no tiene resolución 1080x1350");
  const [pdfDownload] = await Promise.all([
    page.waitForEvent("download", { predicate: (download) => download.suggestedFilename().endsWith(".pdf") }),
    shareDialog.getByRole("button", { name: "Descargar PDF" }).click()
  ]);
  if (!pdfDownload.suggestedFilename().endsWith(".pdf")) throw new Error("La descarga del reporte no generó un PDF");
  await shareDialog.getByRole("button", { name: "×" }).click();

  await panel.getByLabel("Forma de pago").selectOption("Efectivo");
  if (!/\$100\.00/.test(await kpis.locator("button").nth(0).innerText())) throw new Error("El filtro por forma de pago no recalculó el total");
  await panel.getByRole("button", { name: "Limpiar filtros" }).click();
  if (!/\$370\.00/.test(await kpis.locator("button").nth(0).innerText())) throw new Error("Limpiar filtros no restauró el total");

  const bankGroup = panel.locator(".income-day-bank-consolidated");
  const bankGroupText = await bankGroup.innerText();
  if (!bankGroupText.includes("Cuenta bancaria") || !bankGroupText.includes("$200.00")) throw new Error("No se mostró el consolidado bancario");
  if (bankGroupText.includes("REC-1005") || bankGroupText.includes("REC-1006")) throw new Error("Tarjeta o Yappy se incluyeron dentro del consolidado bancario");
  if (!(await panel.locator(".income-day-group--received", { hasText: /^Tarjeta/ }).innerText()).includes("$40.00")) throw new Error("Tarjeta acreditada no quedó separada");
  if (!(await panel.locator(".income-day-group--received", { hasText: /^Yappy LM/ }).innerText()).includes("$30.00")) throw new Error("Yappy no quedó separado");
  await bankGroup.locator(".income-day-group-summary").click();
  const bankAccount = bankGroup.locator(".income-day-bank-account", { hasText: "Cuenta principal" });
  if (!(await bankAccount.innerText()).includes("····8048")) throw new Error("No se mostró el nombre y la cuenta bancaria enmascarada");
  await bankAccount.locator(".income-day-bank-account-summary").click();
  await bankAccount.getByRole("button", { name: "Editar" }).click();
  await page.locator(".income-edit-form textarea").fill("Pago verificado por administración");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  if (!(await bankGroup.innerText()).includes("Colocado el")) throw new Error("No se mostró la fecha del comentario");

  const cashGroup = panel.locator(".income-day-group", { hasText: /^Efectivo/ });
  await cashGroup.locator(".income-day-group-summary").click();
  await cashGroup.getByRole("button", { name: "Editar" }).click();
  const cashEditDialog = page.getByRole("dialog", { name: "Editar ingreso REC-1001" });
  await cashEditDialog.getByLabel("Equipo").selectOption("WC");
  await cashEditDialog.getByLabel("Motivo de la corrección").fill("El cobro correspondía al equipo WC");
  await cashEditDialog.getByRole("button", { name: "Guardar cambios" }).click();
  if (!(await cashGroup.innerText()).includes("WC") || !(await cashGroup.innerText()).includes("Cobro en Ruta · Equipo WC")) throw new Error("La corrección de equipo no actualizó el ingreso y su comentario de ruta");
  await cashGroup.getByLabel("Dinero entregado REC-1001").selectOption("no");
  await panel.getByLabel("Fecha").fill("2026-08-10");
  const pendingDelivery = panel.getByLabel("Pendientes por entregar");
  await pendingDelivery.waitFor({ state: "visible" });
  if (!(await pendingDelivery.innerText()).includes("REC-1001")) throw new Error("El efectivo marcado No no apareció pendiente al día siguiente");
  await pendingDelivery.getByRole("button", { name: "Marcar Sí" }).click();
  await pendingDelivery.waitFor({ state: "detached" });
  const completedDelivery = panel.getByLabel("Entregados hoy de días anteriores");
  await completedDelivery.waitFor({ state: "visible" });
  const completedText = await completedDelivery.innerText();
  if (!completedText.toLowerCase().includes("sábado") || !completedText.includes("08/08/2026")) throw new Error("No se conservó que el dinero pertenecía al sábado");
  const mondayCashGroup = panel.locator(".income-day-group", { hasText: /^Efectivo/ });
  await mondayCashGroup.waitFor({ state: "visible" });
  if (!(await mondayCashGroup.innerText()).includes("$100.00")) throw new Error("El efectivo del sábado no se sumó en el efectivo entregado del lunes");

  await page.waitForTimeout(100);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cobrapp.module2.payments.v1") || "[]"));
  const savedBank = saved.find((payment) => payment.id === "income-bank");
  if (savedBank?.incomeComment !== "Pago verificado por administración") throw new Error("No se guardó el comentario");
  if (!Array.isArray(savedBank?.incomeEdits)) throw new Error("No se guardó la auditoría");
  if (savedBank.incomeEdits.length !== 1) throw new Error("La auditoría del comentario es incorrecta");
  const savedCash = saved.find((payment) => payment.id === "income-cash");
  if (savedCash?.collectionTeam !== "WC" || savedCash?.incomeComment !== "Cobro en Ruta · Equipo WC") throw new Error("No se guardó la corrección del equipo WC");
  if (savedCash?.moneyDelivered !== true || savedCash?.moneyDeliveryDate !== "2026-08-10") throw new Error("No se guardó la entrega del efectivo el lunes");
  if (!Array.isArray(savedCash.incomeEdits) || savedCash.incomeEdits.length !== 3) throw new Error("No se auditaron la corrección de equipo y los cambios de entrega del efectivo");
  if (savedCash.incomeEdits[0]?.previousCollectionTeam !== "PTY" || savedCash.incomeEdits[0]?.nextCollectionTeam !== "WC") throw new Error("La auditoría no conservó el cambio PTY → WC");

  console.log("OK ingresos del día: resumen, cuenta, pendientes, comentario y auditoría validados.");
  await browser.close();
})().catch((error) => {
  console.error("FALLO INGRESOS DEL DIA:", error && error.message ? error.message : error);
  process.exit(1);
});
