import { getBusinessDateKey } from "../../billing";
import type { BillingFrequency, Client, WeeklyChargeDay } from "../../types";
import type { ClientForm, ExportField } from "./clientTypes";

export const INITIAL_EXPORT_FIELDS: ExportField[] = [
  { key: "unitId",                label: "UNIDAD",        enabled: true },
  { key: "cedula",                label: "Cedula",            enabled: true },
  { key: "name",                  label: "Cliente",           enabled: true },
  { key: "rentAmount",            label: "Renta (USD)",       enabled: true },
  { key: "frequency",             label: "Frecuencia",        enabled: true },
  { key: "installmentsAgreed",    label: "Cuotas pactadas",   enabled: true },
  { key: "installmentsRemaining", label: "Cuotas restantes",  enabled: true },
  { key: "installmentsPaid",      label: "Cuotas pagadas",    enabled: true },
  { key: "otherCharges",          label: "Otros cargos",      enabled: true },
  { key: "balance",               label: "Monto a cobrar",    enabled: true },
  { key: "siniestrosSavings",     label: "Ahorro de siniestros", enabled: true },
  { key: "debtSince",             label: "Debe desde",        enabled: true },
];

export const FREQUENCY_LABEL: Record<BillingFrequency, string> = {
  daily: "Diario",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual"
};

export const FREQUENCY_OPTIONS: { value: BillingFrequency; label: string }[] = [
  { value: "daily", label: FREQUENCY_LABEL.daily },
  { value: "weekly", label: FREQUENCY_LABEL.weekly },
  { value: "biweekly", label: FREQUENCY_LABEL.biweekly },
  { value: "monthly", label: FREQUENCY_LABEL.monthly }
];

export const WEEKLY_CHARGE_DAY_OPTIONS: { value: WeeklyChargeDay; label: string }[] = [
  { value: "monday", label: "Lunes" },
  { value: "tuesday", label: "Martes" },
  { value: "wednesday", label: "Miercoles" },
  { value: "thursday", label: "Jueves" },
  { value: "friday", label: "Viernes" },
  { value: "saturday", label: "Sabado" }
];


export const CASH_CLOSINGS_KEY = "cobrapp.module2.cash_closings.v1";
export const STATUS_EDIT_OPTIONS: Client["status"][] = [
  "activo",
  "cliente_enfermo",
  "taller",
  "chapisteria",
  "custodia",
  "en_busqueda"
];
export const STATUS_LABEL: Record<Client["status"], string> = {
  activo: "Activo",
  cliente_enfermo: "Cliente Enfermo",
  taller: "Taller",
  chapisteria: "Chapisteria",
  custodia: "Custodia",
  en_busqueda: "En busqueda",
  archivado: "Archivado"
};

export const initialForm: ClientForm = {
  unitId: "",
  cedula: "",
  name: "",
  firstChargeDate: getBusinessDateKey(),
  rentAmount: "",
  frequency: "monthly",
  chargeFirstSunday: false,
  initialBalance: "",
  travelFundBalance: "0",
  weeklyChargeDay: "monday",
  monthlyChargeDay: "1",
  installmentsAgreed: "",
  installmentsRemaining: "",
  installmentsPaid: "",
  otherCharges: []
};
