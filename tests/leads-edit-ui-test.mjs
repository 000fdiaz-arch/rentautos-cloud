import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:4198';
const owner = '11111111-1111-4111-8111-111111111111';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC2kAAAAASUVORK5CYII=';
const timestamp = '2026-09-02T12:00:00.000Z';
const record = (id, cedula) => ({ id, cedula, birthDate: '1990-01-01', age: 36, attachmentName: 'original.png', attachmentDataUrl: png,
  noCases: true, hasGpsTamperingReport: false, hasLegalCases: false, hasViolenceReports: false, hasDuiReports: false, hasPiracyReports: false,
  collisionReports: 0, pendingDailyReports: 0, decision: 'aplica', extraDeposit: 0, blockers: [], extraDepositReasons: [], createdAt: timestamp, updatedAt: timestamp });
const records = [record('lead-a', '8-100-100'), record('lead-b', '8-100-200')];
let seller = { id: 'seller-a', user_id: owner, token: 'private-test', status: 'pending_review', cedula: '7-100-100', birth_date: '1990-01-01',
  attachment_name: 'seller.png', attachment_data_url: png, evaluation_id: null, expires_at: timestamp, submitted_at: timestamp, reviewed_at: null, created_at: timestamp, updated_at: timestamp };
let failLoad = false, failSave = false, failSeller = false, reads = 0, writes = 0, patches = 0, cases = 0;
const check = text => { console.log('OK', text); cases++; };
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4198', '--strictPort'], {
  windowsHide: true, stdio: 'pipe', env: { ...process.env, VITE_SUPABASE_URL: 'https://leads-tests.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-test-key' }
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite timeout')), 15000);
    server.stdout.on('data', data => { if (data.toString().includes('4198')) { clearTimeout(timer); resolve(); } });
    server.on('error', reject);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base) {
      if (url.pathname === '/edit-test') return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
        </script><script type="module" src="/tests/fixtures/leads-performance.tsx"></script>` });
      return route.continue();
    }
    if (url.hostname !== 'leads-tests.invalid') return route.abort();
    if (url.pathname.endsWith('/rpc/read_lead_evaluations_page')) {
      const input = request.postDataJSON();
      let selected = records;
      if (input.p_cedula) selected = records.filter(row => row.cedula.replace(/-/g, '') === input.p_cedula.replace(/-/g, ''));
      return route.fulfill({ json: selected.map(({ attachmentDataUrl, ...summary }) => ({ id: summary.id, summary, updated_at: summary.updatedAt })) });
    }
    if (url.pathname.endsWith('/lead_evaluations_cloud')) {
      if (request.method() === 'POST') {
        if (failSave) return route.fulfill({ status: 500, json: { message: 'simulated save failure' } });
        const input = request.postDataJSON(); assert.equal(input.user_id, owner);
        const index = records.findIndex(row => row.id === input.id);
        if (index >= 0) records[index] = input.data; else records.push(input.data);
        writes++; return route.fulfill({ status: 201, json: null });
      }
      reads++;
      if (failLoad) return route.fulfill({ status: 500, json: { message: 'simulated document failure' } });
      return route.fulfill({ json: { data: records.find(row => row.id === url.searchParams.get('id')?.slice(3)) } });
    }
    if (url.pathname.endsWith('/seller_lead_requests')) {
      if (request.method() === 'PATCH') {
        if (failSeller) return route.fulfill({ status: 409, json: { message: 'simulated conflict' } });
        assert.equal(url.searchParams.get('id'), `eq.${seller.id}`);
        const input = request.postDataJSON();
        if (!input.status) {
          assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
          assert.equal(url.searchParams.get('status'), 'eq.pending_review');
          assert.equal(url.searchParams.get('updated_at'), `eq.${seller.updated_at}`);
        }
        seller = { ...seller, ...input }; patches++;
        return route.fulfill({ json: url.searchParams.get('select') === 'id' ? { id: seller.id } : seller });
      }
      if (url.searchParams.has('id')) return route.fulfill({ json: seller });
      const { attachment_data_url, token, ...summary } = seller;
      return route.fulfill({ json: [summary] });
    }
    return route.abort();
  });
  const form = () => page.locator('.lead-form-panel');
  const save = () => form().getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  const cancel = () => page.getByRole('button', { name: 'Cancelar edición', exact: true }).click();
  const recent = () => page.getByRole('tab', { name: 'Dictámenes recientes', exact: true }).click();
  const editRow = cedula => page.getByRole('row').filter({ has: page.getByRole('cell', { name: cedula, exact: true }) }).getByRole('button', { name: 'Editar datos', exact: true }).click();
  const newView = () => page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.goto(base + '/edit-test'); await recent();
  assert.equal(reads, 0);
  failLoad = true; await editRow('8-100-100');
  await page.getByText('No se pudo cargar el Lead completo para editar. Intenta nuevamente.').waitFor();
  assert.equal(await form().count(), 0);
  failLoad = false; await editRow('8-100-100');
  await form().waitFor();
  assert.equal(await form().getByLabel('Fecha de nacimiento').inputValue(), '1990-01-01');
  check('edición carga documento completo bajo demanda y permite reintentar una lectura fallida');
  const original = structuredClone(records[0]);
  await form().getByLabel('Fecha de nacimiento').fill('2001-01-01');
  await form().getByLabel('Sin casos', { exact: true }).uncheck();
  await form().getByLabel('Sin casos', { exact: true }).check();
  assert.equal(writes, 0);
  await cancel(); assert.deepEqual(records[0], original);
  check('cancelar no guarda; Sin casos durante edición no publica cambios automáticamente');
  await page.locator('.lead-verdict-panel').getByRole('button', { name: 'Editar datos', exact: true }).click();
  await form().getByLabel('Cedula', { exact: true }).fill('8100200');
  await save(); await page.getByText('Esa cédula ya pertenece a otro Lead. No se guardaron los cambios.').waitFor();
  assert.equal(writes, 0); assert.deepEqual(records[0], original);
  check('rechaza cédula de otro Lead incluso sin guiones y no sobrescribe registros');
  await form().getByLabel('Cedula', { exact: true }).fill('8-100-101');
  await form().getByLabel('Fecha de nacimiento').fill('2999-01-01'); await save();
  await page.getByText('La fecha de nacimiento no es valida.').waitFor(); assert.equal(writes, 0);
  await form().getByLabel('Fecha de nacimiento').fill('2001-01-01');
  failSave = true; await save(); await page.getByText('No se pudo guardar el Lead en nube. Intenta nuevamente.').waitFor();
  assert.equal(await form().getByLabel('Cedula', { exact: true }).inputValue(), '8-100-101');
  failSave = false; await save(); await form().waitFor({ state: 'hidden' });
  assert.equal(records.length, 2); assert.equal(records[0].id, original.id); assert.equal(records[0].createdAt, original.createdAt);
  assert.equal(records[0].attachmentDataUrl, png); assert.equal(records[0].cedula, '8-100-101');
  assert.equal(records[0].decision, 'aplica_con_abono'); assert.equal(records[0].extraDeposit, 200);
  check('valida fecha, conserva formulario ante fallo y corrige el mismo ID con documento y dictamen recalculado');
  await page.reload(); await recent(); await editRow('8-100-101');
  assert.equal(await form().getByLabel('Fecha de nacimiento').inputValue(), '2001-01-01');
  await form().getByLabel('Foto de cedula o licencia').setInputFiles({ name: 'corregida.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
  await page.getByText('Adjunto: corregida.png', { exact: true }).waitFor();
  await form().getByLabel('Sin casos', { exact: true }).uncheck();
  await form().getByLabel('Casos legales', { exact: true }).check();
  await save(); await form().waitFor({ state: 'hidden' });
  assert.equal(records[0].attachmentName, 'corregida.png'); assert.equal(records[0].decision, 'no_aplica');
  check('recarga conserva correcciones y permite reemplazar documento y corregir antecedentes');
  await newView(); await page.getByRole('tab', { name: 'Zona de vendedores' }).click();
  await page.getByRole('button', { name: 'Revisar', exact: true }).click();
  assert.equal(await form().getByLabel('Cedula', { exact: true }).isDisabled(), true);
  await form().getByRole('button', { name: 'Editar datos', exact: true }).click();
  await form().getByLabel('Fecha de nacimiento').fill('1985-02-02'); await cancel();
  assert.equal(await form().getByLabel('Fecha de nacimiento').inputValue(), '1990-01-01'); assert.equal(patches, 0);
  await form().getByRole('button', { name: 'Editar datos', exact: true }).click();
  await form().getByLabel('Cedula', { exact: true }).fill('7-100-101');
  await form().getByLabel('Fecha de nacimiento').fill('1985-02-02');
  failSeller = true; await save(); await page.getByText(/No se pudieron guardar las correcciones/).waitFor();
  assert.equal(seller.cedula, '7-100-100'); failSeller = false;
  const beforeSellerSave = writes;
  await save(); await page.getByText('Datos corregidos y guardados. La solicitud sigue pendiente de revisión.').waitFor();
  assert.equal(writes, beforeSellerSave); assert.equal(seller.status, 'pending_review'); assert.equal(seller.cedula, '7-100-101');
  assert.equal(seller.birth_date, '1985-02-02'); assert.equal(seller.attachment_data_url, png);
  check('corrige datos del vendedor con control de versión, cancela o reintenta sin publicar dictamen');
  await page.reload(); await page.getByRole('button', { name: 'Revisar', exact: true }).click();
  assert.equal(await form().getByLabel('Cedula', { exact: true }).inputValue(), '7-100-101');
  await form().getByRole('button', { name: 'Guardar y publicar dictamen' }).click(); await form().waitFor({ state: 'hidden' });
  assert.equal(seller.status, 'reviewed');
  const linked = records.find(item => item.sellerRequestId === seller.id);
  assert.equal(linked.id, seller.evaluation_id);
  await page.locator('.lead-verdict-panel').getByRole('button', { name: 'Editar datos', exact: true }).click();
  await form().getByLabel('Cedula', { exact: true }).fill('7-100-102');
  failSeller = true; await save(); await page.getByText(/El dictamen se guardó, pero/).waitFor();
  failSeller = false; await save(); await form().waitFor({ state: 'hidden' });
  assert.equal(seller.cedula, '7-100-102'); assert.equal(seller.evaluation_id, linked.id);
  assert.equal(records.filter(item => item.sellerRequestId === seller.id).length, 1);
  check('publicación y edición posterior sincronizan vendedor y dictamen; fallo parcial se informa y reintenta sin duplicar');
  await page.goto(base + '/edit-test?readonly'); await recent();
  assert.equal(await page.getByRole('button', { name: 'Editar datos', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Abrir', exact: true }).first().click();
  assert.equal(await page.getByRole('button', { name: 'Editar datos', exact: true }).count(), 0);
  check('modo de consulta no ofrece edición');
  await page.goto(base + '/edit-test'); await recent(); await editRow('8-100-101');
  mkdirSync('.tmp/leads-edit', { recursive: true });
  await page.screenshot({ path: '.tmp/leads-edit/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: '.tmp/leads-edit/mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  check('edición visible en móvil sin desbordamiento ni errores del navegador');
  console.log(`PASS ${cases} escenarios de edición; datos sintéticos, sin modificar producción.`);
} finally { await browser?.close(); server.kill(); }
