const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/pages/incidents/collisionBalanceRules.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const target = path.join(os.tmpdir(), `collision-balance-rules-${Date.now()}.cjs`);
fs.writeFileSync(target, output);
const { calculateCollisionCredit } = require(target);

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: esperado ${expected}, recibido ${actual}`);
}

const overdueFirst = calculateCollisionCredit({ invoiceAmount: 600, paidToCollision: 250, rentBalance: 180, advanceBalance: 0, rentAmount: 60 });
assertEqual(overdueFirst.creditedAmount, 250, "crédito total");
assertEqual(overdueFirst.balanceAfter, 0, "primero cubre letras vencidas");
assertEqual(overdueFirst.advanceBalanceAfter, 70, "sobrante pasa a adelanto");
assertEqual(overdueFirst.installmentsCovered, 3, "cuotas vencidas cubiertas");

const capped = calculateCollisionCredit({ invoiceAmount: 100, paidToCollision: 130, rentBalance: 200, advanceBalance: 10, rentAmount: 50 });
assertEqual(capped.creditedAmount, 100, "no acredita más que la factura");
assertEqual(capped.balanceAfter, 100, "aplica crédito limitado");
assertEqual(capped.advanceBalanceAfter, 10, "no crea adelanto si queda deuda");

console.log("OK saldo de colisión: crédito a letras vencidas y sobrante a adelanto validados.");
