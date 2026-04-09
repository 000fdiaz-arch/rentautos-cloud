export type BillingFrequency = "daily" | "weekly" | "biweekly" | "monthly";
export type WeeklyChargeDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export type Client = {
  id: string;
  unitId: string;
  name: string;
  rentAmount: number;
  frequency: BillingFrequency;
  weeklyChargeDay?: WeeklyChargeDay;
  monthlyChargeDay?: number;
  installmentsAgreed: number;
  installmentsRemaining: number;
  installmentsPaid: number;
  otherChargeLabel?: string;
  otherChargeAmount?: number;
  balance: number;
  createdAt: string;
};
