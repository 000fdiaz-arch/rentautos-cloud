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

export type Payment = {
  id: string;
  receiptNumber: string;
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
  // Datos de facturación del cliente al momento del pago
  rentAmount: number;
  frequency: BillingFrequency;
  weeklyChargeDay?: WeeklyChargeDay;
  monthlyChargeDay?: number;
  createdAt: string;
};
