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
  await page.getByLabel(/^Usuario$/i).fill(testId);
  await page.getByLabel(/^Contraseña$/i).fill(testPassword);
  await loginBtn.click();
  await page.getByRole('button', { name: /^Pagos$/i }).waitFor({ timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
  await ensureLoggedIn(page);

  const client = {
    id: 'c71-client-other-charges',
    unitId: 'C71',
    name: 'CLIENTE C71',
    cedula: '8-771-000',
    rentAmount: 35,
    frequency: 'daily',
    chargeFirstSunday: false,
    balance: 0,
    advanceBalance: 70,
    savings: 0,
    installmentsAgreed: 1000,
    installmentsRemaining: 0,
    installmentsPaid: 1000,
    otherCharges: [{ label: 'ABONO', amount: 15 }],
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

  const autoButtonCount = await page.getByRole('button', { name: /Auto hasta fin de mes/i }).count();
  if (autoButtonCount !== 0) {
    throw new Error('El boton automatico no debe mostrarse cuando hay otros cargos');
  }

  console.log('OK C71 con otros cargos: boton auto oculto para mantener conciliacion manual.');
  await browser.close();
})().catch((err) => {
  console.error('FALLO TEST C71 AUTO FIN MES CON OTROS CARGOS:', err && err.message ? err.message : err);
  process.exit(1);
});
