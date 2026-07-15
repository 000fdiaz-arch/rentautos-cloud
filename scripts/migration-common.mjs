import fs from "node:fs";
import path from "node:path";

export const LS_KEYS = [
  "cobrapp.module1.clients.v1",
  "cobrapp.module2.payments.v1",
  "cobrapp.payments.seq.v1",
  "cobrapp.module2.pending_bank.v1",
  "cobrapp.module2.pending_card.v1",
  "cobrapp.settings.bank_rules.v1",
  "cobrapp.module2.manual_assignment_audit.v1",
  "cobrapp.settings.late_fee_settings.v1",
  "cobrapp.module2.late_fee_ledger.v1",
  "cobrapp.settings.other_charges_retention.v1",
  "cobrapp.module2.notified.v1",
  "cobrapp.module2.cash_closings.v1",
  "cobrapp.module2.cash_closing_audit.v1",
  "cobrapp.module2.charge_runs.v1",
  "cobrapp.clients.status_filter.v1",
  "cobrapp.clients.daily_collection.v1",
  "cobrapp.clients.daily_collection_am_seals.v1",
  "cobrapp.clients.daily_collection_pm_seals.v1",
  "cobrapp.clients.daily_collection_close_seals.v1",
  "cobrapp.clients.daily_collection_promises.v1",
  "cobrapp.clients.daily_collection_street_actions.v1",
  "cobrapp.module4.leads.v1",
  "cobrapp.module5.fleet_units.v1"
];

export const ARRAY_TABLE_MAP = {
  "cobrapp.module1.clients.v1": "clients_cloud",
  "cobrapp.module2.payments.v1": "payments_cloud",
  "cobrapp.module2.pending_bank.v1": "pending_bank_items_cloud",
  "cobrapp.module2.pending_card.v1": "pending_card_items_cloud",
  "cobrapp.settings.bank_rules.v1": "bank_rules_cloud",
  "cobrapp.module2.manual_assignment_audit.v1": "manual_assignment_audit_cloud",
  "cobrapp.module2.late_fee_ledger.v1": "late_fee_ledger_cloud",
  "cobrapp.module2.notified.v1": "notified_payments_cloud",
  "cobrapp.module2.cash_closings.v1": "cash_closings_cloud",
  "cobrapp.module2.cash_closing_audit.v1": "cash_closing_audit_cloud",
  "cobrapp.module2.charge_runs.v1": "charge_runs_cloud",
  "cobrapp.module4.leads.v1": "lead_evaluations_cloud"
};

export const FLEET_UNITS_KEY = "cobrapp.module5.fleet_units.v1";

export const SINGLETON_TABLE_MAP = {
  "cobrapp.payments.seq.v1": "receipt_sequences_cloud",
  "cobrapp.settings.late_fee_settings.v1": "late_fee_settings_cloud",
  "cobrapp.settings.other_charges_retention.v1": "other_charges_retention_cloud",
  "cobrapp.clients.status_filter.v1": "client_ui_prefs_cloud",
  "cobrapp.clients.daily_collection.v1": "clients_daily_collection_cloud",
  "cobrapp.clients.daily_collection_am_seals.v1": "clients_daily_collection_am_seals_cloud",
  "cobrapp.clients.daily_collection_pm_seals.v1": "clients_daily_collection_pm_seals_cloud",
  "cobrapp.clients.daily_collection_close_seals.v1": "clients_daily_collection_close_seals_cloud",
  "cobrapp.clients.daily_collection_promises.v1": "clients_daily_collection_promises_cloud",
  "cobrapp.clients.daily_collection_street_actions.v1": "clients_daily_collection_street_actions_cloud"
};

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function summarizeValue(value) {
  if (value == null) return { exists: false, kind: null, size: 0 };
  if (Array.isArray(value)) return { exists: true, kind: "array", size: value.length };
  if (typeof value === "object") return { exists: true, kind: "object", size: Object.keys(value).length };
  return { exists: true, kind: typeof value, size: 1 };
}

export function parseArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

export function loadDotEnv(envPath = ".env") {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    out[key] = val;
  }
  return out;
}

export function toArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

export function toObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}
