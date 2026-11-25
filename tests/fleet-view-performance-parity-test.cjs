const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function compile(source) {
  const exports = {};
  new Function('exports', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText)(exports);
  return exports;
}
const rules = compile(fs.readFileSync('src/pages/controlUnits/controlUnitsRules.ts', 'utf8'));

// Historical behavior is the compatibility oracle for this performance change.
function previousSort(args) {
  const { rows, search, groupFilter, companyFilter, modelFilter, statusFilter, sortField, sortDirection } = args;
  const query = search.trim().toLowerCase();
  return rows.filter(row => {
    if (groupFilter !== 'all' && rules.toGroup(row.unit_id ?? '') !== groupFilter) return false;
    if (companyFilter !== 'all' && rules.normalizeText(row.company) !== companyFilter) return false;
    if (modelFilter !== 'all' && rules.normalizeText(row.brand_model) !== modelFilter) return false;
    if (statusFilter !== 'all' && rules.effectiveStatus(row) !== statusFilter) return false;
    if (!query) return true;
    return [row.unit_id, row.company, row.brand_model, row.plate, row.engine_serial, row.chassis_serial,
      rules.optionalString(row, ['color']), rules.optionalString(row, ['transmission', 'transmission_type'])]
      .map(v => rules.normalizeText(v).toLowerCase()).join(' ').includes(query);
  }).sort((left, right) => {
    const a = sortField === 'group' ? rules.toGroup(left.unit_id ?? '') : rules.normalizeText(left[sortField]);
    const b = sortField === 'group' ? rules.toGroup(right.unit_id ?? '') : rules.normalizeText(right[sortField]);
    const result = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return sortDirection === 'asc' ? result : -result;
  });
}
function previousIncomplete(rows, search) {
  const query = search.trim().toLocaleLowerCase('es');
  return rows.filter(row => rules.getFleetCompleteness(row).missing.length > 0)
    .filter(row => !query || [row.unit_id, row.brand_model, row.plate, row.engine_serial, row.chassis_serial]
      .some(value => String(value ?? '').toLocaleLowerCase('es').includes(query)))
    .sort((a, b) => rules.getFleetCompleteness(a).completed - rules.getFleetCompleteness(b).completed ||
      String(a.unit_id ?? '').localeCompare(String(b.unit_id ?? ''), 'es', { numeric: true }));
}
function previousProvisional(rows, clients) {
  return rows.map(row => {
    const unitId = rules.normalizeText(row.unit_id).toUpperCase();
    const client = clients.find(client => client.activeProvisionalRental?.unitId.trim().toUpperCase() === unitId);
    return client ? { ...row, operational_status: 'provisional_rental', client_id: client.id,
      client_name: client.name, client_cedula: client.cedula ?? null } : row;
  });
}

const rows = Array.from({ length: 462 }, (_, i) => ({
  fleet_id: `fleet-${i}`, unit_id: [' A1 ', 'A01', 'A10', 'a2', 'Ñ3', 'É2', '', 'B100'][i % 8] + (i % 13),
  brand_model: i % 3 ? 'KIA PICANTO' : 'Ágil', company: i % 2 ? 'Empresa A' : 'Empresa B',
  year: i % 6 ? 2022 : null, plate: i % 3 ? 'ABC123' : '', engine_serial: i % 4 ? 'motor' : null,
  chassis_serial: i % 5 ? 'chasis' : undefined, color: i % 7 ? 'Azul' : '',
  transmission: i % 8 ? 'manual' : undefined, transmission_type: i % 8 ? undefined : 'automático',
  key_coded: i % 11 ? false : null, operational_status: ['libre', 'activo', 'taller', 'custodia'][i % 4]
}));
rows.push({ fleet_id: 'empty-unit', unit_id: '', operational_status: 'libre' });
const clients = Array.from({ length: 1309 }, (_, i) => ({ id: `client-${i}`, name: `Cliente ${i}`,
  status: i % 3 ? 'activo' : 'archivado', cedula: i % 2 ? 'test' : undefined,
  ...(i % 9 ? {} : { activeProvisionalRental: { unitId: rows[i % rows.length].unit_id.toLowerCase(), status: 'active' } }) }));
clients.push({ id: 'empty-client', name: 'Empty unit', activeProvisionalRental: { unitId: ' ' } });
clients.push({ id: 'duplicate-client', name: 'Must not replace first match', activeProvisionalRental: { unitId: rows[0].unit_id } });
const before = JSON.stringify({ rows, clients });
assert.deepEqual(rules.applyProvisionalFleetClients(rows, clients), previousProvisional(rows, clients));
const args = { rows, search: '', groupFilter: 'all', companyFilter: 'all', modelFilter: 'all', statusFilter: 'all', sortField: 'unit_id', sortDirection: 'asc' };
for (const sortField of ['unit_id', 'group', 'operational_status', 'brand_model', 'company', 'plate']) {
  for (const sortDirection of ['asc', 'desc']) {
    for (const overrides of [{}, { search: 'kia' }, { groupFilter: 'A' }, { companyFilter: 'Empresa B', statusFilter: 'activo' }, { modelFilter: 'Ágil' }, { search: 'missing' }]) {
      const options = { ...args, sortField, sortDirection, ...overrides };
      assert.deepEqual(rules.filterAndSortFleetRows(options), previousSort(options));
    }
  }
}
for (const search of ['', ' a1 ', 'ÁGIL', 'abc123', 'CHASIS', 'not present']) {
  assert.deepEqual(rules.getIncompleteFleetRows(rows, search), previousIncomplete(rows, search));
}
assert.equal(JSON.stringify({ rows, clients }), before, 'view computation must not mutate business data');
assert.ok(rules.getIncompleteFleetRows(rows, '').every(row => rows.includes(row)), 'rows must retain their identity');

const catalog = fs.readFileSync('src/pages/controlUnits/FleetCatalog.tsx', 'utf8');
const ast = ts.createSourceFile('FleetCatalog.tsx', catalog, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'money' ||
  ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'moneyFormatter'));
const money = compile(declarations.map(node => node.getText(ast)).join('\n') + '\nexport { money };').money;
for (const value of [null, undefined, '', 0, -0, -1, 1234.56, '7.999', 'abc', NaN, Infinity]) {
  const number = Number(value);
  const expected = value === null || value === undefined || value === '' || !Number.isFinite(number) || number < 0
    ? 'Por definir' : new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(number);
  assert.equal(money(value), expected);
}
console.log('PASS fleet views retain every record, first provisional-client match, filters, numeric/accent ordering, completeness priority and money formatting without mutations.');
