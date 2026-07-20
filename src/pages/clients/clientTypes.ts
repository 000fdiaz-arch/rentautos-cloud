import type { BillingFrequency, Client, WeeklyChargeDay } from "../../types";

export type ExportFieldKey =
  | "unitId" | "cedula" | "name" | "rentAmount" | "frequency"
  | "installmentsAgreed" | "installmentsRemaining" | "installmentsPaid"
  | "otherCharges" | "balance" | "siniestrosSavings" | "debtSince";

export type ExportField = { key: ExportFieldKey; label: string; enabled: boolean };


export type OtherChargeForm = { id: string; label: string; amount: string };

export type ClientForm = {
  unitId: string;
  cedula: string;
  name: string;
  firstChargeDate: string;
  rentAmount: string;
  frequency: BillingFrequency;
  chargeFirstSunday: boolean;
  initialBalance: string;
  travelFundBalance: string;
  weeklyChargeDay: WeeklyChargeDay;
  monthlyChargeDay: string;
  installmentsAgreed: string;
  installmentsRemaining: string;
  installmentsPaid: string;
  otherCharges: OtherChargeForm[];
};

export type GeneralGroupFilterKey = "ALL" | "T" | "A" | "B" | "C" | "D";

export type PlanFilterKey = "ALL" | BillingFrequency;

export type WeeklyChargeDayFilterKey = "ALL" | WeeklyChargeDay;

export type EditClientTab = "identidad" | "plan" | "cargos" | "estado";

export type ClientsViewTab = "current" | "legacy";

export type ClientDirectoryRow = {
  unitId: string;
  client: Client | null;
  debtStartDate: Date | null;
  nextChargeDate: Date | null;
  pendingInstallments: number;
};
