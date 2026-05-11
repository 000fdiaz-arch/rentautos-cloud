export type BillingFrequency = "daily" | "weekly" | "biweekly" | "monthly";
export type WeeklyChargeDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export type OtherCharge = {
  id?: string;
  label: string;
  amount: number;
};

export type ClientStatus = "active" | "inactive";

export type Client = {
  id: string;
  unitId: string;
  name: string;
  cedula?: string;
  rentAmount: number;
  frequency: BillingFrequency;
  chargeFirstSunday?: boolean;
  firstSundayChargedAt?: string;
  weeklyChargeDay?: WeeklyChargeDay;
  monthlyChargeDay?: number;
  installmentsAgreed: number;
  installmentsRemaining: number;
  installmentsPaid: number;
  otherCharges: OtherCharge[];
  balance: number;
  advanceBalance: number;
  savings: number;
  travelFundBalance?: number;
  createdAt: string;
  firstChargeDate?: string;
  lastChargeDate?: string;
  archivedAt?: string;
  status: ClientStatus;
  statusComment?: string;
};

export type PaymentMethod =
  | "Efectivo"
  | "ACH Express"
  | "Deposito Bancario"
  | "Transferencia Bancaria"
  | "Tarjeta"
  | "YAPPY LM"
  | "Referido"
  | "Descuento";

export type LateFeeSettings = {
  active: boolean;
  dailyAmount: number;
  chargeLabel: string;
  selectedUnits: string[];
};

export type OtherChargesRetentionCycle = BillingFrequency | "when_payment";

export type OtherChargesRetentionConfig = {
  amount: number;
  cycle: OtherChargesRetentionCycle;
};

export type OtherChargesRetentionByClient = Record<string, OtherChargesRetentionConfig>;

export type LateFeeReason = "DAILY_MISSED_PROOF" | "WEEKLY_LATE_DAY";

export type LateFeeLedgerEntry = {
  id: string;
  clientId: string;
  unitId: string;
  date: string;
  amount: number;
  reason: LateFeeReason;
  chargeLabel: string;
  createdAt: string;
};

export type PendingBankItem = {
  folio: string;
  dateApplied: string;
  amountReceived: number;
  capitalPart: number;
  centsPart: number;
  transactionCode?: string;
  referenceId: string;
  extractedName: string;
  description: string;
  importedAt: string;
  accountNumber?: string;
  mappedGroup?: string;
  // Pre-matched client (e.g. auto-match blocked because client has otros cargos)
  suggestedClientId?: string;
  suggestedClientName?: string;
};

export type PendingCardItem = {
  id: string;
  appliedPaymentId?: string;
  folio: string;
  clientId: string;
  clientName: string;
  clientUnit: string;
  clientCedula?: string;
  amountExpected: number;
  dateRegistered: string;
  expectedSettlementDate: string;
  reference?: string;
  createdAt: string;
};

export type BankRule = {
  id: string;
  accountNumber: string;
  groupCode: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ManualBankAssignmentAudit = {
  id: string;
  createdAt: string;
  folio: string;
  accountNumber?: string;
  mappedGroup?: string;
  previousClientId?: string;
  previousClientUnit?: string;
  previousClientName?: string;
  nextClientId?: string;
  nextClientUnit?: string;
  nextClientName?: string;
  reason?: string;
};

export type Payment = {
  id: string;
  receiptNumber: string;
  otherChargesApplied?: OtherCharge[];
  otherChargesDueAfter?: OtherCharge[];
  advanceApplied?: number;
  advanceBalanceAfter?: number;
  clientId: string;
  clientName: string;
  clientUnit: string;
  clientCedula?: string;
  dateApplied: string;
  paymentMethod: PaymentMethod;
  reference?: string;
  amountReceived: number;
  appliedToRent: number;
  centavosAhorro: number;
  installmentsDeducted: number;
  installmentsFromDebt?: number;
  installmentsFromAdvance?: number;
  installmentsTotalInPayment?: number;
  balanceBefore: number;
  balanceAfter: number;
  savingsBefore: number;
  savingsAfter: number;
  installmentsPaidAfter: number;
  installmentsRemainingAfter: number;
  // Datos de facturacion del cliente al momento del pago
  rentAmount: number;
  frequency: BillingFrequency;
  weeklyChargeDay?: WeeklyChargeDay;
  monthlyChargeDay?: number;
  travelFundAvailableSnapshot?: number;
  createdAt: string;
};

export type PaymentPromiseStatus =
  | "pending"
  | "fulfilled"
  | "incomplete"
  | "overdue"
  | "rescheduled"
  | "cancelled"
  | "fulfilled_late";

export type PaymentPromise = {
  id: string;
  clientId: string;
  clientName: string;
  clientUnit: string;
  amountPromised: number;
  amountCollectedWithinWindow: number;
  amountCollectedTotal: number;
  amountMissing: number;
  dueAt: string; // ISO datetime
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  comment: string;
  status: PaymentPromiseStatus;
  closedAt?: string;
  closedReason?: string;
  createdBy?: string;
};
