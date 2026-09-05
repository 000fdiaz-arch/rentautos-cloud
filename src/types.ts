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
  createdAt?: string;
};

export type FineType =
  | "NEGATIVE_PANAPASS_BALANCE"
  | "NO_ACH_XPRESS"
  | "MISSING_UNIT_CENTS";

export type FineStatus = "pending" | "partial" | "paid";

export type ClientFine = {
  id: string;
  type: FineType;
  label: string;
  amount: number;
  amountPaid: number;
  status: FineStatus;
  createdAt: string;
  paidAt?: string;
};

export type ClientTicketStatus = "pending" | "partial" | "paid";

export type ClientTicket = {
  id: string;
  ticketNumber: string;
  ticketDate?: string;
  ticketAmount: number;
  processingFee: number;
  amount: number;
  amountPaid: number;
  status: ClientTicketStatus;
  comment?: string;
  createdAt: string;
  paidAt?: string;
};

export type ClientStatus =
  | "activo"
  | "taller"
  | "chapisteria"
  | "custodia"
  | "archivado";

export type ProvisionalRentalFrequency = "daily" | "weekly" | "biweekly";
export type ProvisionalRentalStatus = "active" | "returned" | "cancelled";

export type ProvisionalRentalCharge = {
  id: string;
  dueDate: string;
  amount: number;
  amountPaid: number;
};

export type ProvisionalRentalRateChange = {
  id: string;
  changedAt: string;
  previousFrequency: ProvisionalRentalFrequency;
  nextFrequency: ProvisionalRentalFrequency;
  previousAmount: number;
  nextAmount: number;
};

export type ProvisionalRental = {
  id: string;
  clientId: string;
  regularUnitId: string;
  unitId: string;
  brandModel?: string;
  plate?: string;
  frequency: ProvisionalRentalFrequency;
  rentAmount: number;
  startDate: string;
  lastChargeDate?: string;
  nextChargeDate?: string;
  returnedAt?: string;
  cancelledAt?: string;
  status: ProvisionalRentalStatus;
  balance: number;
  creditBalance: number;
  charges: ProvisionalRentalCharge[];
  rateChanges?: ProvisionalRentalRateChange[];
  createdAt: string;
  updatedAt: string;
};

export type Client = {
  id: string;
  unitId: string;
  name: string;
  cedula?: string;
  whatsAppPhone?: string;
  rentAmount: number;
  frequency: BillingFrequency;
  chargeFirstSunday?: boolean;
  firstSundayChargedAt?: string;
  weeklyChargeDay?: WeeklyChargeDay;
  monthlyChargeDay?: number;
  installmentsAgreed: number;
  /** Contract installments already generated as rent charges. */
  installmentsIssued?: number;
  /** True when installmentsIssued was inferred from incomplete legacy data. */
  installmentsIssuedEstimateNeedsReview?: boolean;
  installmentsRemaining: number;
  installmentsPaid: number;
  otherCharges: OtherCharge[];
  fines?: ClientFine[];
  tickets?: ClientTicket[];
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
  activeProvisionalRental?: ProvisionalRental;
  provisionalRentalHistory?: ProvisionalRental[];
};

export type LeadDecision = "aplica" | "aplica_con_abono" | "no_aplica";

export type SellerLeadRequestStatus = "waiting_information" | "pending_review" | "incomplete" | "reviewed";

export type SellerLeadRequest = {
  id: string;
  userId: string;
  token: string;
  status: SellerLeadRequestStatus;
  cedula: string;
  birthDate: string;
  attachmentName?: string;
  attachmentDataUrl?: string;
  correctionNote?: string;
  evaluationId?: string;
  expiresAt: string;
  submittedAt?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicSellerLeadRequest = {
  status: SellerLeadRequestStatus | "expired" | "not_found";
  cedula: string;
  birthDate: string;
  attachmentName?: string;
  correctionNote?: string;
  expiresAt: string;
  decision?: LeadDecision;
  extraDeposit?: number;
  reviewedAt?: string;
};

export type LeadEvaluation = {
  id: string;
  cedula: string;
  birthDate: string;
  age: number;
  attachmentName?: string;
  attachmentDataUrl?: string;
  hasGpsTamperingReport: boolean;
  hasLegalCases: boolean;
  hasViolenceReports: boolean;
  hasDuiReports: boolean;
  hasPiracyReports: boolean;
  noCases: boolean;
  collisionReports: number;
  pendingDailyReports: number;
  decision: LeadDecision;
  extraDeposit: number;
  blockers: string[];
  extraDepositReasons: string[];
  sellerRequestId?: string;
  createdAt: string;
  updatedAt: string;
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

export type CollectionTeam = "PTY" | "WC";

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

export type LateFeeReason = "DAILY_MISSED_PROOF" | "WEEKLY_LATE_DAY" | "SCHEDULED_LATE_DAY";

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
  accountName?: string;
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

export type PaymentIncomeEdit = {
  id: string;
  createdAt: string;
  actor: string;
  reason?: string;
  previousAccountNumber?: string;
  nextAccountNumber?: string;
  previousComment?: string;
  nextComment?: string;
  previousCollectionTeam?: CollectionTeam;
  nextCollectionTeam?: CollectionTeam;
  previousMoneyDelivered?: boolean;
  nextMoneyDelivered?: boolean;
  previousMoneyDeliveryDate?: string;
  nextMoneyDeliveryDate?: string;
};

export type Payment = {
  id: string;
  source?: "route";
  receiptNumber: string;
  receiptDeliveryStatus?: "pending" | "sent";
  otherChargesApplied?: OtherCharge[];
  otherChargesDueAfter?: OtherCharge[];
  finesApplied?: OtherCharge[];
  finesDueAfter?: OtherCharge[];
  ticketsApplied?: OtherCharge[];
  ticketsDueAfter?: OtherCharge[];
  advanceApplied?: number;
  advanceBalanceAfter?: number;
  clientId: string;
  clientName: string;
  clientUnit: string;
  clientCedula?: string;
  paymentContext?: "regular" | "provisional_rental";
  provisionalRentalId?: string;
  provisionalRentalUnit?: string;
  provisionalRentalBrandModel?: string;
  provisionalRentalPlate?: string;
  provisionalRentalFrequency?: ProvisionalRentalFrequency;
  provisionalRentalAmount?: number;
  provisionalRentalBalanceBefore?: number;
  provisionalRentalBalanceAfter?: number;
  provisionalRentalCreditAfter?: number;
  provisionalRentalNextChargeDate?: string;
  provisionalRentalChargesApplied?: Array<{
    chargeId: string;
    dueDate: string;
    amount: number;
    chargeAmount: number;
    paidAfter: number;
  }>;
  dateApplied: string;
  paymentMethod: PaymentMethod;
  reference?: string;
  bankAccountNumber?: string;
  bankGroupCode?: string;
  fundsReceivedDate?: string;
  incomeComment?: string;
  collectionTeam?: CollectionTeam;
  incomeEdits?: PaymentIncomeEdit[];
  moneyDelivered?: boolean;
  moneyDeliveryDate?: string;
  moneyDeliveryUpdatedAt?: string;
  moneyDeliveryUpdatedBy?: string;
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
  chargeFirstSunday?: boolean;
  firstSundayChargedAt?: string;
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
