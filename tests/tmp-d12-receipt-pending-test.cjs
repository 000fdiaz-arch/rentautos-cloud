const { chromium } = require('playwright');

async function ensureLoggedIn(page) {
  const pagosBtn = page.getByRole('button', { name: /^Pagos$/i });
  if (await pagosBtn.count()) return;
  const loginBtn = page.getByRole('button', { name: /Iniciar sesion/i });
  if (!(await loginBtn.count())) return;
  const testId = process.env.RENTAUTOS_TEST_ID;
  const testPassword = process.env.RENTAUTOS_TEST_PASSWORD;
  if (!testId || !testPassword) {
    throw new Error('Faltan RENTAUTOS_TEST_ID y RENTAUTOS_TEST_PASSWORD para autenticar el test.');
  }
  await page.getByLabel(/^ID$/i).fill(testId);
  await page.getByLabel(/^Password$/i).fill(testPassword);
  await loginBtn.click();
  await page.getByRole('button', { name: /^Pagos$/i }).waitFor({ timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
  await ensureLoggedIn(page);

  const client = {
    id: 'd12-client-receipt-pending',
    unitId: 'D12',
    name: 'VICTOR RAUL GONZALEZ QUIROS',
    cedula: '29262153',
    rentAmount: 204,
    frequency: 'weekly',
    weeklyChargeDay: 'monday',
    chargeFirstSunday: false,
    balance: 0,
    advanceBalance: 0,
    savings: 0,
    installmentsAgreed: 100,
    installmentsRemaining: 99,
    installmentsPaid: 1,
    otherCharges: [],
    createdAt: '2026-01-01T12:00:00.000Z',
    lastChargeDate: '2026-05-11',
    status: 'activo'
  };

  await page.evaluate(({ client }) => {
    localStorage.setItem('cobrapp.module1.clients.v1', JSON.stringify([client]));
    localStorage.setItem('cobrapp.module2.payments.v1', JSON.stringify([]));
    localStorage.setItem('cobrapp.module2.pending_bank.v1', JSON.stringify([]));
    localStorage.setItem('cobrapp.module2.pending_card.v1', JSON.stringify([]));
    localStorage.setItem('cobrapp.payments.seq.v1', '0');
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
  await clientSearch.fill('D12');
  await page.locator('.client-dropdown-item').first().click();

  await page.locator('input.payment-input--amount').fill('104.12');
  await page.getByRole('button', { name: /Confirmar pago y generar recibo/i }).click();

  const receiptRoot = page.locator('.receipt-card').first();
  await receiptRoot.waitFor({ state: 'visible', timeout: 15000 });

  const receiptText = await receiptRoot.innerText();
  if (!/ESTÁS AL DÍA|ESTAS AL DIA/i.test(receiptText)) {
    throw new Error('El recibo no mostro el estado al dia esperado.');
  }
  if (!/Faltan para completarla/i.test(receiptText)) {
    throw new Error('El recibo no mostro el faltante de la proxima letra.');
  }
  if (!/\$100\.00/.test(receiptText)) {
    throw new Error('El recibo no muestra el saldo pendiente esperado de $100.00.');
  }

  const state = await page.evaluate(() => {
    const clients = JSON.parse(localStorage.getItem('cobrapp.module1.clients.v1') || '[]');
    const payments = JSON.parse(localStorage.getItem('cobrapp.module2.payments.v1') || '[]');
    return { client: clients[0], payment: payments[0] };
  });

  if (!state.payment) throw new Error('No se registro pago.');
  if (state.payment.balanceBefore !== 0) {
    throw new Error(`balanceBefore esperado 0, recibido ${state.payment.balanceBefore}`);
  }
  if (state.payment.balanceAfter !== 0) {
    throw new Error(`balanceAfter esperado 0, recibido ${state.payment.balanceAfter}`);
  }

  console.log('OK D12: recibo muestra faltante de proxima letra y mantiene balance actual en cero.');
  await browser.close();
})().catch((err) => {
  console.error('FALLO TEST D12 RECIBO:', err && err.message ? err.message : err);
  process.exit(1);
});
