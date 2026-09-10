import assert from "node:assert/strict";
import esbuild from "esbuild";

const bundle = await esbuild.build({
  entryPoints: ["src/pages/payments/bankCsvImport.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "stub-cloud-folio-check",
    setup(build) {
      build.onResolve({ filter: /\.\.\/\.\.\/cloudData$/ }, () => ({ path: "cloudData", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: "export async function loadCloudProcessedPaymentFolios() { return new Set(); }",
        loader: "js"
      }));
    }
  }]
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const { importBankCsv } = await import(moduleUrl);

function makeClient(index) {
  return {
    id: `client-${index}`,
    unitId: `T${1000 + index}`,
    name: `CLIENTE ${index}`,
    cedula: `8-${String(index).padStart(4, "0")}`,
    status: "active",
    balance: 100,
    savings: 0,
    rentAmount: 20,
    frequency: "daily",
    installmentsRemaining: 10,
    installmentsPaid: 0,
    installmentsAgreed: 10
  };
}

function makeCsv(rowCount) {
  const rows = ["Cuenta,Folio,Credito,Descripcion,Codigo de Transaccion"];
  for (let index = 0; index < rowCount; index += 1) {
    const clientIndex = index % 1000;
    rows.push(`3380008048,F${index},20.37,BANCO GENERAL-T${1000 + clientIndex}-CLIENTE ${clientIndex},253-104`);
  }
  return rows.join("\n");
}

const clients = Array.from({ length: 1000 }, (_, index) => makeClient(index));
const options = {
  clients,
  bankRules: [{
    id: "rule-t",
    accountNumber: "3380008048",
    groupCode: "T",
    active: true,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z"
  }],
  payments: [],
  pendingItems: [],
  notifiedPayments: [],
  operationalDateKey: "2026-09-10"
};

await importBankCsv(makeCsv(10), options);
const startedAt = performance.now();
const result = await importBankCsv(makeCsv(1000), options);
const elapsed = performance.now() - startedAt;

assert.equal(result.error, undefined);
assert.equal(result.items.length, 1000);
assert.equal(result.items[0].suggestedClientId, "client-0");
assert.equal(result.items[999].suggestedClientId, "client-999");
assert.ok(elapsed < 1000, `La importación indexada tardó ${Math.round(elapsed)}ms; se esperaba menos de 1000ms.`);

const ambiguousClients = [
  { ...makeClient(1), id: "duplicate-a", unitId: "T9000", name: "PERSONA A" },
  { ...makeClient(2), id: "duplicate-b", unitId: "T9000", name: "PERSONA B" }
];
const ambiguousResult = await importBankCsv(
  "Cuenta,Folio,Credito,Descripcion\n3380008048,AMB-1,20.00,BANCO GENERAL-T9000",
  { ...options, clients: ambiguousClients }
);
assert.equal(ambiguousResult.items[0]?.suggestedClientId, undefined, "Una referencia duplicada no debe asignarse automáticamente.");

console.log(`OK pendientes: 1000 movimientos y 1000 clientes procesados en ${Math.round(elapsed)}ms, conservando asignaciones ambiguas sin resolver.`);
