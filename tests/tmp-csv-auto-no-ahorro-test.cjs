const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });

  const client = {
    id: 'csv-client-auto-1',
    unitId: 'T88',
    name: 'CLIENTE CSV AUTO',
    cedula: '8-888-888',
    rentAmount: 35,
    frequency: 'daily',
    chargeFirstSunday: false,
    balance: 0,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 0,
    installmentsPaid: 100,
    otherCharges: [],
    createdAt: new Date().toISOString(),
    lastChargeDate: '2026-04-11',
    status: 'active'
  };

  const pending = {
    folio: 'FOLIO-CSV-002',
    dateApplied: '2026-04-11',
    amountReceived: 115.25,
    capitalPart: 115,
    centsPart: 0.25,
    transactionCode: '253-104',
    referenceId: 'T88',
    extractedName: 'CLIENTE CSV AUTO',
    description: 'PRUEBA CSV AUTO',
    importedAt: new Date().toISOString(),
    accountNumber: '3380008048',
    mappedGroup: 'T',
    suggestedClientId: 'csv-client-auto-1',
    suggestedClientName: 'CLIENTE CSV AUTO'
  };

  await page.evaluate(({ client, pending }) => {
    localStorage.setItem('cobrapp.module1.clients.v1', JSON.stringify([client]));
    localStorage.setItem('cobrapp.module2.payments.v1', JSON.stringify([]));
    localStorage.setItem('cobrapp.module2.pending_bank.v1', JSON.stringify([pending]));
    localStorage.setItem('cobrapp.payments.seq.v1', '0');
  }, { client, pending });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Pagos$/i }).click();
  await page.locator("button:has-text('Ver pendientes')").first().click({ force: true });
  await page.getByRole('button', { name: /^Aplicar$/i }).click();

  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem('cobrapp.module1.clients.v1') || '[]');
    const payments = JSON.parse(localStorage.getItem('cobrapp.module2.payments.v1') || '[]');
    return { client: clients[0], payment: payments[0] };
  });

  if (!state.payment) throw new Error('No se registro pago');
  if ((state.payment.centavosAhorro || 0) !== 0.25) throw new Error(`centavosAhorro esperado 0.25, recibido ${state.payment.centavosAhorro}`);
  if ((state.payment.advanceApplied || 0) !== 115) throw new Error(`advanceApplied esperado 115, recibido ${state.payment.advanceApplied}`);
  if ((state.client.savings || 0) !== 0.25) throw new Error(`savings esperado 0.25, recibido ${state.client.savings}`);
  if ((state.client.advanceBalance || 0) !== 115) throw new Error(`advanceBalance esperado 115, recibido ${state.client.advanceBalance}`);

  console.log('OK CSV auto: solo centavos van a ahorro y el entero excedente va a adelanto.');
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})().catch((err) => {
  console.error('FALLO TEST CSV AUTO:', err && err.message ? err.message : err);
  process.exit(1);
});
