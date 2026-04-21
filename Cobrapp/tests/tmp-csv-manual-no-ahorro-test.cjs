const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });

  const client = {
    id: 'csv-client-1',
    unitId: 'T99',
    name: 'CLIENTE CSV MANUAL',
    cedula: '8-999-999',
    rentAmount: 35,
    frequency: 'daily',
    chargeFirstSunday: false,
    balance: 0,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 0,
    installmentsPaid: 100,
    otherCharges: [{ label: 'ABONO', amount: 120 }],
    createdAt: new Date().toISOString(),
    lastChargeDate: '2026-04-11',
    status: 'active'
  };

  const pending = {
    folio: 'FOLIO-CSV-001',
    dateApplied: '2026-04-11',
    amountReceived: 115,
    capitalPart: 115,
    centsPart: 0,
    transactionCode: '253-104',
    referenceId: 'T99',
    extractedName: 'CLIENTE CSV MANUAL',
    description: 'PRUEBA CSV',
    importedAt: new Date().toISOString(),
    accountNumber: '3380008048',
    mappedGroup: 'T',
    suggestedClientId: 'csv-client-1',
    suggestedClientName: 'CLIENTE CSV MANUAL'
  };

  await page.evaluate(({ client, pending }) => {
    localStorage.setItem('cobrapp.module1.clients.v1', JSON.stringify([client]));
    localStorage.setItem('cobrapp.module2.payments.v1', JSON.stringify([]));
    localStorage.setItem('cobrapp.module2.pending_bank.v1', JSON.stringify([pending]));
    localStorage.setItem('cobrapp.payments.seq.v1', '0');
  }, { client, pending });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Pagos$/i }).click();
  await page.getByRole('button', { name: /Ver pendientes/i }).click();

  // Open manual review due to other charges
  await page.getByRole('button', { name: /Revisar cargos/i }).click();
  await page.getByRole('button', { name: /Confirmar y registrar pago/i }).click();

  // Verify stored data
  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem('cobrapp.module1.clients.v1') || '[]');
    const payments = JSON.parse(localStorage.getItem('cobrapp.module2.payments.v1') || '[]');
    return { client: clients[0], payment: payments[0] };
  });

  if (!state.payment) throw new Error('No se registro pago');
  if ((state.payment.centavosAhorro || 0) !== 0) throw new Error(`centavosAhorro esperado 0, recibido ${state.payment.centavosAhorro}`);
  if ((state.payment.advanceApplied || 0) !== 110) throw new Error(`advanceApplied esperado 110, recibido ${state.payment.advanceApplied}`);
  if ((state.client.savings || 0) !== 0) throw new Error(`savings esperado 0, recibido ${state.client.savings}`);
  if (!state.payment.otherChargesApplied || state.payment.otherChargesApplied.length !== 1 || state.payment.otherChargesApplied[0].amount !== 5) {
    throw new Error(`otros cargos aplicados esperados 5, recibido ${JSON.stringify(state.payment.otherChargesApplied)}`);
  }
  if (!state.client.otherCharges || state.client.otherCharges.length !== 1 || state.client.otherCharges[0].amount !== 115) {
    throw new Error(`otros cargos pendientes esperados 115, recibido ${JSON.stringify(state.client.otherCharges)}`);
  }

  console.log('OK CSV manual: regla D/T diario aplica 5 a otros cargos y deja remanente pendiente.');
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})().catch((err) => {
  console.error('FALLO TEST CSV MANUAL:', err && err.message ? err.message : err);
  process.exit(1);
});
