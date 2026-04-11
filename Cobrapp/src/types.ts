export type BillingFrequency = "daily" | "weekly" | "biweekly" | "monthly";
export type WeeklyChargeDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export type OtherCharge = {
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
  savings: number;
  createdAt: string;
  lastChargeDate?: string;
  archivedAt?: string;
  status: ClientStatus;
  statusComment?: string;
};

export type PaymentMethod = "Efectivo" | "ACH Express" | "Deposito Bancario" | "Transferencia Bancaria" | "Tarjeta";

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
  createdAt: string;
};
