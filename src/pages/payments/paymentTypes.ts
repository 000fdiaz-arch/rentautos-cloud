import type { Client, OtherCharge, PaymentMethod } from "../../types";

export type PaymentForm = {
  clientId: string;
  dateApplied: string;
  paymentMethod: PaymentMethod;
  reference: string;
  amountReceived: string;
};

export type NotifiedPayment = {
  id: string;
  clientId: string;
  amount: number;
  createdAt: string;
};

export type NotifiedPaymentForm = {
  unitId: string;
  amount: string;
};

export type PendingCardEditForm = {
  folio: string;
  reference: string;
};

export type NotifiedSortField = "unit" | "client" | "amount" | "createdAt";
export type SortDirection = "asc" | "desc";
export type HistorySortField = "receipt" | "date" | "unit" | "client" | "amount" | "applied" | "savings" | "installments" | "method";
export type HistoryDeliveryFilter = "all" | "pending" | "sent";

export type CashClosing = {
  date: string;
  closedAt: string;
};

export type CashClosingAuditAction = "close" | "reopen";

export type CashClosingAuditEvent = {
  id: string;
  date: string;
  action: CashClosingAuditAction;
  actor: string;
  reason: string;
  createdAt: string;
};

export type ChargeRun = {
  id: string;
  closingDate: string;
  targetDate: string;
  expectedClients: number;
  chargedClients: number;
  anomalyClients: number;
  chargedTotal: number;
  createdAt: string;
};

export type CloseReportStatus = "ok" | "warning";

export type ChargeReportRow = {
  clientId: string;
  unitId: string;
  name: string;
  shouldCharge: boolean;
  charged: boolean;
  anomaly: boolean;
  reason: string;
  balanceBefore: number;
  balanceAfter: number;
  chargedAmount: number;
  lastChargeDateBefore: string;
  lastChargeDateAfter: string;
};

export type ChargeCloseReport = {
  closingDate: string;
  targetDate: string;
  status: CloseReportStatus;
  expectedClients: number;
  chargedClients: number;
  anomalyClients: number;
  chargedTotal: number;
  generatedAt: string;
  rows: ChargeReportRow[];
};

export type ChargeApplyResult = {
  targetDate: string;
  alreadyProcessed: boolean;
  expectedClients: number;
  chargedClients: number;
  anomalyClients: number;
  chargedTotal: number;
  lateFeeClients: number;
  lateFeeTotal: number;
  rows: ChargeReportRow[];
  blockingError?: string;
};

export type PendingBankPreview = {
  rentAmount: number;
  frequencyLabel: string;
  installmentsAgreed: number;
  installmentsRemainingAfter: number;
  installmentsDeducted: number;
  totalOtherCharges: number;
  forcedOtherChargesRuleApplied: boolean;
  balanceAfter: number;
  installmentsCoveredByAdvance: number;
  upToDateUntil: string | null;
};

export type PendingColumnFilters = {
  folio: string;
  account: string;
  group: string;
  date: string;
  amount: string;
  name: string;
  similarity: string;
  unit: string;
  preview: string;
  description: string;
  actions: string;
};

export type HistoryColumnFilters = {
  receipt: string;
  date: string;
  unit: string;
  client: string;
  amount: string;
  applied: string;
  savings: string;
  installments: string;
  method: string;
};

export type HistoryCopyFeedback = {
  paymentId: string;
  message: string;
  tone: "info" | "success" | "error";
};


export type CollectionStatus = "no_answer" | "reminder" | "call_later" | "paid";

export type CollectionStatusRecord = {
  status: CollectionStatus;
  comment: string;
  updatedAt: string;
};

export type CollectionClosureItem = {
  clientId: string;
  unitId: string;
  clientName: string;
  lastPaymentDate: string | null;
  receivableState: string;
  totalPending: number;
  collectionStatus: CollectionStatus;
  comment: string;
  autoApplied: boolean;
};

export type CollectionClosureSnapshot = {
  date: string;
  closedAt: string;
  actor: string;
  reason: string;
  totals: Record<CollectionStatus, number>;
  items: CollectionClosureItem[];
};

export type CollectionClosuresByDate = Record<string, CollectionClosureSnapshot>;


export type ManualPaymentAllocation = {
  projectedClient: Client;
  balanceBefore: number;
  appliedToRent: number;
  centavosAhorro: number;
  advanceBefore: number;
  advanceApplied: number;
  advanceAfter: number;
  balanceAfter: number;
  installmentsDeducted: number;
  installmentsCoveredByAdvance: number;
  installmentsTotalInPayment: number;
  pendingBefore: number;
  pendingAfter: number;
  totalOtherCharges: number;
  otherChargesApplied: OtherCharge[];
  forcedOtherChargesRuleApplied: boolean;
};
