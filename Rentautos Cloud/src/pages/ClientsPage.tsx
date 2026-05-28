import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  findNextChargeDay,
  getDebtStartDate,
  getPendingInstallments,
  parseDateKey,
  startOfDay,
  toDateKey
} from "../billing";
import { exportAmClosureToPdf, exportClientsToExcel, exportClientsToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import { loadControlUnits } from "../cloudData";
import { writeLocalStorageFromCloud } from "../cloudMirror";
import { supabase } from "../lib/supabase";
import type { BillingFrequency, Client, OtherCharge, Payment, WeeklyChargeDay } from "../types";

type ExportFieldKey =
  | "unitId" | "cedula" | "name" | "rentAmount" | "frequency"
  | "installmentsAgreed" | "installmentsRemaining" | "installmentsPaid"
  | "otherCharges" | "balance" | "siniestrosSavings" | "debtSince";

type ExportField = { key: ExportFieldKey; label: string; enabled: boolean };

const INITIAL_EXPORT_FIELDS: ExportField[] = [
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

const FREQUENCY_LABEL: Record<BillingFrequency, string> = {
  daily: "Diario",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual"
};

type OtherChargeForm = { id: string; label: string; amount: string };

type ClientForm = {
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

type CollectionRunId = "run1" | "run2" | "run3";
type CollectionDailyStatus = "pago_confirmado" | "pago_realizado" | "no_responde" | "recordatorio" | "llamar_mas_tarde" | "promesa_pago";
type CollectionEntry = {
  status: CollectionDailyStatus;
  amountPaid?: number;
  followUpAt?: string;
  promisedAmount?: number;
  note?: string;
  updatedAt: string;
};
type CollectionRunMap = Record<string, CollectionEntry>;
type CollectionDailyRecord = Record<CollectionRunId, CollectionRunMap>;
type CollectionDraft = {
  status: CollectionDailyStatus | "";
  amountPaid: string;
  followUpAt: string;
  promisedAmount: string;
  note: string;
};
type ClientCollectionStartRun = CollectionRunId;
type NoActionReason = "al_dia" | "no_activo" | "libre";
type NoActionConfirmEntry = { reason: NoActionReason; confirmedAt: string };
type NoActionConfirmRunMap = Record<string, NoActionConfirmEntry>;
type NoActionConfirmByDate = Record<string, Record<CollectionRunId, NoActionConfirmRunMap>>;
type DashboardCutKey = "am" | "pm" | "close";
type DashboardMetricKey = "needContact" | "contacted" | "paidDone" | "reminder" | "noResponse" | "callLater" | "promise" | "noAction" | "promiseAttention" | "streetSent" | "streetOnlyCollect" | "streetCollectRemove";
type GeneralGroupFilterKey = "ALL" | "T" | "A" | "B" | "C" | "D";
type PromiseDashboardFilter = "all" | "attention" | "pending";
type PromiseResolution = "paid";
type PromiseState = "vigente" | "proxima" | "vencida" | "incumplida_parcial" | "cumplida";
type StreetActionType = "cobrar_quitar" | "solo_cobrar";
type StreetActionRecord = {
  type: StreetActionType;
  minAmount: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
};
type PaymentPromiseRecord = {
  promisedAt: string;
  promisedAmount: number;
  sourceRun: CollectionRunId;
  createdAt: string;
  note?: string;
  resolvedAt?: string;
  resolution?: PromiseResolution;
};

type EditClientTab = "identidad" | "plan" | "cargos" | "estado";
const CASH_CLOSINGS_KEY = "cobrapp.module2.cash_closings.v1";
const DAILY_COLLECTION_KEY = "cobrapp.clients.daily_collection.v1";
const DAILY_COLLECTION_AM_SEALS_KEY = "cobrapp.clients.daily_collection_am_seals.v1";
const DAILY_COLLECTION_PM_SEALS_KEY = "cobrapp.clients.daily_collection_pm_seals.v1";
const DAILY_COLLECTION_CLOSE_SEALS_KEY = "cobrapp.clients.daily_collection_close_seals.v1";
const DAILY_COLLECTION_PROMISES_KEY = "cobrapp.clients.daily_collection_promises.v1";
const DAILY_COLLECTION_STREET_ACTIONS_KEY = "cobrapp.clients.daily_collection_street_actions.v1";
const DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY = "cobrapp.clients.daily_collection_no_action_confirms.v1";
const DAILY_COLLECTION_SYNC_TABLES = [
  { key: DAILY_COLLECTION_KEY, table: "clients_daily_collection_cloud" },
  { key: DAILY_COLLECTION_AM_SEALS_KEY, table: "clients_daily_collection_am_seals_cloud" },
  { key: DAILY_COLLECTION_PM_SEALS_KEY, table: "clients_daily_collection_pm_seals_cloud" },
  { key: DAILY_COLLECTION_CLOSE_SEALS_KEY, table: "clients_daily_collection_close_seals_cloud" },
  { key: DAILY_COLLECTION_PROMISES_KEY, table: "clients_daily_collection_promises_cloud" },
  { key: DAILY_COLLECTION_STREET_ACTIONS_KEY, table: "clients_daily_collection_street_actions_cloud" }
] as const;
const DAILY_COLLECTION_LOCAL_ONLY_KEYS = new Set<string>([
  DAILY_COLLECTION_KEY,
  DAILY_COLLECTION_AM_SEALS_KEY,
  DAILY_COLLECTION_PM_SEALS_KEY,
  DAILY_COLLECTION_CLOSE_SEALS_KEY,
  DAILY_COLLECTION_PROMISES_KEY,
  DAILY_COLLECTION_STREET_ACTIONS_KEY,
  DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY
]);

function notifyCloudSyncPing(key: string): void {
  window.dispatchEvent(
    new CustomEvent("cobrapp:cloud-sync-ping", {
      detail: { key, at: new Date().toISOString(), source: "clients_daily_collection" }
    })
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseJsonObject<T extends Record<string, unknown>>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
  } catch {
    // ignore malformed local data
  }
  return null;
}

function loadLocalJsonObject<T extends Record<string, unknown>>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  return parseJsonObject<T>(window.localStorage.getItem(key)) ?? fallback;
}

function persistLocalJson(key: string, value: unknown, snapshotRef: MutableRefObject<Record<string, string>>): void {
  const serialized = stableJson(value);
  if (snapshotRef.current[key] === serialized) return;
  snapshotRef.current[key] = serialized;
  window.localStorage.setItem(key, serialized);
  if (!DAILY_COLLECTION_LOCAL_ONLY_KEYS.has(key)) {
    notifyCloudSyncPing(key);
  }
}

function flushDailyCollectionCloudSync(): void {
  for (const { key } of DAILY_COLLECTION_SYNC_TABLES) {
    notifyCloudSyncPing(key);
  }
}

function newerIso(left?: string, right?: string): string {
  const leftMs = left ? new Date(left).getTime() : 0;
  const rightMs = right ? new Date(right).getTime() : 0;
  return (Number.isFinite(leftMs) ? leftMs : 0) >= (Number.isFinite(rightMs) ? rightMs : 0)
    ? (left ?? "")
    : (right ?? "");
}

function mergeDailyCollectionRecords(
  current: Record<string, CollectionDailyRecord>,
  incoming: Record<string, CollectionDailyRecord>
): Record<string, CollectionDailyRecord> {
  const merged: Record<string, CollectionDailyRecord> = { ...current };
  for (const [dateKey, incomingDay] of Object.entries(incoming)) {
    const currentDay = merged[dateKey] ?? { run1: {}, run2: {}, run3: {} };
    const nextDay: CollectionDailyRecord = {
      run1: { ...currentDay.run1 },
      run2: { ...currentDay.run2 },
      run3: { ...currentDay.run3 }
    };
    for (const runId of ["run1", "run2", "run3"] as CollectionRunId[]) {
      for (const [clientId, incomingEntry] of Object.entries(incomingDay?.[runId] ?? {})) {
        const currentEntry = nextDay[runId][clientId];
        const newest = newerIso(currentEntry?.updatedAt, incomingEntry.updatedAt);
        if (!currentEntry || newest === incomingEntry.updatedAt) {
          nextDay[runId][clientId] = incomingEntry;
        }
      }
    }
    merged[dateKey] = nextDay;
  }
  return merged;
}

function mergeSeals(current: Record<string, string>, incoming: Record<string, string>): Record<string, string> {
  const merged = { ...current };
  for (const [dateKey, incomingAt] of Object.entries(incoming)) {
    const newest = newerIso(merged[dateKey], incomingAt);
    if (newest === incomingAt) merged[dateKey] = incomingAt;
  }
  return merged;
}

function mergePromiseRecords(
  current: Record<string, PaymentPromiseRecord>,
  incoming: Record<string, PaymentPromiseRecord>
): Record<string, PaymentPromiseRecord> {
  const merged = { ...current };
  for (const [clientId, incomingRecord] of Object.entries(incoming)) {
    const currentRecord = merged[clientId];
    const currentAt = currentRecord?.resolvedAt ?? currentRecord?.createdAt;
    const incomingAt = incomingRecord.resolvedAt ?? incomingRecord.createdAt;
    const newest = newerIso(currentAt, incomingAt);
    if (!currentRecord || newest === incomingAt) merged[clientId] = incomingRecord;
  }
  return merged;
}

function mergeStreetActions(
  current: Record<string, Record<string, StreetActionRecord>>,
  incoming: Record<string, Record<string, StreetActionRecord>>
): Record<string, Record<string, StreetActionRecord>> {
  const merged: Record<string, Record<string, StreetActionRecord>> = { ...current };
  for (const [dateKey, incomingByClient] of Object.entries(incoming)) {
    const currentByClient = merged[dateKey] ?? {};
    const nextByClient = { ...currentByClient };
    for (const [clientId, incomingRecord] of Object.entries(incomingByClient)) {
      const currentRecord = nextByClient[clientId];
      const newest = newerIso(currentRecord?.updatedAt, incomingRecord.updatedAt);
      if (!currentRecord || newest === incomingRecord.updatedAt) nextByClient[clientId] = incomingRecord;
    }
    merged[dateKey] = nextByClient;
  }
  return merged;
}
const STATUS_EDIT_OPTIONS: Client["status"][] = [
  "activo",
  "cliente_enfermo",
  "taller",
  "chapisteria",
  "custodia",
  "en_busqueda"
];
const STATUS_VISIBLE_OPTIONS: Client["status"][] = [
  "activo",
  "cliente_enfermo",
  "taller",
  "chapisteria",
  "custodia",
  "en_busqueda"
];
const STATUS_LABEL: Record<Client["status"], string> = {
  activo: "Activo",
  cliente_enfermo: "Cliente Enfermo",
  taller: "Taller",
  chapisteria: "Chapisteria",
  custodia: "Custodia",
  en_busqueda: "En busqueda",
  archivado: "Archivado"
};

function isClientActiveForCollection(client: Client): boolean {
  return client.status === "activo";
}

const initialForm: ClientForm = {
  unitId: "",
  cedula: "",
  name: "",
  firstChargeDate: toDateKey(new Date()),
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

function parseNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}

function createOtherChargeForm(initial?: Partial<OtherChargeForm>): OtherChargeForm {
  return {
    id: initial?.id && initial.id.trim() ? initial.id : crypto.randomUUID(),
    label: initial?.label ?? "",
    amount: initial?.amount ?? ""
  };
}

function hasBillingRuleChanged(existing: Client, form: ClientForm): boolean {
  if (existing.frequency !== form.frequency) return true;
  if (form.frequency === "weekly") return (existing.weeklyChargeDay ?? "monday") !== form.weeklyChargeDay;
  if (form.frequency === "monthly") return (existing.monthlyChargeDay ?? 1) !== Number(form.monthlyChargeDay);
  return false;
}

function firstNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[0] : "";
}

function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function formatPaymentDateKey(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  const month = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][parsed.getMonth()];
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${day}/${month}/${parsed.getFullYear()}`;
}

function formatIsoTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
}

function operationalToneClass(value: Client["status"]): string {
  if (value === "activo") return "control-op-badge control-op-badge--activo";
  if (value === "cliente_enfermo") return "control-op-badge control-op-badge--enfermo";
  if (value === "taller") return "control-op-badge control-op-badge--taller";
  if (value === "chapisteria") return "control-op-badge control-op-badge--chapisteria";
  if (value === "custodia") return "control-op-badge control-op-badge--custodia";
  if (value === "en_busqueda") return "control-op-badge control-op-badge--busqueda";
  return "control-op-badge control-op-badge--archivado";
}

function isCollectionBlockedByStatus(status: Client["status"]): boolean {
  return status !== "activo";
}

type FinancialTone = "moroso" | "proximo" | "al_dia";

function getFinancialTone(
  debtStartDate: Date | null,
  nextChargeDate: Date | null,
  operationalDate: Date
): FinancialTone {
  if (debtStartDate) return "moroso";
  if (!nextChargeDate) return "al_dia";
  const MS_PER_DAY = 86_400_000;
  const daysUntilNext = Math.ceil((startOfDay(nextChargeDate).getTime() - startOfDay(operationalDate).getTime()) / MS_PER_DAY);
  if (daysUntilNext <= 1) return "proximo";
  return "al_dia";
}

function financialToneUi(tone: FinancialTone): { label: string; className: string; tooltip: string } {
  if (tone === "moroso") {
    return {
      label: "Moroso",
      className: "badge badge-debt",
      tooltip: "Moroso: tiene saldo vencido (Debe desde ya inició)."
    };
  }
  if (tone === "proximo") {
    return {
      label: "Próx. venc.",
      className: "badge badge-warning",
      tooltip: "Próx. a vencer: el próximo cobro vence en 1 día o menos."
    };
  }
  return {
    label: "Al día",
    className: "badge badge-good",
    tooltip: "Al día: sin saldo vencido y fuera de ventana próxima a vencer."
  };
}

function runLabel(runId: CollectionRunId): string {
  if (runId === "run1") return "RUN 1";
  if (runId === "run2") return "RUN 2";
  return "RUN 3";
}

function runTimeLabel(runId: CollectionRunId): string {
  if (runId === "run1") return "Bloque inicial";
  if (runId === "run2") return "Bloque seguimiento";
  return "Bloque cierre";
}

function getClientCollectionStartRun(
  client: Client,
  todayAmSealAt?: string,
  todayPmSealAt?: string
): ClientCollectionStartRun {
  const createdAtMs = new Date(client.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return "run1";
  const pmSealMs = todayPmSealAt ? new Date(todayPmSealAt).getTime() : Number.NaN;
  const amSealMs = todayAmSealAt ? new Date(todayAmSealAt).getTime() : Number.NaN;
  if (Number.isFinite(pmSealMs) && createdAtMs > pmSealMs) return "run3";
  if (Number.isFinite(amSealMs) && createdAtMs > amSealMs) return "run2";
  return "run1";
}

function sanitizeNoActionConfirms(input: unknown): NoActionConfirmByDate {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const next: NoActionConfirmByDate = {};
  for (const [dateKey, dayValue] of Object.entries(raw)) {
    if (!dayValue || typeof dayValue !== "object" || Array.isArray(dayValue)) continue;
    const dayRaw = dayValue as Record<string, unknown>;
    const day: Record<CollectionRunId, NoActionConfirmRunMap> = { run1: {}, run2: {}, run3: {} };
    for (const runId of ["run1", "run2", "run3"] as CollectionRunId[]) {
      const runValue = dayRaw[runId];
      if (!runValue || typeof runValue !== "object" || Array.isArray(runValue)) continue;
      const runRaw = runValue as Record<string, unknown>;
      const runMap: NoActionConfirmRunMap = {};
      for (const [clientId, entry] of Object.entries(runRaw)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const e = entry as Record<string, unknown>;
        const reason = e.reason;
        const confirmedAt = e.confirmedAt;
        if ((reason === "al_dia" || reason === "no_activo" || reason === "libre") && typeof confirmedAt === "string") {
          runMap[clientId] = { reason, confirmedAt };
        }
      }
      day[runId] = runMap;
    }
    next[dateKey] = day;
  }
  return next;
}

function noActionEntityId(client: Client | null, unitId: string): string {
  return client ? client.id : `free:${unitId.trim().toUpperCase()}`;
}

function collectionStatusLabel(status: CollectionDailyStatus | ""): string {
  if (status === "no_responde") return "No responde";
  if (status === "recordatorio") return "Recordatorio";
  if (status === "llamar_mas_tarde") return "Llamar más tarde";
  if (status === "promesa_pago") return "Promesa de pago";
  if (status === "pago_realizado") return "Pago realizado";
  if (status === "pago_confirmado") return "Pago confirmado";
  return "Sin estado";
}

function getNowDateTimeLocalValue(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatDateTimeForUi(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][date.getMonth()];
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  const time = date.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
  return `${day}/${month}/${year} ${time}`;
}

function getOperationalReferenceDate(now: Date): Date {
  const today = startOfDay(now);
  try {
    const raw = window.localStorage.getItem(CASH_CLOSINGS_KEY);
    if (!raw) return today;
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return today;

    const candidates = parsed
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const rec = item as Record<string, unknown>;
        return typeof rec.date === "string" ? rec.date.trim() : "";
      })
      .filter((dateKey) => dateKey.length > 0);

    if (candidates.length === 0) return today;

    const latestClosed = [...new Set(candidates)].sort().at(-1);
    if (!latestClosed) return today;
    const latestClosedDate = parseDateKey(latestClosed);
    if (!latestClosedDate) return today;
    const nextOperational = new Date(latestClosedDate);
    nextOperational.setDate(nextOperational.getDate() + 1);
    return startOfDay(nextOperational);
  } catch {
    return today;
  }
}

function buildClient(form: ClientForm, existing?: Client): Client {
  const otherCharges: OtherCharge[] = form.otherCharges
    .filter((c) => c.label.trim() && parseNumberOrNull(c.amount) !== null)
    .map((c) => ({
      id: c.id && c.id.trim() ? c.id.trim() : crypto.randomUUID(),
      label: c.label.trim(),
      amount: Number(c.amount)
    }));

  const now = new Date();
  const todayKey = toDateKey(now);
  const normalizedFirstChargeDate = form.firstChargeDate.trim() || existing?.firstChargeDate || todayKey;
  const firstChargeDate = parseDateKey(normalizedFirstChargeDate) ? normalizedFirstChargeDate : todayKey;
  const firstChargeAnchor = parseDateKey(firstChargeDate) ?? startOfDay(now);
  const firstChargeLastDate = toDateKey(new Date(firstChargeAnchor.getFullYear(), firstChargeAnchor.getMonth(), firstChargeAnchor.getDate() - 1));
  const resetLastChargeDate = existing ? hasBillingRuleChanged(existing, form) : false;

  const client: Client = {
    id: existing?.id ?? crypto.randomUUID(),
    unitId: form.unitId.trim(),
    cedula: form.cedula.trim() || undefined,
    name: form.name.trim(),
    rentAmount: Number(form.rentAmount),
    frequency: form.frequency,
    chargeFirstSunday: form.frequency === "daily" ? form.chargeFirstSunday : false,
    firstSundayChargedAt: existing?.firstSundayChargedAt,
    balance: Number(form.initialBalance),
    travelFundBalance: Number(form.travelFundBalance),
    advanceBalance: existing?.advanceBalance ?? 0,
    savings: existing?.savings ?? 0,
    installmentsAgreed: Number(form.installmentsAgreed),
    installmentsRemaining: Number(form.installmentsRemaining),
    installmentsPaid: Number(form.installmentsPaid),
    otherCharges,
    createdAt: existing?.createdAt ?? now.toISOString(),
    firstChargeDate,
    lastChargeDate: resetLastChargeDate
      ? firstChargeLastDate
      : (existing?.lastChargeDate ?? firstChargeLastDate),
    archivedAt: existing?.archivedAt,
    status: existing?.status ?? "activo",
    statusComment: existing?.statusComment
  };

  if (form.frequency === "weekly") client.weeklyChargeDay = form.weeklyChargeDay;
  if (form.frequency === "monthly") client.monthlyChargeDay = Number(form.monthlyChargeDay);
  return client;
}

type Props = {
  clients: Client[];
  payments?: Payment[];
  onPaymentsChange?: (next: Payment[]) => void;
  onClientsChange: (next: Client[]) => void;
  dataOwnerUserId?: string | null;
};

export default function ClientsPage({ clients, payments = [], onPaymentsChange, onClientsChange, dataOwnerUserId }: Props) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [form, setForm] = useState<ClientForm>(initialForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [errorFields, setErrorFields] = useState<Set<string>>(new Set());
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(clients.length === 0);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFields, setExportFields] = useState<ExportField[]>(INITIAL_EXPORT_FIELDS);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    variant: "warning" | "danger";
    onConfirm: () => void;
  } | null>(null);
  const [statusDialog, setStatusDialog] = useState<{
    clientId: string;
    nextStatus: Client["status"];
    comment: string;
  } | null>(null);
  const [editClientTab, setEditClientTab] = useState<EditClientTab>("identidad");
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topScrollInnerRef = useRef<HTMLDivElement>(null);
  const [fleetUnitOptions, setFleetUnitOptions] = useState<string[]>([]);
  const [fleetDetailsByUnit, setFleetDetailsByUnit] = useState<Record<string, {
    plate?: string | null;
    brand_model?: string | null;
    engine_serial?: string | null;
    chassis_serial?: string | null;
    cupo?: string | null;
    company?: string | null;
    observation?: string | null;
  }>>({});
  const [vehicleInfoUnit, setVehicleInfoUnit] = useState<string | null>(null);
  const [clientInfoId, setClientInfoId] = useState<string | null>(null);
  const [dailyCollectionByDate, setDailyCollectionByDate] = useState<Record<string, CollectionDailyRecord>>(() =>
    loadLocalJsonObject<Record<string, CollectionDailyRecord>>(DAILY_COLLECTION_KEY, {})
  );
  const [streetActionsByDate, setStreetActionsByDate] = useState<Record<string, Record<string, StreetActionRecord>>>(() =>
    loadLocalJsonObject<Record<string, Record<string, StreetActionRecord>>>(DAILY_COLLECTION_STREET_ACTIONS_KEY, {})
  );
  const [promiseByClientId, setPromiseByClientId] = useState<Record<string, PaymentPromiseRecord>>(() =>
    loadLocalJsonObject<Record<string, PaymentPromiseRecord>>(DAILY_COLLECTION_PROMISES_KEY, {})
  );
  const [noActionConfirmsByDate, setNoActionConfirmsByDate] = useState<NoActionConfirmByDate>(() =>
    sanitizeNoActionConfirms(loadLocalJsonObject<Record<string, unknown>>(DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY, {}))
  );
  const [collectionDrafts, setCollectionDrafts] = useState<Record<string, CollectionDraft>>({});
  const [amSealsByDate, setAmSealsByDate] = useState<Record<string, string>>(() =>
    loadLocalJsonObject<Record<string, string>>(DAILY_COLLECTION_AM_SEALS_KEY, {})
  );
  const [pmSealsByDate, setPmSealsByDate] = useState<Record<string, string>>(() =>
    loadLocalJsonObject<Record<string, string>>(DAILY_COLLECTION_PM_SEALS_KEY, {})
  );
  const [closeSealsByDate, setCloseSealsByDate] = useState<Record<string, string>>(() =>
    loadLocalJsonObject<Record<string, string>>(DAILY_COLLECTION_CLOSE_SEALS_KEY, {})
  );
  const [activeDashboardFilter, setActiveDashboardFilter] = useState<{ cut: DashboardCutKey; metric: DashboardMetricKey } | null>(null);
  const [promiseDashboardFilter, setPromiseDashboardFilter] = useState<PromiseDashboardFilter>("all");
  const [generalGroupFilter, setGeneralGroupFilter] = useState<GeneralGroupFilterKey>("ALL");
  const [unitSearchFilter, setUnitSearchFilter] = useState<string>("");
  const [clientNameSearchFilter, setClientNameSearchFilter] = useState<string>("");
  const [saveFeedbackByKey, setSaveFeedbackByKey] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [collectionOverrideByKey, setCollectionOverrideByKey] = useState<Record<string, boolean>>({});
  const [streetActionDialog, setStreetActionDialog] = useState<{
    clientId: string;
    clientName: string;
    unitId: string;
    type: StreetActionType;
    minAmount: string;
    note: string;
  } | null>(null);
  const dailyCollectionSnapshotRef = useRef<Record<string, string>>({
    [DAILY_COLLECTION_KEY]: stableJson(dailyCollectionByDate),
    [DAILY_COLLECTION_AM_SEALS_KEY]: stableJson(amSealsByDate),
    [DAILY_COLLECTION_PM_SEALS_KEY]: stableJson(pmSealsByDate),
    [DAILY_COLLECTION_CLOSE_SEALS_KEY]: stableJson(closeSealsByDate),
    [DAILY_COLLECTION_PROMISES_KEY]: stableJson(promiseByClientId),
    [DAILY_COLLECTION_STREET_ACTIONS_KEY]: stableJson(streetActionsByDate),
    [DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY]: stableJson(noActionConfirmsByDate)
  });

  function applyDailyCollectionCloudValue(key: string, value: Record<string, unknown>): void {
    if (key === DAILY_COLLECTION_KEY) {
      const incoming = value as Record<string, CollectionDailyRecord>;
      setDailyCollectionByDate((current) => {
        const next = mergeDailyCollectionRecords(current, incoming);
        const serialized = stableJson(next);
        if (dailyCollectionSnapshotRef.current[key] === serialized) return current;
        dailyCollectionSnapshotRef.current[key] = serialized;
        writeLocalStorageFromCloud(key, serialized);
        return next;
      });
    } else if (key === DAILY_COLLECTION_AM_SEALS_KEY) {
      const incoming = value as Record<string, string>;
      setAmSealsByDate((current) => {
        const next = mergeSeals(current, incoming);
        const serialized = stableJson(next);
        if (dailyCollectionSnapshotRef.current[key] === serialized) return current;
        dailyCollectionSnapshotRef.current[key] = serialized;
        writeLocalStorageFromCloud(key, serialized);
        return next;
      });
    } else if (key === DAILY_COLLECTION_PM_SEALS_KEY) {
      const incoming = value as Record<string, string>;
      setPmSealsByDate((current) => {
        const next = mergeSeals(current, incoming);
        const serialized = stableJson(next);
        if (dailyCollectionSnapshotRef.current[key] === serialized) return current;
        dailyCollectionSnapshotRef.current[key] = serialized;
        writeLocalStorageFromCloud(key, serialized);
        return next;
      });
    } else if (key === DAILY_COLLECTION_CLOSE_SEALS_KEY) {
      const incoming = value as Record<string, string>;
      setCloseSealsByDate((current) => {
        const next = mergeSeals(current, incoming);
        const serialized = stableJson(next);
        if (dailyCollectionSnapshotRef.current[key] === serialized) return current;
        dailyCollectionSnapshotRef.current[key] = serialized;
        writeLocalStorageFromCloud(key, serialized);
        return next;
      });
    } else if (key === DAILY_COLLECTION_PROMISES_KEY) {
      const incoming = value as Record<string, PaymentPromiseRecord>;
      setPromiseByClientId((current) => {
        const next = mergePromiseRecords(current, incoming);
        const serialized = stableJson(next);
        if (dailyCollectionSnapshotRef.current[key] === serialized) return current;
        dailyCollectionSnapshotRef.current[key] = serialized;
        writeLocalStorageFromCloud(key, serialized);
        return next;
      });
    } else if (key === DAILY_COLLECTION_STREET_ACTIONS_KEY) {
      const incoming = value as Record<string, Record<string, StreetActionRecord>>;
      setStreetActionsByDate((current) => {
        const next = mergeStreetActions(current, incoming);
        const serialized = stableJson(next);
        if (dailyCollectionSnapshotRef.current[key] === serialized) return current;
        dailyCollectionSnapshotRef.current[key] = serialized;
        writeLocalStorageFromCloud(key, serialized);
        return next;
      });
    } else if (key === DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY) {
      const next = value as NoActionConfirmByDate;
      setNoActionConfirmsByDate((current) => {
        const serialized = stableJson(next);
        if (dailyCollectionSnapshotRef.current[key] === serialized) return current;
        dailyCollectionSnapshotRef.current[key] = serialized;
        writeLocalStorageFromCloud(key, serialized);
        return next;
      });
    }
  }

  const operationalReferenceDate = useMemo(() => getOperationalReferenceDate(now), [now]);
  const todayKey = useMemo(() => toDateKey(now), [now]);
  const isAmSealed = Boolean(amSealsByDate[todayKey]);
  const isPmSealed = Boolean(pmSealsByDate[todayKey]);
  const isCloseSealed = Boolean(closeSealsByDate[todayKey]);
  const todayCollection = useMemo<CollectionDailyRecord>(() => {
    return dailyCollectionByDate[todayKey] ?? { run1: {}, run2: {}, run3: {} };
  }, [dailyCollectionByDate, todayKey]);
  const todayStreetActions = useMemo<Record<string, StreetActionRecord>>(() => {
    return streetActionsByDate[todayKey] ?? {};
  }, [streetActionsByDate, todayKey]);
  const todayNoActionConfirms = useMemo<Record<CollectionRunId, NoActionConfirmRunMap>>(() => {
    const day = noActionConfirmsByDate[todayKey];
    if (!day || typeof day !== "object" || Array.isArray(day)) return { run1: {}, run2: {}, run3: {} };
    return {
      run1: (day.run1 && typeof day.run1 === "object" ? day.run1 : {}) as NoActionConfirmRunMap,
      run2: (day.run2 && typeof day.run2 === "object" ? day.run2 : {}) as NoActionConfirmRunMap,
      run3: (day.run3 && typeof day.run3 === "object" ? day.run3 : {}) as NoActionConfirmRunMap
    };
  }, [noActionConfirmsByDate, todayKey]);
  const occupiedUnitSet = useMemo(() => {
    const set = new Set<string>();
    for (const client of clients) {
      if (client.status === "archivado") continue;
      const unit = client.unitId.trim().toUpperCase();
      if (unit) set.add(unit);
    }
    return set;
  }, [clients]);
  const availableUnitOptions = useMemo(() => {
    const currentEditingUnit = editingClientId
      ? (clients.find((client) => client.id === editingClientId)?.unitId.trim().toUpperCase() ?? "")
      : "";
    return fleetUnitOptions.filter((unit) => !occupiedUnitSet.has(unit) || unit === currentEditingUnit);
  }, [clients, editingClientId, fleetUnitOptions, occupiedUnitSet]);
  const lastPaymentByClientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const payment of payments) {
      const idKey = String(payment.clientId ?? "").trim();
      if (!idKey) continue;
      const current = map.get(idKey);
      if (!current || payment.dateApplied > current) {
        map.set(idKey, payment.dateApplied);
      }
    }
    return map;
  }, [payments]);
  const paidTodayAmountByClientId = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of payments) {
      if (payment.dateApplied !== todayKey) continue;
      const idKey = String(payment.clientId ?? "").trim();
      if (!idKey) continue;
      map.set(idKey, (map.get(idKey) ?? 0) + Number(payment.amountReceived || 0));
    }
    return map;
  }, [payments, todayKey]);
  const paidTodayAfterAmSealByClientId = useMemo(() => {
    const sealAtIso = amSealsByDate[todayKey];
    if (!sealAtIso) return new Map<string, { amount: number; at: string }>();
    const sealAt = new Date(sealAtIso).getTime();
    const map = new Map<string, { amount: number; at: string }>();
    for (const payment of payments) {
      if (payment.dateApplied !== todayKey) continue;
      const idKey = String(payment.clientId ?? "").trim();
      if (!idKey) continue;
      const createdAt = String(payment.createdAt ?? "").trim();
      if (!createdAt) continue;
      const createdMs = new Date(createdAt).getTime();
      if (!Number.isFinite(createdMs) || createdMs <= sealAt) continue;
      const prev = map.get(idKey);
      if (!prev) {
        map.set(idKey, { amount: Number(payment.amountReceived || 0), at: createdAt });
      } else {
        map.set(idKey, {
          amount: prev.amount + Number(payment.amountReceived || 0),
          at: new Date(createdAt).getTime() > new Date(prev.at).getTime() ? createdAt : prev.at
        });
      }
    }
    return map;
  }, [amSealsByDate, payments, todayKey]);
  const lastPaymentTodayAtByClientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const payment of payments) {
      if (payment.dateApplied !== todayKey) continue;
      const idKey = String(payment.clientId ?? "").trim();
      if (!idKey) continue;
      const createdAt = String(payment.createdAt ?? "").trim();
      if (!createdAt) continue;
      const current = map.get(idKey);
      if (!current || new Date(createdAt).getTime() > new Date(current).getTime()) {
        map.set(idKey, createdAt);
      }
    }
    return map;
  }, [payments, todayKey]);
  const paymentsByClientId = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const payment of payments) {
      const idKey = String(payment.clientId ?? "").trim();
      if (!idKey) continue;
      const list = map.get(idKey) ?? [];
      list.push(payment);
      map.set(idKey, list);
    }
    return map;
  }, [payments]);
  function getPromiseState(client: Client): { state: PromiseState; paidSince: number } | null {
    const record = promiseByClientId[client.id];
    if (!record || record.resolution === "paid") return null;
    const promisedAtMs = new Date(record.promisedAt).getTime();
    if (!Number.isFinite(promisedAtMs)) return null;
    const clientPayments = paymentsByClientId.get(client.id) ?? [];
    let paidSince = 0;
    for (const payment of clientPayments) {
      const createdMs = new Date(String(payment.createdAt ?? "")).getTime();
      if (!Number.isFinite(createdMs)) continue;
      if (createdMs >= new Date(record.createdAt).getTime()) {
        paidSince += Number(payment.amountReceived || 0);
      }
    }
    if ((client.balance ?? 0) <= 0 && paidSince > 0) {
      return { state: "cumplida", paidSince };
    }
    const nowMs = now.getTime();
    const oneDayMs = 86_400_000;
    if (nowMs >= promisedAtMs) {
      if (paidSince > 0 && (client.balance ?? 0) > 0) {
        return { state: "incumplida_parcial", paidSince };
      }
      return { state: "vencida", paidSince };
    }
    if (promisedAtMs - nowMs <= oneDayMs) {
      return { state: "proxima", paidSince };
    }
    return { state: "vigente", paidSince };
  }

  const rows = useMemo(() => {
    // Carga completa en la tabla: no excluir clientes por estado al iniciar.
    const activeClients = clients;
    const clientByUnit = new Map<string, Client>();
    for (const client of activeClients) {
      const key = client.unitId.trim().toUpperCase();
      if (!key || clientByUnit.has(key)) continue;
      clientByUnit.set(key, client);
    }

    const fleetUnitsNormalized = fleetUnitOptions
      .map((unitId) => unitId.trim().toUpperCase())
      .filter((unitId) => unitId.length > 0);
    const fallbackUnitsFromClients = Array.from(
      new Set(
        activeClients
          .map((client) => client.unitId.trim().toUpperCase())
          .filter((unitId) => unitId.length > 0)
      )
    );
    const unitsForRows = fleetUnitsNormalized.length > 0 ? fleetUnitsNormalized : fallbackUnitsFromClients;

    const baseRows = unitsForRows.map((unitId) => {
      const client = clientByUnit.get(unitId) ?? null;
      if (!client) {
        return { unitId, client: null, debtStartDate: null, nextChargeDate: null, pendingInstallments: 0 };
      }
      const debtStartDate = getDebtStartDate(client, operationalReferenceDate);
      const nextChargeDate = debtStartDate ? null : findNextChargeDay(client, operationalReferenceDate);
      const pendingInstallments = getPendingInstallments(client);
      return { unitId, client, debtStartDate, nextChargeDate, pendingInstallments };
    });

    // Los clientes sin unidad se atienden en Clientes 2.0.
    const filtered = [...baseRows];

    filtered.sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }));

    return filtered;
  }, [clients, fleetUnitOptions, operationalReferenceDate]);

  const visibleRows = rows;
  const collectionDashboard = useMemo(() => {
    const clientRows = visibleRows.filter((row): row is (typeof row & { client: Client }) => Boolean(row.client));
    const freeRows = visibleRows.filter((row) => !row.client);
    const clientById = new Map(clientRows.map((row) => [row.client.id, row.client]));
    const todayAmSealAt = amSealsByDate[todayKey];
    const todayPmSealAt = pmSealsByDate[todayKey];
    const startRunByClientId = new Map<string, ClientCollectionStartRun>(
      clientRows.map((row) => [row.client.id, getClientCollectionStartRun(row.client, todayAmSealAt, todayPmSealAt)])
    );
    const amNeedContact = new Set(
      clientRows
        .filter((row) => startRunByClientId.get(row.client.id) === "run1")
        .map((row) => row.client.id)
    );
    for (const row of freeRows) {
      amNeedContact.add(noActionEntityId(null, row.unitId));
    }
    const pmNeedContact = new Set<string>();
    const closeNeedContact = new Set<string>();

    if (isAmSealed) {
      for (const clientId of amNeedContact) {
        const amStatus = todayCollection.run1[clientId]?.status;
        if (amStatus === "no_responde" || amStatus === "llamar_mas_tarde") {
          pmNeedContact.add(clientId);
        }
        const pmStatus = todayCollection.run2[clientId]?.status;
        if (pmStatus === "no_responde" || pmStatus === "llamar_mas_tarde") {
          closeNeedContact.add(clientId);
        }
      }
      // Promesas que requieren gestión (próxima, vencida, incumplida parcial) también entran al scope PM/Cierre
      for (const row of clientRows) {
        if (startRunByClientId.get(row.client.id) === "run2") {
          pmNeedContact.add(row.client.id);
        }
        if (startRunByClientId.get(row.client.id) === "run3") {
          closeNeedContact.add(row.client.id);
        }
        const promiseState = getPromiseState(row.client);
        if (!promiseState) continue;
        if (
          promiseState.state === "proxima" ||
          promiseState.state === "vencida" ||
          promiseState.state === "incumplida_parcial"
        ) {
          pmNeedContact.add(row.client.id);
          closeNeedContact.add(row.client.id);
        }
      }
    }

    function statsFor(
      runId: CollectionRunId,
      scope: Set<string>,
      autoPaidIds?: Set<string>
    ) {
      let contacted = 0;
      let paidDone = 0;
      let reminder = 0;
      let noResponse = 0;
      let callLater = 0;
      let promise = 0;
      let streetSent = 0;
      let streetOnlyCollect = 0;
      let streetCollectRemove = 0;
      let streetMinTotal = 0;
      const contactedIds = new Set<string>();
      const needContactIds = new Set<string>(scope);
      const paidDoneIds = new Set<string>();
      const reminderIds = new Set<string>();
      const noResponseIds = new Set<string>();
      const callLaterIds = new Set<string>();
      const promiseIds = new Set<string>();
      const streetSentIds = new Set<string>();
      const streetOnlyCollectIds = new Set<string>();
      const streetCollectRemoveIds = new Set<string>();
      for (const clientId of scope) {
        const client = clientById.get(clientId);
        const promiseState = client ? getPromiseState(client) : null;
        if (promiseState && promiseState.state !== "cumplida" && promiseState.state === "vigente") {
          // Promesa vigente: se pausa del pendiente del día, pero no cuenta como "gestionado".
          needContactIds.delete(clientId);
          continue;
        }
        if (autoPaidIds?.has(clientId)) {
          contacted += 1;
          paidDone += 1;
          contactedIds.add(clientId);
          paidDoneIds.add(clientId);
          needContactIds.delete(clientId);
          continue;
        }
        const entry = todayCollection[runId][clientId];
        if (!entry?.status) continue;
        contacted += 1;
        contactedIds.add(clientId);
        needContactIds.delete(clientId);
        if (entry.status === "recordatorio") {
          reminder += 1;
          reminderIds.add(clientId);
        }
        if (entry.status === "pago_realizado" || entry.status === "pago_confirmado") {
          paidDone += 1;
          paidDoneIds.add(clientId);
        }
        if (entry.status === "no_responde") {
          noResponse += 1;
          noResponseIds.add(clientId);
        }
        if (entry.status === "llamar_mas_tarde") {
          callLater += 1;
          callLaterIds.add(clientId);
        }
        if (entry.status === "promesa_pago") {
          promise += 1;
          promiseIds.add(clientId);
        }
        if (runId === "run3") {
          const street = todayStreetActions[clientId];
          if (street) {
            streetSent += 1;
            streetMinTotal += Number(street.minAmount || 0);
            streetSentIds.add(clientId);
            if (street.type === "solo_cobrar") {
              streetOnlyCollect += 1;
              streetOnlyCollectIds.add(clientId);
            } else {
              streetCollectRemove += 1;
              streetCollectRemoveIds.add(clientId);
            }
          }
        }
      }
      return {
        needContact: needContactIds.size,
        contacted,
        paidDone,
        reminder,
        noResponse,
        callLater,
        promise,
        streetSent,
        streetOnlyCollect,
        streetCollectRemove,
        streetMinTotal,
          ids: {
            needContact: Array.from(needContactIds),
            contacted: Array.from(contactedIds),
            paidDone: Array.from(paidDoneIds),
            reminder: Array.from(reminderIds),
            noResponse: Array.from(noResponseIds),
            callLater: Array.from(callLaterIds),
            promise: Array.from(promiseIds),
            noAction: [],
            streetSent: Array.from(streetSentIds),
            streetOnlyCollect: Array.from(streetOnlyCollectIds),
            streetCollectRemove: Array.from(streetCollectRemoveIds)
          }
      };
    }

    const pmAutoPaidIds = new Set<string>();
    for (const clientId of pmNeedContact) {
      const paidMeta = paidTodayAfterAmSealByClientId.get(clientId);
      if (!paidMeta) continue;
      const client = clientById.get(clientId);
      if (!client) continue;
      if ((client.balance ?? 0) <= 0) {
        pmAutoPaidIds.add(clientId);
      }
    }

    const amPaidIds = new Set<string>();
    const amStats = statsFor("run1", amNeedContact);
    for (const clientId of amNeedContact) {
      const amEntry = todayCollection.run1[clientId];
      if (amEntry?.status === "pago_confirmado" || amEntry?.status === "pago_realizado") {
        amPaidIds.add(clientId);
      }
    }
    const amPausedByVigentePromiseIds = new Set<string>();
    for (const clientId of amNeedContact) {
      const client = clientById.get(clientId);
      if (!client) continue;
      const promiseState = getPromiseState(client);
      if (promiseState?.state === "vigente") {
        amPausedByVigentePromiseIds.add(clientId);
      }
    }
    // En AM, "Ya gestionados" debe cubrir el universo accionable (incluyendo promesas vigentes pausadas).
    // Si "Pago realizado" incluye pagos reales detectados hoy, esos ids también deben contarse como gestionados.
    const amContactedIds = new Set<string>([
      ...amStats.ids.reminder,
      ...amStats.ids.noResponse,
      ...amStats.ids.callLater,
      ...amStats.ids.promise,
      ...amStats.ids.paidDone,
      ...Array.from(amPausedByVigentePromiseIds),
      ...Array.from(amPaidIds),
      ...Object.keys(todayNoActionConfirms.run1 ?? {})
    ]);
    const amPromiseIds = new Set<string>([
      ...amStats.ids.promise,
      ...Array.from(amPausedByVigentePromiseIds)
    ]);
    const amNeedContactIds = new Set(amStats.ids.needContact);
    for (const id of amContactedIds) {
      amNeedContactIds.delete(id);
    }

    return {
      am: {
        ...amStats,
        contacted: amContactedIds.size,
        needContact: amNeedContactIds.size,
        paidDone: amPaidIds.size,
        promise: amPromiseIds.size,
        ids: {
          ...amStats.ids,
          needContact: Array.from(amNeedContactIds),
          contacted: Array.from(amContactedIds),
          paidDone: Array.from(amPaidIds),
          promise: Array.from(amPromiseIds),
          noAction: Object.keys(todayNoActionConfirms.run1 ?? {})
        }
      },
      pm: statsFor("run2", pmNeedContact, pmAutoPaidIds),
      close: statsFor("run3", closeNeedContact)
    };
  }, [amSealsByDate, pmSealsByDate, todayKey, isAmSealed, operationalReferenceDate, paidTodayAfterAmSealByClientId, paidTodayAmountByClientId, promiseByClientId, paymentsByClientId, now, todayCollection, todayStreetActions, todayNoActionConfirms, visibleRows]);
  const promiseAttentionClientIds = useMemo(() => {
    const due = new Set<string>();
    const pending = new Set<string>();
    const allOpen = new Set<string>();
    for (const row of visibleRows) {
      if (!row.client) continue;
      const promise = getPromiseState(row.client);
      if (!promise || promise.state === "cumplida") continue;
      allOpen.add(row.client.id);
      if (promise.state === "proxima" || promise.state === "vencida" || promise.state === "incumplida_parcial") {
        due.add(row.client.id);
      } else if (promise.state === "vigente") {
        pending.add(row.client.id);
      }
    }
    return { due, pending, allOpen };
  }, [visibleRows, promiseByClientId, paymentsByClientId, now]);
  const promiseAttentionRun2Ids = useMemo(() => {
    const pmNeedContactIds = new Set(collectionDashboard.pm.ids.needContact);
    return Array.from(promiseAttentionClientIds.due).filter((id) => pmNeedContactIds.has(id));
  }, [collectionDashboard.pm.ids.needContact, promiseAttentionClientIds.due]);
  const amActionableRows = useMemo(() => {
    const todayAmSealAt = amSealsByDate[todayKey];
    const todayPmSealAt = pmSealsByDate[todayKey];
    return visibleRows
      .filter((row): row is (typeof row & { client: Client }) => Boolean(row.client))
      .filter((row) => isClientActiveForCollection(row.client))
      .filter((row) => getClientCollectionStartRun(row.client, todayAmSealAt, todayPmSealAt) === "run1")
      .filter((row) => {
        if (row.debtStartDate) return true;
        if (!row.nextChargeDate) return false;
        const MS_PER_DAY = 86_400_000;
        const daysUntilNext = Math.ceil((startOfDay(row.nextChargeDate).getTime() - startOfDay(operationalReferenceDate).getTime()) / MS_PER_DAY);
        return daysUntilNext <= 1;
      });
  }, [amSealsByDate, pmSealsByDate, todayKey, operationalReferenceDate, visibleRows]);
  const amCompletion = useMemo(() => {
    const actionable = amActionableRows;

    const missing = actionable
      .filter((row) => !todayCollection.run1[row.client.id]?.status)
      .map((row) => row.unitId);

    return {
      total: actionable.length,
      completed: actionable.length - missing.length,
      missingUnits: missing,
      isComplete: missing.length === 0
    };
  }, [amActionableRows, todayCollection.run1]);
  const pmCompletion = useMemo(() => {
    const pmScopeIds = collectionDashboard.pm.ids.needContact;
    const rows = visibleRows
      .filter((row): row is (typeof row & { client: Client }) => Boolean(row.client))
      .filter((row) => pmScopeIds.includes(row.client.id));
    const missing = rows
      .filter((row) => !todayCollection.run2[row.client.id]?.status)
      .map((row) => row.unitId);
    return {
      total: rows.length,
      completed: rows.length - missing.length,
      missingUnits: missing,
      isComplete: missing.length === 0
    };
  }, [collectionDashboard.pm.ids.needContact, todayCollection.run2, visibleRows]);
  const closeCompletion = useMemo(() => {
    const closeScopeIds = collectionDashboard.close.ids.needContact;
    const rows = visibleRows
      .filter((row): row is (typeof row & { client: Client }) => Boolean(row.client))
      .filter((row) => closeScopeIds.includes(row.client.id));
    const missing = rows
      .filter((row) => !todayCollection.run3[row.client.id]?.status)
      .map((row) => row.unitId);
    const eligibleForStreet = rows.filter((row) => {
      const status = todayCollection.run3[row.client.id]?.status;
      return status === "no_responde" || status === "llamar_mas_tarde" || status === "promesa_pago";
    });
    const missingStreetUnits = eligibleForStreet
      .filter((row) => !todayStreetActions[row.client.id])
      .map((row) => row.unitId);
    return {
      total: rows.length,
      completed: rows.length - missing.length,
      missingUnits: missing,
      isComplete: missing.length === 0,
      eligibleStreetTotal: eligibleForStreet.length,
      missingStreetUnits,
      streetReady: missingStreetUnits.length === 0
    };
  }, [collectionDashboard.close.ids.needContact, todayCollection.run3, todayStreetActions, visibleRows]);
  const missingNoActionConfirmationByRun = useMemo(() => {
    const missing: Record<CollectionRunId, string[]> = { run1: [], run2: [], run3: [] };
    const todayAmSealAt = amSealsByDate[todayKey];
    const todayPmSealAt = pmSealsByDate[todayKey];
    const runOrder: Record<CollectionRunId, number> = { run1: 1, run2: 2, run3: 3 };
    for (const row of visibleRows) {
      const client = row.client;
      const entityId = noActionEntityId(client, row.unitId);
      if (!client) {
        if (todayNoActionConfirms.run1?.[entityId]) continue;
        missing.run1.push(row.unitId);
        continue;
      }
      const startRun = getClientCollectionStartRun(client, todayAmSealAt, todayPmSealAt);
      const startOrder = runOrder[startRun];
      const debtStartDate = row.debtStartDate;
      const nextChargeDate = row.nextChargeDate;
      const tone = getFinancialTone(debtStartDate, nextChargeDate, operationalReferenceDate);
      const reason: NoActionReason | null = (() => {
        const hasAnyOverride = ["run1", "run2", "run3"].some((run) => collectionOverrideByKey[`${client.id}:${run}`]);
        if (client.status === "libre") return "libre";
        if (isCollectionBlockedByStatus(client.status) && !hasAnyOverride) return "no_activo";
        if (tone === "al_dia") return "al_dia";
        return null;
      })();
      if (!reason) continue;
      if (startOrder > runOrder.run1) continue;
      if (todayCollection.run1[entityId]?.status) continue;
      if (todayNoActionConfirms.run1?.[entityId]) continue;
      missing.run1.push(row.unitId);
    }
    return missing;
  }, [amSealsByDate, pmSealsByDate, todayKey, visibleRows, collectionOverrideByKey, operationalReferenceDate, todayCollection, todayNoActionConfirms]);
  function getRowGroup(unitId: string): Exclude<GeneralGroupFilterKey, "T"> | "T" {
    const normalized = unitId.trim().toUpperCase();
    if (normalized.startsWith("A")) return "A";
    if (normalized.startsWith("B")) return "B";
    if (normalized.startsWith("C")) return "C";
    if (normalized.startsWith("D")) return "D";
    return "T";
  }
  const displayedRows = useMemo(() => {
    let baseRows = generalGroupFilter === "ALL"
      ? visibleRows
      : visibleRows.filter((row) => getRowGroup(row.unitId) === generalGroupFilter);
    const unitQuery = unitSearchFilter.trim().toUpperCase();
    const clientQuery = clientNameSearchFilter.trim().toLowerCase();
    if (unitQuery.length > 0) {
      baseRows = baseRows.filter((row) => row.unitId.trim().toUpperCase().includes(unitQuery));
    }
    if (clientQuery.length > 0) {
      baseRows = baseRows.filter((row) => row.client && row.client.name.trim().toLowerCase().includes(clientQuery));
    }
    if (promiseDashboardFilter === "attention") {
      baseRows = baseRows.filter((row) => row.client && promiseAttentionClientIds.due.has(row.client.id));
    } else if (promiseDashboardFilter === "pending") {
      baseRows = baseRows.filter((row) => row.client && promiseAttentionClientIds.pending.has(row.client.id));
    }
    if (!activeDashboardFilter) return baseRows;
    if (activeDashboardFilter.metric === "needContact") {
      // Pendientes del bloque aplica solo al bloque AM (RUN1).
      if (activeDashboardFilter.cut !== "am") return baseRows;
      const ids = new Set(collectionDashboard.am.ids.needContact);
      return baseRows.filter((row) => ids.has(noActionEntityId(row.client, row.unitId)));
    }
    if (activeDashboardFilter.metric === "promiseAttention") {
      if (activeDashboardFilter.cut !== "pm") return baseRows;
      const ids = new Set(promiseAttentionRun2Ids);
      return baseRows.filter((row) => row.client && ids.has(row.client.id));
    }
    if (activeDashboardFilter.metric === "noAction") {
      if (activeDashboardFilter.cut !== "am") return baseRows;
      const ids = new Set(collectionDashboard.am.ids.noAction);
      return baseRows.filter((row) => ids.has(noActionEntityId(row.client, row.unitId)));
    }
    const metricKey = activeDashboardFilter.metric as Exclude<DashboardMetricKey, "promiseAttention">;
    const ids = new Set(collectionDashboard[activeDashboardFilter.cut].ids[metricKey]);
    if (activeDashboardFilter.cut === "am" && activeDashboardFilter.metric === "contacted") {
      // RUN1 puede mezclar ids de cliente y ids de unidad libre (free:UNIDAD).
      return baseRows.filter((row) => ids.has(noActionEntityId(row.client, row.unitId)));
    }
    return baseRows.filter((row) => row.client && ids.has(row.client.id));
  }, [activeDashboardFilter, collectionDashboard, generalGroupFilter, visibleRows, promiseDashboardFilter, promiseAttentionClientIds, unitSearchFilter, clientNameSearchFilter, promiseAttentionRun2Ids]);

  useEffect(() => {
    if (activeDashboardFilter?.metric === "needContact" && activeDashboardFilter.cut !== "am") {
      setActiveDashboardFilter(null);
    }
  }, [activeDashboardFilter]);

  function persist(next: Client[]): void {
    onClientsChange(next);
  }

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (topScrollInnerRef.current && tableScrollRef.current) {
      topScrollInnerRef.current.style.width = `${tableScrollRef.current.scrollWidth}px`;
    }
  }, [rows]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    let cancelled = false;

    const loadCloudDailyCollection = async () => {
      await Promise.all(
        DAILY_COLLECTION_SYNC_TABLES.map(async ({ key, table }) => {
          const { data, error } = await supabase
            .from(table)
            .select("data")
            .eq("user_id", dataOwnerUserId)
            .maybeSingle();
          if (error) {
            console.error(`No se pudo cargar ${key} desde nube.`, error);
            return;
          }
          if (cancelled) return;
          const payload = (data as { data?: unknown } | null)?.data;
          if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            applyDailyCollectionCloudValue(key, payload as Record<string, unknown>);
          }
        })
      );
    };

    void loadCloudDailyCollection();

    const channel = supabase.channel(`clients-daily-collection-live-${dataOwnerUserId}`);
    for (const { key, table } of DAILY_COLLECTION_SYNC_TABLES) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `user_id=eq.${dataOwnerUserId}`
        },
        (payload) => {
          const row = payload.new as { data?: unknown } | null;
          const data = row?.data;
          if (!data || typeof data !== "object" || Array.isArray(data)) return;
          applyDailyCollectionCloudValue(key, data as Record<string, unknown>);
        }
      );
    }
    channel.subscribe();
    const fallbackTimer = window.setInterval(() => {
      void loadCloudDailyCollection();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(fallbackTimer);
      void supabase.removeChannel(channel);
    };
  }, [dataOwnerUserId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DAILY_COLLECTION_KEY);
      const parsed = parseJsonObject<Record<string, CollectionDailyRecord>>(raw);
      if (parsed) {
        dailyCollectionSnapshotRef.current[DAILY_COLLECTION_KEY] = stableJson(parsed);
        setDailyCollectionByDate(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      persistLocalJson(DAILY_COLLECTION_KEY, dailyCollectionByDate, dailyCollectionSnapshotRef);
    } catch {
      // ignore
    }
  }, [dailyCollectionByDate]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DAILY_COLLECTION_AM_SEALS_KEY);
      const parsed = parseJsonObject<Record<string, string>>(raw);
      if (parsed) {
        dailyCollectionSnapshotRef.current[DAILY_COLLECTION_AM_SEALS_KEY] = stableJson(parsed);
        setAmSealsByDate(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      persistLocalJson(DAILY_COLLECTION_AM_SEALS_KEY, amSealsByDate, dailyCollectionSnapshotRef);
    } catch {
      // ignore
    }
  }, [amSealsByDate]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DAILY_COLLECTION_PM_SEALS_KEY);
      const parsed = parseJsonObject<Record<string, string>>(raw);
      if (parsed) {
        dailyCollectionSnapshotRef.current[DAILY_COLLECTION_PM_SEALS_KEY] = stableJson(parsed);
        setPmSealsByDate(parsed);
      }
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      persistLocalJson(DAILY_COLLECTION_PM_SEALS_KEY, pmSealsByDate, dailyCollectionSnapshotRef);
    } catch {
      // ignore
    }
  }, [pmSealsByDate]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DAILY_COLLECTION_CLOSE_SEALS_KEY);
      const parsed = parseJsonObject<Record<string, string>>(raw);
      if (parsed) {
        dailyCollectionSnapshotRef.current[DAILY_COLLECTION_CLOSE_SEALS_KEY] = stableJson(parsed);
        setCloseSealsByDate(parsed);
      }
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      persistLocalJson(DAILY_COLLECTION_CLOSE_SEALS_KEY, closeSealsByDate, dailyCollectionSnapshotRef);
    } catch {
      // ignore
    }
  }, [closeSealsByDate]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DAILY_COLLECTION_PROMISES_KEY);
      const parsed = parseJsonObject<Record<string, PaymentPromiseRecord>>(raw);
      if (parsed) {
        dailyCollectionSnapshotRef.current[DAILY_COLLECTION_PROMISES_KEY] = stableJson(parsed);
        setPromiseByClientId(parsed);
      }
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      persistLocalJson(DAILY_COLLECTION_PROMISES_KEY, promiseByClientId, dailyCollectionSnapshotRef);
    } catch {
      // ignore
    }
  }, [promiseByClientId]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DAILY_COLLECTION_STREET_ACTIONS_KEY);
      const parsed = parseJsonObject<Record<string, Record<string, StreetActionRecord>>>(raw);
      if (parsed) {
        dailyCollectionSnapshotRef.current[DAILY_COLLECTION_STREET_ACTIONS_KEY] = stableJson(parsed);
        setStreetActionsByDate(parsed);
      }
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      persistLocalJson(DAILY_COLLECTION_STREET_ACTIONS_KEY, streetActionsByDate, dailyCollectionSnapshotRef);
    } catch {
      // ignore
    }
  }, [streetActionsByDate]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY);
      const parsed = parseJsonObject<Record<string, unknown>>(raw);
      if (parsed) {
        const sanitized = sanitizeNoActionConfirms(parsed);
        dailyCollectionSnapshotRef.current[DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY] = stableJson(sanitized);
        setNoActionConfirmsByDate(sanitized);
      }
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      const serialized = stableJson(noActionConfirmsByDate);
      if (dailyCollectionSnapshotRef.current[DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY] === serialized) return;
      dailyCollectionSnapshotRef.current[DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY] = serialized;
      window.localStorage.setItem(DAILY_COLLECTION_NO_ACTION_CONFIRMS_KEY, serialized);
    } catch {
      // ignore
    }
  }, [noActionConfirmsByDate]);
  useEffect(() => {
    setPromiseByClientId((current) => {
      let changed = false;
      const next: Record<string, PaymentPromiseRecord> = { ...current };
      for (const [clientId, record] of Object.entries(current)) {
        if (record.resolution === "paid") continue;
        const client = clients.find((item) => item.id === clientId);
        if (!client) continue;
        const clientPayments = paymentsByClientId.get(clientId) ?? [];
        const createdAtMs = new Date(record.createdAt).getTime();
        const paidSince = clientPayments
          .filter((p) => new Date(String(p.createdAt ?? "")).getTime() >= createdAtMs)
          .reduce((sum, p) => sum + Number(p.amountReceived || 0), 0);
        if ((client.balance ?? 0) <= 0 && paidSince > 0) {
          next[clientId] = {
            ...record,
            resolution: "paid",
            resolvedAt: new Date().toISOString()
          };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [clients, paymentsByClientId]);

  useEffect(() => {
    if (!dataOwnerUserId) {
      setFleetUnitOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadControlUnits(dataOwnerUserId);
        if (cancelled) return;
        const units = Array.from(
          new Set(
            data
              .map((row) => String(row.unit_id ?? "").trim().toUpperCase())
              .filter((unit) => unit.length > 0)
          )
        ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        setFleetUnitOptions(units);
        const nextDetails: Record<string, {
          plate?: string | null;
          brand_model?: string | null;
          engine_serial?: string | null;
          chassis_serial?: string | null;
          cupo?: string | null;
          company?: string | null;
          observation?: string | null;
        }> = {};
        for (const row of data) {
          const key = String(row.unit_id ?? "").trim().toUpperCase();
          if (!key) continue;
          nextDetails[key] = {
            plate: row.plate ?? null,
            brand_model: row.brand_model ?? null,
            engine_serial: row.engine_serial ?? null,
            chassis_serial: row.chassis_serial ?? null,
            cupo: row.cupo ?? null,
            company: row.company ?? null,
            observation: row.observation ?? null
          };
        }
        setFleetDetailsByUnit(nextDetails);
      } catch (error) {
        console.error("No se pudo cargar nomenclatura de flota para Clientes.", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId]);

  function handleTopScroll() {
    if (tableScrollRef.current && topScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  }

  function handleTableScroll() {
    if (topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  }

  function recalculateInstallments(nextForm: ClientForm): ClientForm {
    const agreed = parseIntegerOrNull(nextForm.installmentsAgreed);
    const remaining = parseIntegerOrNull(nextForm.installmentsRemaining);
    if (agreed === null && remaining === null) return { ...nextForm, installmentsPaid: "" };
    if (agreed === null) return { ...nextForm, installmentsPaid: "" };
    if (remaining === null) return { ...nextForm, installmentsPaid: String(agreed) };
    return { ...nextForm, installmentsPaid: String(Math.max(agreed - remaining, 0)) };
  }

  const installmentLiveError = useMemo(() => {
    const agreed = parseIntegerOrNull(form.installmentsAgreed);
    const remaining = parseIntegerOrNull(form.installmentsRemaining);
    if (form.installmentsAgreed.trim() !== "" && agreed === null) return "Cuotas pactadas debe ser un numero entero mayor o igual a 0.";
    if (form.installmentsRemaining.trim() !== "" && remaining === null) return "Cuotas restantes debe ser un numero entero mayor o igual a 0.";
    if (agreed !== null && agreed < 0) return "Cuotas pactadas no puede ser negativa.";
    if (remaining !== null && remaining < 0) return "Cuotas restantes no puede ser negativa.";
    if (agreed !== null && remaining !== null && remaining > agreed) return "Error: las cuotas restantes no pueden ser mayores que las cuotas pactadas.";
    return null;
  }, [form.installmentsAgreed, form.installmentsRemaining]);

  function validate(input: ClientForm, currentEditingId: string | null): { messages: string[]; fields: Set<string> } {
    const messages: string[] = [];
    const fields = new Set<string>();

    if (!input.unitId.trim()) { messages.push("UNIDAD/ID es obligatorio."); fields.add("unitId"); }
    const normalizedUnit = input.unitId.trim().toUpperCase();
    const duplicated = clients.some(
      (client) => client.id !== currentEditingId && client.unitId.trim().toUpperCase() === normalizedUnit
    );
    if (duplicated) { messages.push("UNIDAD/ID ya existe. No se permiten duplicados."); fields.add("unitId"); }
    if (fleetUnitOptions.length > 0 && !fleetUnitOptions.includes(normalizedUnit)) {
      messages.push("UNIDAD/ID no existe en la base de flota. Usa una nomenclatura valida.");
      fields.add("unitId");
    }
    const occupiedByOther = clients.some((client) => (
      client.id !== currentEditingId &&
      client.status !== "archivado" &&
      client.unitId.trim().toUpperCase() === normalizedUnit
    ));
    if (occupiedByOther) {
      messages.push("UNIDAD/ID ya esta ocupada por otro cliente activo.");
      fields.add("unitId");
    }
    if (!input.name.trim()) { messages.push("El nombre del cliente es obligatorio."); fields.add("name"); }
    const firstChargeDate = parseDateKey(input.firstChargeDate.trim());
    if (!firstChargeDate) {
      messages.push("La fecha de primer cobro es obligatoria.");
      fields.add("firstChargeDate");
    } else {
      const today = startOfDay(new Date());
      if (startOfDay(firstChargeDate) < today) {
        messages.push("La fecha de primer cobro no puede ser menor a hoy.");
        fields.add("firstChargeDate");
      }
    }

    const rentAmount = Number(input.rentAmount);
    if (!Number.isFinite(rentAmount) || rentAmount < 0) {
      messages.push("La renta debe ser un numero mayor o igual a 0.");
      fields.add("rentAmount");
    }

    const initialBalance = Number(input.initialBalance);
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      messages.push("El MONTO A COBRAR debe ser un numero valido mayor o igual a 0.");
      fields.add("initialBalance");
    }
    const travelFundBalance = Number(input.travelFundBalance);
    if (!Number.isFinite(travelFundBalance) || travelFundBalance < 0) {
      messages.push("El FONDO DE VIAJE debe ser un numero valido mayor o igual a 0.");
      fields.add("travelFundBalance");
    }

    const agreed = Number(input.installmentsAgreed);
    const remaining = Number(input.installmentsRemaining);
    const paid = Number(input.installmentsPaid);
    if (
      !Number.isFinite(agreed) || !Number.isFinite(remaining) || !Number.isFinite(paid) ||
      !Number.isInteger(agreed) || !Number.isInteger(remaining) || !Number.isInteger(paid) ||
      agreed < 0 || remaining < 0 || paid < 0
    ) {
      messages.push("Las cuotas deben ser enteros validos mayores o iguales a 0.");
      fields.add("installmentsAgreed"); fields.add("installmentsRemaining");
    } else if (remaining > agreed) {
      messages.push("Las cuotas restantes no pueden ser mayores que las cuotas pactadas.");
      fields.add("installmentsAgreed"); fields.add("installmentsRemaining");
    } else if (paid !== agreed - remaining) {
      messages.push("Las cuotas no cuadran. Pagadas debe ser Pactadas menos Restantes.");
      fields.add("installmentsAgreed"); fields.add("installmentsRemaining");
    }

    if (input.frequency === "monthly") {
      const monthlyChargeDay = Number(input.monthlyChargeDay);
      if (!Number.isInteger(monthlyChargeDay) || monthlyChargeDay < 1 || monthlyChargeDay > 31) {
        messages.push("Para mensual, el dia de cobro debe estar entre 1 y 31.");
        fields.add("monthlyChargeDay");
      }
    }

    for (const charge of input.otherCharges) {
      const hasLabel = charge.label.trim().length > 0;
      const amount = parseNumberOrNull(charge.amount);
      if (hasLabel && amount === null) { messages.push("Cada cargo adicional debe tener un monto valido."); break; }
      if (!hasLabel && amount !== null) { messages.push("Cada cargo adicional debe tener un concepto."); break; }
    }

    return { messages, fields };
  }

  function handleInstallmentChange(field: "installmentsAgreed" | "installmentsRemaining", value: string): void {
    setForm((current) => recalculateInstallments({ ...current, [field]: value }));
  }

  function handleSubmitClient(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalizedForm = recalculateInstallments({ ...form, unitId: form.unitId.trim().toUpperCase() });
    setForm(normalizedForm);

    const { messages: nextErrors, fields: nextFields } = validate(normalizedForm, editingClientId);
    setErrors(nextErrors);
    setErrorFields(nextFields);
    if (nextErrors.length > 0) return;

    if (editingClientId !== null) {
      const existing = clients.find((client) => client.id === editingClientId);
      if (!existing) { setErrors(["No se encontro el cliente a editar."]); return; }
      persist(clients.map((client) => client.id === editingClientId ? buildClient(normalizedForm, existing) : client));
    } else {
      persist([...clients, buildClient(normalizedForm)]);
    }

    setForm(initialForm);
    setErrors([]);
    setErrorFields(new Set());
    setEditingClientId(null);
    setIsFormOpen(false);
  }

  function handleStartEditClient(client: Client): void {
    const nextForm: ClientForm = {
      unitId: client.unitId,
      cedula: client.cedula ?? "",
      name: client.name,
      firstChargeDate: client.firstChargeDate ?? toDateKey(new Date()),
      rentAmount: String(client.rentAmount),
      frequency: client.frequency,
      chargeFirstSunday: client.chargeFirstSunday ?? false,
      initialBalance: String(client.balance),
      travelFundBalance: String(client.travelFundBalance ?? 0),
      weeklyChargeDay: client.weeklyChargeDay ?? "monday",
      monthlyChargeDay: String(client.monthlyChargeDay ?? 1),
      installmentsAgreed: String(client.installmentsAgreed),
      installmentsRemaining: String(client.installmentsRemaining),
      installmentsPaid: String(client.installmentsPaid),
      otherCharges: client.otherCharges.map((c) =>
        createOtherChargeForm({ id: c.id, label: c.label, amount: String(c.amount) })
      )
    };
    setForm(recalculateInstallments(nextForm));
    setErrors([]);
    setErrorFields(new Set());
    setEditingClientId(client.id);
    setEditClientTab("identidad");
  }

  function handleCancelEdit(): void {
    setEditingClientId(null);
    setEditClientTab("identidad");
    setForm(initialForm);
    setErrors([]);
    setErrorFields(new Set());
    setIsFormOpen(false);
  }

  function isStatusAllowedForClient(client: Client, nextStatus: Client["status"]): boolean {
    if (nextStatus !== "cliente_enfermo") return true;
    return client.frequency === "daily";
  }

  function requiresComment(nextStatus: Client["status"]): boolean {
    return nextStatus === "taller" || nextStatus === "chapisteria" || nextStatus === "custodia" || nextStatus === "archivado";
  }

  function applyClientStatusChange(client: Client, nextStatus: Client["status"], comment: string): Client {
    const normalizedComment = comment.trim() || undefined;
    if (nextStatus === "activo") {
      return {
        ...client,
        status: "activo",
        statusComment: undefined,
        archivedAt: undefined,
        lastChargeDate: toDateKey(new Date())
      };
    }
    if (nextStatus === "archivado") {
      return {
        ...client,
        status: "archivado",
        statusComment: normalizedComment,
        archivedAt: new Date().toISOString()
      };
    }
    return {
      ...client,
      status: nextStatus,
      statusComment: normalizedComment
    };
  }

  function handleStatusSelection(client: Client, nextStatus: Client["status"]): void {
    if (!isStatusAllowedForClient(client, nextStatus)) {
      setErrors(["'Cliente Enfermo' solo aplica para clientes de plan diario."]);
      return;
    }
    if (nextStatus === client.status) return;

    const needsComment = requiresComment(nextStatus);
    if (!needsComment) {
      persist(clients.map((c) => (c.id === client.id ? applyClientStatusChange(c, nextStatus, "") : c)));
      return;
    }
    setStatusDialog({ clientId: client.id, nextStatus, comment: "" });
  }

  function handleConfirmStatusChange(): void {
    if (!statusDialog) return;
    const comment = statusDialog.comment.trim();
    if (requiresComment(statusDialog.nextStatus) && !comment) return;
    persist(clients.map((c) =>
      c.id === statusDialog.clientId ? applyClientStatusChange(c, statusDialog.nextStatus, comment) : c
    ));
    setStatusDialog(null);
  }

  function handleCreateClientFromUnit(unitId: string): void {
    setEditingClientId(null);
    setErrors([]);
    setErrorFields(new Set());
    setForm({ ...initialForm, unitId });
    setIsFormOpen(true);
  }

  function handleUnlinkClient(client: Client): void {
    setConfirmDialog({
      title: "Desvincular cliente",
      message: `Se desvinculara ${client.name} de la unidad ${client.unitId}. La unidad quedara libre y el cliente pasara a Clientes 2.0. ¿Deseas continuar?`,
      variant: "warning",
      onConfirm: () => {
        persist(clients.map((current) => {
          if (current.id !== client.id) return current;
          return {
            ...current,
            unitId: "",
            status: "archivado",
            statusComment: `Desvinculado de unidad ${client.unitId} el ${new Date().toLocaleDateString("es-PA")}`,
            archivedAt: new Date().toISOString()
          };
        }));
        setConfirmDialog(null);
      }
    });
  }

  function getRunEntry(clientId: string, runId: CollectionRunId): CollectionEntry | undefined {
    return todayCollection[runId][clientId];
  }

  function getDraft(clientId: string, runId: CollectionRunId): CollectionDraft {
    const key = `${clientId}:${runId}`;
    const draft = collectionDrafts[key];
    if (draft) return draft;
    const existing = getRunEntry(clientId, runId);
    return {
      status: existing?.status ?? "",
      amountPaid: existing?.amountPaid !== undefined ? String(existing.amountPaid) : "",
      followUpAt: existing?.followUpAt ?? "",
      promisedAmount: existing?.promisedAmount !== undefined ? String(existing.promisedAmount) : "",
      note: existing?.note ?? ""
    };
  }

  function updateDraft(clientId: string, runId: CollectionRunId, patch: Partial<CollectionDraft>): void {
    const key = `${clientId}:${runId}`;
    setCollectionDrafts((current) => ({ ...current, [key]: { ...getDraft(clientId, runId), ...patch } }));
  }

  function resetDraft(clientId: string, runId: CollectionRunId): void {
    const key = `${clientId}:${runId}`;
    const existing = getRunEntry(clientId, runId);
    setCollectionDrafts((current) => ({
      ...current,
      [key]: {
        status: existing?.status ?? "",
        amountPaid: existing?.amountPaid !== undefined ? String(existing.amountPaid) : "",
        followUpAt: existing?.followUpAt ?? "",
        promisedAmount: existing?.promisedAmount !== undefined ? String(existing.promisedAmount) : "",
        note: existing?.note ?? ""
      }
    }));
  }

  function saveCollectionEntry(client: Client, runId: CollectionRunId): void {
    const feedbackKey = `${client.id}:${runId}`;
    const hasOverride = Boolean(collectionOverrideByKey[feedbackKey]);
    if (isCollectionBlockedByStatus(client.status) && !hasOverride) {
      setErrors([`Unidad en estado "${STATUS_LABEL[client.status]}". Habilita cobro manual si necesitas gestionar.`]);
      setSaveFeedbackByKey((current) => ({ ...current, [feedbackKey]: { type: "error", text: "Requiere habilitar cobro manual" } }));
      return;
    }
    const draft = getDraft(client.id, runId);
    const normalizedNote = draft.note.trim() || (draft.status === "no_responde" ? "Sin respuesta" : "");
    if (!draft.status) {
      setErrors(["Debes seleccionar un estado de cobranza para guardar la gestion."]);
      setSaveFeedbackByKey((current) => ({ ...current, [feedbackKey]: { type: "error", text: "Falta estado" } }));
      return;
    }
    const promiseState = getPromiseState(client);
    if (
      promiseState &&
      (promiseState.state === "vencida" || promiseState.state === "proxima" || promiseState.state === "incumplida_parcial") &&
      draft.status !== "promesa_pago" &&
      !draft.note.trim()
    ) {
      setErrors(["Esta unidad tiene promesa activa/vencida. Debes dejar una nota para continuar."]);
      setSaveFeedbackByKey((current) => ({ ...current, [feedbackKey]: { type: "error", text: "Falta nota de seguimiento" } }));
      return;
    }
    let amountPaid = draft.amountPaid.trim() === "" ? undefined : Number(draft.amountPaid);
    if (draft.status === "pago_confirmado" || draft.status === "pago_realizado") {
      const fromPayments = paidTodayAmountByClientId.get(client.id) ?? 0;
      if (fromPayments <= 0) {
        setErrors(["No puedes marcar estado de pago si no existe pago en historial hoy."]);
        setSaveFeedbackByKey((current) => ({ ...current, [feedbackKey]: { type: "error", text: "Sin pago en historial" } }));
        return;
      }
      amountPaid = fromPayments > 0 ? fromPayments : undefined;
    }
    if (draft.status === "llamar_mas_tarde" && !draft.followUpAt.trim()) {
      setErrors(["Llamar mas tarde requiere proxima gestion."]);
      setSaveFeedbackByKey((current) => ({ ...current, [feedbackKey]: { type: "error", text: "Falta fecha/hora" } }));
      return;
    }
    if (draft.status === "promesa_pago") {
      if (!draft.followUpAt.trim()) {
        setErrors(["Promesa de pago requiere fecha y hora pactada."]);
        setSaveFeedbackByKey((current) => ({ ...current, [feedbackKey]: { type: "error", text: "Falta fecha/hora promesa" } }));
        return;
      }
      const promisedAmount = Number(draft.promisedAmount);
      if (!Number.isFinite(promisedAmount) || promisedAmount <= 0) {
        setErrors(["Promesa de pago requiere monto prometido mayor a 0."]);
        setSaveFeedbackByKey((current) => ({ ...current, [feedbackKey]: { type: "error", text: "Falta monto prometido" } }));
        return;
      }
    }

    setDailyCollectionByDate((current) => {
      const dayRecord = current[todayKey] ?? { run1: {}, run2: {}, run3: {} };
      const runRecord = dayRecord[runId];
      return {
        ...current,
        [todayKey]: {
          ...dayRecord,
          [runId]: {
            ...runRecord,
            [client.id]: {
              status: draft.status,
              amountPaid,
              followUpAt: draft.followUpAt.trim() || undefined,
              promisedAmount: draft.status === "promesa_pago" ? Number(draft.promisedAmount) : undefined,
              note: normalizedNote || undefined,
              updatedAt: new Date().toISOString()
            }
          }
        }
      };
    });
    if (draft.status === "promesa_pago") {
      const promisedAt = draft.followUpAt.trim();
      const promisedAmount = Number(draft.promisedAmount);
      setPromiseByClientId((current) => ({
        ...current,
        [client.id]: {
          promisedAt,
          promisedAmount,
          sourceRun: runId,
          createdAt: new Date().toISOString(),
          note: normalizedNote || undefined
        }
      }));
    }
    if (draft.note.trim() !== normalizedNote) {
      updateDraft(client.id, runId, { note: normalizedNote });
    }
    const timeLabel = new Date().toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
    setSaveFeedbackByKey((current) => ({ ...current, [feedbackKey]: { type: "success", text: `Guardado ${timeLabel}` } }));
  }

  function undoCollectionEntry(clientId: string, runId: CollectionRunId): void {
    const feedbackKey = `${clientId}:${runId}`;
    setDailyCollectionByDate((current) => {
      const today = current[todayKey];
      if (!today) return current;
      const nextRunMap = { ...today[runId] };
      delete nextRunMap[clientId];
      return {
        ...current,
        [todayKey]: {
          ...today,
          [runId]: nextRunMap
        }
      };
    });
    setPromiseByClientId((current) => {
      const record = current[clientId];
      if (!record || record.sourceRun !== runId || record.resolution === "paid") return current;
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    resetDraft(clientId, runId);
    setSaveFeedbackByKey((current) => ({ ...current, [feedbackKey]: { type: "success", text: "Gestión deshecha" } }));
  }

  function confirmNoAction(clientId: string, runId: CollectionRunId, reason: NoActionReason): void {
    setNoActionConfirmsByDate((current) => {
      const day = current[todayKey] ?? { run1: {}, run2: {}, run3: {} };
      const runMap = day[runId] ?? {};
      const existing = runMap[clientId];
      if (existing && existing.reason === reason) return current;
      return {
        ...current,
        [todayKey]: {
          ...day,
          [runId]: {
            ...runMap,
            [clientId]: { reason, confirmedAt: new Date().toISOString() }
          }
        }
      };
    });
  }

  function undoNoActionConfirmation(clientId: string, runId: CollectionRunId): void {
    setNoActionConfirmsByDate((current) => {
      const day = current[todayKey];
      if (!day) return current;
      const runMap = day[runId] ?? {};
      if (!runMap[clientId]) return current;
      const nextRunMap = { ...runMap };
      delete nextRunMap[clientId];
      return {
        ...current,
        [todayKey]: {
          ...day,
          [runId]: nextRunMap
        }
      };
    });
  }

  function undoPromiseForClient(client: Client): void {
    const currentPromise = promiseByClientId[client.id];
    if (!currentPromise) return;
    setConfirmDialog({
      title: "Deshacer promesa",
      message: `Se eliminará la promesa vigente de ${firstNameOf(client.name)} y se reactivará su gestión normal. ¿Deseas continuar?`,
      variant: "warning",
      onConfirm: () => {
        setPromiseByClientId((current) => {
          if (!current[client.id]) return current;
          const next = { ...current };
          delete next[client.id];
          return next;
        });
        // Limpiar cualquier promesa guardada en el día para este cliente (RUN 1/2/3).
        setDailyCollectionByDate((current) => {
          const day = current[todayKey];
          if (!day) return current;
          const nextDay: CollectionDailyRecord = {
            run1: { ...day.run1 },
            run2: { ...day.run2 },
            run3: { ...day.run3 }
          };
          let changed = false;
          for (const runId of ["run1", "run2", "run3"] as CollectionRunId[]) {
            const entry = nextDay[runId][client.id];
            if (entry?.status === "promesa_pago") {
              delete nextDay[runId][client.id];
              changed = true;
            }
          }
          if (!changed) return current;
          return {
            ...current,
            [todayKey]: nextDay
          };
        });
        // Limpiar borradores de todos los RUN para evitar estado visual "pegado".
        resetDraft(client.id, "run1");
        resetDraft(client.id, "run2");
        resetDraft(client.id, "run3");
        setSaveFeedbackByKey((current) => {
          const next = { ...current };
          delete next[`${client.id}:run1`];
          delete next[`${client.id}:run2`];
          delete next[`${client.id}:run3`];
          return next;
        });
        setConfirmDialog(null);
      }
    });
  }

  async function downloadAmClosureReport(): Promise<void> {
    try {
      const amScopeIds = new Set(amActionableRows.map((row) => row.client.id));
      const summaryNoResponde = amActionableRows.filter((row) => todayCollection.run1[row.client.id]?.status === "no_responde").length;
      const summaryRecordatorio = amActionableRows.filter((row) => todayCollection.run1[row.client.id]?.status === "recordatorio").length;
      const summaryLlamarMasTarde = amActionableRows.filter((row) => todayCollection.run1[row.client.id]?.status === "llamar_mas_tarde").length;
      let promiseActive = 0;
      let promiseDueOrNear = 0;
      let promisePartialBreach = 0;
      for (const row of amActionableRows) {
        const promise = getPromiseState(row.client);
        if (!promise || promise.state === "cumplida") continue;
        promiseActive += 1;
        if (promise.state === "proxima" || promise.state === "vencida") promiseDueOrNear += 1;
        if (promise.state === "incumplida_parcial") promisePartialBreach += 1;
      }
      const generatedAt = new Date();
      const paymentsUntilClose = payments
        .filter((payment) => payment.dateApplied === todayKey)
        .filter((payment) => new Date(payment.createdAt).getTime() <= generatedAt.getTime())
        .filter((payment) => amScopeIds.has(String(payment.clientId ?? "").trim()));
      const paymentEntriesAtClose = paymentsUntilClose.length;
      const paidClientsAtClose = new Set(
        paymentsUntilClose
          .map((payment) => String(payment.clientId ?? "").trim())
          .filter((id) => id.length > 0)
      );
      for (const row of amActionableRows) {
        const st = todayCollection.run1[row.client.id]?.status;
        if (st === "pago_confirmado" || st === "pago_realizado") {
          paidClientsAtClose.add(row.client.id);
        }
      }
      const details = amActionableRows
        .slice()
        .sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }))
        .map((row) => {
          const entry = todayCollection.run1[row.client.id];
          return {
            unitId: row.unitId,
            client: row.client.name,
            amStatus: collectionStatusLabel(entry?.status ?? ""),
            comment: entry?.note ?? "",
            promiseNote: (() => {
              const promiseRecord = promiseByClientId[row.client.id];
              const promiseState = getPromiseState(row.client);
              if (!promiseRecord || !promiseState || promiseState.state === "cumplida") return "";
              return `Prometió pagar el ${formatDateTimeForUi(promiseRecord.promisedAt)} por ${formatCurrency(promiseRecord.promisedAmount)} (${promiseState.state}).`;
            })(),
            inheritToPm: entry?.status === "no_responde" || entry?.status === "llamar_mas_tarde" ? "Si" : "No"
          };
        });
      await exportAmClosureToPdf(
        "AM",
        {
          date: toDateKey(generatedAt),
          time: generatedAt.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" }),
          totalUnits: amActionableRows.length,
          noResponse: summaryNoResponde,
          reminder: summaryRecordatorio,
          callLater: summaryLlamarMasTarde,
          paidClientsAtClose: paidClientsAtClose.size,
          paymentEntriesAtClose,
          promiseActive,
          promiseDueOrNear,
          promisePartialBreach
        },
        details
      );
    } catch (error) {
      console.error("No se pudo descargar el reporte AM.", error);
      setErrors(["No se pudo descargar el reporte AM. Intenta nuevamente."]);
    }
  }
  async function downloadPmClosureReport(): Promise<void> {
    if (!isAmSealed) {
      setErrors(["Primero debes culminar AM para descargar el reporte PM."]);
      return;
    }
    const pmScopeIds = new Set(collectionDashboard.pm.ids.needContact);
    const pmRows = visibleRows
      .filter((row): row is (typeof row & { client: Client }) => Boolean(row.client))
      .filter((row) => pmScopeIds.has(row.client.id));
    const summaryNoResponde = pmRows.filter((row) => todayCollection.run2[row.client.id]?.status === "no_responde").length;
    const summaryRecordatorio = pmRows.filter((row) => todayCollection.run2[row.client.id]?.status === "recordatorio").length;
    const summaryLlamarMasTarde = pmRows.filter((row) => todayCollection.run2[row.client.id]?.status === "llamar_mas_tarde").length;
    let promiseActive = 0;
    let promiseDueOrNear = 0;
    let promisePartialBreach = 0;
    for (const row of pmRows) {
      const promise = getPromiseState(row.client);
      if (!promise || promise.state === "cumplida") continue;
      promiseActive += 1;
      if (promise.state === "proxima" || promise.state === "vencida") promiseDueOrNear += 1;
      if (promise.state === "incumplida_parcial") promisePartialBreach += 1;
    }
    const generatedAt = new Date();
    const paymentsUntilClose = payments
      .filter((payment) => payment.dateApplied === todayKey)
      .filter((payment) => new Date(payment.createdAt).getTime() <= generatedAt.getTime())
      .filter((payment) => pmScopeIds.has(String(payment.clientId ?? "").trim()));
    const paymentEntriesAtClose = paymentsUntilClose.length;
    const paidClientsAtClose = new Set(
      paymentsUntilClose.map((payment) => String(payment.clientId ?? "").trim()).filter((id) => id.length > 0)
    );
    for (const row of pmRows) {
      const st = todayCollection.run2[row.client.id]?.status;
      if (st === "pago_confirmado" || st === "pago_realizado") {
        paidClientsAtClose.add(row.client.id);
      }
    }
    const details = pmRows
      .slice()
      .sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }))
      .map((row) => {
        const entry = todayCollection.run2[row.client.id];
        return {
          unitId: row.unitId,
          client: row.client.name,
          amStatus: collectionStatusLabel(entry?.status ?? ""),
          comment: entry?.note ?? "",
          promiseNote: (() => {
            const promiseRecord = promiseByClientId[row.client.id];
            const promiseState = getPromiseState(row.client);
            if (!promiseRecord || !promiseState || promiseState.state === "cumplida") return "";
            return `Prometió pagar el ${formatDateTimeForUi(promiseRecord.promisedAt)} por ${formatCurrency(promiseRecord.promisedAmount)} (${promiseState.state}).`;
          })(),
          inheritToPm: entry?.status === "no_responde" || entry?.status === "llamar_mas_tarde" ? "Si" : "No"
        };
      });
    await exportAmClosureToPdf(
      "PM",
      {
        date: toDateKey(generatedAt),
        time: generatedAt.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" }),
        totalUnits: pmRows.length,
        noResponse: summaryNoResponde,
        reminder: summaryRecordatorio,
        callLater: summaryLlamarMasTarde,
        paidClientsAtClose: paidClientsAtClose.size,
        paymentEntriesAtClose,
        promiseActive,
        promiseDueOrNear,
        promisePartialBreach
      },
      details
    );
  }
  async function downloadCloseClosureReport(): Promise<void> {
    if (!isAmSealed) {
      setErrors(["Primero debes culminar AM para descargar el reporte de Cierre."]);
      return;
    }
    const closeScopeIds = new Set(collectionDashboard.close.ids.needContact);
    const closeRows = visibleRows
      .filter((row): row is (typeof row & { client: Client }) => Boolean(row.client))
      .filter((row) => closeScopeIds.has(row.client.id));
    const summaryNoResponde = closeRows.filter((row) => todayCollection.run3[row.client.id]?.status === "no_responde").length;
    const summaryRecordatorio = closeRows.filter((row) => todayCollection.run3[row.client.id]?.status === "recordatorio").length;
    const summaryLlamarMasTarde = closeRows.filter((row) => todayCollection.run3[row.client.id]?.status === "llamar_mas_tarde").length;
    let promiseActive = 0;
    let promiseDueOrNear = 0;
    let promisePartialBreach = 0;
    for (const row of closeRows) {
      const promise = getPromiseState(row.client);
      if (!promise || promise.state === "cumplida") continue;
      promiseActive += 1;
      if (promise.state === "proxima" || promise.state === "vencida") promiseDueOrNear += 1;
      if (promise.state === "incumplida_parcial") promisePartialBreach += 1;
    }
    const generatedAt = new Date();
    const paymentsUntilClose = payments
      .filter((payment) => payment.dateApplied === todayKey)
      .filter((payment) => new Date(payment.createdAt).getTime() <= generatedAt.getTime())
      .filter((payment) => closeScopeIds.has(String(payment.clientId ?? "").trim()));
    const paymentEntriesAtClose = paymentsUntilClose.length;
    const paidClientsAtClose = new Set(
      paymentsUntilClose.map((payment) => String(payment.clientId ?? "").trim()).filter((id) => id.length > 0)
    );
    for (const row of closeRows) {
      const st = todayCollection.run3[row.client.id]?.status;
      if (st === "pago_confirmado" || st === "pago_realizado") {
        paidClientsAtClose.add(row.client.id);
      }
    }
    const details = closeRows
      .slice()
      .sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }))
      .map((row) => {
        const entry = todayCollection.run3[row.client.id];
        const streetAction = todayStreetActions[row.client.id];
        const streetLabel = streetAction
          ? `${streetAction.type === "solo_cobrar" ? "SOLO COBRAR" : "COBRAR / QUITAR"} · Min ${formatCurrency(streetAction.minAmount)}`
          : "No";
        return {
          unitId: row.unitId,
          client: row.client.name,
          amStatus: collectionStatusLabel(entry?.status ?? ""),
          comment: entry?.note ?? "",
          promiseNote: (() => {
            const promiseRecord = promiseByClientId[row.client.id];
            const promiseState = getPromiseState(row.client);
            if (!promiseRecord || !promiseState || promiseState.state === "cumplida") return "";
            return `Prometió pagar el ${formatDateTimeForUi(promiseRecord.promisedAt)} por ${formatCurrency(promiseRecord.promisedAmount)} (${promiseState.state}).`;
          })(),
          inheritToPm: streetLabel
        };
      });
    await exportAmClosureToPdf(
      "CIERRE",
      {
        date: toDateKey(generatedAt),
        time: generatedAt.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" }),
        totalUnits: closeRows.length,
        noResponse: summaryNoResponde,
        reminder: summaryRecordatorio,
        callLater: summaryLlamarMasTarde,
        paidClientsAtClose: paidClientsAtClose.size,
        paymentEntriesAtClose,
        promiseActive,
        promiseDueOrNear,
        promisePartialBreach
      },
      details
    );
  }

  function closeAmRun(): void {
    if (!amCompletion.isComplete) {
      const preview = amCompletion.missingUnits.slice(0, 8).join(", ");
      const suffix = amCompletion.missingUnits.length > 8 ? "..." : "";
      setErrors([`No puedes culminar AM. Faltan unidades sin estado en AM: ${preview}${suffix}`]);
      return;
    }
    if (missingNoActionConfirmationByRun.run1.length > 0) {
      const preview = missingNoActionConfirmationByRun.run1.slice(0, 8).join(", ");
      const suffix = missingNoActionConfirmationByRun.run1.length > 8 ? "..." : "";
      setErrors([`No puedes culminar RUN 1. Faltan confirmaciones "sin acción": ${preview}${suffix}`]);
      return;
    }
    setAmSealsByDate((current) => ({ ...current, [todayKey]: new Date().toISOString() }));
    window.setTimeout(() => flushDailyCollectionCloudSync(), 0);
  }
  function closePmRun(): void {
    if (!isAmSealed) {
      setErrors(["Debes culminar AM primero para cerrar PM."]);
      return;
    }
    if (!pmCompletion.isComplete) {
      const preview = pmCompletion.missingUnits.slice(0, 8).join(", ");
      const suffix = pmCompletion.missingUnits.length > 8 ? "..." : "";
      setErrors([`No puedes culminar PM. Faltan unidades sin estado en PM: ${preview}${suffix}`]);
      return;
    }
    setPmSealsByDate((current) => ({ ...current, [todayKey]: new Date().toISOString() }));
    window.setTimeout(() => flushDailyCollectionCloudSync(), 0);
  }
  function closeCloseRun(): void {
    if (!isPmSealed) {
      setErrors(["Debes culminar PM primero para cerrar Cierre."]);
      return;
    }
    if (!closeCompletion.isComplete) {
      const preview = closeCompletion.missingUnits.slice(0, 8).join(", ");
      const suffix = closeCompletion.missingUnits.length > 8 ? "..." : "";
      setErrors([`No puedes culminar Cierre. Faltan unidades sin estado en Cierre: ${preview}${suffix}`]);
      return;
    }
    if (!closeCompletion.streetReady) {
      const preview = closeCompletion.missingStreetUnits.slice(0, 8).join(", ");
      const suffix = closeCompletion.missingStreetUnits.length > 8 ? "..." : "";
      setErrors([`No puedes culminar Cierre. Falta "Enviar a calle" en unidades elegibles: ${preview}${suffix}`]);
      return;
    }
    setCloseSealsByDate((current) => ({ ...current, [todayKey]: new Date().toISOString() }));
    window.setTimeout(() => flushDailyCollectionCloudSync(), 0);
  }

  function openStreetActionDialog(client: Client, unitId: string): void {
    const existing = todayStreetActions[client.id];
    setStreetActionDialog({
      clientId: client.id,
      clientName: client.name,
      unitId,
      type: existing?.type ?? "cobrar_quitar",
      minAmount: existing?.minAmount ? String(existing.minAmount) : "",
      note: existing?.note ?? ""
    });
  }

  function saveStreetAction(): void {
    if (!streetActionDialog) return;
    const minAmount = Number(streetActionDialog.minAmount);
    if (!Number.isFinite(minAmount) || minAmount <= 0) {
      setErrors(["En 'Enviar a calle' debes indicar un monto mínimo válido (> 0)."]);
      return;
    }
    setStreetActionsByDate((current) => {
      const today = current[todayKey] ?? {};
      return {
        ...current,
        [todayKey]: {
          ...today,
          [streetActionDialog.clientId]: {
            type: streetActionDialog.type,
            minAmount,
            note: streetActionDialog.note.trim() || undefined,
            createdAt: today[streetActionDialog.clientId]?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      };
    });
    setStreetActionDialog(null);
  }

  function undoRunBlock(runId: CollectionRunId): void {
    const runLabelText = runId === "run1" ? "RUN 1" : runId === "run2" ? "RUN 2" : "RUN 3";
    setConfirmDialog({
      title: `Deshacer ${runLabelText}`,
      message: `Se borrará toda la gestión del ${runLabelText} de hoy.${runId === "run1" ? " También se limpiarán RUN 2 y RUN 3 para mantener consistencia." : runId === "run2" ? " También se limpiará RUN 3 para mantener consistencia." : ""} ¿Deseas continuar?`,
      variant: "warning",
      onConfirm: () => {
        setDailyCollectionByDate((current) => {
          const today = current[todayKey];
          if (!today) return current;
          const nextDay: CollectionDailyRecord = {
            run1: { ...today.run1 },
            run2: { ...today.run2 },
            run3: { ...today.run3 }
          };
          if (runId === "run1") {
            nextDay.run1 = {};
            nextDay.run2 = {};
            nextDay.run3 = {};
          } else if (runId === "run2") {
            nextDay.run2 = {};
            nextDay.run3 = {};
          } else {
            nextDay.run3 = {};
          }
          return { ...current, [todayKey]: nextDay };
        });
        setStreetActionsByDate((current) => {
          if (runId !== "run1" && runId !== "run2" && runId !== "run3") return current;
          if (runId === "run3" || runId === "run2" || runId === "run1") {
            const next = { ...current };
            next[todayKey] = {};
            return next;
          }
          return current;
        });
        setPromiseByClientId((current) => {
          const next: Record<string, PaymentPromiseRecord> = {};
          for (const [clientId, record] of Object.entries(current)) {
            if (record.resolution === "paid") {
              next[clientId] = record;
              continue;
            }
            const remove =
              runId === "run1"
                ? record.sourceRun === "run1" || record.sourceRun === "run2" || record.sourceRun === "run3"
                : runId === "run2"
                ? record.sourceRun === "run2" || record.sourceRun === "run3"
                : record.sourceRun === "run3";
            if (!remove) next[clientId] = record;
          }
          return next;
        });
        setAmSealsByDate((current) => {
          if (runId !== "run1") return current;
          const next = { ...current };
          delete next[todayKey];
          return next;
        });
        setPmSealsByDate((current) => {
          if (runId === "run3") return current;
          const next = { ...current };
          delete next[todayKey];
          return next;
        });
        setCloseSealsByDate((current) => {
          const next = { ...current };
          delete next[todayKey];
          return next;
        });
        setNoActionConfirmsByDate((current) => {
          const day = current[todayKey];
          if (!day) return current;
          const nextDay = {
            run1: { ...day.run1 },
            run2: { ...day.run2 },
            run3: { ...day.run3 }
          };
          if (runId === "run1") {
            nextDay.run1 = {};
            nextDay.run2 = {};
            nextDay.run3 = {};
          } else if (runId === "run2") {
            nextDay.run2 = {};
            nextDay.run3 = {};
          } else {
            nextDay.run3 = {};
          }
          return { ...current, [todayKey]: nextDay };
        });
        setSaveFeedbackByKey({});
      }
    });
  }

  function reopenRunSeal(runId: CollectionRunId): void {
    const runLabelText = runId === "run1" ? "RUN 1" : runId === "run2" ? "RUN 2" : "RUN 3";
    setConfirmDialog({
      title: `Reabrir ${runLabelText}`,
      message: `Se quitará el cierre de ${runLabelText} para hoy sin borrar gestiones guardadas. ¿Deseas continuar?`,
      variant: "warning",
      onConfirm: () => {
        if (runId === "run1") {
          setAmSealsByDate((current) => {
            const next = { ...current };
            delete next[todayKey];
            return next;
          });
          return;
        }
        if (runId === "run2") {
          setPmSealsByDate((current) => {
            const next = { ...current };
            delete next[todayKey];
            return next;
          });
          return;
        }
        setCloseSealsByDate((current) => {
          const next = { ...current };
          delete next[todayKey];
          return next;
        });
      }
    });
  }


  type RowData = typeof rows[number];

  function getExportCell(key: ExportFieldKey, row: RowData): string | number {
    const { client, debtStartDate, nextChargeDate } = row;
    switch (key) {
      case "unitId":                return client.unitId;
      case "cedula":                return client.cedula ?? "-";
      case "name":                  return client.name;
      case "rentAmount":            return client.rentAmount;
      case "frequency":             return FREQUENCY_LABEL[client.frequency];
      case "installmentsAgreed":    return client.installmentsAgreed;
      case "installmentsRemaining": return client.installmentsRemaining;
      case "installmentsPaid":      return client.installmentsPaid;
      case "otherCharges":
        return client.otherCharges.length > 0
          ? client.otherCharges.map((c) => `${c.label}: ${formatCurrency(c.amount)}`).join(" | ")
          : "-";
      case "balance":               return client.balance;
      case "siniestrosSavings":     return client.savings;
      case "debtSince":
        if (debtStartDate) return formatDate(debtStartDate);
        if (nextChargeDate) return `Al día hasta ${formatDate(nextChargeDate)}`;
        return "Al dia";
    }
  }

  function buildExportData(): { headers: string[]; body: (string | number)[][] } {
    const active = exportFields.filter((f) => f.enabled);
    const headers = active.map((f) => f.label);
    const body = visibleRows.filter((row) => row.client !== null).map((row) => active.map((f) => getExportCell(f.key, row)));
    return { headers, body };
  }

  async function handleExportExcel(): Promise<void> {
    const { headers, body } = buildExportData();
    setIsExporting(true);
    setExportError(null);
    try {
      await exportClientsToExcel(headers, body, new Date());
    } catch {
      setExportError("No fue posible generar el archivo Excel.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportPDF(): Promise<void> {
    const { headers, body } = buildExportData();
    setIsExporting(true);
    setExportError(null);
    try {
      await exportClientsToPdf(headers, body, new Date());
    } catch {
      setExportError("No fue posible generar el archivo PDF.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="clients-luxury-page">
      {editingClientId !== null && (
        <div className="modal-overlay" onClick={handleCancelEdit}>
          <div className="modal edit-client-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Editar cliente</h2>
              <button type="button" className="modal-close" onClick={handleCancelEdit}>X</button>
            </div>
            <div className="modal-body edit-client-modal-body">
              <div className="edit-client-summary">
                <div><span className="hint">Unidad</span><p>{form.unitId || "-"}</p></div>
                <div><span className="hint">Cliente</span><p>{form.name || "-"}</p></div>
                <div><span className="hint">Frecuencia</span><p>{FREQUENCY_LABEL[form.frequency]}</p></div>
                <div><span className="hint">Saldo</span><p>{form.initialBalance || "0.00"}</p></div>
              </div>
              <div className="cash-view-tabs" style={{ marginBottom: 12 }}>
                <button type="button" className={`button ghost small ${editClientTab === "identidad" ? "cash-tab-active" : ""}`} onClick={() => setEditClientTab("identidad")}>Identidad</button>
                <button type="button" className={`button ghost small ${editClientTab === "plan" ? "cash-tab-active" : ""}`} onClick={() => setEditClientTab("plan")}>Plan y Cobranza</button>
                <button type="button" className={`button ghost small ${editClientTab === "cargos" ? "cash-tab-active" : ""}`} onClick={() => setEditClientTab("cargos")}>Otros cargos</button>
                <button type="button" className={`button ghost small ${editClientTab === "estado" ? "cash-tab-active" : ""}`} onClick={() => setEditClientTab("estado")}>Estado</button>
              </div>
              <form className="form-grid edit-client-form-grid" onSubmit={handleSubmitClient}>
                {editClientTab === "identidad" && (
                  <>
                    <label>UNIDAD
                      <select value={form.unitId} onChange={(e) => setForm((c) => ({ ...c, unitId: e.target.value.toUpperCase() }))} className={errorFields.has("unitId") ? "input-error" : undefined} required>
                        <option value="">Selecciona unidad...</option>
                        {availableUnitOptions.map((unit) => (
                          <option key={unit} value={unit}>{unit}</option>
                        ))}
                      </select>
                    </label>
                    <label>Cedula
                      <input type="text" value={form.cedula} onChange={(e) => setForm((c) => ({ ...c, cedula: e.target.value }))} placeholder="Ej. 8-123-456" />
                    </label>
                    <label>Nombre
                      <input type="text" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Ej. Richard Alexander" className={errorFields.has("name") ? "input-error" : undefined} required />
                    </label>
                    <label>Fecha primer cobro
                      <input type="date" value={form.firstChargeDate} onChange={(e) => setForm((c) => ({ ...c, firstChargeDate: e.target.value }))} className={errorFields.has("firstChargeDate") ? "input-error" : undefined} required />
                    </label>
                  </>
                )}
                {editClientTab === "plan" && (
                  <>
                    <label>Renta (USD)
                      <input type="number" step="0.01" min="0" value={form.rentAmount} onChange={(e) => setForm((c) => ({ ...c, rentAmount: e.target.value }))} placeholder="0.00" className={errorFields.has("rentAmount") ? "input-error" : undefined} required />
                    </label>
                    <label>Frecuencia
                      <select value={form.frequency} onChange={(e) => setForm((c) => ({ ...c, frequency: e.target.value as BillingFrequency }))}>
                        <option value="daily">Diario</option>
                        <option value="weekly">Semanal</option>
                        <option value="biweekly">Quincenal</option>
                        <option value="monthly">Mensual</option>
                      </select>
                    </label>
                    {form.frequency === "daily" && (
                      <label>
                        <span style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600 }}>Cobrar primer domingo</span>
                        <select value={form.chargeFirstSunday ? "yes" : "no"} onChange={(e) => setForm((c) => ({ ...c, chargeFirstSunday: e.target.value === "yes" }))}>
                          <option value="no">No</option>
                          <option value="yes">Si</option>
                        </select>
                      </label>
                    )}
                    {form.frequency === "weekly" && (
                      <label>Dia de cobro semanal
                        <select value={form.weeklyChargeDay} onChange={(e) => setForm((c) => ({ ...c, weeklyChargeDay: e.target.value as WeeklyChargeDay }))}>
                          <option value="monday">Lunes</option>
                          <option value="tuesday">Martes</option>
                          <option value="wednesday">Miercoles</option>
                          <option value="thursday">Jueves</option>
                          <option value="friday">Viernes</option>
                          <option value="saturday">Sabado</option>
                        </select>
                      </label>
                    )}
                    {form.frequency === "monthly" && (
                      <label>Dia del mes para cobrar
                        <input type="number" min="1" max="31" step="1" value={form.monthlyChargeDay} onChange={(e) => setForm((c) => ({ ...c, monthlyChargeDay: e.target.value }))} className={errorFields.has("monthlyChargeDay") ? "input-error" : undefined} required />
                      </label>
                    )}
                    <label>Cuotas pactadas
                      <input type="number" step="1" min="0" value={form.installmentsAgreed} onChange={(e) => handleInstallmentChange("installmentsAgreed", e.target.value)} className={errorFields.has("installmentsAgreed") ? "input-error" : undefined} required />
                    </label>
                    <label>Cuotas restantes
                      <input type="number" step="1" min="0" value={form.installmentsRemaining} onChange={(e) => handleInstallmentChange("installmentsRemaining", e.target.value)} className={errorFields.has("installmentsRemaining") ? "input-error" : undefined} required />
                    </label>
                    <label>Cuotas pagadas
                      <input type="number" step="1" min="0" value={form.installmentsPaid} readOnly />
                    </label>
                    <label>MONTO A COBRAR (USD)
                      <input type="number" step="0.01" min="0" value={form.initialBalance} onChange={(e) => setForm((c) => ({ ...c, initialBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("initialBalance") ? "input-error" : undefined} required />
                    </label>
                    <label>FONDO DE VIAJE (USD)
                      <input type="number" step="0.01" min="0" value={form.travelFundBalance} onChange={(e) => setForm((c) => ({ ...c, travelFundBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("travelFundBalance") ? "input-error" : undefined} required />
                    </label>
                  </>
                )}
                {editClientTab === "cargos" && (
                  <div className="other-charges-section" style={{ gridColumn: "1 / -1" }}>
                    <div className="other-charges-header">
                      <span>Otros cargos</span>
                      <button type="button" className="button ghost small" onClick={() =>
                        setForm((c) => ({ ...c, otherCharges: [...c.otherCharges, createOtherChargeForm()] }))
                      }>+ Agregar</button>
                    </div>
                    {form.otherCharges.map((charge, i) => (
                      <div key={i} className="other-charge-row">
                        <input type="text" placeholder="Concepto" value={charge.label}
                          onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, label: e.target.value } : ch) }))} />
                        <input type="number" step="0.01" min="0" placeholder="0.00" value={charge.amount}
                          onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, amount: e.target.value } : ch) }))} />
                        <button type="button" className="other-charge-remove" onClick={() =>
                          setForm((c) => ({ ...c, otherCharges: c.otherCharges.filter((_, idx) => idx !== i) }))
                        }>X</button>
                      </div>
                    ))}
                  </div>
                )}
                {editClientTab === "estado" && (
                  <div className="cash-subpanel" style={{ gridColumn: "1 / -1" }}>
                    <h3>Estado operativo</h3>
                    <p className="hint">El estado se edita desde la tabla principal en la columna Cobranza.</p>
                  </div>
                )}
                <div className="modal-actions edit-client-footer">
                  <button type="submit" className={`button primary ${installmentLiveError ? "button-disabled" : ""}`} disabled={installmentLiveError !== null}>
                    Guardar cambios
                  </button>
                  <button type="button" className="button ghost" onClick={handleCancelEdit}>Cancelar</button>
                </div>
              </form>
              {form.frequency === "daily" && <p className="hint">Regla diaria: cobro automatico de lunes a sabado.</p>}
              {form.frequency === "daily" && form.chargeFirstSunday && <p className="hint">Incluye el primer domingo automaticamente una sola vez.</p>}
              {form.frequency === "biweekly" && <p className="hint">Regla quincenal: cobros fijos dia 15 y fin de mes.</p>}
              {form.frequency === "monthly" && <p className="hint">Regla mensual: si el dia configurado cae domingo, el cobro se mueve al lunes siguiente.</p>}
              {errors.length > 0 && <ul className="error-list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              {installmentLiveError !== null && <ul className="error-list"><li>{installmentLiveError}</li></ul>}
            </div>
          </div>
        </div>
      )}

      {confirmDialog !== null && (
        <div className="modal-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{confirmDialog.title}</h2>
              <button type="button" className="modal-close" onClick={() => setConfirmDialog(null)}>X</button>
            </div>
            <div className="confirm-modal-body">
              <p>{confirmDialog.message}</p>
              <div className="confirm-modal-actions">
                <button type="button" className={`button ${confirmDialog.variant === "danger" ? "danger" : "primary"}`} onClick={confirmDialog.onConfirm}>Confirmar</button>
                <button type="button" className="button ghost" onClick={() => setConfirmDialog(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {statusDialog !== null && (
        <div className="modal-overlay" onClick={() => setStatusDialog(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Cambiar estado</h2>
              <button type="button" className="modal-close" onClick={() => setStatusDialog(null)}>X</button>
            </div>
            <div className="confirm-modal-body">
              <p>
                Confirma el cambio a <strong>{STATUS_LABEL[statusDialog.nextStatus]}</strong> e indica el motivo:
              </p>
              <textarea
                className="pause-comment-input"
                placeholder="Ej. Acuerdo de pago, reparacion en unidad, negociacion..."
                value={statusDialog.comment}
                onChange={(e) => setStatusDialog((d) => d ? { ...d, comment: e.target.value } : d)}
                rows={3}
                autoFocus
              />
              <div className="confirm-modal-actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="button primary"
                  onClick={handleConfirmStatusChange}
                  disabled={statusDialog.comment.trim().length === 0}
                >
                  Confirmar
                </button>
                <button type="button" className="button ghost" onClick={() => setStatusDialog(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {streetActionDialog !== null && (
        <div className="modal-overlay" onClick={() => setStreetActionDialog(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Enviar a calle · {streetActionDialog.unitId}</h2>
              <button type="button" className="modal-close" onClick={() => setStreetActionDialog(null)}>X</button>
            </div>
            <div className="confirm-modal-body">
              <p><strong>{streetActionDialog.clientName}</strong></p>
              <label className="field-label">Tipo de gestión</label>
              <select
                value={streetActionDialog.type}
                onChange={(e) => setStreetActionDialog((current) => current ? { ...current, type: e.target.value as StreetActionType } : current)}
              >
                <option value="cobrar_quitar">COBRAR / QUITAR</option>
                <option value="solo_cobrar">SOLO COBRAR</option>
              </select>
              <label className="field-label">Monto mínimo a pagar</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={streetActionDialog.minAmount}
                onChange={(e) => setStreetActionDialog((current) => current ? { ...current, minAmount: e.target.value } : current)}
              />
              <label className="field-label">Nota (opcional)</label>
              <input
                type="text"
                placeholder="Detalle para cobradora"
                value={streetActionDialog.note}
                onChange={(e) => setStreetActionDialog((current) => current ? { ...current, note: e.target.value } : current)}
              />
              <div className="confirm-modal-actions" style={{ marginTop: 16 }}>
                <button type="button" className="button primary" onClick={saveStreetAction}>Guardar</button>
                <button type="button" className="button ghost" onClick={() => setStreetActionDialog(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {vehicleInfoUnit !== null && (
        <div className="modal-overlay" onClick={() => setVehicleInfoUnit(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Info de unidad {vehicleInfoUnit}</h2>
              <button type="button" className="modal-close" onClick={() => setVehicleInfoUnit(null)}>X</button>
            </div>
            <div className="confirm-modal-body" style={{ maxHeight: "70vh", overflowY: "auto", paddingRight: 6 }}>
              <div className="control-unit-info-grid">
                <div><span className="hint">Placa</span><p>{fleetDetailsByUnit[vehicleInfoUnit]?.plate ?? "-"}</p></div>
                <div><span className="hint">Marca/Modelo</span><p>{fleetDetailsByUnit[vehicleInfoUnit]?.brand_model ?? "-"}</p></div>
                <div><span className="hint">Empresa</span><p>{fleetDetailsByUnit[vehicleInfoUnit]?.company ?? "-"}</p></div>
                <div><span className="hint">Serial Motor</span><p>{fleetDetailsByUnit[vehicleInfoUnit]?.engine_serial ?? "-"}</p></div>
                <div><span className="hint">Serial Chasis</span><p>{fleetDetailsByUnit[vehicleInfoUnit]?.chassis_serial ?? "-"}</p></div>
                <div><span className="hint">Cupo</span><p>{fleetDetailsByUnit[vehicleInfoUnit]?.cupo ?? "-"}</p></div>
                <div style={{ gridColumn: "1 / -1" }}><span className="hint">Observacion</span><p>{fleetDetailsByUnit[vehicleInfoUnit]?.observation ?? "-"}</p></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {clientInfoId !== null && (
        <div className="modal-overlay" onClick={() => setClientInfoId(null)}>
          <div className="modal confirm-modal client-data-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Datos del cliente</h2>
              <button type="button" className="modal-close" onClick={() => setClientInfoId(null)}>X</button>
            </div>
            <div className="confirm-modal-body client-data-modal-body">
              {(() => {
                const selected = clients.find((c) => c.id === clientInfoId);
                if (!selected) return <p className="hint">No se encontro cliente.</p>;
                return (
                  <div className="control-unit-info-grid">
                    <div><span className="hint">Unidad</span><p>{selected.unitId}</p></div>
                    <div><span className="hint">Nombre completo</span><p>{selected.name}</p></div>
                    <div><span className="hint">Cedula</span><p>{selected.cedula ?? "-"}</p></div>
                    <div><span className="hint">Estado</span><p>{STATUS_LABEL[selected.status]}</p></div>
                    <div><span className="hint">Renta</span><p>{formatCurrency(selected.rentAmount)}</p></div>
                    <div><span className="hint">Frecuencia</span><p>{FREQUENCY_LABEL[selected.frequency]}</p></div>
                    <div><span className="hint">Fecha primer cobro</span><p>{selected.firstChargeDate ?? "-"}</p></div>
                    <div><span className="hint">Ultimo cobro</span><p>{selected.lastChargeDate ?? "-"}</p></div>
                    <div><span className="hint">Cuotas pactadas</span><p>{selected.installmentsAgreed}</p></div>
                    <div><span className="hint">Cuotas restantes</span><p>{selected.installmentsRemaining}</p></div>
                    <div><span className="hint">Cuotas pagadas</span><p>{selected.installmentsPaid}</p></div>
                    <div><span className="hint">Monto a cobrar</span><p>{formatCurrency(selected.balance)}</p></div>
                    <div><span className="hint">Fondo de viaje</span><p>{formatCurrency(selected.travelFundBalance ?? 0)}</p></div>
                    <div><span className="hint">Ahorro de siniestros</span><p>{formatCurrency(selected.savings)}</p></div>
                    <div><span className="hint">Saldo a favor</span><p>{formatCurrency(selected.advanceBalance)}</p></div>
                    <div><span className="hint">Creado</span><p>{selected.createdAt}</p></div>
                    <div><span className="hint">Archivado en</span><p>{selected.archivedAt ?? "-"}</p></div>
                    <div style={{ gridColumn: "1 / -1" }}><span className="hint">Comentario de estado</span><p>{selected.statusComment ?? "-"}</p></div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <span className="hint">Otros cargos</span>
                      <p>{selected.otherCharges.length > 0 ? selected.otherCharges.map((c) => `${c.label}: ${formatCurrency(c.amount)}`).join(" | ") : "-"}</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {isFormOpen && (
        <div className="modal-overlay" onClick={() => setIsFormOpen(false)}>
          <div className="modal edit-client-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Agregar cliente</h2>
              <button type="button" className="modal-close" onClick={() => setIsFormOpen(false)}>X</button>
            </div>
            <div className="modal-body edit-client-modal-body">
              <form className="form-grid" onSubmit={handleSubmitClient}>
            <label>
              UNIDAD
              <select value={form.unitId} onChange={(e) => setForm((c) => ({ ...c, unitId: e.target.value.toUpperCase() }))} className={errorFields.has("unitId") ? "input-error" : undefined} required>
                <option value="">Selecciona unidad...</option>
                {availableUnitOptions.map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </label>
            <label>
              Cedula
              <input type="text" value={form.cedula} onChange={(e) => setForm((c) => ({ ...c, cedula: e.target.value }))} placeholder="Ej. 8-123-456" />
            </label>
            <label>
              Nombre
              <input type="text" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Ej. Richard Alexander" className={errorFields.has("name") ? "input-error" : undefined} required />
            </label>
            <label>
              Fecha primer cobro
              <input type="date" value={form.firstChargeDate} onChange={(e) => setForm((c) => ({ ...c, firstChargeDate: e.target.value }))} className={errorFields.has("firstChargeDate") ? "input-error" : undefined} required />
            </label>
            <label>
              Renta (USD)
              <input type="number" step="0.01" min="0" value={form.rentAmount} onChange={(e) => setForm((c) => ({ ...c, rentAmount: e.target.value }))} placeholder="0.00" className={errorFields.has("rentAmount") ? "input-error" : undefined} required />
            </label>
            <label>
              Frecuencia
              <select value={form.frequency} onChange={(e) => setForm((c) => ({ ...c, frequency: e.target.value as BillingFrequency }))}>
                <option value="daily">Diario</option>
                <option value="weekly">Semanal</option>
                <option value="biweekly">Quincenal</option>
                <option value="monthly">Mensual</option>
              </select>
            </label>
            {form.frequency === "daily" && (
              <label>
                <span style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 600 }}>Cobrar primer domingo</span>
                <select value={form.chargeFirstSunday ? "yes" : "no"} onChange={(e) => setForm((c) => ({ ...c, chargeFirstSunday: e.target.value === "yes" }))}>
                  <option value="no">No</option>
                  <option value="yes">Si</option>
                </select>
              </label>
            )}
            {form.frequency === "weekly" && (
              <label>
                Dia de cobro semanal
                <select value={form.weeklyChargeDay} onChange={(e) => setForm((c) => ({ ...c, weeklyChargeDay: e.target.value as WeeklyChargeDay }))}>
                  <option value="monday">Lunes</option>
                  <option value="tuesday">Martes</option>
                  <option value="wednesday">Miercoles</option>
                  <option value="thursday">Jueves</option>
                  <option value="friday">Viernes</option>
                  <option value="saturday">Sabado</option>
                </select>
              </label>
            )}
            {form.frequency === "monthly" && (
              <label>
                Dia del mes para cobrar
                <input type="number" min="1" max="31" step="1" value={form.monthlyChargeDay} onChange={(e) => setForm((c) => ({ ...c, monthlyChargeDay: e.target.value }))} required />
              </label>
            )}
            <label>
              Cuotas pactadas
              <input type="number" step="1" min="0" value={form.installmentsAgreed} onChange={(e) => handleInstallmentChange("installmentsAgreed", e.target.value)} className={errorFields.has("installmentsAgreed") ? "input-error" : undefined} required />
            </label>
            <label>
              Cuotas restantes
              <input type="number" step="1" min="0" value={form.installmentsRemaining} onChange={(e) => handleInstallmentChange("installmentsRemaining", e.target.value)} className={errorFields.has("installmentsRemaining") ? "input-error" : undefined} required />
            </label>
            <label>
              Cuotas pagadas
              <input type="number" step="1" min="0" value={form.installmentsPaid} readOnly />
            </label>
            <label>
              MONTO A COBRAR (USD)
              <input type="number" step="0.01" min="0" value={form.initialBalance} onChange={(e) => setForm((c) => ({ ...c, initialBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("initialBalance") ? "input-error" : undefined} required />
            </label>
            <label>
              FONDO DE VIAJE (USD)
              <input type="number" step="0.01" min="0" value={form.travelFundBalance} onChange={(e) => setForm((c) => ({ ...c, travelFundBalance: e.target.value }))} placeholder="0.00" className={errorFields.has("travelFundBalance") ? "input-error" : undefined} required />
            </label>
            <div className="other-charges-section">
              <div className="other-charges-header">
                <span>Otros cargos</span>
                <button type="button" className="button ghost small" onClick={() =>
                  setForm((c) => ({ ...c, otherCharges: [...c.otherCharges, createOtherChargeForm()] }))
                }>+ Agregar</button>
              </div>
              {form.otherCharges.map((charge, i) => (
                <div key={i} className="other-charge-row">
                  <input type="text" placeholder="Concepto (ej. Mantenimiento)" value={charge.label}
                    onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, label: e.target.value } : ch) }))} />
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={charge.amount}
                    onChange={(e) => setForm((c) => ({ ...c, otherCharges: c.otherCharges.map((ch, idx) => idx === i ? { ...ch, amount: e.target.value } : ch) }))} />
                  <button type="button" className="other-charge-remove" onClick={() =>
                    setForm((c) => ({ ...c, otherCharges: c.otherCharges.filter((_, idx) => idx !== i) }))
                  }>X</button>
                </div>
              ))}
            </div>
            <button type="submit" className={`button primary ${installmentLiveError ? "button-disabled" : ""}`} disabled={installmentLiveError !== null}>
              Guardar cliente
            </button>
              </form>
              {form.frequency === "daily" && <p className="hint">Regla diaria: cobro automatico de lunes a sabado.</p>}
              {form.frequency === "daily" && form.chargeFirstSunday && <p className="hint">Incluye el primer domingo automaticamente una sola vez.</p>}
              {form.frequency === "biweekly" && <p className="hint">Regla quincenal: cobros fijos dia 15 y fin de mes.</p>}
              {form.frequency === "monthly" && <p className="hint">Regla mensual: si el dia configurado cae domingo, el cobro se mueve al lunes siguiente.</p>}
              {errors.length > 0 && <ul className="error-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
              {installmentLiveError !== null && <ul className="error-list"><li>{installmentLiveError}</li></ul>}
            </div>
          </div>
        </div>
      )}

      <section className="panel">
        {isExportOpen && (
          <div className="export-panel">
            <p className="export-title">Selecciona las columnas a exportar:</p>
            <div className="export-fields">
              {exportFields.map((field) => (
                <label key={field.key} className="export-field-label">
                  <input type="checkbox" checked={field.enabled} onChange={() =>
                    setExportFields((current) => current.map((f) => f.key === field.key ? { ...f, enabled: !f.enabled } : f))
                  } />
                  {field.label}
                </label>
              ))}
            </div>
            <div className="export-actions">
              <button type="button" className="button primary" onClick={handleExportExcel} disabled={isExporting}>
                {isExporting ? "Exportando..." : "Descargar Excel"}
              </button>
              <button type="button" className="button ghost" onClick={handleExportPDF} disabled={isExporting}>
                Descargar PDF
              </button>
            </div>
            {exportError !== null && <p className="hint error-text">{exportError}</p>}
            <p className="hint">Se exportan los {rows.length} clientes visibles con los filtros actuales.</p>
          </div>
        )}

        {activeDashboardFilter && (
          <div className="collection-active-filter">
            <span>
              Filtro activo: {activeDashboardFilter.cut.toUpperCase()} · {
                activeDashboardFilter.metric === "needContact" ? "Pendientes" :
                activeDashboardFilter.metric === "contacted" ? "Gestionados" :
                activeDashboardFilter.metric === "streetSent" ? "Enviados a calle" :
                activeDashboardFilter.metric === "streetOnlyCollect" ? "Solo cobrar" :
                activeDashboardFilter.metric === "streetCollectRemove" ? "Cobrar / quitar" :
                activeDashboardFilter.metric === "promiseAttention" ? "Promesa con atención" :
                activeDashboardFilter.metric === "paidDone" ? "Pago realizado" :
                activeDashboardFilter.metric === "promise" ? "Promesa" :
                activeDashboardFilter.metric === "reminder" ? "Recordatorio" :
                activeDashboardFilter.metric === "noResponse" ? "No responde" :
                activeDashboardFilter.metric === "callLater" ? "Llamar más tarde" :
                "Sin cobro hoy"
              }
            </span>
            <button type="button" className="button ghost small" onClick={() => setActiveDashboardFilter(null)}>Quitar filtro</button>
          </div>
        )}
        <div className="collection-active-filter">
          <span>
            Promesas: {promiseAttentionClientIds.allOpen.size} activas · {promiseAttentionClientIds.due.size} con atención · {promiseAttentionClientIds.pending.size} pendientes
          </span>
          <button
            type="button"
            className="button ghost small"
            onClick={() =>
              setPromiseDashboardFilter((current) =>
                current === "all" ? "attention" : current === "attention" ? "pending" : "all"
              )
            }
          >
            {promiseDashboardFilter === "attention"
              ? "Ver solo pendientes"
              : promiseDashboardFilter === "pending"
              ? "Ver todas"
              : "Filtrar promesas por vencer/vencidas"}
          </button>
        </div>
        {displayedRows.length === 0 ? (
          <p className="empty">Aun no hay clientes con ese filtro.</p>
        ) : (
          <>
            <section className="daily-exec-board">
              <div className="collection-dashboard-cuts">
                {([
                  { key: "am", title: "RUN 1", stats: collectionDashboard.am },
                  { key: "pm", title: "RUN 2", stats: collectionDashboard.pm },
                  { key: "close", title: "RUN 3", stats: collectionDashboard.close }
                ] as const).map((cut) => (
                  <article key={cut.key} className="collection-dashboard-cut-card">
                    <header className="collection-dashboard-cut-head">
                      <strong>{cut.title}</strong>
                      <button
                        type="button"
                        className="button primary small collection-cut-download-btn"
                        onClick={() => {
                          if (cut.key === "am") {
                            void downloadAmClosureReport();
                            return;
                          }
                          if (cut.key === "pm") {
                            void downloadPmClosureReport();
                            return;
                          }
                          void downloadCloseClosureReport();
                        }}
                        title={`Descargar reporte ${cut.title} en PDF`}
                      >
                        Descargar
                      </button>
                    </header>
                    <p className="collection-dashboard-cut-help">
                      {cut.key === "am"
                        ? "Bloque inicial: cartera pendiente y trazabilidad del contacto."
                        : cut.key === "pm"
                        ? "Bloque seguimiento: continuidad de casos heredados."
                        : "Bloque cierre: resolución final y envío a calle."}
                    </p>
                    <div className={`collection-dashboard-kpis ${cut.key === "close" ? "collection-dashboard-kpis--close" : ""}`}>
                      <button
                        type="button"
                        className={`collection-dashboard-kpi collection-dashboard-kpi--need ${cut.key !== "am" ? "is-disabled" : ""} ${activeDashboardFilter?.cut === cut.key && activeDashboardFilter?.metric === "needContact" ? "is-active" : ""}`}
                        onClick={() => {
                          if (cut.key !== "am") return;
                          setActiveDashboardFilter((current) => current?.cut === "am" && current.metric === "needContact" ? null : { cut: "am", metric: "needContact" });
                        }}
                        aria-disabled={cut.key !== "am"}
                        title={cut.key === "am" ? "Filtrar pendientes del bloque AM (RUN1)" : "Disponible solo en bloque AM (RUN1)"}
                      >
                        <span>Pendientes</span>
                        <strong>{cut.stats.needContact}</strong>
                      </button>
                      <div
                        role="button"
                        tabIndex={0}
                        className={`collection-dashboard-kpi collection-dashboard-kpi--contacted ${activeDashboardFilter?.cut === cut.key && activeDashboardFilter?.metric === "contacted" ? "is-active" : ""}`}
                        onClick={() => setActiveDashboardFilter((current) => current?.cut === cut.key && current.metric === "contacted" ? null : { cut: cut.key, metric: "contacted" })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setActiveDashboardFilter((current) => current?.cut === cut.key && current.metric === "contacted" ? null : { cut: cut.key, metric: "contacted" });
                          }
                        }}
                      >
                        <span>Gestionados</span>
                        <strong>{cut.stats.contacted}</strong>
                        <div className="collection-dashboard-kpi-breakdown-grid">
                          <button
                            type="button"
                            className={`collection-dashboard-kpi-breakdown-item ${activeDashboardFilter?.cut === cut.key && activeDashboardFilter?.metric === "paidDone" ? "is-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDashboardFilter((current) => current?.cut === cut.key && current.metric === "paidDone" ? null : { cut: cut.key, metric: "paidDone" });
                            }}
                          >
                            <b>{cut.stats.paidDone}</b>
                            <small>Pago realizado</small>
                          </button>
                          <button
                            type="button"
                            className={`collection-dashboard-kpi-breakdown-item ${activeDashboardFilter?.cut === cut.key && activeDashboardFilter?.metric === "promise" ? "is-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDashboardFilter((current) => current?.cut === cut.key && current.metric === "promise" ? null : { cut: cut.key, metric: "promise" });
                            }}
                          >
                            <b>{cut.stats.promise}</b>
                            <small>Promesa</small>
                          </button>
                          <button
                            type="button"
                            className={`collection-dashboard-kpi-breakdown-item ${activeDashboardFilter?.cut === cut.key && activeDashboardFilter?.metric === "reminder" ? "is-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDashboardFilter((current) => current?.cut === cut.key && current.metric === "reminder" ? null : { cut: cut.key, metric: "reminder" });
                            }}
                          >
                            <b>{cut.stats.reminder}</b>
                            <small>Recordatorio</small>
                          </button>
                          <button
                            type="button"
                            className={`collection-dashboard-kpi-breakdown-item ${activeDashboardFilter?.cut === cut.key && activeDashboardFilter?.metric === "noResponse" ? "is-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDashboardFilter((current) => current?.cut === cut.key && current.metric === "noResponse" ? null : { cut: cut.key, metric: "noResponse" });
                            }}
                          >
                            <b>{cut.stats.noResponse}</b>
                            <small>No responde</small>
                          </button>
                          <button
                            type="button"
                            className={`collection-dashboard-kpi-breakdown-item collection-dashboard-kpi-breakdown-item--full ${activeDashboardFilter?.cut === cut.key && activeDashboardFilter?.metric === "callLater" ? "is-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDashboardFilter((current) => current?.cut === cut.key && current.metric === "callLater" ? null : { cut: cut.key, metric: "callLater" });
                            }}
                          >
                            <b>{cut.stats.callLater}</b>
                            <small>Llamar más tarde</small>
                          </button>
                          {cut.key === "am" && (
                            <button
                              type="button"
                              className={`collection-dashboard-kpi-breakdown-item collection-dashboard-kpi-breakdown-item--full ${activeDashboardFilter?.cut === "am" && activeDashboardFilter?.metric === "noAction" ? "is-active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDashboardFilter((current) => current?.cut === "am" && current.metric === "noAction" ? null : { cut: "am", metric: "noAction" });
                              }}
                            >
                              <b>{Object.keys(todayNoActionConfirms.run1 ?? {}).length}</b>
                              <small>Sin cobro hoy</small>
                            </button>
                          )}
                        </div>
                      </div>
                      {(cut.key === "am" || cut.key === "pm" || cut.key === "close") && (
                        <article className="collection-dashboard-kpi collection-dashboard-kpi--action-label">
                          <span>Estado operativo</span>
                          <strong>
                            {cut.key === "am"
                              ? (isAmSealed ? "Finalizado" : "En curso")
                              : cut.key === "pm"
                              ? (!isAmSealed ? "Pendiente" : isPmSealed ? "Finalizado" : "En curso")
                              : (!isPmSealed ? "Pendiente" : isCloseSealed ? "Finalizado" : "En curso")}
                          </strong>
                        </article>
                      )}
                      {cut.key === "pm" && (
                        <button
                          type="button"
                          className={`collection-dashboard-kpi collection-dashboard-kpi--promise ${activeDashboardFilter?.cut === "pm" && activeDashboardFilter?.metric === "promiseAttention" ? "is-active" : ""}`}
                          onClick={() => setActiveDashboardFilter((current) => current?.cut === "pm" && current.metric === "promiseAttention" ? null : { cut: "pm", metric: "promiseAttention" })}
                          title="Filtrar promesas próximas, vencidas o incumplidas parciales"
                        >
                          <span>Promesa con atención</span>
                          <strong>{promiseAttentionRun2Ids.length}</strong>
                        </button>
                      )}
                    </div>
                    {cut.key === "am" && (
                      <div className="collection-dashboard-am-action">
                        {isAmSealed ? (
                          <>
                            <button
                              type="button"
                              className="button ghost small daily-exec-am-close-btn daily-exec-am-close-btn--lux-reopen"
                              onClick={() => reopenRunSeal("run1")}
                              title="Reabrir RUN 1 sin borrar gestiones"
                            >
                              Reabrir RUN 1
                            </button>
                            <button
                              type="button"
                              className="button ghost small daily-exec-am-close-btn daily-exec-am-close-btn--lux-danger"
                              onClick={() => undoRunBlock("run1")}
                              title="Borrar la gestión del RUN 1 de hoy"
                            >
                              Deshacer RUN 1
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="button primary small daily-exec-am-close-btn"
                            onClick={closeAmRun}
                            disabled={!amCompletion.isComplete}
                            title={amCompletion.isComplete ? "Culminar bloque AM" : "Completa todas las unidades de AM para culminar"}
                          >
                            Terminar bloque AM
                          </button>
                        )}
                      </div>
                    )}
                    {cut.key === "pm" && (
                      <div className="collection-dashboard-am-action">
                        {isPmSealed ? (
                          <>
                            <button
                              type="button"
                              className="button ghost small daily-exec-am-close-btn daily-exec-am-close-btn--lux-reopen"
                              onClick={() => reopenRunSeal("run2")}
                              title="Reabrir RUN 2 sin borrar gestiones"
                            >
                              Reabrir RUN 2
                            </button>
                            <button
                              type="button"
                              className="button ghost small daily-exec-am-close-btn daily-exec-am-close-btn--lux-danger"
                              onClick={() => undoRunBlock("run2")}
                              title="Borrar la gestión del RUN 2 (y RUN 3) de hoy"
                            >
                              Deshacer RUN 2
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="button primary small daily-exec-am-close-btn"
                            onClick={closePmRun}
                            disabled={!isAmSealed || !pmCompletion.isComplete || isPmSealed}
                            title={
                              !isAmSealed
                                ? "Debes culminar RUN 1 para cerrar RUN 2"
                                : isPmSealed
                                ? "RUN 2 ya está culminado"
                                : pmCompletion.isComplete
                                ? "Culminar RUN 2"
                                : "Completa todas las unidades de RUN 2 para culminar"
                            }
                          >
                            Terminar RUN 2
                          </button>
                        )}
                      </div>
                    )}
                    {cut.key === "close" && (
                      <div className="collection-dashboard-am-action">
                        {isCloseSealed ? (
                          <>
                            <button
                              type="button"
                              className="button ghost small daily-exec-am-close-btn daily-exec-am-close-btn--lux-reopen"
                              onClick={() => reopenRunSeal("run3")}
                              title="Reabrir RUN 3 sin borrar gestiones"
                            >
                              Reabrir RUN 3
                            </button>
                            <button
                              type="button"
                              className="button ghost small daily-exec-am-close-btn daily-exec-am-close-btn--lux-danger"
                              onClick={() => undoRunBlock("run3")}
                              title="Borrar la gestión del RUN 3 de hoy"
                            >
                              Deshacer RUN 3
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="button primary small daily-exec-am-close-btn"
                            onClick={closeCloseRun}
                            disabled={!isPmSealed || !closeCompletion.isComplete || !closeCompletion.streetReady || isCloseSealed}
                            title={
                              !isPmSealed
                                ? "Debes culminar RUN 2 para cerrar RUN 3"
                                : isCloseSealed
                                ? "RUN 3 ya está culminado"
                                : !closeCompletion.streetReady
                                ? "Debes completar 'Enviar a calle' en todos los casos elegibles"
                                : closeCompletion.isComplete
                                ? "Culminar RUN 3"
                                : "Completa todas las unidades de RUN 3 para culminar"
                            }
                          >
                            Terminar RUN 3
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
                <article className="collection-dashboard-cut-card">
                  <header className="collection-dashboard-cut-head">
                    <strong>ENVIO A CALLE</strong>
                  </header>
                  <div className="collection-dashboard-street-group">
                    <button
                      type="button"
                      className={`collection-dashboard-kpi collection-dashboard-kpi--contacted collection-dashboard-kpi--street-main ${activeDashboardFilter?.cut === "close" && activeDashboardFilter?.metric === "streetSent" ? "is-active" : ""}`}
                      onClick={() => setActiveDashboardFilter((current) => current?.cut === "close" && current.metric === "streetSent" ? null : { cut: "close", metric: "streetSent" })}
                    >
                      <span>Enviados a calle</span>
                      <strong>{collectionDashboard.close.streetSent}</strong>
                    </button>
                    <div className="collection-dashboard-street-group__subs">
                      <button
                        type="button"
                        className={`collection-dashboard-kpi collection-dashboard-kpi--promise ${activeDashboardFilter?.cut === "close" && activeDashboardFilter?.metric === "streetOnlyCollect" ? "is-active" : ""}`}
                        onClick={() => setActiveDashboardFilter((current) => current?.cut === "close" && current.metric === "streetOnlyCollect" ? null : { cut: "close", metric: "streetOnlyCollect" })}
                      >
                        <span>Solo cobrar</span>
                        <strong>{collectionDashboard.close.streetOnlyCollect}</strong>
                      </button>
                      <button
                        type="button"
                        className={`collection-dashboard-kpi collection-dashboard-kpi--noresponse ${activeDashboardFilter?.cut === "close" && activeDashboardFilter?.metric === "streetCollectRemove" ? "is-active" : ""}`}
                        onClick={() => setActiveDashboardFilter((current) => current?.cut === "close" && current.metric === "streetCollectRemove" ? null : { cut: "close", metric: "streetCollectRemove" })}
                      >
                        <span>Cobrar / quitar</span>
                        <strong>{collectionDashboard.close.streetCollectRemove}</strong>
                      </button>
                    </div>
                    <div className="collection-dashboard-street-group__footer">
                      <article className="collection-dashboard-kpi collection-dashboard-kpi--action-label">
                        <span>Mínimo total calle</span>
                        <strong>{formatCurrency(collectionDashboard.close.streetMinTotal)}</strong>
                      </article>
                    </div>
                  </div>
                </article>
              </div>
            </section>
            <div className="top-scroll" ref={topScrollRef} onScroll={handleTopScroll}>
              <div ref={topScrollInnerRef} style={{ height: 1 }} />
            </div>
            <div className="table-scroll clients-premium-table-wrap" ref={tableScrollRef} onScroll={handleTableScroll}>
              <table className="clients-premium-table">
                <thead>
                  <tr>
                    <th>
                      <div className="collection-header-inline">
                        <span className="collection-header-title">GENERALES</span>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <select
                          value={generalGroupFilter}
                          onChange={(e) => setGeneralGroupFilter(e.target.value as GeneralGroupFilterKey)}
                          title="Filtrar por grupo"
                        >
                          <option value="ALL">Todos</option>
                          <option value="T">Grupo T</option>
                          <option value="A">Grupo A</option>
                          <option value="B">Grupo B</option>
                          <option value="C">Grupo C</option>
                          <option value="D">Grupo D</option>
                        </select>
                      </div>
                      <div className="clients-header-search-grid">
                        <input
                          type="text"
                          className="clients-header-search-input"
                          placeholder="Filtrar por unidad (Ej: A54)"
                          value={unitSearchFilter}
                          onChange={(e) => setUnitSearchFilter(e.target.value)}
                        />
                        <input
                          type="text"
                          className="clients-header-search-input"
                          placeholder="Filtrar por cliente"
                          value={clientNameSearchFilter}
                          onChange={(e) => setClientNameSearchFilter(e.target.value)}
                        />
                      </div>
                    </th>
                    <th>
                      <div className="collection-header-inline">
                        <span className="collection-header-title">ESTADO DE CUENTA</span>
                      </div>
                    </th>
                    <th>
                      <div className="collection-header-daily">
                        <span className="collection-header-title">JORNADA DE GESTION</span>
                        <div className="collection-header-lanes" aria-hidden="true">
                          <span>RUN 1</span>
                          <span>RUN 2</span>
                          <span>RUN 3</span>
                        </div>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map(({ client, unitId, debtStartDate, nextChargeDate, pendingInstallments }) => {
                    const otherChargeText = client && client.otherCharges.length > 0
                      ? client.otherCharges.map((c) => `${c.label}: ${formatCurrency(c.amount)}`).join(" | ")
                      : null;
                    const otherChargesTotal = client ? client.otherCharges.reduce((sum, charge) => sum + charge.amount, 0) : 0;
                    const financialTone = getFinancialTone(debtStartDate, nextChargeDate, operationalReferenceDate);
                    const financialBadge = financialToneUi(financialTone);
                    const paidTodayAmount = client ? (paidTodayAmountByClientId.get(client.id) ?? 0) : 0;
                    const lockedByTodayPayment = false;
                    const clientHasManualCollectionEnabled = Boolean(client) && (["run1", "run2", "run3"] as CollectionRunId[]).some((runId) =>
                      Boolean(collectionOverrideByKey[`${client.id}:${runId}`])
                    );
                    const rowBlockedByStatus = Boolean(client) && (
                      client.status === "libre" ||
                      (isCollectionBlockedByStatus(client.status) && !clientHasManualCollectionEnabled)
                    );
                    const noActionReasonForStatus: NoActionReason | null = client
                      ? (client.status === "libre"
                        ? "libre"
                        : rowBlockedByStatus
                        ? "no_activo"
                        : financialTone === "al_dia"
                        ? "al_dia"
                        : null)
                      : null;
                    const statusReviewQuestion = client
                      ? (client.status === "libre"
                        ? `¿La unidad ${unitId} sigue libre y disponible?`
                        : `¿La unidad ${unitId} sigue en ${(STATUS_LABEL[client.status] ?? "estado no definido").toLowerCase()}? ¿Ya revisaste?`)
                      : "";
                    const debtLabel = client
                      ? (debtStartDate ? formatDate(debtStartDate) : nextChargeDate ? `Al dia hasta ${formatPaymentDateKey(toDateKey(nextChargeDate))}` : "Al dia")
                      : "-";
                    const overdueInstallmentsLabel = pendingInstallments > 0
                      ? `${pendingInstallments} cuota${pendingInstallments === 1 ? "" : "s"} atrasada${pendingInstallments === 1 ? "" : "s"}`
                      : "Sin cuotas atrasadas";
                    const lastPaymentLabel = client ? (() => {
                      const value = lastPaymentByClientId.get(client.id);
                      return value ? formatPaymentDateKey(value) : "-";
                    })() : "-";

                    if (rowBlockedByStatus && client) {
                      return (
                        <tr key={client.id} className="clients-row--status-alert">
                          <td className="clients-cell-status-only" colSpan={3}>
                            <div className="clients-status-alert">
                              <span className="clients-status-alert__state">{STATUS_LABEL[client.status]}</span>
                              <span>Unidad: {unitId}</span>
                              <span>Cliente: {firstNameOf(client.name)}</span>
                              <span>Saldo: {formatCurrency(client.balance)}</span>
                              <span>Debe desde: {debtLabel}</span>
                              <span>Ultimo pago: {lastPaymentLabel}</span>
                              <span>Otros cargos: {formatCurrency(otherChargesTotal)}</span>
                              <span>Estado cuenta: {financialBadge.label}</span>
                              <div className="clients-status-review-cta">
                                <span className="hint">{statusReviewQuestion}</span>
                                <div className="collection-form-actions" style={{ marginTop: 8 }}>
                                  {(() => {
                                    const confirmed = Boolean(todayNoActionConfirms.run1?.[client.id]);
                                    return (
                                      <>
                                        <button
                                          type="button"
                                          className={`button small ${confirmed ? "ghost" : "primary"}`}
                                          onClick={() => confirmNoAction(client.id, "run1", noActionReasonForStatus ?? "no_activo")}
                                          title="Confirmar revisión de estado"
                                        >
                                          {confirmed ? "Revisión confirmada" : "Sí, confirmar revisión"}
                                        </button>
                                        {confirmed && (
                                          <button
                                            type="button"
                                            className="button small clients-no-action-undo-btn"
                                            onClick={() => undoNoActionConfirmation(client.id, "run1")}
                                            title="Deshacer confirmación de revisión"
                                          >
                                            Deshacer revisión
                                          </button>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="button primary small clients-status-alert__action"
                                onClick={() => {
                                  setCollectionOverrideByKey((current) => ({
                                    ...current,
                                    [`${client.id}:run1`]: true,
                                    [`${client.id}:run2`]: true,
                                    [`${client.id}:run3`]: true
                                  }));
                                }}
                              >
                                Generar cobro (excepcion)
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={client?.id ?? `fleet-${unitId}`} className={!client ? "clients-row--no-driver" : ""}>
                        <td className="clients-cell-unit">
                          <strong className="clients-unit-id">{unitId}</strong>
                          <div className="debt-meta ar-truncate-line clients-unit-name" title={client?.name ?? "Sin chofer"}>
                            {client ? firstNameOf(client.name) : "Sin chofer"}
                          </div>
                          <div className="clients-unit-plan">
                            {client ? (
                              <>
                                <strong className="clients-plan-amount">{formatCurrency(client.rentAmount)}</strong>
                                <span className={`badge ${client.frequency === "daily" ? "badge-good" : client.frequency === "weekly" ? "badge-warning" : client.frequency === "biweekly" ? "badge-debt" : "badge-good"}`}>{FREQUENCY_LABEL[client.frequency]}</span>
                              </>
                            ) : <span className="badge badge-warning">Libre</span>}
                          </div>
                          {otherChargeText ? (
                            <div className="debt-meta" title={otherChargeText} style={{ cursor: "help" }}>
                              Ver detalle cargos
                            </div>
                          ) : null}
                          <div className="clients-info-actions">
                            <button type="button" className="button ghost small clients-info-btn clients-info-btn--util" onClick={() => setVehicleInfoUnit(unitId)}>
                              Ver unidad
                            </button>
                            {client ? (
                              <>
                                <button type="button" className="button ghost small clients-info-btn clients-info-btn--util" onClick={() => setClientInfoId(client.id)}>
                                  Ver cliente
                                </button>
                                <button
                                  type="button"
                                  className="button ghost small clients-info-btn clients-info-btn--primary"
                                  onClick={() => {
                                    handleStartEditClient(client);
                                    setEditClientTab("identidad");
                                  }}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="button ghost small clients-info-btn clients-info-btn--primary"
                                  onClick={() => handleUnlinkClient(client)}
                                  title="Desvincular cliente de esta unidad"
                                >
                                  Desvincular
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="button primary small clients-info-btn clients-info-btn--primary"
                                onClick={() => handleCreateClientFromUnit(unitId)}
                              >
                                Crear Cliente
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="clients-cell-collection">
                          <div className="clients-collection-status-row">
                            {client ? (
                              <select
                                className={operationalToneClass(client.status)}
                                value={client.status}
                                onChange={(e) => handleStatusSelection(client, e.target.value as Client["status"])}
                                title={client.statusComment ? `Motivo: ${client.statusComment}` : undefined}
                              >
                                {STATUS_EDIT_OPTIONS.map((status) => (
                                  <option
                                    key={status}
                                    value={status}
                                    disabled={status === "cliente_enfermo" && client.frequency !== "daily"}
                                  >
                                    {STATUS_LABEL[status]}
                                  </option>
                                ))}
                              </select>
                            ) : <span className="badge badge-warning">Inactivo</span>}
                            <span className={`${financialBadge.className} clients-financial-badge`} title={financialBadge.tooltip}>{financialBadge.label}</span>
                          </div>
                          <div className="clients-collection-card">
                            <div className="clients-collection-head">
                              <span className="clients-collection-head-label">Saldo</span>
                              <span className={`clients-collection-balance ${client && client.balance <= 0 ? "amount-good" : "amount-debt"}`}>
                                {client ? formatCurrency(client.balance) : "-"}
                              </span>
                            </div>
                            <div className="clients-collection-line">
                              <span>Debe desde</span>
                              <strong>{client ? (debtStartDate ? formatDate(debtStartDate) : nextChargeDate ? `Al día hasta ${formatPaymentDateKey(toDateKey(nextChargeDate))}` : "Al día") : "-"}</strong>
                            </div>
                            <div className="clients-collection-line">
                              <span>Atraso</span>
                              <strong>
                                <span className={`badge clients-overdue-badge ${pendingInstallments > 0 ? "clients-overdue-badge--due" : "clients-overdue-badge--ok"}`}>
                                  {overdueInstallmentsLabel}
                                </span>
                              </strong>
                            </div>
                            <div className={`clients-collection-line ${paidTodayAmount > 0 ? "clients-collection-line--last-payment-paid" : ""}`}>
                              <span>Ultimo pago</span>
                              <strong>{client ? (() => {
                                const value = lastPaymentByClientId.get(client.id);
                                return value ? formatPaymentDateKey(value) : "-";
                              })() : "-"}{paidTodayAmount > 0 ? <span className="clients-paid-today-inline">PAGÓ HOY</span> : null}</strong>
                            </div>
                            <div className="clients-collection-line">
                              <span>Otros cargos</span>
                              <strong>{formatCurrency(otherChargesTotal)}</strong>
                            </div>
                            <div className="clients-collection-quota-grid">
                              <div className="quota-chip quota-chip--pactadas">
                                <span>Pactadas</span>
                                <strong>{client ? client.installmentsAgreed : "-"}</strong>
                              </div>
                              <div className="quota-chip quota-chip--restantes">
                                <span>Restantes</span>
                                <strong>{client ? client.installmentsRemaining : "-"}</strong>
                              </div>
                              <div className="quota-chip quota-chip--pagadas">
                                <span>Pagadas</span>
                                <strong>{client ? client.installmentsPaid : "-"}</strong>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="clients-cell-runs">
                          {!client ? (
                            <div className="collection-no-action-wrap">
                              <div className="collection-no-action">
                                <span className="badge">Sin acción hoy</span>
                              </div>
                              <div className="collection-no-action">
                                <span className="hint">¿La unidad {unitId} sigue libre y disponible?</span>
                              </div>
                              <div className="collection-form-actions">
                                {(() => {
                                  const entityId = noActionEntityId(null, unitId);
                                  const confirmed = Boolean(todayNoActionConfirms.run1?.[entityId]);
                                  return (
                                    <>
                                      <button
                                        type="button"
                                        className={`button small ${confirmed ? "ghost" : "primary"}`}
                                        onClick={() => confirmNoAction(entityId, "run1", "libre")}
                                        title="Confirmar revisión de unidad libre"
                                      >
                                        {confirmed ? "Revisión confirmada" : "Sí, confirmar revisión"}
                                      </button>
                                      {confirmed && (
                                        <button
                                          type="button"
                                          className="button small clients-no-action-undo-btn"
                                          onClick={() => undoNoActionConfirmation(entityId, "run1")}
                                          title="Deshacer confirmación de revisión"
                                        >
                                          Deshacer revisión
                                        </button>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          ) : (
                            financialTone === "al_dia" ? (
                              <div className="collection-no-action-wrap">
                                <div className="collection-no-action">
                                  <span className="badge">Sin acción hoy</span>
                                </div>
                                <div className="collection-no-action">
                                  <span className="hint">¿Cuándo fue la última vez que revisaste si la unidad {unitId} está bien?</span>
                                </div>
                                <div className="collection-form-actions">
                                  {(() => {
                                    const confirmed = client ? Boolean(todayNoActionConfirms.run1?.[client.id]) : false;
                                    return (
                                      <>
                                        <button
                                          type="button"
                                          className={`button small ${confirmed ? "ghost" : "primary"}`}
                                          onClick={() => {
                                            if (!client) return;
                                            confirmNoAction(client.id, "run1", "al_dia");
                                          }}
                                          title="Confirmar revisión de unidad"
                                        >
                                          {confirmed ? "Revisión confirmada" : "Sí, confirmar revisión"}
                                        </button>
                                        {confirmed && client && (
                                          <button
                                            type="button"
                                            className="button small clients-no-action-undo-btn"
                                            onClick={() => undoNoActionConfirmation(client.id, "run1")}
                                            title="Deshacer confirmación de revisión"
                                          >
                                            Deshacer revisión
                                          </button>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            ) : (
                              <div className="collection-runs-wrap">
                                <div className="collection-runs-columns">
                                  {(() => {
                                    const startRun = getClientCollectionStartRun(client, amSealsByDate[todayKey], pmSealsByDate[todayKey]);
                                    const promiseInfo = getPromiseState(client);
                                    const promiseRecord = promiseByClientId[client.id];
                                    const hasActivePromise = Boolean(promiseInfo) && promiseInfo?.state !== "cumplida";
                                    const promiseBlocksRuns = hasActivePromise && promiseInfo?.state === "vigente";
                                    const promiseNeedsAction = hasActivePromise && (promiseInfo?.state === "proxima" || promiseInfo?.state === "vencida" || promiseInfo?.state === "incumplida_parcial");
                                    const amBaseEntry = todayCollection.run1[client.id];
                                    const amDraft = getDraft(client.id, "run1");
                                    const amStatusSeed = isAmSealed ? (amBaseEntry?.status || "") : (amDraft.status || amBaseEntry?.status || "");
                                    const amStatusPreview: CollectionDailyStatus | "" = lockedByTodayPayment
                                      ? "pago_confirmado"
                                      : amStatusSeed;
                                    const showOnlyAm = (amStatusPreview === "recordatorio" || amStatusPreview === "promesa_pago") && !isAmSealed;
                                    const showOnlyAmByPaidConfirm = amStatusPreview === "pago_confirmado";
                                    const forceRun2Current = isAmSealed && !todayCollection.run1[client.id]?.status;
                                    const noActionHandledInAm = Boolean(todayNoActionConfirms.run1?.[client.id]);
                                    const allRunIds: CollectionRunId[] = ["run1", "run2", "run3"];
                                    const isRunHiddenByCreation = (runId: CollectionRunId): boolean => {
                                      if (startRun === "run3") return runId === "run1" || runId === "run2";
                                      if (startRun === "run2") return runId === "run1";
                                      return false;
                                    };
                                    const isRunHidden = (runId: CollectionRunId): boolean => {
                                      if (noActionHandledInAm && runId !== "run1") return true;
                                      if (forceRun2Current) return runId === "run1";
                                      if (showOnlyAmByPaidConfirm && startRun === "run1") return runId !== "run1";
                                      if (showOnlyAm && startRun === "run1") return runId !== "run1";
                                      return isRunHiddenByCreation(runId);
                                    };
                                    const hiddenReasonForRun = (runId: CollectionRunId): string => {
                                      if (noActionHandledInAm && runId !== "run1") {
                                        return "Gestionado en AM como 'sin cobro hoy'.";
                                      }
                                      if (forceRun2Current && runId === "run1") {
                                        return "Oculto: AM cerrada sin gestión en RUN 1. Continúa en RUN 2.";
                                      }
                                      if (showOnlyAmByPaidConfirm && startRun === "run1" && runId !== "run1") {
                                        return "Oculto por pago confirmado en RUN 1.";
                                      }
                                      if (showOnlyAm && startRun === "run1" && runId !== "run1") {
                                        return "Oculto por gestión AM actual.";
                                      }
                                      if (startRun === "run3" && (runId === "run1" || runId === "run2")) {
                                        return "Oculto: cliente creado después del cierre PM.";
                                      }
                                      if (startRun === "run2" && runId === "run1") {
                                        return "Oculto: cliente creado después del cierre AM.";
                                      }
                                      return "";
                                    };
                                    if (promiseBlocksRuns && promiseRecord && promiseInfo) {
                                      return (
                                        <div key={`${client.id}-promise`} className="collection-promise-lock">
                                          <span className={`badge ${promiseInfo.state === "proxima" ? "badge-warning" : "badge-good"}`}>
                                            {promiseInfo.state === "proxima" ? "Promesa próxima a vencer" : "Promesa vigente"}
                                          </span>
                                          <strong>Prometió pagar el {formatDateTimeForUi(promiseRecord.promisedAt)}</strong>
                                          <p>Monto prometido: {formatCurrency(promiseRecord.promisedAmount)}</p>
                                          <p className="hint">Gestión pausada hasta la fecha pactada.</p>
                                          <div className="collection-form-actions">
                                            <button
                                              type="button"
                                              className="button small collection-promise-lock__undo"
                                              onClick={() => undoPromiseForClient(client)}
                                              title="Eliminar promesa y reactivar gestión"
                                            >
                                              Deshacer promesa
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    }
                                    return allRunIds.map((runId) => {
                                    const runHidden = isRunHidden(runId);
                                    if (runHidden) {
                                      const runVariantClass = runId === "run1"
                                        ? "collection-mini-form--am"
                                        : runId === "run2"
                                          ? "collection-mini-form--pm"
                                          : "collection-mini-form--close";
                                      return (
                                        <div key={runId} className={`collection-mini-form collection-mini-form--column collection-mini-form--hidden ${runVariantClass}`}>
                                          <div className="collection-hidden-state">
                                            <span className={`collection-hidden-state__pill ${noActionHandledInAm && runId !== "run1" ? "badge badge-good" : ""}`}>
                                              {noActionHandledInAm && runId !== "run1" ? "Gestionado" : "No aplica"}
                                            </span>
                                            <strong className="collection-hidden-state__title">
                                              {noActionHandledInAm && runId !== "run1" ? "Atendido en RUN 1" : "Run oculto por flujo diario"}
                                            </strong>
                                            <p className="collection-hidden-state__reason">{hiddenReasonForRun(runId)}</p>
                                          </div>
                                        </div>
                                      );
                                    }
                                    const draft = getDraft(client.id, runId);
                                    const isPreventive = financialTone === "proximo";
                                    const amEntry = todayCollection.run1[client.id];
                                    const pmEntry = todayCollection.run2[client.id];
                                    const inheritedFromAm = amEntry?.status === "no_responde" || amEntry?.status === "llamar_mas_tarde";
                                    const inheritedFromPm = pmEntry?.status === "no_responde" || pmEntry?.status === "llamar_mas_tarde";
                                    const runEnabledByInheritance =
                                      runId === "run1" ? true :
                                      runId === "run2" ? (forceRun2Current || (isAmSealed && inheritedFromAm)) :
                                      inheritedFromPm;
                                    const runEditable = runId !== "run1" || !isAmSealed;
                                    const feedbackKey = `${client.id}:${runId}`;
                                    const saveFeedback = saveFeedbackByKey[feedbackKey];
                                    const pmAutoPaidMeta = runId === "run2" ? paidTodayAfterAmSealByClientId.get(client.id) : undefined;
                                    const pmAutoPaid = runId === "run2" && Boolean(pmAutoPaidMeta) && (client.balance ?? 0) <= 0;
                                    const effectiveStatus: CollectionDailyStatus | "" = pmAutoPaid
                                      ? "pago_realizado"
                                      : (lockedByTodayPayment ? "pago_confirmado" : draft.status);
                                    const closeStreetEligible = runId === "run3" && (effectiveStatus === "no_responde" || effectiveStatus === "llamar_mas_tarde" || effectiveStatus === "promesa_pago");
                                    const streetAction = runId === "run3" ? todayStreetActions[client.id] : undefined;
                                    const paidTodayAtIso = lastPaymentTodayAtByClientId.get(client.id);
                                    const paidTodayTimeLabel = paidTodayAtIso ? formatIsoTimeLabel(paidTodayAtIso) : "";
                                    const showProcessedChip = runId === "run1" && paidTodayTimeLabel.length > 0;
                                    const runVariantClass = runId === "run1"
                                      ? "collection-mini-form--am"
                                      : runId === "run2"
                                      ? "collection-mini-form--pm"
                                      : "collection-mini-form--close";
                                    const hasSavedEntry = Boolean(todayCollection[runId][client.id]?.status);
                                    const blockedByStatus = isCollectionBlockedByStatus(client.status) && !collectionOverrideByKey[feedbackKey];
                                    return (
                                      <div key={runId} className={`collection-mini-form collection-mini-form--column ${runVariantClass} ${isPreventive ? "collection-mini-form--preventive" : ""} ${showProcessedChip ? "collection-mini-form--has-processed-chip" : ""}`}>
                                        {blockedByStatus ? (
                                          <div className="collection-status-lock">
                                            <span className="badge badge-warning">Estado: {STATUS_LABEL[client.status]}</span>
                                            <button type="button" className="button primary small" onClick={() => setCollectionOverrideByKey((current) => ({ ...current, [feedbackKey]: true }))}>
                                              Habilitar cobro manual
                                            </button>
                                          </div>
                                        ) : null}
                                        {promiseNeedsAction && promiseRecord && runId === "run1" ? (
                                          <div className="collection-promise-reactivation">
                                            <span className={`badge ${promiseInfo?.state === "incumplida_parcial" ? "badge-debt" : "badge-warning"}`}>
                                              {promiseInfo?.state === "incumplida_parcial" ? "Promesa incumplida (pago parcial)" : "Promesa vencida/próxima"}
                                            </span>
                                            <p className="hint">
                                              Prometió pagar el {formatDateTimeForUi(promiseRecord.promisedAt)} por {formatCurrency(promiseRecord.promisedAmount)}.
                                            </p>
                                          </div>
                                        ) : null}
                                        {pmAutoPaid && pmAutoPaidMeta ? (
                                          <span className="badge badge-good">Pago realizado · {formatIsoTimeLabel(pmAutoPaidMeta.at)} · {formatCurrency(pmAutoPaidMeta.amount)}</span>
                                        ) : null}
                                        {showProcessedChip ? (
                                          <span className="collection-paid-processed-chip">
                                            <span className="collection-paid-processed-chip__dot" />
                                            <span className="collection-paid-processed-chip__label">Pago procesado</span>
                                            <strong className="collection-paid-processed-chip__time">{paidTodayTimeLabel}</strong>
                                          </span>
                                        ) : null}
                                        {runId === "run1" && paidTodayAmount > 0 && !pmAutoPaid && effectiveStatus !== "pago_confirmado" ? (
                                          <span className="hint">Sugerido: confirmar "Pago confirmado".</span>
                                        ) : null}
                                        <span className={`badge ${isPreventive ? "badge-warning" : "badge-debt"} collection-action-badge`}>
                                          {lockedByTodayPayment ? "Pago confirmado automático" : isPreventive ? "Acción preventiva" : "Acción prioritaria"}
                                        </span>
                                      <select
                                        value={effectiveStatus}
                                        onChange={(e) => {
                                          const nextStatus = e.target.value as CollectionDailyStatus | "";
                                          if (nextStatus === "llamar_mas_tarde" && !draft.followUpAt) {
                                            updateDraft(client.id, runId, { status: nextStatus, followUpAt: getNowDateTimeLocalValue() });
                                            return;
                                          }
                                          if (nextStatus === "promesa_pago" && !draft.followUpAt) {
                                            updateDraft(client.id, runId, { status: nextStatus, followUpAt: getNowDateTimeLocalValue() });
                                            return;
                                          }
                                          updateDraft(client.id, runId, { status: nextStatus });
                                        }}
                                        disabled={blockedByStatus || pmAutoPaid || lockedByTodayPayment || !runEnabledByInheritance || !runEditable}
                                      >
                                          {!lockedByTodayPayment && !pmAutoPaid && <option value="">Seleccionar</option>}
                                        {pmAutoPaid ? (
                                          <option value="pago_realizado">Pago realizado</option>
                                        ) : lockedByTodayPayment ? (
                                          <option value="pago_confirmado">Pago confirmado</option>
                                        ) : runId === "run1" ? (
                                          <>
                                            {paidTodayAmount > 0 ? (
                                              <option value="pago_confirmado">Pago confirmado</option>
                                            ) : null}
                                            <option value="no_responde">No responde</option>
                                            <option value="recordatorio">Recordatorio</option>
                                            <option value="llamar_mas_tarde">Llamar más tarde</option>
                                            <option value="promesa_pago">Promesa de pago</option>
                                          </>
                                        ) : isPreventive ? (
                                          <>
                                            {paidTodayAmount > 0 ? <option value="pago_realizado">Pago realizado</option> : null}
                                            <option value="llamar_mas_tarde">Llamar más tarde</option>
                                            <option value="promesa_pago">Promesa de pago</option>
                                          </>
                                        ) : runId === "run3" ? (
                                          <>
                                            {paidTodayAmount > 0 ? <option value="pago_realizado">Pago realizado</option> : null}
                                            <option value="promesa_pago">Promesa de pago</option>
                                          </>
                                        ) : (
                                          <>
                                            {paidTodayAmount > 0 ? <option value="pago_realizado">Pago realizado</option> : null}
                                            <option value="no_responde">No responde</option>
                                            <option value="llamar_mas_tarde">Llamar más tarde</option>
                                            <option value="promesa_pago">Promesa de pago</option>
                                          </>
                                          )}
                                        </select>
                                        {effectiveStatus === "llamar_mas_tarde" && (
                                          <input
                                            type="datetime-local"
                                            value={draft.followUpAt}
                                            onChange={(e) => updateDraft(client.id, runId, { followUpAt: e.target.value })}
                                          />
                                        )}
                                        {effectiveStatus === "promesa_pago" && (
                                          <>
                                            <input
                                              type="datetime-local"
                                              value={draft.followUpAt}
                                              onChange={(e) => updateDraft(client.id, runId, { followUpAt: e.target.value })}
                                            />
                                            <input
                                              type="number"
                                              min="0.01"
                                              step="0.01"
                                              placeholder="Monto prometido"
                                              value={draft.promisedAmount}
                                              onChange={(e) => updateDraft(client.id, runId, { promisedAmount: e.target.value })}
                                            />
                                          </>
                                        )}
                                        <input
                                          type="text"
                                          placeholder="Nota"
                                          value={draft.note}
                                          onChange={(e) => updateDraft(client.id, runId, { note: e.target.value })}
                                          disabled={blockedByStatus || pmAutoPaid || lockedByTodayPayment || !runEnabledByInheritance || !runEditable}
                                        />
                                        {runId === "run3" && (
                                          <div className="collection-form-actions">
                                            <button
                                              type="button"
                                              className="button ghost small"
                                              onClick={() => openStreetActionDialog(client, unitId)}
                                              disabled={blockedByStatus || !closeStreetEligible}
                                              title={closeStreetEligible ? "Enviar a cobrador de calle" : "Disponible para No responde / Llamar más tarde / Promesa de pago"}
                                            >
                                              Enviar a calle
                                            </button>
                                            {streetAction ? (
                                              <span className="hint">
                                                {streetAction.type === "solo_cobrar" ? "SOLO COBRAR" : "COBRAR / QUITAR"} · Min {formatCurrency(streetAction.minAmount)}
                                              </span>
                                            ) : null}
                                          </div>
                                        )}
                                        {!blockedByStatus && !pmAutoPaid && !lockedByTodayPayment && runEnabledByInheritance && runEditable && (
                                          <div className="collection-form-actions">
                                            <button
                                              type="button"
                                              className={`button small ${hasSavedEntry ? "ghost" : "primary"}`}
                                              onClick={() => {
                                                if (hasSavedEntry) {
                                                  undoCollectionEntry(client.id, runId);
                                                  return;
                                                }
                                                saveCollectionEntry(client, runId);
                                              }}
                                            >
                                              {hasSavedEntry ? "Deshacer" : "Guardar"}
                                            </button>
                                          </div>
                                        )}
                                        {saveFeedback && (
                                          <p className={`collection-save-feedback collection-save-feedback--${saveFeedback.type}`}>
                                            {saveFeedback.text}
                                          </p>
                                        )}
                                        {!runEditable && runId === "run1" && (
                                          <p className="hint">AM sellada: usa "Reabrir AM" para editar.</p>
                                        )}
                                        {!runEnabledByInheritance && (
                                          <p className="hint">
                                            {runId === "run2" && !isAmSealed
                                              ? "Bloqueado hasta cerrar AM."
                                              : "Heredado del bloque anterior."}
                                          </p>
                                        )}
                                        {pmAutoPaid && (
                                          <p className="hint">Gestión PM cerrada automáticamente por pago del bloque PM.</p>
                                        )}
                                      </div>
                                    );
                                  });
                                  })()}
                                </div>
                              </div>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}









