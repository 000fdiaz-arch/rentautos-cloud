import { formatCurrency } from "../../format";
import { PLAN_LABEL, type ReceivableRow, type ReceivableState, type SortDirection } from "../../receivables";
import type { Client } from "../../types";
import type { CollectionStatus, CollectionStatusRecord, FieldManagementType, RouteAssignment } from "./receivablesTypes";

export type DashboardFilter = "none" | "totalPorCobrar" | "totalVencido" | "proximoAVencer" | "clientesMorosos" | "cobradoEsteMes";
export type ExportFieldKey = "unitId" | "name" | "rentAmount" | "pendingSummary" | "lastPaymentDate" | "state" | "collectionStatus" | "routeCollection";
export type ExportField = { key: ExportFieldKey; label: string; enabled: boolean };
export type CollectionStatusFilter = "all" | CollectionStatus;
export type GroupFilter = "all" | string;
export type ReceivablesViewMode = "cartera" | "historial";
export type ReceivablesWorkflowTab = "management" | "route";
export type CollectionCutKey = "morning" | "afternoon" | "night";

export type CollectionClosureItem = {
  clientId: string;
  unitId: string;
  clientName: string;
  lastPaymentDate: string | null;
  lastPaymentAt?: string | null;
  receivableState: string;
  totalPending: number;
  collectionStatus: CollectionStatus;
  comment: string;
  autoApplied: boolean;
  managementType?: FieldManagementType;
  managementAmount?: number;
  managementComment?: string;
  contactTime?: string;
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

export const COLLECTION_CUT_OPTIONS: Array<{ key: CollectionCutKey; label: string; shortLabel: string }> = [
  { key: "night", label: "Gestion diaria de cobranza", shortLabel: "Gestion diaria" }
];

export const STATE_FILTER_OPTIONS: Array<{ value: ReceivableState; label: string }> = [
  { value: "alDia", label: "Al dia" },
  { value: "proximo", label: "Proximo a vencer" },
  { value: "venceHoy", label: "Vence hoy" },
  { value: "vencido", label: "Vencido" },
  { value: "critico", label: "Moroso critico" }
];

export const COLLECTION_STATUS_HELP: Record<CollectionStatus, string> = {
  unassigned: "Aun no se ha seleccionado una gestion.",
  pending: "Se le debe generar una accion de cobro.",
  contacted: "Culmina la gestion: la renta vencida es permitida.",
  covered: "Cliente al dia, sin saldo vencido que gestionar.",
  route: "Enviar a cobro en ruta; requiere monto minimo para liberar.",
  no_answer: "Llamada no responde, se dejo mensaje.",
  reminder: "Mensaje recordatorio enviado.",
  call_later: "Cliente pide llamar mas tarde.",
  paid: "Pago confirmado.",
  route_collection: "Cobro en ruta.",
  route_not_sent: "No enviado a ruta."
};

export const COLLECTION_STATUS_OPTIONS: Array<{ value: CollectionStatus; label: string; description: string }> = [
  { value: "unassigned", label: "Por asignar", description: COLLECTION_STATUS_HELP.unassigned },
  { value: "pending", label: "Pendiente", description: COLLECTION_STATUS_HELP.pending },
  { value: "contacted", label: "Contactado", description: COLLECTION_STATUS_HELP.contacted },
  { value: "covered", label: "Cubierto", description: COLLECTION_STATUS_HELP.covered },
  { value: "route", label: "Cobro en ruta", description: COLLECTION_STATUS_HELP.route },
  { value: "no_answer", label: "Llamada no responde", description: COLLECTION_STATUS_HELP.no_answer },
  { value: "reminder", label: "Mensaje recordatorio", description: COLLECTION_STATUS_HELP.reminder },
  { value: "call_later", label: "Llamar mas tarde", description: COLLECTION_STATUS_HELP.call_later },
  { value: "paid", label: "Pago confirmado", description: COLLECTION_STATUS_HELP.paid },
  { value: "route_collection", label: "Cobro en ruta", description: COLLECTION_STATUS_HELP.route_collection },
  { value: "route_not_sent", label: "No enviado a ruta", description: COLLECTION_STATUS_HELP.route_not_sent }
];

export const DAILY_COLLECTION_STATUS_OPTIONS = COLLECTION_STATUS_OPTIONS.filter((option) => (
  option.value === "unassigned" ||
  option.value === "pending" ||
  option.value === "contacted" ||
  option.value === "covered" ||
  option.value === "route"
));

export const ROUTE_COLLECTION_STATUS_OPTIONS: Array<{ value: CollectionStatus; label: string; description: string }> = [
  { value: "route", label: "Pendiente", description: "Asignado a cobro en ruta, pendiente de resultado." },
  { value: "route_collection", label: "En ruta", description: "La cuenta esta en gestion de calle." },
  { value: "paid", label: "Cobrado", description: "Pago confirmado durante la ruta." },
  { value: "route_not_sent", label: "No cobrado", description: "La ruta no logro cobrar esta cuenta." },
  { value: "call_later", label: "Reprogramado", description: "La visita o cobro queda para seguimiento posterior." }
];

export const REGULAR_COLLECTION_STATUS_OPTIONS = DAILY_COLLECTION_STATUS_OPTIONS;
export const ROUTE_ASSIGNMENT_OPTIONS: RouteAssignment[] = ["PTY", "WC", "CL"];

export const INITIAL_EXPORT_FIELDS: ExportField[] = [
  { key: "unitId", label: "Unidad", enabled: true },
  { key: "name", label: "Nombre", enabled: true },
  { key: "rentAmount", label: "Letra", enabled: true },
  { key: "pendingSummary", label: "Renta vencida", enabled: true },
  { key: "lastPaymentDate", label: "Ultima fecha de pago", enabled: true },
  { key: "state", label: "Estado", enabled: true },
  { key: "collectionStatus", label: "ESTADO COBRANZA", enabled: true },
  { key: "routeCollection", label: "COBRO EN RUTA", enabled: true }
];

export const COLLECTION_CLOSURES_KEY = "cobrapp.module3.collection_closures.v1";

export function isCollectionClosureDay(value: CollectionClosureEntry | undefined): value is CollectionClosureDay {
  return !!value && typeof value === "object" && "cuts" in value && !!value.cuts && typeof value.cuts === "object";
}

export function getCollectionClosureCuts(entry: CollectionClosureEntry | undefined): Partial<Record<CollectionCutKey, CollectionClosureSnapshot>> {
  if (!entry) return {};
  if (isCollectionClosureDay(entry)) return entry.cuts;
  const cutKey = entry.cutKey ?? "night";
  return { [cutKey]: entry };
}

export function getCollectionClosureCut(
  closures: CollectionClosuresByDate,
  dateKey: string,
  cutKey: CollectionCutKey
): CollectionClosureSnapshot | null {
  return getCollectionClosureCuts(closures[dateKey])[cutKey] ?? null;
}

export function hasCollectionClosureCut(
  closures: CollectionClosuresByDate,
  dateKey: string,
  cutKey: CollectionCutKey
): boolean {
  return !!getCollectionClosureCut(closures, dateKey, cutKey);
}

export function getCollectionClosureDateKeys(closures: CollectionClosuresByDate): string[] {
  return Object.keys(closures)
    .filter((dateKey) => Object.keys(getCollectionClosureCuts(closures[dateKey])).length > 0)
    .sort((a, b) => b.localeCompare(a));
}

export function renderSortIcon(active: boolean, direction: SortDirection): string {
  if (!active) return "<>";
  return direction === "asc" ? "^" : "v";
}

export function stateToneClass(state: ReceivableRow["state"]): string {
  if (state === "alDia") return "ar-badge ar-badge--good";
  if (state === "proximo") return "ar-badge ar-badge--warn";
  if (state === "venceHoy") return "ar-badge ar-badge--today";
  if (state === "vencido") return "ar-badge ar-badge--debt";
  return "ar-badge ar-badge--critical";
}

export function clientOperationalStatusLabel(status: Client["status"] | "libre" | string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "libre") return "LIBRE";
  if (normalized === "activo") return "Activo";
  if (normalized === "taller") return "Taller";
  if (normalized === "chapisteria") return "Chapisteria";
  if (normalized === "custodia") return "Custodia";
  if (normalized === "archivado") return "Archivado";
  return normalized.length > 0 ? status : "Sin estado";
}

export function clientOperationalStatusTone(status: Client["status"] | "libre" | string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "libre") return "ar-badge ar-badge--neutral";
  if (normalized === "activo") return "ar-badge ar-badge--good";
  if (normalized === "taller" || normalized === "chapisteria") return "ar-badge ar-badge--today";
  if (normalized === "custodia") return "ar-badge ar-badge--debt";
  return "ar-badge ar-badge--critical";
}

export function pendingSummaryText(totalPending: number, rentAmount: number): string {
  const installments = rentAmount > 0 ? Math.ceil(totalPending / rentAmount) : 0;
  if (installments <= 0) return formatCurrency(totalPending);
  return `${formatCurrency(totalPending)} (${installments} ${installments === 1 ? "cuota" : "cuotas"})`;
}

export function isToday(date: Date, now: Date): boolean {
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function hasActiveOperationalClient(row: ReceivableRow, operationalStatus = row.operationalStatus ?? "activo"): boolean {
  return row.hasActiveClient && operationalStatus.trim().toLowerCase() === "activo";
}

export function shouldDefaultToCovered(row: ReceivableRow, operationalStatus = row.operationalStatus ?? "activo"): boolean {
  return hasActiveOperationalClient(row, operationalStatus) && row.totalPending <= 0;
}

export function normalizeComment(value: string): string {
  return value.slice(0, 5);
}

export function normalizeFieldManagementComment(value: string): string {
  return value.slice(0, 25);
}

export function normalizeSupportNote(value: string): string {
  return value.slice(0, 300);
}

export function normalizeContactTime(value: string): string | undefined {
  const trimmed = value.replace(/\s+/g, " ").trim().toUpperCase();
  if (!trimmed) return undefined;
  if (CONTACT_TIME_OPTIONS.includes(trimmed)) return trimmed;
  const compact = trimmed.replace(/\./g, "");
  const match = compact.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return undefined;
  if (minute !== 0 && minute !== 30) return undefined;
  const normalized = `${hour}:${String(minute).padStart(2, "0")} ${match[3]}`;
  return CONTACT_TIME_OPTIONS.includes(normalized) ? normalized : undefined;
}

export const CONTACT_TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour24 = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
});

export function normalizeRouteAssignment(value: string): RouteAssignment | undefined {
  const normalized = value.replace(/\s+/g, " ").trim().toUpperCase().slice(0, 12);
  return normalized ? normalized as RouteAssignment : undefined;
}

export function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDateForTitle(value: Date): string {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${value.getFullYear()}`;
}

export function planLabelForExport(plan: ReceivableRow["plan"]): string {
  return PLAN_LABEL[plan] ?? "Plan";
}

function parseStoredCollectionRecord(value: unknown): CollectionStatusRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = row.status;
  const comment = typeof row.comment === "string" ? normalizeComment(row.comment.trim()) : "";
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString();
  const managementType: FieldManagementType | undefined = row.managementType === "solo_cobrar" || row.managementType === "cobrar_o_quitar"
    ? row.managementType
    : undefined;
  const rawAmount = typeof row.managementAmount === "number" ? row.managementAmount : Number(row.managementAmount);
  const managementAmount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : undefined;
  const managementComment = typeof row.managementComment === "string" ? normalizeFieldManagementComment(row.managementComment.trim()) : "";
  const managementUpdatedAt = typeof row.managementUpdatedAt === "string" ? row.managementUpdatedAt : undefined;
  const rawRouteReleaseAmount = typeof row.routeReleaseAmount === "number" ? row.routeReleaseAmount : Number(row.routeReleaseAmount);
  const routeReleaseAmount = Number.isFinite(rawRouteReleaseAmount) && rawRouteReleaseAmount > 0 ? rawRouteReleaseAmount : undefined;
  const routeReleaseUpdatedAt = typeof row.routeReleaseUpdatedAt === "string" ? row.routeReleaseUpdatedAt : undefined;
  const routeAssignment = typeof row.routeAssignment === "string" ? normalizeRouteAssignment(row.routeAssignment) : undefined;
  const routeAssignmentUpdatedAt = typeof row.routeAssignmentUpdatedAt === "string" ? row.routeAssignmentUpdatedAt : undefined;
  const whatsAppMessageCopiedAt = typeof row.whatsAppMessageCopiedAt === "string" ? row.whatsAppMessageCopiedAt : undefined;
  const whatsAppMessageSentAt = typeof row.whatsAppMessageSentAt === "string" ? row.whatsAppMessageSentAt : undefined;
  const whatsAppMessageText = typeof row.whatsAppMessageText === "string" ? row.whatsAppMessageText : undefined;
  const supportNote = typeof row.supportNote === "string" ? normalizeSupportNote(row.supportNote.trim()) : "";
  const supportNoteUpdatedAt = typeof row.supportNoteUpdatedAt === "string" ? row.supportNoteUpdatedAt : undefined;
  const contactTime = typeof row.contactTime === "string" ? normalizeContactTime(row.contactTime) : undefined;
  const contactTimeUpdatedAt = typeof row.contactTimeUpdatedAt === "string" ? row.contactTimeUpdatedAt : undefined;
  const paymentPromiseDate = typeof row.paymentPromiseDate === "string" ? row.paymentPromiseDate : undefined;
  const paymentPromiseUpdatedAt = typeof row.paymentPromiseUpdatedAt === "string" ? row.paymentPromiseUpdatedAt : undefined;
  const messageAudit = { whatsAppMessageCopiedAt, whatsAppMessageSentAt, whatsAppMessageText, supportNote, supportNoteUpdatedAt, contactTime, contactTimeUpdatedAt, paymentPromiseDate, paymentPromiseUpdatedAt, routeReleaseAmount, routeReleaseUpdatedAt, routeAssignment, routeAssignmentUpdatedAt };
  if (
    status === "pending" ||
    status === "unassigned" ||
    status === "contacted" ||
    status === "covered" ||
    status === "route" ||
    status === "no_answer" ||
    status === "reminder" ||
    status === "call_later" ||
    status === "paid" ||
    status === "route_collection" ||
    status === "route_not_sent"
  ) {
    return { status, comment, updatedAt, managementType, managementAmount, managementComment, managementUpdatedAt, ...messageAudit };
  }
  if (row.actionType === "cobrar") {
    return { status: "reminder", comment, updatedAt, managementType: "solo_cobrar", managementAmount, managementComment, managementUpdatedAt, ...messageAudit };
  }
  if (row.actionType === "quitarOCobrar") {
    return { status: "call_later", comment, updatedAt, managementType: "cobrar_o_quitar", managementAmount, managementComment, managementUpdatedAt, ...messageAudit };
  }
  return null;
}

export function parseCollectionStatusMapFromStorage(raw: string | null): Record<string, CollectionStatusRecord> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .map(([clientId, value]) => [clientId, parseStoredCollectionRecord(value)] as const)
      .filter((entry): entry is [string, CollectionStatusRecord] => entry[1] !== null));
  } catch {
    return {};
  }
}

export function parseCollectionClosuresFromStorage(raw: string | null): CollectionClosuresByDate {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CollectionClosuresByDate;
  } catch {
    return {};
  }
}
