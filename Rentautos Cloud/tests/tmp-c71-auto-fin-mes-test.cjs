const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });

  const client = {
    id: 'c71-client-auto-month',
    unitId: 'C71',
    name: 'CLIENTE C71',
    cedula: '8-771-000',
    rentAmount: 35,
    frequency: 'daily',
    chargeFirstSunday: false,
    balance: 0,
    advanceBalance: 70,
    savings: 0.71,
    installmentsAgreed: 1000,
    installmentsRemaining: 0,
    installmentsPaid: 1000,
    otherCharges: [],
    createdAt: new Date().toISOString(),
    lastChargeDate: '2026-04-11',
    status: 'active'
  };

  await page.evaluate(({ client }) => {
    localStorage.setItem('cobrapp.module1.clients.v1', JSON.stringify([client]));
    localStorage.setItem('cobrapp.module2.payments.v1', JSON.stringify([]));
    localStorage.setItem('cobrapp.module2.pending_bank.v1', JSON.stringify([]));
    localStorage.setItem('cobrapp.payments.seq.v1', '0');
    localStorage.setItem('cobrapp.module2.cash_closings.v1', JSON.stringify([{ date: '2026-04-10', closedAt: new Date().toISOString() }]));
  }, { client });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Pagos$/i }).click();
  const registerToggle = page.getByRole('button', { name: /Registrar pago|Cerrar/i }).first();
  if (await registerToggle.count()) {
    const label = await registerToggle.innerText();
    if (!/Cerrar/i.test(label)) await registerToggle.click();
  }

  if (await page.locator('.client-pill-clear').count()) {
    await page.locator('.client-pill-clear').first().click();
  }
  const clientSearch = page.locator('input.client-search-input').first();
  await clientSearch.waitFor({ state: 'visible' });
  await clientSearch.fill('C71');
  await page.locator('.client-dropdown-item').first().click();

  await page.getByRole('button', { name: /Auto hasta fin de mes/i }).click();
  const amountValue = await page.locator('input.payment-input--amount').inputValue();
  if (Number(amountValue) !== 455) throw new Error(`Monto esperado 455, recibido ${amountValue}`);

  await page.getByRole('button', { name: /Confirmar pago y generar recibo/i }).click();
  await page.getByRole('button', { name: /^Clientes$/i }).click();
  await page.locator('input[type="text"]').first().fill('c71');

  const bodyText = await page.locator('body').innerText();
  if (!/Al dia - 30 abr 2026/i.test(bodyText)) {
    throw new Error('No se encontro "Al dia - 30 abr 2026" en pantalla');
  }

  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem('cobrapp.module1.clients.v1') || '[]');
    const payments = JSON.parse(localStorage.getItem('cobrapp.module2.payments.v1') || '[]');
    return { client: clients[0], payment: payments[0] };
  });

  if (!state.payment) throw new Error('No se registro pago');
  if ((state.payment.advanceApplied || 0) !== 455) throw new Error(`advanceApplied esperado 455, recibido ${state.payment.advanceApplied}`);
  if ((state.client.advanceBalance || 0) !== 525) throw new Error(`advanceBalance esperado 525, recibido ${state.client.advanceBalance}`);

  console.log('OK C71 auto fin de mes: queda Al dia - 30 abr 2026.');
  console.log(JSON.stringify(state, null, 2));
  await browser.close();
})().catch((err) => {
  console.error('FALLO TEST C71 AUTO FIN MES:', err && err.message ? err.message : err);
  process.exit(1);
});
