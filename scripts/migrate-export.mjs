import path from "node:path";
import {
  LS_KEYS,
  nowStamp,
  parseArg,
  readJson,
  summarizeValue,
  toArray,
  writeJson
} from "./migration-common.mjs";

const input = parseArg("input", "RESPALDO COBRAPP/cobrapp-backup.json");
const output = parseArg("output", `exports/baseline-full-${nowStamp()}.json`);

const source = readJson(input);

const data = {
  "cobrapp.module1.clients.v1": toArray(source.clients),
  "cobrapp.module2.payments.v1": toArray(source.payments),
  "cobrapp.payments.seq.v1": Number.isFinite(source.seq) ? Number(source.seq) : 0,
  "cobrapp.module2.pending_bank.v1": toArray(source.pendingBankItems),
  "cobrapp.module2.pending_card.v1": toArray(source.pendingCardItems),
  "cobrapp.settings.bank_rules.v1": toArray(source.bankRules),
  "cobrapp.module2.manual_assignment_audit.v1": toArray(source.manualAssignmentAudit),
  "cobrapp.settings.late_fee_settings.v1": source.lateFeeSettings ?? { active: false, dailyAmount: 5, chargeLabel: "RECARGO POR TARDANZA DE PAGO", selectedUnits: [] },
  "cobrapp.module2.late_fee_ledger.v1": toArray(source.lateFeeLedger),
  "cobrapp.settings.other_charges_retention.v1": source.otherChargesRetentionByClient ?? {},
  "cobrapp.module2.notified.v1": toArray(source.notifiedPayments),
  "cobrapp.module2.cash_closings.v1": toArray(source.cashClosings),
  "cobrapp.module2.cash_closing_audit.v1": toArray(source.cashClosingAudit),
  "cobrapp.module2.charge_runs.v1": toArray(source.chargeRuns),
  "cobrapp.clients.status_filter.v1": typeof source.statusFilter === "string" ? source.statusFilter : "active",
  "cobrapp.module4.leads.v1": toArray(source.leadEvaluations),
  "cobrapp.module5.fleet_units.v1": toArray(source.fleetUnits)
};

const summary = {};
for (const key of LS_KEYS) summary[key] = summarizeValue(data[key]);

const payload = {
  schemaVersion: "rentautos-localstorage-baseline-v1",
  exportedAt: new Date().toISOString(),
  sourceFile: path.resolve(input),
  summary,
  data
};

writeJson(output, payload);
console.log(`OK exportado: ${path.resolve(output)}`);
console.log(`Clientes: ${summary["cobrapp.module1.clients.v1"].size} | Pagos: ${summary["cobrapp.module2.payments.v1"].size}`);
