import type { Client, CollectionTeam, OtherCharge, PaymentMethod } from "../../types";

export type PaymentForm = {
  clientId: string;
  dateApplied: string;
  paymentMethod: PaymentMethod;
  cashDeliveryStatus: "" | "delivered" | "pending";
  collectionTeam?: CollectionTeam | "";
  reference: string;
  amountReceived: string;
};

export type NotifiedPayment = {
  id: string;
  clientId: string;
  amount: number;
  createdAt: string;
  paymentMethod?: "bank";
  collectionTeam?: CollectionTeam;
  source?: "route";
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
  status?: "pending" | "completed" | "reverted";
  revertedAt?: string;
  revertedReason?: string;
  revertedBy?: string;
  clientSnapshots?: CashCloseClientSnapshot[];
  lateFeeEntryIds?: string[];
};

export type CloseReportStatus = "ok" | "warning";

export type CashCloseClientSnapshot = {
  clientId: string;
  unitId: string;
  name: string;
  before: {
    balance: number;
    advanceBalance?: number;
    lastChargeDate?: string;
    firstSundayChargedAt?: string;
    installmentsIssued?: number;
    installmentsIssuedEstimateNeedsReview?: boolean;
    otherCharges?: Client["otherCharges"];
    activeProvisionalRental?: Client["activeProvisionalRental"];
  };
  after: {
    balance: number;
    advanceBalance?: number;
    lastChargeDate?: string;
    firstSundayChargedAt?: string;
    installmentsIssued?: number;
    installmentsIssuedEstimateNeedsReview?: boolean;
    otherCharges?: Client["otherCharges"];
    activeProvisionalRental?: Client["activeProvisionalRental"];
  };
};

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
  isProvisionalRental?: boolean;
  rentAmount: number;
  frequencyLabel: string;
  installmentsAgreed: number;
  installmentsPendingBefore?: number;
  installmentsRemainingAfter: number;
  installmentsDeducted: number;
  totalLateFees: number;
  totalOtherCharges: number;
  totalFines: number;
  totalTickets: number;
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


export type CollectionStatus =
  | "pending"
  | "contacted"
  | "covered"
  | "route"
  | "no_answer"
  | "reminder"
  | "call_later"
  | "paid"
  | "route_collection"
  | "route_not_sent";
export type CollectionCutKey = "morning" | "afternoon" | "night";

export type CollectionStatusRecord = {
  status: CollectionStatus;
  comment: string;
  updatedAt: string;
  managementType?: "solo_cobrar" | "cobrar_o_quitar" | "desiste" | "quitar";
  managementAmount?: number;
  managementComment?: string;
  managementUpdatedAt?: string;
  whatsAppMessageCopiedAt?: string;
  whatsAppMessageSentAt?: string;
  whatsAppMessageText?: string;
  paymentPromiseDate?: string;
  paymentPromiseUpdatedAt?: string;
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
  managementType?: "solo_cobrar" | "cobrar_o_quitar" | "desiste" | "quitar";
  managementAmount?: number;
  managementComment?: string;
  whatsAppMessageCopiedAt?: string;
  whatsAppMessageSentAt?: string;
};

export type CollectionClosureSnapshot = {
  date: string;
  cutKey?: CollectionCutKey;
  cutLabel?: string;
  closedAt: string;
  actor: string;
  reason: string;
  totals: Record<CollectionStatus, number>;
  items: CollectionClosureItem[];
};

export type CollectionClosureDay = {
  date: string;
  cuts: Partial<Record<CollectionCutKey, CollectionClosureSnapshot>>;
};

export type CollectionClosureEntry = CollectionClosureSnapshot | CollectionClosureDay;
export type CollectionClosuresByDate = Record<string, CollectionClosureEntry>;


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
  totalLateFees: number;
  totalOtherCharges: number;
  otherChargesApplied: OtherCharge[];
  totalFines: number;
  finesApplied: OtherCharge[];
  totalTickets: number;
  ticketsApplied: OtherCharge[];
  forcedOtherChargesRuleApplied: boolean;
};
