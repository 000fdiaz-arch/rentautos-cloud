import type { PaymentMethod } from "../../types";
import type { HistoryColumnFilters, PendingColumnFilters } from "./paymentTypes";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "Efectivo",
  "ACH Express",
  "Deposito Bancario",
  "Transferencia Bancaria",
  "Tarjeta",
  "YAPPY LM",
  "Referido",
  "Descuento"
];
export const BANK_PAYMENT_METHODS = new Set<PaymentMethod>(["ACH Express", "Deposito Bancario", "Transferencia Bancaria"]);
export const NOTIFIED_PAYMENTS_KEY = "cobrapp.module2.notified.v1";
export const NOTIFIED_AMOUNT_TOLERANCE = 0.02;
export const NOTIFIED_DAYS_WINDOW = 7;
export const CASH_CLOSINGS_KEY = "cobrapp.module2.cash_closings.v1";
export const CASH_CLOSING_AUDIT_KEY = "cobrapp.module2.cash_closing_audit.v1";
export const CHARGE_RUNS_KEY = "cobrapp.module2.charge_runs.v1";
export const COLLECTION_STATUS_KEY = "cobrapp.module3.street_management.v1";
export const COLLECTION_CLOSURES_KEY = "cobrapp.module3.collection_closures.v1";

export const FREQUENCY_LABEL: Record<string, string> = {
  daily: "Diario",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual"
};


export const EMPTY_PENDING_FILTERS: PendingColumnFilters = {
  folio: "",
  account: "",
  group: "",
  date: "",
  amount: "",
  name: "",
  similarity: "",
  unit: "",
  preview: "",
  description: "",
  actions: ""
};

export const EMPTY_HISTORY_COLUMN_FILTERS: HistoryColumnFilters = {
  receipt: "",
  date: "",
  unit: "",
  client: "",
  amount: "",
  applied: "",
  savings: "",
  installments: "",
  method: ""
};
