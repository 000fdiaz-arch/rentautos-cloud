import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_ACTIVE_ROUTE_FILTER,
  activeRouteFilterLabel,
  activeRouteFilterValue,
  compareActiveRouteFilterValues,
  compareActiveRouteItems
} from "../activeRouteOrdering";
import { exportReceivablesToExcel, exportReceivablesToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import {
  loadCloudCollectionClosures,
  loadCloudLatestPaymentsForReceivableTargets,
  loadCloudActiveRouteItems,
  loadCloudStreetManagement,
  loadCollisionCases,
  loadControlUnits,
  loadInsuranceClaims,
  publishCloudActiveRouteItems,
  removeCloudActiveRouteItem,
  saveCloudActiveRouteItem,
  saveCloudCollectionClosures,
  saveCloudStreetManagement,
  syncCloudStreetManagementDelta,
  type ActiveRouteItem,
  type CollisionCaseRecord,
  type ControlUnitRow,
  type InsuranceClaimRecord
} from "../cloudData";
import { supabase } from "../lib/supabase";
import {
  buildReceivableRows,
  createMockReceivableRows,
  DEFAULT_RECEIVABLE_FILTERS,
  filterReceivableRows,
  getGroupFromUnit,
  sortReceivableRows,
  PLAN_LABEL,
  STATE_LABEL,
  type ReceivableFilters,
  type ReceivableRow,
  type ReceivableSortField,
  type ReceivableState,
  type SortDirection
} from "../receivables";
import type { Client, Payment } from "../types";
import type {
  CollectionStatus,
  CollectionStatusRecord,
  FieldManagementType,
  RouteUrgency,
  RouteExportFormat,
  WhatsAppContactFilter
} from "./receivables/receivablesTypes";
import { ReceivableDetailModal } from "./receivables/ReceivableDetailModal";
import { ReceivablesFiltersPanel } from "./receivables/ReceivablesFiltersPanel";
import { ReceivablesLedgerTable, type ReceivablesHistoryRow } from "./receivables/ReceivablesLedgerTable";
import { buildIncidentActionsByUnit } from "./receivables/incidentReceivableActions";
import { exportRouteCollection } from "./receivables/routeCollectionExport";
import {
  COLLECTION_STATUS_OPTIONS,
  COLLECTION_STATUS_HELP,
  COLLECTION_CUT_OPTIONS,
  DAILY_COLLECTION_STATUS_OPTIONS,
  ROUTE_COLLECTION_STATUS_OPTIONS,
  ROUTE_ASSIGNMENT_OPTIONS,
  ROUTE_URGENCY_OPTIONS,
  INITIAL_EXPORT_FIELDS,
  clientOperationalStatusLabel,
  getCollectionClosureCuts,
  getCollectionClosureDateKeys,
  formatDateForTitle,
  getFutureContactTimeOptions,
  hasActiveOperationalClient,
  isToday,
  normalizeComment,
  normalizeContactTime,
  normalizeFieldManagementComment,
  overdueInstallmentsText,
  normalizeRouteAssignment,
  normalizeRouteUrgency,
  normalizeSupportNote,
  parseCollectionStatusMapFromStorage,
  pendingSummaryText,
  planLabelForExport,
  renderSortIcon,
  shouldDefaultToCovered,
  toTimestamp,
  type CollectionClosureItem,
  type CollectionClosuresByDate,
  type CollectionCutKey,
  type CollectionStatusFilter,
  type ExportField,
  type ReceivablesViewMode,
  type ReceivablesWorkflowTab
} from "./receivables/receivablesPageRules";

type Props = {
  clients: Client[];
  payments: Payment[];
  onClientsChange?: (next: Client[]) => void | Promise<void>;
  dataOwnerUserId?: string | null;
  readOnly?: boolean;
  receivablesDateKey?: string;
  isPaymentHistoryLoaded?: boolean;
  onRefreshPayments?: () => Promise<void>;
  streetManagementData?: Record<string, unknown>;
  onStreetManagementPersist?: (value: Record<string, unknown>) => Promise<boolean> | boolean;
};


type PendingContactPrompt = {
  clientId: string;
  step: "question" | "time";
  selectedTime: string;
};

const STATEMENT_SUGGESTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const CLEAR_COLLECTION_MANAGEMENT_CONFIRMATION = "LIMPIAR GESTION";

function getStatusOptionsForCut(cutKey: CollectionCutKey): Array<{ value: CollectionStatus; label: string; description: string }> {
  return cutKey === "night" ? DAILY_COLLECTION_STATUS_OPTIONS : COLLECTION_STATUS_OPTIONS;
}

function createEmptyCollectionStatusCounts(): Record<CollectionStatus, number> {
  return {
    unassigned: 0,
    no_answer: 0,
    reminder: 0,
    call_later: 0,
    paid: 0,
    route_collection: 0,
    route_not_sent: 0,
    pending: 0,
    contacted: 0,
    covered: 0,
    route: 0
  };
}

function normalizeWhatsAppPhoneForFilter(value: string | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 8) return `507${digits}`;
  if (digits.length >= 10) return digits;
  return "";
}

function statementCedulaKey(row: ReceivableRow): string {
  const cedula = row.cedula?.replace(/[^a-z0-9]/gi, "").toUpperCase() ?? "";
  return cedula.length >= 5 ? cedula : "";
}

function isWhatsAppEligibleUnit(row: ReceivableRow): boolean {
  return hasActiveOperationalClient(row);
}

function adjustedMonthlyChargeDate(year: number, monthIndex: number, monthlyChargeDay: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const date = new Date(year, monthIndex, Math.min(monthlyChargeDay, lastDay));
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date;
}

function isReceivableChargeDay(row: ReceivableRow, date: Date): boolean {
  const weekDay = date.getDay();
  if (row.plan === "daily") {
    if (weekDay >= 1 && weekDay <= 6) return true;
    return weekDay === 0 && !!row.chargeFirstSunday && row.installmentsPaid <= 7;
  }
  if (row.plan === "weekly") {
    const dayMap: Record<NonNullable<ReceivableRow["weeklyChargeDay"]>, number> = {
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };
    return weekDay === dayMap[row.weeklyChargeDay ?? "monday"];
  }
  if (row.plan === "biweekly") {
    const day = date.getDate();
    if (day === 15) return true;
    if (date.getMonth() === 1) return day === new Date(date.getFullYear(), 2, 0).getDate();
    return day === 30;
  }
  const monthlyChargeDay = row.monthlyChargeDay ?? 1;
  const adjusted = adjustedMonthlyChargeDate(date.getFullYear(), date.getMonth(), monthlyChargeDay);
  return adjusted.getDate() === date.getDate();
}

function overdueRentForWhatsAppDate(row: ReceivableRow, date: Date): number {
  const pendingInstallments = row.rentAmount > 0 ? Math.ceil(row.totalPending / row.rentAmount) : 0;
  const currentInstallments = isReceivableChargeDay(row, date) && pendingInstallments > 0 ? 1 : 0;
  const overdueInstallments = Math.max(0, Math.min(row.overdueInstallments, pendingInstallments - currentInstallments));
  return Math.max(0, Math.min(row.totalPending, overdueInstallments * row.rentAmount));
}

function currentRentForWhatsApp(row: ReceivableRow, date: Date): number {
  return Math.max(0, row.totalPending - overdueRentForWhatsAppDate(row, date));
}

function hasPendingRentForWhatsApp(row: ReceivableRow): boolean {
  return isWhatsAppEligibleUnit(row) && row.totalPending > 0;
}

function hasTimestampWithinWindow(value: string | undefined, now: Date, windowMs: number): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return now.getTime() - date.getTime() < windowMs;
}

function hasLastPaymentOutsideSuggestionWindow(row: ReceivableRow, now: Date): boolean {
  const rawTimestamp = row.lastPaymentAt ?? (row.lastPaymentDate ? `${row.lastPaymentDate}T12:00:00` : "");
  if (!rawTimestamp) return true;
  const lastPaymentDate = new Date(rawTimestamp);
  if (Number.isNaN(lastPaymentDate.getTime())) return true;
  return now.getTime() - lastPaymentDate.getTime() >= STATEMENT_SUGGESTION_WINDOW_MS;
}

function getWhatsAppContactStatus(row: ReceivableRow, record: CollectionStatusRecord | undefined, now: Date): Exclude<WhatsAppContactFilter, "all" | "pending"> {
  if (!hasPendingRentForWhatsApp(row)) return "idle";
  if (hasTimestampWithinWindow(record?.whatsAppMessageSentAt, now, STATEMENT_SUGGESTION_WINDOW_MS)) return "sent";
  if (!hasLastPaymentOutsideSuggestionWindow(row, now)) return "idle";
  return "ready";
}

function parsePositiveMoneyInput(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.replace(/[$,\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null;
}

function dateKeyFromTimestampValue(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromDateKey(dateKey: string, fallback: Date): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return fallback;
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function paymentReleasesRoute(payment: Payment, clientId: string, releaseAmount: number, routeStartedAt: number, routeDateKey: string): boolean {
  if (releaseAmount <= 0 || payment.clientId !== clientId || payment.amountReceived < releaseAmount) return false;
  const createdTimestamp = toTimestamp(payment.createdAt);
  if (createdTimestamp > 0) return createdTimestamp >= routeStartedAt;
  return !!routeDateKey && payment.dateApplied >= routeDateKey;
}

function hasRouteReleaseAmount(record: CollectionStatusRecord | undefined): boolean {
  const amount = record?.routeReleaseAmount ?? record?.managementAmount;
  return typeof amount === "number" && amount > 0;
}

function buildActiveRouteItem(row: ReceivableRow, record: CollectionStatusRecord, publishedAt: string): ActiveRouteItem | null {
  const releaseAmount = record.routeReleaseAmount ?? record.managementAmount;
  if (!releaseAmount || releaseAmount <= 0) return null;
  const routeStartedAt = record.routeReleaseUpdatedAt ?? record.managementUpdatedAt ?? record.updatedAt ?? publishedAt;
  return {
    clientId: row.id,
    unitId: row.unitId,
    clientName: row.name,
    clientCedula: row.cedula && row.cedula !== "-" ? row.cedula : undefined,
    whatsAppPhone: row.whatsAppPhone,
    routeAssignment: record.routeAssignment,
    managementType: record.managementType ?? "solo_cobrar",
    urgency: record.routeUrgency ?? "normal",
    releaseAmount,
    pendingAmount: row.totalPending,
    overdueBalance: row.overdueBalance,
    rentAmount: row.rentAmount,
    daysLate: row.daysLate,
    lastPaymentDate: row.lastPaymentDate,
    comment: record.managementComment?.trim() || undefined,
    publishedAt,
    routeStartedAt
  };
}

function activeRouteItemReleasedByPayment(item: ActiveRouteItem, payments: Payment[]): boolean {
  const routeStartedAt = toTimestamp(item.routeStartedAt);
  const routeDateKey = dateKeyFromTimestampValue(item.routeStartedAt);
  return payments.some((payment) => paymentReleasesRoute(payment, item.clientId, item.releaseAmount, routeStartedAt, routeDateKey));
}

function routeMissingAmountMessage(rows: ReceivableRow[]): string {
  const units = rows.map((row) => row.unitId).filter(Boolean);
  const visibleUnits = units.slice(0, 8).join(", ");
  const extraCount = Math.max(0, units.length - 8);
  const unitText = visibleUnits ? ` Unidad${units.length === 1 ? "" : "es"}: ${visibleUnits}${extraCount > 0 ? ` y ${extraCount} mas` : ""}.` : "";
  return `Falta Min. liberar en ${rows.length} unidad(es) en cobro en ruta.${unitText}`;
}

function routeMissingAssignmentMessage(rows: ReceivableRow[]): string {
  const units = rows.map((row) => row.unitId).filter(Boolean);
  const visibleUnits = units.slice(0, 8).join(", ");
  const extraCount = Math.max(0, units.length - 8);
  const unitText = visibleUnits ? ` Unidad${units.length === 1 ? "" : "es"}: ${visibleUnits}${extraCount > 0 ? ` y ${extraCount} mas` : ""}.` : "";
  return `Falta asignar Ruta en ${rows.length} unidad(es) en cobro en ruta.${unitText}`;
}

function formatActiveRouteAddedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("es-PA", { hour: "numeric", minute: "2-digit" });
  return `${formatDate(date)} ${time}`;
}

function isRouteManagementRecord(record: CollectionStatusRecord | undefined): boolean {
  if (!record) return false;
  return (
    record.isRouteTagged === true ||
    record.status === "route" ||
    record.status === "route_collection" ||
    record.status === "route_not_sent" ||
    !!record.managementType ||
    typeof record.routeReleaseAmount === "number" ||
    typeof record.managementAmount === "number"
  );
}

function buildPendingRouteRecord(previous: CollectionStatusRecord | undefined, updatedAt: string): CollectionStatusRecord {
  return {
    ...previous,
    status: "pending",
    isRouteTagged: false,
    routeTaggedAt: undefined,
    comment: previous?.comment ?? "",
    updatedAt,
    managementType: undefined,
    managementAmount: undefined,
    managementComment: "",
    managementUpdatedAt: undefined,
    routeReleaseAmount: undefined,
    routeReleaseUpdatedAt: undefined,
    routeAssignment: undefined,
    routeAssignmentUpdatedAt: undefined,
    routeUrgency: undefined,
    routeUrgencyUpdatedAt: undefined,
    whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
    whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
    whatsAppMessageText: previous?.whatsAppMessageText,
    supportNote: previous?.supportNote,
    supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
    contactTime: previous?.contactTime,
    contactTimeUpdatedAt: previous?.contactTimeUpdatedAt,
    paymentPromiseDate: previous?.paymentPromiseDate,
    paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
  };
}

function routeRemovalBlocksRecord(
  record: CollectionStatusRecord | undefined,
  removedItem: ActiveRouteItem | undefined
): boolean {
  const removedAt = toTimestamp(removedItem?.removedAt);
  if (removedAt <= 0) return false;
  const reassignedAt = Math.max(
    toTimestamp(record?.updatedAt),
    toTimestamp(record?.managementUpdatedAt),
    toTimestamp(record?.routeReleaseUpdatedAt),
    toTimestamp(record?.routeAssignmentUpdatedAt)
  );
  return removedAt > reassignedAt;
}

export default function ReceivablesPage({
  clients,
  payments,
  onClientsChange,
  dataOwnerUserId,
  readOnly = false,
  receivablesDateKey,
  streetManagementData,
  onStreetManagementPersist
}: Props) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [filters, setFilters] = useState<ReceivableFilters>(DEFAULT_RECEIVABLE_FILTERS);
  const [sortField, setSortField] = useState<ReceivableSortField>("unitId");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedDetailRow, setSelectedDetailRow] = useState<ReceivableRow | null>(null);
  const [collectionStatusByClient, setCollectionStatusByClient] = useState<Record<string, CollectionStatusRecord>>({});
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<CollectionStatusFilter>("all");
  const [routeTagFilter, setRouteTagFilter] = useState<boolean>(false);
  const [routeReadyFilter, setRouteReadyFilter] = useState<boolean>(false);
  const [whatsAppContactFilter, setWhatsAppContactFilter] = useState<WhatsAppContactFilter>("all");
  const [prioritizeContactTime, setPrioritizeContactTime] = useState<boolean>(false);
  const [pendingContactPrompt, setPendingContactPrompt] = useState<PendingContactPrompt | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean>(false);
  const [workflowTab, setWorkflowTab] = useState<ReceivablesWorkflowTab>("management");
  const [activeRouteFilter, setActiveRouteFilter] = useState<string>(ALL_ACTIVE_ROUTE_FILTER);
  const [activeRouteSearchQuery, setActiveRouteSearchQuery] = useState<string>("");
  const viewMode: ReceivablesViewMode = "cartera";
  const [collectionClosuresByDate, setCollectionClosuresByDate] = useState<CollectionClosuresByDate>({});
  const [collectionClosuresLoaded, setCollectionClosuresLoaded] = useState<boolean>(false);
  const [isCollectionClosuresLoading, setIsCollectionClosuresLoading] = useState<boolean>(false);
  const [visibleCollectionCut] = useState<CollectionCutKey | "all">("night");
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [routeExportMessage, setRouteExportMessage] = useState<string>("");
  const [collectionCutMessage, setCollectionCutMessage] = useState<string | null>(null);
  const [isSavingCollectionCut, setIsSavingCollectionCut] = useState<CollectionCutKey | null>(null);
  const [isClearingCollectionManagement, setIsClearingCollectionManagement] = useState<boolean>(false);
  const [isClearManagementConfirmOpen, setIsClearManagementConfirmOpen] = useState<boolean>(false);
  const [clearManagementConfirmation, setClearManagementConfirmation] = useState<string>("");
  const [isExportConfigOpen, setIsExportConfigOpen] = useState<boolean>(false);
  const [routeExportFormat, setRouteExportFormat] = useState<RouteExportFormat>("jpg");
  const [publishedRouteDownload, setPublishedRouteDownload] = useState<{
    rows: ReceivableRow[];
    statusByClient: Record<string, CollectionStatusRecord>;
    publishedCount: number;
  } | null>(null);
  const [isRouteExportMenuOpen, setIsRouteExportMenuOpen] = useState<boolean>(false);
  const [exportFields, setExportFields] = useState<ExportField[]>(INITIAL_EXPORT_FIELDS);
  const [fieldManagementModalClientId, setFieldManagementModalClientId] = useState<string | null>(null);
  const [fieldManagementDraftByClient, setFieldManagementDraftByClient] = useState<
    Record<string, { type: FieldManagementType | ""; amount: string; comment: string }>
  >({});
  const [fieldManagementErrorByClient, setFieldManagementErrorByClient] = useState<Record<string, string>>({});
  const [statusSavingByClient, setStatusSavingByClient] = useState<Record<string, boolean>>({});
  const [fleetUnits, setFleetUnits] = useState<ControlUnitRow[]>([]);
  const [insuranceClaims, setInsuranceClaims] = useState<InsuranceClaimRecord[]>([]);
  const [collisionCases, setCollisionCases] = useState<CollisionCaseRecord[]>([]);
  const [supplementalLastPayments, setSupplementalLastPayments] = useState<Payment[]>([]);
  const [activeRouteItems, setActiveRouteItems] = useState<ActiveRouteItem[]>([]);
  const [activeRouteLoading, setActiveRouteLoading] = useState<boolean>(false);
  const [activeRouteError, setActiveRouteError] = useState<string>("");
  const [activeRouteMessage, setActiveRouteMessage] = useState<string>("");
  const [publishedCustomRouteEditorByClient, setPublishedCustomRouteEditorByClient] = useState<Record<string, boolean>>({});
  const [publishedRouteAmountDraftByClient, setPublishedRouteAmountDraftByClient] = useState<Record<string, string>>({});
  const [publishedRouteCommentDraftByClient, setPublishedRouteCommentDraftByClient] = useState<Record<string, string>>({});
  const [isPublishedRouteDraftCustomRouteOpen, setIsPublishedRouteDraftCustomRouteOpen] = useState<boolean>(false);
  const [isAddPublishedRouteOpen, setIsAddPublishedRouteOpen] = useState<boolean>(false);
  const [publishedRouteDraft, setPublishedRouteDraft] = useState<{
    clientId: string;
    type: FieldManagementType;
    amount: string;
    comment: string;
    routeAssignment: string;
    urgency: RouteUrgency;
  }>({
    clientId: "",
    type: "solo_cobrar",
    amount: "",
    comment: "",
    routeAssignment: "",
    urgency: "normal"
  });
  const [publishedRouteDraftError, setPublishedRouteDraftError] = useState<string>("");

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const persistStreetTimerRef = useRef<number | null>(null);
  const lastStreetSnapshotRef = useRef<string>("");
  const streetPersistPendingRef = useRef<boolean>(false);
  const streetManagementLoadedRef = useRef<boolean>(false);
  const optimisticStatusByClientRef = useRef<Record<string, CollectionStatusRecord>>({});
  const activeRouteItemsRef = useRef<ActiveRouteItem[]>([]);
  const saveTokenByClientRef = useRef<Record<string, number>>({});
  const latestCollectionStatusByClientRef = useRef<Record<string, CollectionStatusRecord>>({});
  const streetManagementDataRef = useRef<Record<string, unknown>>(streetManagementData ?? {});

  function collectionRecordTimestamp(record: CollectionStatusRecord | undefined): number {
    if (!record) return 0;
    return Math.max(
      toTimestamp(record.updatedAt),
      toTimestamp(record.managementUpdatedAt),
      toTimestamp(record.routeReleaseUpdatedAt),
      toTimestamp(record.supportNoteUpdatedAt),
      toTimestamp(record.contactTimeUpdatedAt),
      toTimestamp(record.routeUrgencyUpdatedAt),
      toTimestamp(record.whatsAppMessageCopiedAt),
      toTimestamp(record.whatsAppMessageSentAt),
      toTimestamp(record.paymentPromiseUpdatedAt)
    );
  }

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!dataOwnerUserId) { setInsuranceClaims([]); setCollisionCases([]); return; }
    let cancelled = false;
    Promise.all([loadInsuranceClaims(dataOwnerUserId), loadCollisionCases(dataOwnerUserId)])
      .then(([claims, collisions]) => {
        if (cancelled) return;
        setInsuranceClaims(claims);
        setCollisionCases(collisions);
      })
      .catch((error) => {
        console.error("No se pudieron cargar las acciones de siniestros en cuentas por cobrar.", error);
        if (!cancelled) { setInsuranceClaims([]); setCollisionCases([]); }
      });
    return () => { cancelled = true; };
  }, [dataOwnerUserId]);

  useEffect(() => {
    activeRouteItemsRef.current = activeRouteItems;
  }, [activeRouteItems]);

  const applyStreetManagementData = useCallback((rawData: Record<string, unknown>): void => {
    const parsed = parseCollectionStatusMapFromStorage(JSON.stringify(rawData ?? {}));
    optimisticStatusByClientRef.current = {};
    setCollectionStatusByClient((current) => {
      const next: Record<string, CollectionStatusRecord> = { ...parsed };
      for (const [clientId, currentRecord] of Object.entries(current)) {
        const incomingRecord = parsed[clientId];
        if (incomingRecord && collectionRecordTimestamp(currentRecord) > collectionRecordTimestamp(incomingRecord)) {
          next[clientId] = currentRecord;
        }
      }
      latestCollectionStatusByClientRef.current = next;
      lastStreetSnapshotRef.current = JSON.stringify(next);
      streetManagementLoadedRef.current = true;
      return next;
    });
  }, []);

  const applyStreetManagementItemPayload = useCallback((payload: unknown): void => {
    const event = payload && typeof payload === "object"
      ? payload as { eventType?: unknown; new?: unknown; old?: unknown }
      : null;
    const eventType = typeof event?.eventType === "string" ? event.eventType : "";
    const row = (eventType === "DELETE" ? event?.old : event?.new) as { client_id?: unknown; data?: unknown } | undefined;
    const clientId = typeof row?.client_id === "string" ? row.client_id : "";
    if (!clientId) return;
    setCollectionStatusByClient((current) => {
      const next: Record<string, CollectionStatusRecord> = clientId === "__clearedAt"
        ? {}
        : { ...current };
      if (clientId !== "__clearedAt") {
        if (eventType === "DELETE") {
          delete next[clientId];
        } else {
          const parsed = parseCollectionStatusMapFromStorage(JSON.stringify({ [clientId]: row?.data }));
          if (parsed[clientId]) {
            const currentRecord = current[clientId];
            next[clientId] = collectionRecordTimestamp(currentRecord) > collectionRecordTimestamp(parsed[clientId])
              ? currentRecord
              : parsed[clientId];
          }
          else delete next[clientId];
        }
      }
      delete optimisticStatusByClientRef.current[clientId];
      latestCollectionStatusByClientRef.current = next;
      lastStreetSnapshotRef.current = JSON.stringify(next);
      streetManagementLoadedRef.current = true;
      return next;
    });
  }, []);

  useEffect(() => {
    streetManagementDataRef.current = streetManagementData ?? {};
    if (!dataOwnerUserId) applyStreetManagementData(streetManagementDataRef.current);
  }, [applyStreetManagementData, dataOwnerUserId, streetManagementData]);

  useEffect(() => {
    streetManagementLoadedRef.current = false;
    streetPersistPendingRef.current = false;
    lastStreetSnapshotRef.current = "";
    setCollectionStatusByClient({});
  }, [dataOwnerUserId]);

  const loadStreetManagementFromCloud = useCallback(async (): Promise<void> => {
    if (!dataOwnerUserId) {
      applyStreetManagementData(streetManagementDataRef.current);
      return;
    }
    try {
      const cloudData = await loadCloudStreetManagement(dataOwnerUserId);
      applyStreetManagementData(cloudData);
    } catch (error) {
      console.error("No se pudo cargar gestion de cobranza desde nube.", error);
      applyStreetManagementData(streetManagementDataRef.current);
    }
  }, [applyStreetManagementData, dataOwnerUserId]);

  const loadActiveRouteFromCloud = useCallback(async (): Promise<void> => {
    if (!dataOwnerUserId) {
      setActiveRouteItems([]);
      activeRouteItemsRef.current = [];
      setActiveRouteLoading(false);
      setActiveRouteError("");
      return;
    }
    setActiveRouteLoading(true);
    setActiveRouteError("");
    try {
      const rows = await loadCloudActiveRouteItems(dataOwnerUserId);
      setActiveRouteItems(rows);
      activeRouteItemsRef.current = rows;
      setPublishedRouteAmountDraftByClient((current) => {
        const visibleClientIds = new Set(rows.map((item) => item.clientId));
        const next: Record<string, string> = {};
        for (const [clientId, draft] of Object.entries(current)) {
          if (visibleClientIds.has(clientId)) next[clientId] = draft;
        }
        return next;
      });
      setPublishedRouteCommentDraftByClient((current) => {
        const visibleClientIds = new Set(rows.map((item) => item.clientId));
        const next: Record<string, string> = {};
        for (const [clientId, draft] of Object.entries(current)) {
          if (visibleClientIds.has(clientId)) next[clientId] = draft;
        }
        return next;
      });
    } catch (error) {
      console.error("No se pudo cargar la ruta en calle.", error);
      setActiveRouteError("No se pudo cargar la Ruta en calle.");
    } finally {
      setActiveRouteLoading(false);
    }
  }, [dataOwnerUserId]);

  useEffect(() => {
    void loadStreetManagementFromCloud();
  }, [loadStreetManagementFromCloud]);

  useEffect(() => {
    void loadActiveRouteFromCloud();
  }, [loadActiveRouteFromCloud]);

  useEffect(() => {
    if (!dataOwnerUserId) return;
    function refreshWhenVisible(): void {
      if (document.visibilityState === "visible") void loadStreetManagementFromCloud();
    }
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [dataOwnerUserId, loadStreetManagementFromCloud]);

  useEffect(() => {
    if (!dataOwnerUserId) {
      setFleetUnits([]);
      return;
    }
    let cancelled = false;
    loadControlUnits(dataOwnerUserId)
      .then((rows) => {
        if (!cancelled) setFleetUnits(rows);
      })
      .catch((error) => {
        console.error("No se pudo cargar la flota para cuentas por cobrar.", error);
        if (!cancelled) setFleetUnits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId]);

  useEffect(() => {
    const serialized = JSON.stringify(collectionStatusByClient);
    latestCollectionStatusByClientRef.current = collectionStatusByClient;
    if (dataOwnerUserId && !streetManagementLoadedRef.current) return;
    if (serialized === lastStreetSnapshotRef.current) return;
    streetPersistPendingRef.current = true;

    if (persistStreetTimerRef.current) window.clearTimeout(persistStreetTimerRef.current);
    persistStreetTimerRef.current = null;
    void (async () => {
      const saveTokenSnapshot = { ...saveTokenByClientRef.current };
      const previousSnapshot = parseCollectionStatusMapFromStorage(lastStreetSnapshotRef.current);
      try {
        if (dataOwnerUserId) {
          await syncCloudStreetManagementDelta(
            dataOwnerUserId,
            previousSnapshot as Record<string, unknown>,
            collectionStatusByClient as Record<string, unknown>
          );
        } else if (onStreetManagementPersist) {
          const ok = await onStreetManagementPersist(collectionStatusByClient as Record<string, unknown>);
          if (ok === false) return;
        }
        lastStreetSnapshotRef.current = serialized;
      } catch (error) {
        console.error("No se pudo guardar la gestion de cobranza.", error);
        setCollectionCutMessage("No se pudo guardar la gestion de cobranza. Revisa la conexion e intenta nuevamente.");
      } finally {
        setStatusSavingByClient((current) => {
          const next = { ...current };
          for (const [clientId, token] of Object.entries(saveTokenSnapshot)) {
            if (saveTokenByClientRef.current[clientId] === token) next[clientId] = false;
          }
          return next;
        });
        streetPersistPendingRef.current = false;
      }
    })();
  }, [collectionStatusByClient, dataOwnerUserId, loadStreetManagementFromCloud, onStreetManagementPersist]);

  useEffect(() => {
    return () => {
      if (persistStreetTimerRef.current) window.clearTimeout(persistStreetTimerRef.current);
      if (streetPersistPendingRef.current) {
        const latestStatusByClient = latestCollectionStatusByClientRef.current;
        const previousSnapshot = parseCollectionStatusMapFromStorage(lastStreetSnapshotRef.current);
        lastStreetSnapshotRef.current = JSON.stringify(latestStatusByClient);
        if (dataOwnerUserId) {
          void syncCloudStreetManagementDelta(
            dataOwnerUserId,
            previousSnapshot as Record<string, unknown>,
            latestStatusByClient as Record<string, unknown>
          );
        } else if (onStreetManagementPersist) {
          void onStreetManagementPersist(latestStatusByClient as Record<string, unknown>);
        }
      }
    };
  }, [dataOwnerUserId, onStreetManagementPersist]);

  const loadCollectionClosuresFromCloud = useCallback(async (): Promise<void> => {
    if (!dataOwnerUserId) {
      setCollectionClosuresByDate({});
      setCollectionClosuresLoaded(false);
      return;
    }
    setIsCollectionClosuresLoading(true);
    try {
      const rows = await loadCloudCollectionClosures(dataOwnerUserId);
      setCollectionClosuresByDate(rows as CollectionClosuresByDate);
      setCollectionClosuresLoaded(true);
    } catch (error) {
      console.error("No se pudo cargar historial de cierres de cobranza.", error);
    } finally {
      setIsCollectionClosuresLoading(false);
    }
  }, [dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId) {
      setCollectionClosuresByDate({});
      setCollectionClosuresLoaded(false);
      return;
    }
    if (collectionClosuresLoaded) return;
    void loadCollectionClosuresFromCloud();
  }, [collectionClosuresLoaded, dataOwnerUserId, loadCollectionClosuresFromCloud]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase || !collectionClosuresLoaded) return;
    const client = supabase;
    const channel = client
      .channel(`collection-closures-live-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "collection_closures_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, (payload) => {
        const nextData = (payload.new as { data?: unknown } | null)?.data;
        if (nextData && typeof nextData === "object" && !Array.isArray(nextData)) {
          setCollectionClosuresByDate(nextData as CollectionClosuresByDate);
          setCollectionClosuresLoaded(true);
          return;
        }
        void loadCollectionClosuresFromCloud();
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [collectionClosuresLoaded, dataOwnerUserId, loadCollectionClosuresFromCloud]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    const channel = client
      .channel(`street-management-items-live-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "street_management_items_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, (payload) => {
        applyStreetManagementItemPayload(payload);
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [applyStreetManagementItemPayload, dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    const channel = client
      .channel(`active-route-items-live-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_route_items_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void loadActiveRouteFromCloud();
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId, loadActiveRouteFromCloud]);

  useEffect(() => {
    const historyDates = getCollectionClosureDateKeys(collectionClosuresByDate);
    if (historyDates.length === 0) {
      setSelectedHistoryDate("");
      return;
    }
    if (!selectedHistoryDate || !collectionClosuresByDate[selectedHistoryDate]) {
      setSelectedHistoryDate(historyDates[0]);
    }
  }, [collectionClosuresByDate, selectedHistoryDate]);

  const todayDateKey = useMemo(() => {
    const fallbackYear = now.getFullYear();
    const fallbackMonth = String(now.getMonth() + 1).padStart(2, "0");
    const fallbackDay = String(now.getDate()).padStart(2, "0");
    const fallback = `${fallbackYear}-${fallbackMonth}-${fallbackDay}`;
    return receivablesDateKey && /^\d{4}-\d{2}-\d{2}$/.test(receivablesDateKey) ? receivablesDateKey : fallback;
  }, [now, receivablesDateKey]);
  const receivablesDate = useMemo(() => dateFromDateKey(todayDateKey, now), [now, todayDateKey]);
  const receivablesDateLabel = useMemo(() => formatDate(receivablesDate), [receivablesDate]);
  const incidentActionsByUnit = useMemo(
    () => buildIncidentActionsByUnit(insuranceClaims, collisionCases, todayDateKey),
    [collisionCases, insuranceClaims, todayDateKey]
  );

  const receivablePayments = useMemo(() => {
    if (supplementalLastPayments.length === 0) return payments;
    const byId = new Map<string, Payment>();
    for (const payment of payments) byId.set(payment.id, payment);
    for (const payment of supplementalLastPayments) {
      if (!byId.has(payment.id)) byId.set(payment.id, payment);
    }
    return [...byId.values()];
  }, [payments, supplementalLastPayments]);

  const baseRows = useMemo(() => {
    if (clients.length === 0) return createMockReceivableRows(receivablesDate);
    return buildReceivableRows(clients, receivablePayments, receivablesDate, fleetUnits);
  }, [clients, fleetUnits, receivablePayments, receivablesDate]);

  useEffect(() => {
    setSupplementalLastPayments([]);
  }, [dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId || clients.length === 0) {
      setSupplementalLastPayments([]);
      return;
    }
    const lookupTargets = clients
      .filter((client) => client.status !== "archivado" && !client.archivedAt)
      .map((client) => ({
        clientId: client.id,
        unitId: client.unitId,
        name: client.name,
        cedula: client.cedula
      }));
    if (lookupTargets.length === 0) return;

    let cancelled = false;
    let retryTimer: number | null = null;
    let retryCount = 0;
    const loadLatestPayments = (): void => {
      void loadCloudLatestPaymentsForReceivableTargets(dataOwnerUserId, lookupTargets)
        .then((latestPayments) => {
          if (cancelled) return;
          setSupplementalLastPayments(latestPayments);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("No se pudieron completar los ultimos pagos para cuentas por cobrar.", error);
          if (retryCount >= 2) return;
          retryCount += 1;
          retryTimer = window.setTimeout(loadLatestPayments, 1_500 * retryCount);
        });
    };
    loadLatestPayments();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [clients, dataOwnerUserId, payments]);

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [collectionStatusFilter, filters, routeTagFilter, sortDirection, sortField, viewMode, whatsAppContactFilter, workflowTab]);

  const clientStatusById = useMemo(() => {
    const map = new Map<string, Client["status"]>();
    for (const client of clients) map.set(client.id, client.status);
    return map;
  }, [clients]);

  const availableGroups = useMemo(() => {
    const groups = Array.from(
      new Set(
        baseRows
          .map((row) => getGroupFromUnit(row.unitId))
          .filter((group) => group.length > 0)
      )
    );
    return groups.sort((a, b) => a.localeCompare(b));
  }, [baseRows]);

  const todayCollectionCuts: Partial<Record<CollectionCutKey, { items: CollectionClosureItem[] }>> = useMemo(() => ({}), []);
  const isTodayCollectionClosed = false;
  const isCollectionLocked = readOnly || isTodayCollectionClosed;

  useEffect(() => {
    const routeEntries = Object.entries(collectionStatusByClient).filter(([, record]) => (
      record.isRouteTagged === true &&
      typeof record.routeReleaseAmount === "number" &&
      record.routeReleaseAmount > 0
    ));
    if (routeEntries.length === 0) return;

    const releasedClientIds = new Set<string>();
    for (const [clientId, record] of routeEntries) {
      const releaseAmount = record.routeReleaseAmount ?? 0;
      const routeStartedValue = record.routeReleaseUpdatedAt ?? record.managementUpdatedAt ?? record.updatedAt;
      const routeStartedAt = toTimestamp(routeStartedValue);
      const routeDateKey = dateKeyFromTimestampValue(routeStartedValue);
      const hasReleasePayment = payments.some((payment) => (
        paymentReleasesRoute(payment, clientId, releaseAmount, routeStartedAt, routeDateKey)
      ));
      if (hasReleasePayment) releasedClientIds.add(clientId);
    }
    if (releasedClientIds.size === 0) return;

    let changedStatus = false;
    const nextStatusByClient = { ...collectionStatusByClient };
    for (const clientId of releasedClientIds) {
      const previous = nextStatusByClient[clientId];
      if (!previous || !previous.isRouteTagged) continue;
      const updatedRecord = buildPendingRouteRecord(previous, new Date().toISOString());
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      nextStatusByClient[clientId] = updatedRecord;
      changedStatus = true;
    }
    if (changedStatus) {
      setCollectionStatusByClient(nextStatusByClient);
      latestCollectionStatusByClientRef.current = nextStatusByClient;
      if (dataOwnerUserId) {
        for (const clientId of releasedClientIds) {
          void removeCloudActiveRouteItem(dataOwnerUserId, clientId, "paid").catch((error) => {
            console.error("No se pudo limpiar la Ruta en calle por pago.", error);
          });
        }
      }
    }
  }, [collectionStatusByClient, dataOwnerUserId, payments]);

  const filteredRows = useMemo(() => filterReceivableRows(baseRows, filters), [baseRows, filters]);
  const whatsAppGroupRowsByClient = useMemo(() => {
    const rowsByPhone = new Map<string, ReceivableRow[]>();
    const rowsByClient = new Map<string, ReceivableRow[]>();
    for (const row of baseRows) {
      const phone = normalizeWhatsAppPhoneForFilter(row.whatsAppPhone);
      if (!phone || !hasPendingRentForWhatsApp(row)) continue;
      const phoneRows = rowsByPhone.get(phone) ?? [];
      phoneRows.push(row);
      rowsByPhone.set(phone, phoneRows);
    }
    for (const groupRows of rowsByPhone.values()) {
      const sortedGroupRows = sortReceivableRows(groupRows, "unitId", "asc");
      for (const row of sortedGroupRows) rowsByClient.set(row.id, sortedGroupRows);
    }
    return rowsByClient;
  }, [baseRows]);
  const statementGroupRowsByClient = useMemo(() => {
    const eligibleRows = baseRows.filter((row) => row.hasActiveClient);
    const rowsByIdentity = new Map<string, ReceivableRow[]>();
    const rowsByClient = new Map<string, ReceivableRow[]>();
    for (const row of eligibleRows) {
      const cedula = statementCedulaKey(row);
      const phone = normalizeWhatsAppPhoneForFilter(row.whatsAppPhone);
      const identity = phone
        ? `phone:${phone}`
        : cedula
          ? `cedula:${cedula}`
          : `client:${row.id}`;
      const identityRows = rowsByIdentity.get(identity) ?? [];
      identityRows.push(row);
      rowsByIdentity.set(identity, identityRows);
    }
    for (const groupRows of rowsByIdentity.values()) {
      const sortedGroupRows = sortReceivableRows(groupRows, "unitId", "asc");
      for (const row of sortedGroupRows) rowsByClient.set(row.id, sortedGroupRows);
    }
    return rowsByClient;
  }, [baseRows]);
  const activeRouteEligibleClientIds = useMemo(
    () => new Set(baseRows.filter((row) => hasActiveOperationalClient(row)).map((row) => row.id)),
    [baseRows]
  );
  const activeVisibleRouteItems = useMemo(() => (
    activeRouteItems
      .filter((item) => !item.removedAt)
      .filter((item) => activeRouteEligibleClientIds.has(item.clientId))
      .filter((item) => !activeRouteItemReleasedByPayment(item, payments))
      .sort(compareActiveRouteItems)
  ), [activeRouteEligibleClientIds, activeRouteItems, payments]);
  const removedRouteClientIds = useMemo(
    () => new Set(activeRouteItems.filter((item) => !!item.removedAt).map((item) => item.clientId)),
    [activeRouteItems]
  );
  const removedRouteItemByClient = useMemo(() => (
    new Map(activeRouteItems
      .filter((item) => !!item.removedAt)
      .map((item) => [item.clientId, item] as const))
  ), [activeRouteItems]);
  const blockingRemovedRouteClientIds = useMemo(() => (
    new Set(Array.from(removedRouteItemByClient.entries())
      .filter(([clientId, item]) => routeRemovalBlocksRecord(collectionStatusByClient[clientId], item))
      .map(([clientId]) => clientId))
  ), [collectionStatusByClient, removedRouteItemByClient]);
  const inactiveVisibleRouteItems = useMemo(() => (
    activeRouteItems.filter((item) => {
      if (item.removedAt) return false;
      const row = baseRows.find((candidate) => candidate.id === item.clientId);
      // La ausencia temporal de la fila durante una recarga no confirma que la
      // unidad este inactiva. Solo se desmonta con una fila cargada y no elegible.
      return !!row && !hasActiveOperationalClient(row);
    })
  ), [activeRouteItems, baseRows]);
  const activeRouteFilterOptions = useMemo(() => (
    Array.from(new Set(activeVisibleRouteItems.map((item) => activeRouteFilterValue(item.routeAssignment))))
      .sort(compareActiveRouteFilterValues)
  ), [activeVisibleRouteItems]);
  useEffect(() => {
    if (activeRouteFilter !== ALL_ACTIVE_ROUTE_FILTER && !activeRouteFilterOptions.includes(activeRouteFilter)) {
      setActiveRouteFilter(ALL_ACTIVE_ROUTE_FILTER);
    }
  }, [activeRouteFilter, activeRouteFilterOptions]);
  const activeFilteredRouteItems = useMemo(() => {
    const normalizedQuery = activeRouteSearchQuery.trim().toLowerCase();
    return activeVisibleRouteItems
      .filter((item) => (
        activeRouteFilter === ALL_ACTIVE_ROUTE_FILTER ||
        activeRouteFilterValue(item.routeAssignment) === activeRouteFilter
      ))
      .filter((item) => {
        if (!normalizedQuery) return true;
        return [
          item.unitId,
          item.clientName,
          item.clientCedula ?? "",
          item.whatsAppPhone ?? "",
          item.routeAssignment ?? "",
          item.comment ?? ""
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      });
  }, [activeRouteFilter, activeRouteSearchQuery, activeVisibleRouteItems]);
  const activeVisibleRouteClientIds = useMemo(
    () => new Set(activeVisibleRouteItems.map((item) => item.clientId)),
    [activeVisibleRouteItems]
  );
  useEffect(() => {
    if (inactiveVisibleRouteItems.length === 0) return;
    const removedAt = new Date().toISOString();
    const inactiveClientIds = new Set(inactiveVisibleRouteItems.map((item) => item.clientId));
    const nextActiveRouteItems: ActiveRouteItem[] = activeRouteItemsRef.current.map((item) => (
      inactiveClientIds.has(item.clientId)
        ? { ...item, removedAt, removedReason: "inactive" }
        : item
    ));
    activeRouteItemsRef.current = nextActiveRouteItems;
    setActiveRouteItems(nextActiveRouteItems);
    if (!readOnly) {
      setCollectionStatusByClient((current) => {
        const next = { ...current };
        let changedStatus = false;
        for (const clientId of inactiveClientIds) {
          const previous = next[clientId];
          if (!isRouteManagementRecord(previous)) continue;
          const updatedRecord = buildPendingRouteRecord(previous, removedAt);
          next[clientId] = updatedRecord;
          optimisticStatusByClientRef.current[clientId] = updatedRecord;
          markClientStatusAsSaving(clientId);
          changedStatus = true;
        }
        return changedStatus ? next : current;
      });
    }
    if (!dataOwnerUserId) return;
    for (const clientId of inactiveClientIds) {
      void removeCloudActiveRouteItem(dataOwnerUserId, clientId, "inactive").catch((error) => {
        console.error("No se pudo sacar de la Ruta en calle por estado inactivo.", error);
      });
    }
  }, [dataOwnerUserId, inactiveVisibleRouteItems, readOnly]);
  useEffect(() => {
    if (removedRouteClientIds.size === 0 || isCollectionLocked) return;
    const nowIso = new Date().toISOString();
    let changedStatus = false;
    setCollectionStatusByClient((current) => {
      const next = { ...current };
      for (const clientId of removedRouteClientIds) {
        const previous = next[clientId];
        if (!isRouteManagementRecord(previous)) continue;
        const removedItem = removedRouteItemByClient.get(clientId);
        if (!routeRemovalBlocksRecord(previous, removedItem)) continue;
        const updatedRecord = buildPendingRouteRecord(previous, nowIso);
        next[clientId] = updatedRecord;
        optimisticStatusByClientRef.current[clientId] = updatedRecord;
        markClientStatusAsSaving(clientId);
        changedStatus = true;
      }
      return changedStatus ? next : current;
    });
  }, [collectionStatusByClient, isCollectionLocked, removedRouteClientIds, removedRouteItemByClient]);
  const routeWorkflowRowsCount = useMemo(
    () => baseRows.filter((row) => isRouteReadyToSendRow(row)).length,
    [activeVisibleRouteClientIds, baseRows, blockingRemovedRouteClientIds, collectionStatusByClient, incidentActionsByUnit, todayCollectionCuts]
  );
  const canDownloadPublishedRoute = publishedRouteDownload !== null && routeWorkflowRowsCount === 0;
  const publishedRouteAddRows = useMemo(
    () => baseRows.filter((row) => hasActiveOperationalClient(row) && !hasBlockingIncidentAction(row) && !activeVisibleRouteClientIds.has(row.id)),
    [activeVisibleRouteClientIds, baseRows, incidentActionsByUnit]
  );
  const publishedRouteDraftSelectedRow = useMemo(
    () => baseRows.find((row) => row.id === publishedRouteDraft.clientId),
    [baseRows, publishedRouteDraft.clientId]
  );
  const publishedRouteSuggestedReleaseAmount = publishedRouteDraftSelectedRow?.overdueBalance && publishedRouteDraftSelectedRow.overdueBalance > 0
    ? publishedRouteDraftSelectedRow.overdueBalance
    : 0;
  const canSavePublishedRouteDraft = !!publishedRouteDraftSelectedRow && !!parsePositiveMoneyInput(publishedRouteDraft.amount);
  const managementWorkflowRowsCount = baseRows.length;
  const clearableManagementRecordsCount = Object.keys(collectionStatusByClient).length;
  const canConfirmClearManagement = clearManagementConfirmation.trim().toUpperCase() === CLEAR_COLLECTION_MANAGEMENT_CONFIRMATION;
  const workflowRows = useMemo(() => (
    workflowTab === "route"
      ? filteredRows.filter((row) => isRouteReadyToSendRow(row))
      : filteredRows
  ), [activeVisibleRouteClientIds, blockingRemovedRouteClientIds, filteredRows, workflowTab, collectionStatusByClient, todayCollectionCuts]);
  const collectionStatusCounts = useMemo(() => {
    const counts = createEmptyCollectionStatusCounts();
    for (const row of workflowRows) {
      const status = getWorkflowStatus(row) || "unassigned";
      counts[status] += 1;
    }
    return counts;
  }, [workflowRows, collectionStatusByClient, todayCollectionCuts]);
  const routeTaggedManagementCount = workflowTab === "management"
    ? workflowRows.filter((row) => activeVisibleRouteClientIds.has(row.id)).length
    : 0;
  const routePendingCount = collectionStatusCounts.pending;
  const managementAlertCount = workflowTab === "route"
    ? routePendingCount
    : collectionStatusFilter === "covered"
    ? collectionStatusCounts.covered
    : collectionStatusCounts.pending;
  const managementAlertText = workflowTab === "route"
    ? `${managementAlertCount} cobro${managementAlertCount === 1 ? "" : "s"} en ruta activo${managementAlertCount === 1 ? "" : "s"}`
    : collectionStatusFilter === "covered"
    ? `${managementAlertCount} gestion${managementAlertCount === 1 ? "" : "es"} cubierta${managementAlertCount === 1 ? "" : "s"}`
    : `${managementAlertCount} gestion${managementAlertCount === 1 ? "" : "es"} pendiente${managementAlertCount === 1 ? "" : "s"}`;
  const collectionStatusFilterOptions = workflowTab === "route" ? ROUTE_COLLECTION_STATUS_OPTIONS : DAILY_COLLECTION_STATUS_OPTIONS;
  const collectionStatusFilterHelp = collectionStatusFilter === "all"
    ? "Muestra todos los estados de gestion."
    : collectionStatusFilterOptions.find((option) => option.value === collectionStatusFilter)?.description ?? COLLECTION_STATUS_HELP[collectionStatusFilter];
  const filteredByCollectionStatusRows = useMemo(() => {
    const statusRows = collectionStatusFilter === "all"
      ? workflowRows
      : workflowRows.filter((row) => getWorkflowStatus(row) === collectionStatusFilter);
    if (workflowTab !== "management") return statusRows;
    if (routeReadyFilter) return statusRows.filter((row) => isRouteReadyToSendRow(row));
    if (routeTagFilter) return statusRows.filter((row) => activeVisibleRouteClientIds.has(row.id));
    return statusRows;
  }, [activeVisibleRouteClientIds, collectionStatusFilter, routeReadyFilter, routeTagFilter, workflowRows, collectionStatusByClient, now, todayCollectionCuts, workflowTab]);
  const whatsAppContactCounts = useMemo(() => {
    const counts: Record<WhatsAppContactFilter, number> = {
      all: filteredByCollectionStatusRows.length,
      pending: 0,
      ready: 0,
      sent: 0,
      idle: 0
    };
    for (const row of filteredByCollectionStatusRows) {
      const status = getWhatsAppContactStatus(row, collectionStatusByClient[row.id], now);
      counts[status] += 1;
      if (status === "ready") counts.pending += 1;
    }
    return counts;
  }, [collectionStatusByClient, filteredByCollectionStatusRows, now]);
  const whatsAppAlertCount = whatsAppContactFilter === "sent"
    ? whatsAppContactCounts.sent
    : whatsAppContactFilter === "idle"
    ? whatsAppContactCounts.idle
    : whatsAppContactCounts.pending;
  const whatsAppAlertText = whatsAppContactFilter === "sent"
    ? `${whatsAppAlertCount} enviado${whatsAppAlertCount === 1 ? "" : "s"}`
    : whatsAppContactFilter === "idle"
    ? `${whatsAppAlertCount} sin sugerencia`
    : `${whatsAppAlertCount} sugerido${whatsAppAlertCount === 1 ? "" : "s"}`;
  const filteredByWhatsAppRows = useMemo(() => {
    if (whatsAppContactFilter === "all") return filteredByCollectionStatusRows;
    if (whatsAppContactFilter === "pending") {
      return filteredByCollectionStatusRows.filter((row) => (
        getWhatsAppContactStatus(row, collectionStatusByClient[row.id], now) === "ready"
      ));
    }
    return filteredByCollectionStatusRows.filter((row) => (
      getWhatsAppContactStatus(row, collectionStatusByClient[row.id], now) === whatsAppContactFilter
    ));
  }, [collectionStatusByClient, filteredByCollectionStatusRows, now, whatsAppContactFilter]);

  function contactTimeMinutes(row: ReceivableRow): number {
    if (getEffectiveStatus(row) !== "pending") return Number.POSITIVE_INFINITY;
    const time = collectionStatusByClient[row.id]?.contactTime;
    if (!time) return Number.POSITIVE_INFINITY;
    const match = time.match(/^(\d{1,2}):(\d{2})\s(AM|PM)$/);
    if (!match) return Number.POSITIVE_INFINITY;
    const hour12 = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour12) || !Number.isFinite(minute)) return Number.POSITIVE_INFINITY;
    const hour24 = (hour12 % 12) + (match[3] === "PM" ? 12 : 0);
    return hour24 * 60 + minute;
  }

  const sortedRows = useMemo(() => {
    const naturalRows = sortReceivableRows(filteredByWhatsAppRows, sortField, sortDirection);
    if (!prioritizeContactTime) return naturalRows;
    return [...naturalRows].sort((a, b) => {
      const timeDiff = contactTimeMinutes(a) - contactTimeMinutes(b);
      if (timeDiff !== 0) return timeDiff;
      return a.unitId.localeCompare(b.unitId, undefined, { numeric: true });
    });
  }, [collectionStatusByClient, filteredByWhatsAppRows, prioritizeContactTime, sortDirection, sortField]);
  const rows = sortedRows;
  const selectedHistoryCuts = useMemo(
    () => selectedHistoryDate ? getCollectionClosureCuts(collectionClosuresByDate[selectedHistoryDate]) : {},
    [collectionClosuresByDate, selectedHistoryDate]
  );
  const selectedHistoryRows = useMemo(() => {
    const rowsByClient = new Map<string, ReceivablesHistoryRow>();
    for (const option of COLLECTION_CUT_OPTIONS) {
      const closure = selectedHistoryCuts[option.key];
      if (!closure) continue;
      for (const item of closure.items) {
        const existing = rowsByClient.get(item.clientId);
        if (existing) {
          existing.cuts[option.key] = item;
          continue;
        }
        rowsByClient.set(item.clientId, {
          clientId: item.clientId,
          unitId: item.unitId,
          clientName: item.clientName,
          lastPaymentDate: item.lastPaymentDate,
          lastPaymentAt: item.lastPaymentAt,
          receivableState: item.receivableState,
          totalPending: item.totalPending,
          cuts: { [option.key]: item }
        });
      }
    }
    return Array.from(rowsByClient.values()).sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }));
  }, [selectedHistoryCuts]);
  const closureBlockers = useMemo(() => {
    const pendingManagementRows = baseRows.filter((row) => {
      const status = getEffectiveStatus(row);
      return status === "unassigned";
    });
    const pendingWhatsAppRows: ReceivableRow[] = [];
    return {
      pendingManagementRows,
      pendingWhatsAppRows
    };
  }, [baseRows, collectionStatusByClient, todayCollectionCuts]);

  function getEffectiveStatusFromMap(
    row: ReceivableRow,
    statusByClient: Record<string, CollectionStatusRecord>
  ): CollectionStatus | "" {
    const dailyStatus = getCutItemForClient("night", row.id)?.collectionStatus;
    if (statusByClient[row.id]?.isRouteTagged) return "pending";
    if (dailyStatus) return dailyStatus;
    const stored = statusByClient[row.id]?.status;
    if (stored === "unassigned" || stored === "pending" || stored === "contacted" || stored === "covered") return stored;
    if (stored === "paid") return "covered";
    if (stored === "route" || stored === "route_collection" || stored === "route_not_sent") return "pending";
    if (shouldDefaultToCovered(row)) return "covered";
    return "unassigned";
  }

  function buildClosureBlockersForStatus(statusByClient: Record<string, CollectionStatusRecord>) {
    const pendingManagementRows = baseRows.filter((row) => {
      const status = getEffectiveStatusFromMap(row, statusByClient);
      return status === "unassigned";
    });
    const pendingWhatsAppRows: ReceivableRow[] = [];
    return { pendingManagementRows, pendingWhatsAppRows };
  }
  function updateFilter<K extends keyof ReceivableFilters>(key: K, value: ReceivableFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleStateFilterToggle(value: ReceivableState | "all") {
    if (value === "all") {
      updateFilter("state", []);
      return;
    }
    const current = filters.state;
    if (current.includes(value)) {
      updateFilter(
        "state",
        current.filter((item) => item !== value)
      );
      return;
    }
    updateFilter("state", [...current, value]);
  }

  function clearFilters() {
    setFilters(DEFAULT_RECEIVABLE_FILTERS);
    setCollectionStatusFilter("all");
    setRouteTagFilter(false);
    setWhatsAppContactFilter("all");
    setMobileFiltersOpen(false);
  }

  function handleSort(field: ReceivableSortField) {
    if (sortField === field) return setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    setSortField(field);
    setSortDirection("asc");
  }

  function hasPaymentToday(row: ReceivableRow): boolean {
    if (!row.lastPaymentDate) return false;
    return isToday(new Date(`${row.lastPaymentDate}T12:00:00`), now);
  }

  function hasAutoPaidStatus(row: ReceivableRow): boolean {
    return row.state === "alDia" || hasPaymentToday(row);
  }

  function hasBlockingIncidentAction(row: ReceivableRow): boolean {
    return incidentActionsByUnit[row.unitId.trim().toUpperCase()]?.urgent === true;
  }

  function clientHasBlockingIncidentAction(clientId: string): boolean {
    const row = baseRows.find((item) => item.id === clientId);
    return row ? hasBlockingIncidentAction(row) : false;
  }

  function hasRouteCollection(row: ReceivableRow): boolean {
    const management = collectionStatusByClient[row.id];
    if (!management) return false;
    const hasType = management.managementType === "solo_cobrar" || management.managementType === "cobrar_o_quitar" || management.managementType === "desiste" || management.managementType === "quitar";
    return hasType && !!management.managementAmount && management.managementAmount > 0;
  }

  function isNightRouteCollection(row: ReceivableRow): boolean {
    return collectionStatusByClient[row.id]?.isRouteTagged === true;
  }

  function isRouteWorkflowRow(row: ReceivableRow): boolean {
    const record = collectionStatusByClient[row.id];
    return record?.isRouteTagged === true;
  }

  function isRouteReadyToSendRow(row: ReceivableRow): boolean {
    return hasActiveOperationalClient(row)
      && !hasBlockingIncidentAction(row)
      && isRouteWorkflowRow(row)
      && !activeVisibleRouteClientIds.has(row.id)
      && !blockingRemovedRouteClientIds.has(row.id);
  }

  function buildWhatsAppReceivableMessage(row: ReceivableRow): string {
    const groupedRows = whatsAppGroupRowsByClient.get(row.id) ?? [row];
    if (groupedRows.length > 1) return buildWhatsAppReceivableGroupMessage(groupedRows);

    const today = formatDateForTitle(now);
    const firstName = row.name.trim().split(/\s+/)[0] || row.name;
    const lastPayment = row.lastPaymentDate
      ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`))
      : "Sin pagos registrados";
    const totalPending = Math.max(0, row.totalPending);
    const overdueAmount = overdueRentForWhatsAppDate(row, now);
    const currentAmount = currentRentForWhatsApp(row, now);
    const hasOverdue = overdueAmount > 0;
    const hasCurrent = currentAmount > 0;
    const planLabel = PLAN_LABEL[row.plan]?.toLowerCase() ?? "plan";
    const currentPeriodLabel: Record<ReceivableRow["plan"], string> = {
      daily: "del dia de hoy",
      weekly: "de la semana actual",
      biweekly: "de la quincena actual",
      monthly: "del mes actual"
    };
    function installmentText(amount: number, statusLabel: string): string {
      const installments = row.rentAmount > 0 ? Math.ceil(amount / row.rentAmount) : 0;
      if (installments <= 0) return "";
      return `${installments} cuota${installments === 1 ? "" : "s"} ${planLabel}${statusLabel ? ` ${statusLabel}` : ""}`;
    }
    const mixedInstallmentsText = [
      installmentText(overdueAmount, "vencida"),
      installmentText(currentAmount, "corriente")
    ].filter(Boolean).join(" + ");

    const detailParts = [
      installmentText(overdueAmount, "vencida")
    ].filter(Boolean);
    const installmentsText = detailParts.length > 0
      ? detailParts.join(" + ")
      : "Sin cuotas pendientes";
    const message = [
      `Hola, ${firstName}.`,
      "",
      hasOverdue && hasCurrent
        ? `Le escribimos para recordarle que mantiene saldo pendiente al ${today}.`
        : hasCurrent
          ? `Le escribimos sobre el saldo corriente ${currentPeriodLabel[row.plan]}: ${formatCurrency(currentAmount)}.`
          : `Le escribimos para recordarle que tiene renta vencida al ${today}.`,
      "",
      ...(hasOverdue && hasCurrent
        ? [
            `Total pendiente: ${formatCurrency(totalPending)}.`,
            `Detalle: ${mixedInstallmentsText || "incluye renta vencida y saldo corriente"}.`
          ]
        : hasCurrent
          ? [
              `Detalle: ${installmentText(currentAmount, "corriente") || installmentsText}.`
            ]
          : [
              `Renta vencida: ${formatCurrency(overdueAmount)}.`,
              `Ultimo pago registrado: ${lastPayment}.`,
              `Detalle: ${installmentsText}.`
            ]),
      "",
      hasCurrent && !hasOverdue
        ? "Por favor, realice el pago durante el periodo correspondiente."
        : "Agradecemos pueda realizar el pago pronto.",
      "",
      "Gracias."
    ].join("\n");
    return message;
  }

  function buildWhatsAppReceivableGroupMessage(groupRows: ReceivableRow[]): string {
    const today = formatDateForTitle(now);
    const primaryRow = groupRows[0];
    const firstName = primaryRow.name.trim().split(/\s+/)[0] || primaryRow.name;
    const totalOverdueRent = groupRows.reduce((sum, item) => sum + overdueRentForWhatsAppDate(item, now), 0);
    const totalCurrentRent = groupRows.reduce((sum, item) => sum + currentRentForWhatsApp(item, now), 0);
    const totalPendingRent = groupRows.reduce((sum, item) => sum + Math.max(0, item.totalPending), 0);
    const totalOverdueInstallments = groupRows.reduce((sum, item) => {
      const amount = overdueRentForWhatsAppDate(item, now);
      return sum + (item.rentAmount > 0 ? Math.ceil(amount / item.rentAmount) : 0);
    }, 0);
    const totalCurrentInstallments = groupRows.reduce((sum, item) => {
      const amount = currentRentForWhatsApp(item, now);
      return sum + (item.rentAmount > 0 ? Math.ceil(amount / item.rentAmount) : 0);
    }, 0);
    const hasOverdue = totalOverdueRent > 0;
    const hasCurrent = totalCurrentRent > 0;
    const mixedGroupDetail = [
      totalOverdueInstallments > 0 ? `${totalOverdueInstallments} cuota${totalOverdueInstallments === 1 ? "" : "s"} vencida${totalOverdueInstallments === 1 ? "" : "s"}` : "",
      totalCurrentInstallments > 0 ? `${totalCurrentInstallments} cuota${totalCurrentInstallments === 1 ? "" : "s"} corriente${totalCurrentInstallments === 1 ? "" : "s"}` : ""
    ].filter(Boolean).join(" + ");
    const unitBlocks = groupRows.map((item) => {
      const amount = hasCurrent ? Math.max(0, item.totalPending) : overdueRentForWhatsAppDate(item, now);
      return `Unidad ${item.unitId}: ${formatCurrency(amount)}`;
    });

    return [
      `Hola, ${firstName}.`,
      "",
      hasOverdue && hasCurrent
        ? `Le escribimos para recordarle que mantiene saldo pendiente al ${today}:`
        : hasCurrent
          ? "Le escribimos sobre el saldo corriente del dia de hoy:"
          : `Le escribimos para recordarle que tiene renta vencida al ${today}:`,
      unitBlocks.join("\n"),
      hasCurrent
        ? `Total pendiente: ${formatCurrency(totalPendingRent)}.`
        : `Total renta vencida: ${formatCurrency(totalOverdueRent)}.`,
      ...(hasOverdue && hasCurrent ? [`Detalle: ${mixedGroupDetail || "incluye renta vencida y saldo corriente"}.`] : []),
      "",
      hasCurrent && !hasOverdue
        ? "Por favor, realice el pago durante el periodo correspondiente."
        : "Agradecemos pueda realizar el pago pronto.",
      "",
      "Gracias."
    ].join("\n");
  }

  function getWhatsAppGroupRows(row: ReceivableRow): ReceivableRow[] {
    return whatsAppGroupRowsByClient.get(row.id) ?? [row];
  }

  function getStatementGroupRows(row: ReceivableRow): ReceivableRow[] {
    return statementGroupRowsByClient.get(row.id) ?? [row];
  }

  function getEffectiveStatus(row: ReceivableRow): CollectionStatus | "" {
    const dailyStatus = getCutItemForClient("night", row.id)?.collectionStatus;
    if (collectionStatusByClient[row.id]?.isRouteTagged) return "pending";
    if (dailyStatus) return dailyStatus;
    const stored = collectionStatusByClient[row.id]?.status;
    if (stored === "unassigned" || stored === "pending" || stored === "contacted" || stored === "covered") return stored;
    if (stored === "paid") return "covered";
    if (stored === "route" || stored === "route_collection" || stored === "route_not_sent") return "pending";
    if (shouldDefaultToCovered(row)) return "covered";
    return "unassigned";
  }

  function getWorkflowStatus(row: ReceivableRow): CollectionStatus | "" {
    if (workflowTab === "route" && collectionStatusByClient[row.id]?.isRouteTagged) return "pending";
    return getEffectiveStatus(row);
  }

  function getCutItemForClient(cutKey: CollectionCutKey, clientId: string): CollectionClosureItem | undefined {
    return todayCollectionCuts[cutKey]?.items.find((item) => item.clientId === clientId);
  }

  function isTerminalForCut(cutKey: CollectionCutKey, status: CollectionStatus): boolean {
    if (status === "covered") return true;
    if (cutKey === "morning") return status === "reminder" || status === "paid";
    if (cutKey === "afternoon") return status === "paid";
    return status === "route" || status === "route_collection" || status === "route_not_sent";
  }

  function isRowEligibleForCut(row: ReceivableRow, cutKey: CollectionCutKey): boolean {
    if (cutKey === "morning") return true;
    const morningItem = getCutItemForClient("morning", row.id);
    if (morningItem && isTerminalForCut("morning", morningItem.collectionStatus)) return false;
    if (cutKey === "afternoon") return true;
    const afternoonItem = getCutItemForClient("afternoon", row.id);
    if (afternoonItem && isTerminalForCut("afternoon", afternoonItem.collectionStatus)) return false;
    return true;
  }

  function handleSupportNoteChange(clientId: string, value: string): void {
    if (isCollectionLocked || clientHasBlockingIncidentAction(clientId)) return;
    markClientStatusAsSaving(clientId);
    const note = normalizeSupportNote(value);
    const nowIso = new Date().toISOString();
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: previous?.status ?? "unassigned",
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: previous?.managementType,
        managementAmount: previous?.managementAmount,
        managementComment: previous?.managementComment,
        managementUpdatedAt: previous?.managementUpdatedAt,
        routeReleaseAmount: previous?.routeReleaseAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        routeAssignment: previous?.routeAssignment,
        routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: note,
        supportNoteUpdatedAt: nowIso,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  function handleContactTimeChange(clientId: string, value: string): void {
    if (isCollectionLocked || clientHasBlockingIncidentAction(clientId)) return;
    markClientStatusAsSaving(clientId);
    const contactTime = normalizeContactTime(value);
    const nowIso = new Date().toISOString();
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: previous?.status ?? "unassigned",
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        contactTime,
        contactTimeUpdatedAt: nowIso
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  function computeCutTotals(items: CollectionClosureItem[]): Record<CollectionStatus, number> {
    const totals = createEmptyCollectionStatusCounts();
    for (const item of items) totals[item.collectionStatus] += 1;
    return totals;
  }

  async function clearLiveCollectionStatusAfterClosure(): Promise<void> {
    if (readOnly) throw new Error("El usuario no tiene permiso para editar cuentas por cobrar.");
    const nowIso = new Date().toISOString();
    const activeRouteStatus: Record<string, CollectionStatusRecord> = {};
    for (const [clientId, record] of Object.entries(collectionStatusByClient)) {
      if (!record.isRouteTagged) continue;
      activeRouteStatus[clientId] = {
        ...record,
        status: "pending",
        isRouteTagged: true,
        routeTaggedAt: record.routeTaggedAt ?? record.updatedAt ?? nowIso,
        updatedAt: nowIso
      };
    }
    for (const item of activeVisibleRouteItems) {
      activeRouteStatus[item.clientId] = buildManagementRecordFromActiveRouteItem(
        item,
        collectionStatusByClient[item.clientId],
        nowIso
      );
    }
    const nextStatusByClient = activeRouteStatus;
    if (persistStreetTimerRef.current) {
      window.clearTimeout(persistStreetTimerRef.current);
      persistStreetTimerRef.current = null;
    }
    optimisticStatusByClientRef.current = { ...nextStatusByClient };
    saveTokenByClientRef.current = {};
    latestCollectionStatusByClientRef.current = nextStatusByClient;
    lastStreetSnapshotRef.current = JSON.stringify(nextStatusByClient);
    streetPersistPendingRef.current = false;
    setStatusSavingByClient({});
    setCollectionStatusByClient(nextStatusByClient);
    if (dataOwnerUserId) {
      await saveCloudStreetManagement(dataOwnerUserId, nextStatusByClient as Record<string, unknown>);
      const cloudData = await loadCloudStreetManagement(dataOwnerUserId);
      const remaining = Object.keys(parseCollectionStatusMapFromStorage(JSON.stringify(cloudData)));
      if (remaining.length !== Object.keys(nextStatusByClient).length) {
        throw new Error(`La gestion no quedo alineada con Ruta en calle (${remaining.length} registro(s)).`);
      }
    } else if (onStreetManagementPersist) {
      const ok = await onStreetManagementPersist(nextStatusByClient as Record<string, unknown>);
      if (ok === false) throw new Error("No se pudieron limpiar los estados vivos de cobranza.");
    }
  }

  async function handleClearCollectionManagement(): Promise<void> {
    if (!canConfirmClearManagement) return;
    setCollectionCutMessage(null);
    setExportError(null);
    setIsClearingCollectionManagement(true);
    try {
      await clearLiveCollectionStatusAfterClosure();
      setCollectionStatusFilter("all");
      setWhatsAppContactFilter("all");
      setFieldManagementModalClientId(null);
      setIsRouteExportMenuOpen(false);
      setIsClearManagementConfirmOpen(false);
      setClearManagementConfirmation("");
      setCollectionCutMessage("Gestion limpiada. La Ruta en calle se mantuvo activa en gestion.");
    } catch (error) {
      console.error("No se pudo limpiar la gestion de cobranza.", error);
      setCollectionCutMessage("No se pudo limpiar la gestion de cobranza.");
    } finally {
      setIsClearingCollectionManagement(false);
    }
  }

  function cancelClearCollectionManagement(): void {
    if (isClearingCollectionManagement) return;
    setIsClearManagementConfirmOpen(false);
    setClearManagementConfirmation("");
  }

  function applyCollectionCutStatus(clientId: string, nextStatus: CollectionStatus, contactTime?: string): void {
    if (isCollectionLocked || clientHasBlockingIncidentAction(clientId)) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const normalizedStatus: CollectionStatus = previous?.isRouteTagged ? "pending" : nextStatus;
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: normalizedStatus,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: previous?.isRouteTagged ? previous.managementType : undefined,
        managementAmount: previous?.isRouteTagged ? previous.managementAmount : undefined,
        managementComment: previous?.isRouteTagged ? previous.managementComment : "",
        managementUpdatedAt: previous?.isRouteTagged ? previous.managementUpdatedAt : undefined,
        routeReleaseAmount: previous?.isRouteTagged ? previous.routeReleaseAmount : undefined,
        routeReleaseUpdatedAt: previous?.isRouteTagged ? previous.routeReleaseUpdatedAt : undefined,
        routeAssignment: previous?.isRouteTagged ? previous.routeAssignment : undefined,
        routeAssignmentUpdatedAt: previous?.isRouteTagged ? previous.routeAssignmentUpdatedAt : undefined,
        routeUrgency: previous?.isRouteTagged ? previous.routeUrgency : undefined,
        routeUrgencyUpdatedAt: previous?.isRouteTagged ? previous.routeUrgencyUpdatedAt : undefined,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        contactTime: normalizedStatus === "pending" ? contactTime ?? previous?.contactTime : previous?.contactTime,
        contactTimeUpdatedAt: normalizedStatus === "pending" && contactTime ? nowIso : previous?.contactTimeUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  function handleCollectionCutStatusChange(cutKey: CollectionCutKey, clientId: string, nextStatus: string): void {
    if (isCollectionLocked || clientHasBlockingIncidentAction(clientId) || cutKey !== "night") return;
    if (collectionStatusByClient[clientId]?.isRouteTagged && nextStatus !== "pending") return;
    if (nextStatus === "pending") {
      setPendingContactPrompt({ clientId, step: "question", selectedTime: "" });
      return;
    }
    applyCollectionCutStatus(clientId, nextStatus as CollectionStatus);
  }

  function leavePendingWithoutContactTime(): void {
    if (!pendingContactPrompt) return;
    applyCollectionCutStatus(pendingContactPrompt.clientId, "pending");
    setPendingContactPrompt(null);
  }

  function openPendingContactTimeSelection(): void {
    if (!pendingContactPrompt) return;
    const firstAvailableTime = getFutureContactTimeOptions(new Date())[0] ?? "";
    setPendingContactPrompt({ ...pendingContactPrompt, step: "time", selectedTime: firstAvailableTime });
  }

  function confirmPendingContactTime(): void {
    if (!pendingContactPrompt?.selectedTime) return;
    applyCollectionCutStatus(pendingContactPrompt.clientId, "pending", pendingContactPrompt.selectedTime);
    setPendingContactPrompt(null);
  }

  function handleRouteTagChange(clientId: string, tagged: boolean): void {
    if (isCollectionLocked) return;
    if (!tagged) {
      if (activeVisibleRouteClientIds.has(clientId)) void handleRemoveFromPublishedRoute(clientId);
      else handleRemoveFromRoute(clientId);
      return;
    }
    if (clientHasBlockingIncidentAction(clientId)) return;
    const routeCandidate = baseRows.find((row) => row.id === clientId);
    if (!routeCandidate || !hasActiveOperationalClient(routeCandidate)) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "pending",
        isRouteTagged: true,
        routeTaggedAt: previous?.routeTaggedAt ?? nowIso,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: previous?.managementType ?? "solo_cobrar",
        managementAmount: previous?.managementAmount,
        managementComment: previous?.managementComment ?? "",
        managementUpdatedAt: previous?.managementUpdatedAt ?? nowIso,
        routeReleaseAmount: previous?.routeReleaseAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        routeAssignment: previous?.routeAssignment,
        routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
        routeUrgency: previous?.routeUrgency ?? "normal",
        routeUrgencyUpdatedAt: previous?.routeUrgencyUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        contactTime: previous?.contactTime,
        contactTimeUpdatedAt: previous?.contactTimeUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return { ...current, [clientId]: updatedRecord };
    });
  }

  function handleRouteWorkflowStatusChange(clientId: string, nextStatus: string): void {
    if (isCollectionLocked) return;
    if (!ROUTE_COLLECTION_STATUS_OPTIONS.some((option) => option.value === nextStatus)) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "pending",
        isRouteTagged: true,
        routeTaggedAt: previous?.routeTaggedAt ?? nowIso,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: previous?.managementType ?? "solo_cobrar",
        managementAmount: previous?.managementAmount ?? previous?.routeReleaseAmount,
        managementComment: previous?.managementComment ?? "",
        managementUpdatedAt: previous?.managementUpdatedAt ?? nowIso,
        routeReleaseAmount: previous?.routeReleaseAmount ?? previous?.managementAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt ?? nowIso,
        routeAssignment: previous?.routeAssignment,
        routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  function handleRouteManagementTypeChange(clientId: string, managementType: FieldManagementType): void {
    if (isCollectionLocked || clientHasBlockingIncidentAction(clientId)) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "pending",
        isRouteTagged: true,
        routeTaggedAt: previous?.routeTaggedAt ?? nowIso,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType,
        managementAmount: previous?.managementAmount ?? previous?.routeReleaseAmount,
        managementComment: previous?.managementComment ?? "",
        managementUpdatedAt: nowIso,
        routeReleaseAmount: previous?.routeReleaseAmount ?? previous?.managementAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt
          ?? (previous?.routeReleaseAmount || previous?.managementAmount ? nowIso : undefined),
        routeAssignment: previous?.routeAssignment,
        routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
    updatePublishedRouteItem(clientId, (item) => ({ ...item, managementType }));
  }

  function handleRouteManagementCommentChange(clientId: string, value: string): void {
    if (isCollectionLocked || clientHasBlockingIncidentAction(clientId)) return;
    const nowIso = new Date().toISOString();
    const managementComment = normalizeFieldManagementComment(value);
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "pending",
        isRouteTagged: true,
        routeTaggedAt: previous?.routeTaggedAt ?? nowIso,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: previous?.managementType ?? "solo_cobrar",
        managementAmount: previous?.managementAmount ?? previous?.routeReleaseAmount,
        managementComment,
        managementUpdatedAt: nowIso,
        routeReleaseAmount: previous?.routeReleaseAmount ?? previous?.managementAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        routeAssignment: previous?.routeAssignment,
        routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
    updatePublishedRouteItem(clientId, (item) => ({ ...item, comment: managementComment }));
  }

  function handleRouteAssignmentChange(clientId: string, value: string): void {
    if (isCollectionLocked || clientHasBlockingIncidentAction(clientId)) return;
    const routeAssignment = normalizeRouteAssignment(value);
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "pending",
        isRouteTagged: true,
        routeTaggedAt: previous?.routeTaggedAt ?? nowIso,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: previous?.managementType ?? "solo_cobrar",
        managementAmount: previous?.managementAmount ?? previous?.routeReleaseAmount,
        managementComment: previous?.managementComment ?? "",
        managementUpdatedAt: previous?.managementUpdatedAt ?? nowIso,
        routeReleaseAmount: previous?.routeReleaseAmount ?? previous?.managementAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        routeAssignment,
        routeAssignmentUpdatedAt: routeAssignment ? nowIso : undefined,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
    updatePublishedRouteItem(clientId, (item) => ({
      ...item,
      routeAssignment,
      zone: activeRouteFilterValue(item.routeAssignment) === activeRouteFilterValue(routeAssignment)
        ? item.zone
        : undefined
    }));
  }

  function handleRouteUrgencyChange(clientId: string, value: RouteUrgency): void {
    if (isCollectionLocked || clientHasBlockingIncidentAction(clientId)) return;
    const routeUrgency = normalizeRouteUrgency(value);
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "pending",
        isRouteTagged: true,
        routeTaggedAt: previous?.routeTaggedAt ?? nowIso,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: previous?.managementType ?? "solo_cobrar",
        managementAmount: previous?.managementAmount ?? previous?.routeReleaseAmount,
        managementComment: previous?.managementComment ?? "",
        managementUpdatedAt: previous?.managementUpdatedAt ?? nowIso,
        routeReleaseAmount: previous?.routeReleaseAmount ?? previous?.managementAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        routeAssignment: previous?.routeAssignment,
        routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
        routeUrgency,
        routeUrgencyUpdatedAt: routeUrgency === "normal" ? undefined : nowIso,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
    updatePublishedRouteItem(clientId, (item) => ({
      ...item,
      urgency: routeUrgency
    }));
  }

  function buildManagementRecordFromActiveRouteItem(
    item: ActiveRouteItem,
    previous: CollectionStatusRecord | undefined,
    nowIso: string
  ): CollectionStatusRecord {
    const routeAssignment = normalizeRouteAssignment(item.routeAssignment ?? "");
    const routeUrgency = normalizeRouteUrgency(item.urgency);

    return {
      ...previous,
      status: "pending",
      isRouteTagged: true,
      routeTaggedAt: previous?.routeTaggedAt ?? item.routeStartedAt ?? item.publishedAt ?? nowIso,
      comment: previous?.comment ?? "",
      updatedAt: nowIso,
      managementType: item.managementType ?? previous?.managementType ?? "solo_cobrar",
      managementAmount: item.releaseAmount > 0 ? item.releaseAmount : undefined,
      managementComment: normalizeFieldManagementComment(item.comment ?? previous?.managementComment ?? ""),
      managementUpdatedAt: nowIso,
      routeReleaseAmount: item.releaseAmount > 0 ? item.releaseAmount : undefined,
      routeReleaseUpdatedAt: item.releaseAmount > 0 ? nowIso : undefined,
      routeAssignment,
      routeAssignmentUpdatedAt: routeAssignment ? nowIso : undefined,
      routeUrgency,
      routeUrgencyUpdatedAt: routeUrgency === "normal" ? undefined : nowIso,
      whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
      whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
      whatsAppMessageText: previous?.whatsAppMessageText,
      supportNote: previous?.supportNote,
      supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
      contactTime: previous?.contactTime,
      contactTimeUpdatedAt: previous?.contactTimeUpdatedAt,
      paymentPromiseDate: previous?.paymentPromiseDate,
      paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
    };
  }

  function syncActiveRouteItemsToManagement(items: ActiveRouteItem[], successMessage?: string): void {
    if (isCollectionLocked) {
      setActiveRouteMessage("");
      setActiveRouteError(`La gestion de ${receivablesDateLabel} ya esta cerrada.`);
      return;
    }
    const visibleItems = items.filter((item) => !item.removedAt);
    if (visibleItems.length === 0) return;
    const nowIso = new Date().toISOString();
    for (const item of visibleItems) markClientStatusAsSaving(item.clientId);
    setCollectionStatusByClient((current) => {
      const next = { ...current };
      for (const item of visibleItems) {
        const updatedRecord = buildManagementRecordFromActiveRouteItem(item, current[item.clientId], nowIso);
        next[item.clientId] = updatedRecord;
        optimisticStatusByClientRef.current[item.clientId] = updatedRecord;
      }
      return next;
    });
    if (successMessage) {
      setActiveRouteError("");
      setActiveRouteMessage(successMessage);
    }
  }

  function handleRemoveFromRoute(clientId: string): void {
    if (isCollectionLocked) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    if (dataOwnerUserId) {
      void removeCloudActiveRouteItem(dataOwnerUserId, clientId, "manual_management").catch((error) => {
        console.error("No se pudo sacar de la Ruta en calle.", error);
      });
    }
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      if (!previous) return current;
      const updatedRecord = buildPendingRouteRecord(previous, nowIso);
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  async function handleRemoveFromPublishedRoute(clientId: string): Promise<void> {
    if (readOnly || !dataOwnerUserId) return;
    setActiveRouteError("");
    const removedAt = new Date().toISOString();
    try {
      await removeCloudActiveRouteItem(dataOwnerUserId, clientId, "manual_published");
      setPublishedRouteAmountDraftByClient((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
      setPublishedRouteCommentDraftByClient((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
      const nextActiveRouteItems: ActiveRouteItem[] = activeRouteItemsRef.current.map((item) => (
        item.clientId === clientId
          ? { ...item, removedAt, removedReason: "manual_published" }
          : item
      ));
      activeRouteItemsRef.current = nextActiveRouteItems;
      setActiveRouteItems(nextActiveRouteItems);
      markClientStatusAsSaving(clientId);
      setCollectionStatusByClient((current) => {
        const previous = current[clientId];
        const updatedRecord = buildPendingRouteRecord(previous, removedAt);
        optimisticStatusByClientRef.current[clientId] = updatedRecord;
        return {
          ...current,
          [clientId]: updatedRecord
        };
      });
    } catch (error) {
      console.error("No se pudo sacar de la Ruta en calle.", error);
      setActiveRouteError("No se pudo sacar de la Ruta en calle.");
    }
  }

  function updatePublishedRouteItem(clientId: string, updater: (item: ActiveRouteItem) => ActiveRouteItem): void {
    if (readOnly || !dataOwnerUserId) return;
    setActiveRouteMessage("");
    const currentItem = activeRouteItemsRef.current.find((item) => item.clientId === clientId);
    const updatedItem = currentItem ? updater(currentItem) : null;
    if (!updatedItem) return;
    activeRouteItemsRef.current = activeRouteItemsRef.current.map((item) => (
      item.clientId === clientId ? updatedItem : item
    ));
    setActiveRouteItems(activeRouteItemsRef.current);
    void saveCloudActiveRouteItem(dataOwnerUserId, updatedItem).catch((error) => {
      console.error("No se pudo guardar la Ruta en calle.", error);
      setActiveRouteError("No se pudo guardar la Ruta en calle.");
      void loadActiveRouteFromCloud();
    });
    syncActiveRouteItemsToManagement([updatedItem]);
  }

  function handlePublishedRouteTypeChange(clientId: string, managementType: FieldManagementType): void {
    if (clientHasBlockingIncidentAction(clientId)) return;
    updatePublishedRouteItem(clientId, (item) => ({ ...item, managementType }));
  }

  function handlePublishedRouteReleaseAmountChange(clientId: string, value: string): void {
    if (clientHasBlockingIncidentAction(clientId)) return;
    setPublishedRouteAmountDraftByClient((current) => ({
      ...current,
      [clientId]: value
    }));
  }

  function commitPublishedRouteReleaseAmount(clientId: string): void {
    if (clientHasBlockingIncidentAction(clientId)) return;
    const draft = publishedRouteAmountDraftByClient[clientId];
    if (draft === undefined) return;
    const parsedAmount = parsePositiveMoneyInput(draft);
    if (!parsedAmount) {
      setPublishedRouteAmountDraftByClient((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
      updatePublishedRouteItem(clientId, (item) => ({ ...item, releaseAmount: 0 }));
      return;
    }
    setPublishedRouteAmountDraftByClient((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    updatePublishedRouteItem(clientId, (item) => ({ ...item, releaseAmount: parsedAmount }));
  }

  function handlePublishedRouteCommentChange(clientId: string, value: string): void {
    if (clientHasBlockingIncidentAction(clientId)) return;
    setPublishedRouteCommentDraftByClient((current) => ({
      ...current,
      [clientId]: normalizeFieldManagementComment(value)
    }));
  }

  function commitPublishedRouteComment(clientId: string): void {
    if (clientHasBlockingIncidentAction(clientId)) return;
    const draft = publishedRouteCommentDraftByClient[clientId];
    if (draft === undefined) return;
    setPublishedRouteCommentDraftByClient((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    updatePublishedRouteItem(clientId, (item) => ({
      ...item,
      comment: normalizeFieldManagementComment(draft).trim() || undefined
    }));
  }

  function handlePublishedRouteAssignmentChange(clientId: string, value: string): void {
    if (clientHasBlockingIncidentAction(clientId)) return;
    updatePublishedRouteItem(clientId, (item) => ({
      ...item,
      routeAssignment: normalizeRouteAssignment(value),
      zone: activeRouteFilterValue(item.routeAssignment) === activeRouteFilterValue(normalizeRouteAssignment(value))
        ? item.zone
        : undefined
    }));
  }

  function handlePublishedRouteUrgencyChange(clientId: string, value: RouteUrgency): void {
    if (clientHasBlockingIncidentAction(clientId)) return;
    updatePublishedRouteItem(clientId, (item) => ({
      ...item,
      urgency: normalizeRouteUrgency(value)
    }));
  }

  function openAddPublishedRoute(): void {
    const firstRow = publishedRouteAddRows[0];
    setPublishedRouteDraft({
      clientId: firstRow?.id ?? "",
      type: "solo_cobrar",
      amount: "",
      comment: "",
      routeAssignment: "",
      urgency: "normal"
    });
    setPublishedRouteDraftError("");
    setIsPublishedRouteDraftCustomRouteOpen(false);
    setIsAddPublishedRouteOpen(true);
  }

  function updatePublishedRouteDraftClient(clientId: string): void {
    setPublishedRouteDraft((current) => ({
      ...current,
      clientId,
      amount: ""
    }));
  }

  async function handleAddPublishedRoute(): Promise<void> {
    if (readOnly || !dataOwnerUserId) return;
    const row = baseRows.find((item) => item.id === publishedRouteDraft.clientId);
    if (!row) {
      setPublishedRouteDraftError("Selecciona una unidad.");
      return;
    }
    if (hasBlockingIncidentAction(row)) {
      setPublishedRouteDraftError("Completa primero la acción pendiente de siniestros de esta unidad.");
      return;
    }
    const releaseAmount = parsePositiveMoneyInput(publishedRouteDraft.amount);
    if (!releaseAmount) {
      setPublishedRouteDraftError("Indica el MIN. LIBERAR.");
      return;
    }
    const nowIso = new Date().toISOString();
    const item: ActiveRouteItem = {
      clientId: row.id,
      unitId: row.unitId,
      clientName: row.name,
      clientCedula: row.cedula && row.cedula !== "-" ? row.cedula : undefined,
      whatsAppPhone: row.whatsAppPhone,
      routeAssignment: normalizeRouteAssignment(publishedRouteDraft.routeAssignment),
      managementType: publishedRouteDraft.type,
      urgency: normalizeRouteUrgency(publishedRouteDraft.urgency),
      releaseAmount,
      pendingAmount: row.totalPending,
      overdueBalance: row.overdueBalance,
      rentAmount: row.rentAmount,
      daysLate: row.daysLate,
      lastPaymentDate: row.lastPaymentDate,
      comment: normalizeFieldManagementComment(publishedRouteDraft.comment).trim() || undefined,
      publishedAt: nowIso,
      routeStartedAt: nowIso
    };
    setPublishedRouteDraftError("");
    setActiveRouteMessage("");
    try {
      await saveCloudActiveRouteItem(dataOwnerUserId, item);
      const remaining = activeRouteItemsRef.current.filter((currentItem) => currentItem.clientId !== item.clientId);
      activeRouteItemsRef.current = [item, ...remaining];
      setActiveRouteItems(activeRouteItemsRef.current);
      syncActiveRouteItemsToManagement([item]);
      setIsAddPublishedRouteOpen(false);
    } catch (error) {
      console.error("No se pudo agregar unidad a Ruta en calle.", error);
      setPublishedRouteDraftError("No se pudo agregar la unidad.");
    }
  }

  function handleSyncActiveRouteToManagement(): void {
    if (readOnly) return;
    syncActiveRouteItemsToManagement(activeVisibleRouteItems, "Ruta en calle sincronizada con Gestion.");
  }

  function handleRouteReleaseAmountChange(clientId: string, value: string): void {
    if (isCollectionLocked || clientHasBlockingIncidentAction(clientId)) return;
    const parsedAmount = parsePositiveMoneyInput(value);
    const activePublishedItem = activeRouteItemsRef.current.find((item) => item.clientId === clientId && !item.removedAt);
    const nextAmount = parsedAmount ?? undefined;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "pending",
        isRouteTagged: true,
        routeTaggedAt: previous?.routeTaggedAt ?? nowIso,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: previous?.managementType ?? "solo_cobrar",
        managementAmount: nextAmount,
        managementComment: previous?.managementComment ?? "",
        managementUpdatedAt: nowIso,
        routeReleaseAmount: nextAmount,
        routeReleaseUpdatedAt: nextAmount ? nowIso : undefined,
        routeAssignment: previous?.routeAssignment,
        routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
    if (activePublishedItem) {
      updatePublishedRouteItem(clientId, (item) => ({
        ...item,
        releaseAmount: nextAmount ?? 0
      }));
    }
  }

  function handleCollectionCutCommentChange(cutKey: CollectionCutKey, clientId: string, value: string): void {
    if (isCollectionLocked) return;
    if (cutKey !== "night") return;
    handleSupportNoteChange(clientId, value);
  }

  function markClientStatusAsSaving(clientId: string): void {
    saveTokenByClientRef.current[clientId] = (saveTokenByClientRef.current[clientId] ?? 0) + 1;
    setStatusSavingByClient((current) => ({ ...current, [clientId]: true }));
  }

  function handleCollectionStatusChange(clientId: string, nextStatus: string): void {
    if (isCollectionLocked) return;
    markClientStatusAsSaving(clientId);
    if (nextStatus !== "no_answer" && nextStatus !== "reminder" && nextStatus !== "call_later" && nextStatus !== "paid") {
      setCollectionStatusByClient((current) => {
        const next = { ...current };
        delete next[clientId];
        delete optimisticStatusByClientRef.current[clientId];
        return next;
      });
      return;
    }
    setCollectionStatusByClient((current) => {
      const currentComment = current[clientId]?.comment ?? "";
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: nextStatus,
        comment: nextStatus === "call_later" ? normalizeComment(currentComment) : "",
        updatedAt: new Date().toISOString(),
        managementType: previous?.managementType,
        managementAmount: previous?.managementAmount,
        managementComment: previous?.managementComment,
        managementUpdatedAt: previous?.managementUpdatedAt,
        routeReleaseAmount: previous?.routeReleaseAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  function handleWhatsAppMessageSent(clientId: string, message: string): void {
    if (isCollectionLocked) return;
    const targetRows = whatsAppGroupRowsByClient.get(clientId) ?? baseRows.filter((row) => row.id === clientId);
    const targetClientIds = targetRows.length > 0 ? targetRows.map((row) => row.id) : [clientId];
    for (const targetClientId of targetClientIds) markClientStatusAsSaving(targetClientId);
    const sentAt = new Date().toISOString();
    setCollectionStatusByClient((current) => {
      const next = { ...current };
      for (const targetClientId of targetClientIds) {
        const previous = current[targetClientId];
        const updatedRecord: CollectionStatusRecord = {
          ...previous,
          status: previous?.status ?? "unassigned",
          comment: previous?.comment ?? "",
          updatedAt: sentAt,
          managementType: previous?.managementType,
          managementAmount: previous?.managementAmount,
          managementComment: previous?.managementComment,
          managementUpdatedAt: previous?.managementUpdatedAt,
          routeReleaseAmount: previous?.routeReleaseAmount,
          routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
          routeAssignment: previous?.routeAssignment,
          routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
          whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt ?? sentAt,
          whatsAppMessageSentAt: sentAt,
          whatsAppMessageText: message,
          supportNote: previous?.supportNote,
          supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
          paymentPromiseDate: previous?.paymentPromiseDate,
          paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
        };
        optimisticStatusByClientRef.current[targetClientId] = updatedRecord;
        next[targetClientId] = updatedRecord;
      }
      return next;
    });
  }

  function handleCallLaterCommentChange(clientId: string, value: string): void {
    if (isCollectionLocked) return;
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const currentStatus = current[clientId]?.status ?? "call_later";
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: currentStatus,
        comment: normalizeComment(value),
        updatedAt: new Date().toISOString(),
        managementType: previous?.managementType,
        managementAmount: previous?.managementAmount,
        managementComment: previous?.managementComment,
        managementUpdatedAt: previous?.managementUpdatedAt,
        routeReleaseAmount: previous?.routeReleaseAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        routeAssignment: previous?.routeAssignment,
        routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  function handleOpenFieldManagementModal(clientId: string): void {
    const stored = collectionStatusByClient[clientId];
    setFieldManagementDraftByClient((drafts) => ({
      ...drafts,
      [clientId]: {
        type: stored?.managementType ?? "",
        amount: stored?.managementAmount ? String(stored.managementAmount) : "",
        comment: stored?.managementComment ?? ""
      }
    }));
    setFieldManagementErrorByClient((current) => ({ ...current, [clientId]: "" }));
    setFieldManagementModalClientId(clientId);
  }

  function handleFieldManagementDraftChange(
    clientId: string,
    patch: Partial<{ type: FieldManagementType | ""; amount: string; comment: string }>
  ): void {
    setFieldManagementErrorByClient((current) => ({ ...current, [clientId]: "" }));
    setFieldManagementDraftByClient((current) => {
      const existing = current[clientId] ?? { type: "", amount: "", comment: "" };
      return {
        ...current,
        [clientId]: {
          ...existing,
          ...patch,
          comment: patch.comment !== undefined ? normalizeFieldManagementComment(patch.comment) : existing.comment
        }
      };
    });
  }

  function handleSaveFieldManagement(clientId: string): void {
    if (isCollectionLocked) return;
    markClientStatusAsSaving(clientId);
    const draft = fieldManagementDraftByClient[clientId] ?? { type: "", amount: "", comment: "" };
    if (draft.type !== "solo_cobrar" && draft.type !== "cobrar_o_quitar" && draft.type !== "desiste" && draft.type !== "quitar") {
      setFieldManagementErrorByClient((current) => ({ ...current, [clientId]: "Selecciona tipo de gestion." }));
      return;
    }
    const managementType: FieldManagementType = draft.type;
    const parsedAmount = Number(draft.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFieldManagementErrorByClient((current) => ({ ...current, [clientId]: "Monto a pagar obligatorio." }));
      return;
    }

    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: previous?.status ?? "reminder",
        comment: previous?.comment ?? "",
        updatedAt: previous?.updatedAt ?? new Date().toISOString(),
        managementType,
        managementAmount: parsedAmount,
        managementComment: normalizeFieldManagementComment(draft.comment),
        managementUpdatedAt: new Date().toISOString(),
        routeReleaseAmount: previous?.routeReleaseAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
    setFieldManagementErrorByClient((current) => ({ ...current, [clientId]: "" }));
    setFieldManagementModalClientId(null);
  }

  function handleRemoveFieldManagement(clientId: string): void {
    if (isCollectionLocked) return;
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      if (!previous) return current;
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        managementType: undefined,
        managementAmount: undefined,
        managementComment: "",
        managementUpdatedAt: new Date().toISOString()
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  async function handleExportExcel() {
    const headers = ["Unidad", "Renta vencida", "Ult. pago / Estado", "ESTADO COBRANZA", "COBRO EN RUTA"];
    setIsExporting(true);
    setExportError(null);
    try {
      await exportReceivablesToExcel(headers, rows.map((row) => headers.map((header) => {
        const effectiveStatus = getEffectiveStatus(row);
        const collectionStatusLabel = COLLECTION_STATUS_OPTIONS.find((option) => option.value === effectiveStatus)?.label ?? "Seleccionar";
        const totalDue = row.overdueBalance + row.totalOtherCharges;
        if (header === "Unidad") return row.unitId;
        if (header === "Renta vencida") {
          return `${pendingSummaryText(row.overdueBalance, row.rentAmount)} | Otros cargos: ${formatCurrency(row.totalOtherCharges)} | Total general: ${formatCurrency(totalDue)} | Letra: ${formatCurrency(row.rentAmount)} | ${row.name}`;
        }
        if (header === "Ult. pago / Estado") {
          const sourceClient = clients.find((client) => client.id === row.id);
          const operationalStatus = row.operationalStatus ?? sourceClient?.status ?? "activo";
          const lastPaymentLabel = row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "Sin pagos";
          return `${lastPaymentLabel} | ${STATE_LABEL[row.state]} | ${clientOperationalStatusLabel(operationalStatus)}`;
        }
        if (header === "ESTADO COBRANZA") return collectionStatusLabel;
        if (header === "COBRO EN RUTA") return hasRouteCollection(row) || isNightRouteCollection(row) ? "SI" : "NO";
        return "";
      })), now);
    } catch {
      setExportError("No se pudo exportar el archivo Excel.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportPdf() {
    const selectedFields = exportFields.filter((field) => field.enabled);
    const headers = selectedFields.map((field) => field.label);
    if (selectedFields.length === 0) return setExportError("Selecciona al menos una columna para exportar.");
    setIsExporting(true);
    setExportError(null);
    try {
      await exportReceivablesToPdf(headers, rows.map((row) => selectedFields.map((field) => {
        const effectiveStatus = getEffectiveStatus(row);
        if (field.key === "unitId") return row.unitId;
        if (field.key === "name") return row.name;
        if (field.key === "rentAmount") return row.rentAmount;
        if (field.key === "pendingSummary") {
          return `${pendingSummaryText(row.overdueBalance, row.rentAmount)} | Otros cargos: ${formatCurrency(row.totalOtherCharges)} | Total general: ${formatCurrency(row.overdueBalance + row.totalOtherCharges)}`;
        }
        if (field.key === "lastPaymentDate") return row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "-";
        if (field.key === "collectionStatus") return COLLECTION_STATUS_OPTIONS.find((option) => option.value === effectiveStatus)?.label ?? "Seleccionar";
        if (field.key === "routeCollection") return hasRouteCollection(row) || isNightRouteCollection(row) ? "SI" : "NO";
        return STATE_LABEL[row.state];
      })), now);
    } catch {
      setExportError("No se pudo exportar el archivo PDF.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handlePublishCobroEnRuta(): Promise<void> {
    setExportError(null);
    setRouteExportMessage("");
    setIsExporting(true);
    setPublishedRouteDownload(null);
    let publishedCount = 0;
    let publicationAttempted = false;
    let publicationConfirmed = false;
    try {
      let statusByClientForRoute = { ...collectionStatusByClient };
      let activeRouteItemsForSend = activeRouteItemsRef.current;
      if (dataOwnerUserId) {
        const [cloudStreetManagement, cloudActiveRouteItems] = await Promise.all([
          loadCloudStreetManagement(dataOwnerUserId),
          loadCloudActiveRouteItems(dataOwnerUserId)
        ]);
        statusByClientForRoute = parseCollectionStatusMapFromStorage(JSON.stringify(cloudStreetManagement));
        activeRouteItemsForSend = cloudActiveRouteItems;
      }
      const activeClientIdsForSend = new Set(activeRouteItemsForSend
        .filter((item) => !item.removedAt)
        .filter((item) => !activeRouteItemReleasedByPayment(item, payments))
        .map((item) => item.clientId));
      const removedItemByClientForSend = new Map(activeRouteItemsForSend
        .filter((item) => !!item.removedAt)
        .map((item) => [item.clientId, item] as const));
      const isRouteRowFromMap = (row: ReceivableRow): boolean => {
        const record = statusByClientForRoute[row.id];
        return (
          hasActiveOperationalClient(row) &&
          record?.isRouteTagged === true &&
          !activeClientIdsForSend.has(row.id) &&
          !routeRemovalBlocksRecord(record, removedItemByClientForSend.get(row.id))
        );
      };
      const hasRouteCollectionFromMap = (row: ReceivableRow): boolean => {
        const management = statusByClientForRoute[row.id];
        const hasType = management?.managementType === "solo_cobrar" || management?.managementType === "cobrar_o_quitar" || management?.managementType === "desiste" || management?.managementType === "quitar";
        return hasType && !!management?.managementAmount && management.managementAmount > 0;
      };
      const blockedIncidentRows = baseRows.filter((row) => isRouteRowFromMap(row) && hasBlockingIncidentAction(row));
      const routeRowsForSend = baseRows.filter((row) => isRouteRowFromMap(row) && !hasBlockingIncidentAction(row));
      if (routeRowsForSend.length === 0) {
        if (blockedIncidentRows.length > 0) {
          setExportError(`Completa primero la acción pendiente de siniestros de: ${blockedIncidentRows.map((row) => row.unitId).join(", ")}.`);
          return;
        }
        activeRouteItemsRef.current = activeRouteItemsForSend;
        setActiveRouteItems(activeRouteItemsForSend);
        setRouteExportMessage("Las unidades seleccionadas ya estaban publicadas. Se actualizo Ruta en calle.");
        return;
      }
      const routeRowsMissingAmount = routeRowsForSend.filter((row) => !hasRouteReleaseAmount(statusByClientForRoute[row.id]));
      if (routeRowsMissingAmount.length > 0) {
        setExportError(routeMissingAmountMessage(routeRowsMissingAmount));
        return;
      }
      const routeRowsMissingAssignment = routeRowsForSend.filter((row) => {
        const routeAssignment = statusByClientForRoute[row.id]?.routeAssignment;
        return !routeAssignment || routeAssignment.trim().length === 0;
      });
      if (routeRowsMissingAssignment.length > 0) {
        setExportError(routeMissingAssignmentMessage(routeRowsMissingAssignment));
        return;
      }
      const previousStatusByClientForRoute = { ...statusByClientForRoute };
      const exportedAt = new Date().toISOString();
      for (const row of routeRowsForSend) {
        if (hasRouteCollectionFromMap(row)) continue;
        const previous = statusByClientForRoute[row.id];
        const routeReleaseAmount = previous?.routeReleaseAmount ?? previous?.managementAmount;
        statusByClientForRoute[row.id] = {
          status: "pending",
          isRouteTagged: true,
          routeTaggedAt: previous?.routeTaggedAt ?? exportedAt,
          comment: previous?.comment ?? "",
          updatedAt: exportedAt,
          managementType: previous?.managementType ?? "solo_cobrar",
          managementAmount: routeReleaseAmount,
          managementComment: previous?.managementComment || "Ruta",
          managementUpdatedAt: previous?.managementUpdatedAt ?? exportedAt,
          routeReleaseAmount,
          routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt ?? exportedAt,
          routeAssignment: previous?.routeAssignment,
          routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
          routeUrgency: previous?.routeUrgency ?? "normal",
          routeUrgencyUpdatedAt: previous?.routeUrgencyUpdatedAt,
          whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
          whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
          whatsAppMessageText: previous?.whatsAppMessageText,
          supportNote: previous?.supportNote,
          supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
          paymentPromiseDate: previous?.paymentPromiseDate,
          paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
        };
      }
      if (dataOwnerUserId) {
        await syncCloudStreetManagementDelta(
          dataOwnerUserId,
          previousStatusByClientForRoute as Record<string, unknown>,
          statusByClientForRoute as Record<string, unknown>
        );
        applyStreetManagementData(statusByClientForRoute as Record<string, unknown>);
      } else if (onStreetManagementPersist) {
        const ok = await onStreetManagementPersist(statusByClientForRoute as Record<string, unknown>);
        if (ok === false) throw new Error("No se pudo guardar Cobro en Ruta.");
        applyStreetManagementData(statusByClientForRoute as Record<string, unknown>);
      }
      if (dataOwnerUserId) {
        const activeRouteItemsToPublish = routeRowsForSend
          .map((row) => {
            const record = statusByClientForRoute[row.id];
            if (!record) return null;
            return buildActiveRouteItem(row, record, exportedAt);
          })
          .filter((item): item is ActiveRouteItem => item !== null);
        publicationAttempted = true;
        await publishCloudActiveRouteItems(dataOwnerUserId, activeRouteItemsToPublish);
        const verifiedActiveRouteItems = await loadCloudActiveRouteItems(dataOwnerUserId);
        const verifiedByClient = new Map(verifiedActiveRouteItems.map((item) => [item.clientId, item] as const));
        const unverifiedUnits = activeRouteItemsToPublish
          .filter((item) => {
            const verified = verifiedByClient.get(item.clientId);
            return !verified || !!verified.removedAt || verified.publishedAt !== exportedAt;
          })
          .map((item) => item.unitId);
        if (unverifiedUnits.length > 0) {
          throw new Error(`No se confirmo la publicacion de: ${unverifiedUnits.join(", ")}`);
        }
        activeRouteItemsRef.current = verifiedActiveRouteItems;
        setActiveRouteItems(verifiedActiveRouteItems);
        publishedCount = activeRouteItemsToPublish.length;
        publicationConfirmed = true;
      }
      setPublishedRouteDownload({
        rows: routeRowsForSend,
        statusByClient: statusByClientForRoute,
        publishedCount: dataOwnerUserId ? publishedCount : routeRowsForSend.length
      });
      setRouteReadyFilter(false);
      const unitLabel = routeRowsForSend.length === 1 ? "unidad" : "unidades";
      setRouteExportMessage(
        dataOwnerUserId
          ? `Ruta publicada: ${publishedCount} ${unitLabel}. Ya puedes descargarla.`
          : `Ruta preparada: ${routeRowsForSend.length} ${unitLabel}. Ya puedes descargarla.`
      );
    } catch (error) {
      console.error("No se pudo enviar Cobro en Ruta.", error);
      setExportError(
        publicationConfirmed
          ? `La ruta se publico con ${publishedCount} unidad(es), pero no se pudo preparar la descarga.`
          : publicationAttempted
            ? "No se pudo confirmar la publicacion de la ruta; puedes volver a intentar."
            : "No se pudo preparar la publicacion de la ruta; puedes volver a intentar."
      );
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDownloadPublishedRoute(): Promise<void> {
    if (!publishedRouteDownload) return;
    setExportError(null);
    setRouteExportMessage("");
    setIsExporting(true);
    try {
      const exported = await exportRouteCollection({
        rows: publishedRouteDownload.rows,
        statusByClient: publishedRouteDownload.statusByClient,
        format: routeExportFormat,
        now
      });
      if (!exported) throw new Error("No hay registros publicados para descargar.");
      const unitLabel = publishedRouteDownload.publishedCount === 1 ? "unidad" : "unidades";
      setRouteExportMessage(`Ruta descargada: ${publishedRouteDownload.publishedCount} ${unitLabel}.`);
    } catch (error) {
      console.error("No se pudo descargar la ruta publicada.", error);
      setExportError("La ruta esta publicada, pero no se pudo descargar el archivo. Puedes volver a intentar.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleSaveCollectionCut(cutKey: CollectionCutKey): Promise<void> {
    setCollectionCutMessage(null);
    setExportError(null);
    if (isCollectionLocked) {
      setCollectionCutMessage(`La gestion de ${receivablesDateLabel} ya esta cerrada.`);
      return;
    }
    if (!dataOwnerUserId) {
      setCollectionCutMessage("No se pudo guardar el corte: falta conexion con la nube del negocio.");
      return;
    }
    const cutOption = COLLECTION_CUT_OPTIONS.find((option) => option.key === cutKey);
    const cutLabel = cutKey === "night" ? "Gestion diaria" : cutOption?.shortLabel ?? "Corte";
    let statusByClientForClosure = collectionStatusByClient;
    if (dataOwnerUserId) {
      const cloudStreetManagement = await loadCloudStreetManagement(dataOwnerUserId);
      statusByClientForClosure = parseCollectionStatusMapFromStorage(JSON.stringify(cloudStreetManagement));
      applyStreetManagementData(cloudStreetManagement);
    }
    if (cutKey === "night") {
      const freshClosureBlockers = buildClosureBlockersForStatus(statusByClientForClosure);
      const blockerMessages: string[] = [];
      if (freshClosureBlockers.pendingManagementRows.length > 0) {
        blockerMessages.push(`${freshClosureBlockers.pendingManagementRows.length} unidad(es) con gestion pendiente`);
      }
      if (freshClosureBlockers.pendingWhatsAppRows.length > 0) {
        blockerMessages.push(`${freshClosureBlockers.pendingWhatsAppRows.length} WhatsApp pendiente(s) por enviar o confirmar`);
      }
      if (blockerMessages.length > 0) {
        setCollectionCutMessage(`No se puede cerrar la gestion de ${receivablesDateLabel}: ${blockerMessages.join(" y ")}.`);
        if (freshClosureBlockers.pendingManagementRows.length > 0) setCollectionStatusFilter("unassigned");
        else setWhatsAppContactFilter("pending");
        return;
      }
      const routeRowsMissingAmount = baseRows.filter((row) => (
        statusByClientForClosure[row.id]?.isRouteTagged === true &&
        !hasRouteReleaseAmount(statusByClientForClosure[row.id])
      ));
      if (routeRowsMissingAmount.length > 0) {
        setCollectionCutMessage(routeMissingAmountMessage(routeRowsMissingAmount));
        return;
      }
    }
    setIsSavingCollectionCut(cutKey);
    try {
      const validStatuses = new Set(getStatusOptionsForCut(cutKey).map((option) => option.value));
      const eligibleRows = cutKey === "night" ? baseRows : baseRows.filter((row) => isRowEligibleForCut(row, cutKey));
      const closureItems: CollectionClosureItem[] = [];
      for (const row of eligibleRows) {
        const statusRecord = statusByClientForClosure[row.id];
        const existingItem = getCutItemForClient(cutKey, row.id);
        const savedStatus = existingItem?.collectionStatus;
        const autoStatus = cutKey === "night"
          ? (shouldDefaultToCovered(row) ? "covered" : "unassigned")
          : (hasAutoPaidStatus(row) ? "paid" : "");
        const freshStatus = getEffectiveStatusFromMap(row, statusByClientForClosure);
        const status = savedStatus && validStatuses.has(savedStatus)
          ? savedStatus
          : freshStatus && validStatuses.has(freshStatus)
            ? freshStatus
            : autoStatus;
        if (!status || !validStatuses.has(status)) continue;
        closureItems.push({
          clientId: row.id,
          unitId: row.unitId,
          clientName: row.name,
          lastPaymentDate: row.lastPaymentDate,
          lastPaymentAt: row.lastPaymentAt,
          receivableState: row.state,
          totalPending: row.totalPending,
          collectionStatus: status,
          comment: existingItem?.comment ?? "",
          autoApplied: !existingItem,
          managementType: statusRecord?.managementType,
          managementAmount: statusRecord?.managementAmount,
          managementComment: statusRecord?.managementComment,
          contactTime: statusRecord?.contactTime,
          whatsAppMessageCopiedAt: statusRecord?.whatsAppMessageCopiedAt,
          whatsAppMessageSentAt: statusRecord?.whatsAppMessageSentAt
        });
      }
      const closureTotals = computeCutTotals(closureItems);
      const snapshot = {
        date: todayDateKey,
        cutKey,
        cutLabel,
        closedAt: new Date().toISOString(),
        actor: "Operador",
        reason: cutKey === "night" ? "Gestion diaria de cobranza" : cutOption?.label ?? cutLabel,
        totals: closureTotals,
        items: closureItems
      };
      const cloudClosures = await loadCloudCollectionClosures(dataOwnerUserId) as CollectionClosuresByDate;
      const existingCuts = getCollectionClosureCuts(cloudClosures[todayDateKey]);
      const nextClosures: CollectionClosuresByDate = {
        ...cloudClosures,
        [todayDateKey]: {
          date: todayDateKey,
          cuts: {
            ...existingCuts,
            [cutKey]: snapshot
          }
        }
      };
      await saveCloudCollectionClosures(dataOwnerUserId, nextClosures as Record<string, unknown>);
      setCollectionClosuresByDate(nextClosures);
      setCollectionClosuresLoaded(true);
      setSelectedHistoryDate(todayDateKey);
      await clearLiveCollectionStatusAfterClosure();
      setCollectionCutMessage(`${cutLabel} guardada con ${closureItems.length} registro(s).`);
    } catch (error) {
      console.error("No se pudo guardar el corte de cobranza.", error);
      setCollectionCutMessage("No se pudo guardar el corte de cobranza.");
    } finally {
      setIsSavingCollectionCut(null);
    }
  }

  const activeAdvancedFilterCount = [
    filters.unitSearch.trim(),
    filters.clientSearch.trim(),
    filters.cedulaSearch.trim(),
    filters.plan !== DEFAULT_RECEIVABLE_FILTERS.plan ? filters.plan : "",
    filters.group !== DEFAULT_RECEIVABLE_FILTERS.group ? filters.group : "",
    filters.state.length > 0 ? "state" : ""
  ].filter(Boolean).length;
  const pendingContactTimeOptions = getFutureContactTimeOptions(now);
  const pendingContactRow = pendingContactPrompt
    ? baseRows.find((row) => row.id === pendingContactPrompt.clientId)
    : undefined;

  return (
    <>
      <section className="panel ar-ledger-panel">
        <div className="ar-ledger-command">
          <div className="ar-ledger-title">
            <h1>Cuentas por cobrar</h1>
            <p>Gestiona estados, notas y ruta de cobro desde una sola lista.</p>
            <p className="ar-ledger-date-note">
              Fecha de gestion: <strong>{receivablesDateLabel}</strong>
              {" | Gestion abierta"}
            </p>
          </div>
          {viewMode === "cartera" ? (
            <div className="ar-collection-cuts-actions">
              <button
                type="button"
                className="button ghost small"
                onClick={() => {
                  setCollectionCutMessage(null);
                  setExportError(null);
                  setClearManagementConfirmation("");
                  setIsClearManagementConfirmOpen(true);
                }}
                disabled={isClearingCollectionManagement || readOnly}
                title={readOnly ? "No tienes permiso para editar cuentas por cobrar." : undefined}
              >
                {isClearingCollectionManagement ? "Limpiando gestion..." : "Limpiar gestion"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="ar-workflow-commandbar">
          <div className="ar-workflow-tabs" role="tablist" aria-label="Flujo de cuentas por cobrar">
            <button
              type="button"
              role="tab"
              aria-selected={workflowTab === "management"}
              className={workflowTab === "management" ? "is-active" : ""}
              onClick={() => {
                setWorkflowTab("management");
                setCollectionStatusFilter("all");
                setRouteTagFilter(false);
                setRouteReadyFilter(false);
              }}
            >
              Gestion <strong>{managementWorkflowRowsCount}</strong>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workflowTab === "route"}
              className={workflowTab === "route" ? "is-active" : ""}
              onClick={() => {
                setWorkflowTab("route");
                setCollectionStatusFilter("all");
                setRouteTagFilter(false);
                setRouteReadyFilter(false);
              }}
            >
              Ruta en calle <strong>{activeVisibleRouteItems.length}</strong>
            </button>
          </div>
          <div className={`ar-route-publish-cta ${routeWorkflowRowsCount > 0 ? "has-ready-items" : ""} ${canDownloadPublishedRoute ? "is-ready-to-download" : ""}`}>
            {routeWorkflowRowsCount > 0 ? (
              <button
                type="button"
                className={`ar-route-publish-copy ${routeReadyFilter ? "is-active" : ""}`}
                aria-pressed={routeReadyFilter}
                onClick={() => {
                  setWorkflowTab("management");
                  setRouteReadyFilter((current) => !current);
                  setRouteTagFilter(false);
                  setCollectionStatusFilter("all");
                  setWhatsAppContactFilter("all");
                }}
              >
                {routeWorkflowRowsCount} {routeWorkflowRowsCount === 1 ? "unidad lista" : "unidades listas"}
              </button>
            ) : (
              <span className="ar-route-publish-copy">
                {canDownloadPublishedRoute ? "Ruta publicada" : "Sin unidades nuevas"}
              </span>
            )}
            <button
              type="button"
              className="button ar-route-publish-button"
              onClick={() => void (canDownloadPublishedRoute ? handleDownloadPublishedRoute() : handlePublishCobroEnRuta())}
              disabled={isExporting || (!canDownloadPublishedRoute && routeWorkflowRowsCount === 0)}
            >
              {isExporting
                ? canDownloadPublishedRoute ? "Descargando..." : "Publicando..."
                : canDownloadPublishedRoute ? "Descargar ruta" : "Publicar ruta"}
              {!isExporting ? <strong>{canDownloadPublishedRoute ? publishedRouteDownload?.publishedCount : routeWorkflowRowsCount}</strong> : null}
            </button>
            <select
              className="ar-route-export-format ar-route-export-format--prominent"
              value={routeExportFormat}
              onChange={(event) => setRouteExportFormat(event.target.value as RouteExportFormat)}
              disabled={isExporting}
              aria-label="Formato para publicar cobro en ruta"
            >
              <option value="jpg">JPG</option>
              <option value="pdf">PDF</option>
              <option value="excel">Excel</option>
            </select>
          </div>
        </div>

        {workflowTab === "management" ? <div className="ar-ledger-toolbar">
          <div className="ar-view-tabs">
            <label className="ar-toolbar-filter ar-toolbar-filter--management">
              <span className="ar-toolbar-filter-label">Gestion</span>
              <select
                className="ar-toolbar-filter-select ar-toolbar-filter-select--management"
                value={collectionStatusFilter}
                title={collectionStatusFilterHelp}
                aria-label={`Filtro de gestion: ${collectionStatusFilterHelp}`}
                onChange={(event) => setCollectionStatusFilter(event.target.value as CollectionStatusFilter)}
              >
                <option value="all" title="Muestra todos los estados de gestion.">Todos</option>
                {collectionStatusFilterOptions.map((option) => (
                  <option key={option.value} value={option.value} title={option.description}>{option.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`ar-route-direct-filter ${routeTagFilter ? "is-active" : ""}`}
              aria-pressed={routeTagFilter}
              onClick={() => {
                const next = !routeTagFilter;
                setRouteTagFilter(next);
                setRouteReadyFilter(false);
                if (next) {
                  setCollectionStatusFilter("all");
                  setWhatsAppContactFilter("all");
                }
              }}
            >
              En ruta <strong>{routeTaggedManagementCount}</strong>
            </button>
            <label className="ar-toolbar-filter">
              <span className="ar-toolbar-filter-label">WhatsApp</span>
              <select
                className="ar-toolbar-filter-select"
                value={whatsAppContactFilter}
                onChange={(event) => setWhatsAppContactFilter(event.target.value as WhatsAppContactFilter)}
              >
                <option value="all">Todos</option>
                <option value="pending">Sugeridos</option>
                <option value="sent">Enviado</option>
                <option value="idle">Sin sugerencia</option>
              </select>
            </label>
          </div>
          <div className="ar-ledger-toolbar-meta">
            <button
              type="button"
              className={`ar-management-alert ${collectionStatusFilter === "covered" ? "ar-management-alert--done" : ""}`}
              onClick={() => setCollectionStatusFilter(collectionStatusFilter === "covered" ? "covered" : "pending")}
            >
              {managementAlertText}
            </button>
            <button
              type="button"
              className={`ar-whatsapp-alert ${whatsAppContactFilter === "sent" ? "ar-whatsapp-alert--done" : ""}`}
              onClick={() => setWhatsAppContactFilter(whatsAppContactFilter === "sent" ? "sent" : "pending")}
            >
              {whatsAppAlertText}
            </button>
            <button
              type="button"
              className={`ar-contact-time-sort ${prioritizeContactTime ? "is-active" : ""}`}
              onClick={() => setPrioritizeContactTime((current) => !current)}
            >
              {prioritizeContactTime ? "Agenda de llamadas" : "Proximo contacto"}
            </button>
            <span className="ar-results-count">Mostrando {rows.length} de {managementWorkflowRowsCount}</span>
          </div>
        </div> : null}

        {workflowTab === "management" ? (
          <>
            <button
              type="button"
              className={`ar-mobile-filter-toggle ${mobileFiltersOpen ? "is-open" : ""}`}
              onClick={() => setMobileFiltersOpen((current) => !current)}
              aria-expanded={mobileFiltersOpen}
            >
              <span>{mobileFiltersOpen ? "Ocultar filtros" : "Filtros"}</span>
              {activeAdvancedFilterCount > 0 ? <strong>{activeAdvancedFilterCount}</strong> : null}
            </button>

            <ReceivablesFiltersPanel
              className={mobileFiltersOpen ? "is-mobile-open" : ""}
              filters={filters}
              availableGroups={availableGroups}
              onFilterChange={updateFilter}
              onStateFilterToggle={handleStateFilterToggle}
              onClearFilters={clearFilters}
            />
          </>
        ) : null}

        {collectionCutMessage ? <p className="hint">{collectionCutMessage}</p> : null}
        {routeExportMessage ? <p className="hint">{routeExportMessage}</p> : null}
        {exportError ? <p className="hint error-text">{exportError}</p> : null}
        {workflowTab === "route" ? (
          <div className="ar-active-route-panel ar-active-route-panel--tab">
            <div className="ar-active-route-head">
              <div>
                <strong>Ruta en calle</strong>
                <span>
                  {activeFilteredRouteItems.length} de {activeVisibleRouteItems.length} activo{activeVisibleRouteItems.length === 1 ? "" : "s"} en calle
                </span>
              </div>
              <div className="ar-active-route-actions">
                <button
                  type="button"
                  className="button ghost small"
                  onClick={handleSyncActiveRouteToManagement}
                  disabled={readOnly || activeVisibleRouteItems.length === 0 || isCollectionLocked}
                  title={isCollectionLocked ? "La gestion esta cerrada para sincronizar." : undefined}
                >
                  Sincronizar gestion
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={openAddPublishedRoute}
                  disabled={readOnly || publishedRouteAddRows.length === 0}
                  title={readOnly ? "No tienes permiso para editar cuentas por cobrar." : publishedRouteAddRows.length === 0 ? "No hay unidades disponibles para agregar." : undefined}
                >
                  Agregar unidad
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => void loadActiveRouteFromCloud()}
                  disabled={activeRouteLoading}
                >
                  {activeRouteLoading ? "Actualizando..." : "Actualizar"}
                </button>
              </div>
            </div>
            {activeRouteError ? <p className="error-text">{activeRouteError}</p> : null}
            {activeRouteMessage ? <p className="hint">{activeRouteMessage}</p> : null}
            {activeVisibleRouteItems.length > 0 ? (
              <label className="ar-active-route-search">
                <span>Buscar en Ruta en calle</span>
                <input
                  type="search"
                  value={activeRouteSearchQuery}
                  onChange={(event) => setActiveRouteSearchQuery(event.target.value)}
                  placeholder="Unidad, cliente, cedula, telefono, comentario..."
                  autoComplete="off"
                />
              </label>
            ) : null}
            {activeRouteFilterOptions.length > 0 ? (
              <div className="ar-active-route-filters" aria-label="Filtrar Ruta en calle">
                <button
                  type="button"
                  className={activeRouteFilter === ALL_ACTIVE_ROUTE_FILTER ? "is-active" : ""}
                  onClick={() => setActiveRouteFilter(ALL_ACTIVE_ROUTE_FILTER)}
                >
                  Todas
                </button>
                {activeRouteFilterOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={activeRouteFilter === option ? "is-active" : ""}
                    onClick={() => setActiveRouteFilter(option)}
                  >
                    {activeRouteFilterLabel(option)}
                  </button>
                ))}
              </div>
            ) : null}
            {activeFilteredRouteItems.length > 0 ? (
              <>
                <div className="table-scroll ar-active-route-scroll">
                  <table className="ar-table ar-active-route-table">
                    <thead>
                      <tr>
                        <th>Unidad</th>
                        <th>Cliente</th>
                        <th>Atraso</th>
                        <th>Renta vencida</th>
                        <th>Tipo</th>
                        <th>Min. liberar</th>
                        <th>Comentario</th>
                        <th>Ruta</th>
                        <th>Alarma</th>
                        <th>Accion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeFilteredRouteItems.map((item) => {
                        const routeAssignment = item.routeAssignment ?? "";
                        const routeUrgency = item.urgency ?? "normal";
                        const isCustomRouteAssignment = !!routeAssignment && !ROUTE_ASSIGNMENT_OPTIONS.includes(routeAssignment);
                        const isCustomRouteEditorOpen = isCustomRouteAssignment || !!publishedCustomRouteEditorByClient[item.clientId];
                        const hasIncidentBlock = incidentActionsByUnit[item.unitId.trim().toUpperCase()]?.urgent === true;
                        return (
                          <tr key={item.clientId} className={`${routeUrgency !== "normal" ? `ar-route-urgency-row ar-route-urgency-row--${routeUrgency}` : ""}${hasIncidentBlock ? " ar-route-incident-blocked" : ""}`.trim() || undefined}>
                            <td><strong className="ar-unit-id">{item.unitId}</strong></td>
                            <td>
                              <span className="client-name ar-route-client-name" title={item.clientName}>{item.clientName}</span>
                              <span className="ar-route-added-at">En calle {formatActiveRouteAddedAt(item.publishedAt)}</span>
                              {hasIncidentBlock ? <span className="ar-incident-route-block">Acción de siniestros obligatoria</span> : null}
                            </td>
                            <td>{item.daysLate > 0 ? `${item.daysLate} dias` : "Sin atraso"}</td>
                            <td className="amount-debt">
                              <strong className="ar-overdue-chip-amount">{formatCurrency(item.overdueBalance)}</strong>
                              <small className="ar-overdue-chip-installments">{overdueInstallmentsText(item.overdueBalance, item.rentAmount)}</small>
                            </td>
                            <td>
                              <select
                                className="ar-route-list-type"
                                value={item.managementType ?? "solo_cobrar"}
                                onChange={(event) => handlePublishedRouteTypeChange(item.clientId, event.target.value as FieldManagementType)}
                                disabled={readOnly || hasIncidentBlock}
                              >
                                <option value="solo_cobrar">Solo cobrar</option>
                                <option value="cobrar_o_quitar">Cobrar o quitar</option>
                                <option value="desiste">Desiste</option>
                                <option value="quitar">Quitar</option>
                              </select>
                            </td>
                            <td>
                              <input
                                className="ar-route-list-amount"
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                value={publishedRouteAmountDraftByClient[item.clientId] ?? (item.releaseAmount > 0 ? String(item.releaseAmount) : "")}
                                onChange={(event) => handlePublishedRouteReleaseAmountChange(item.clientId, event.target.value)}
                                onBlur={() => commitPublishedRouteReleaseAmount(item.clientId)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") event.currentTarget.blur();
                                }}
                                disabled={readOnly || hasIncidentBlock}
                              />
                            </td>
                            <td>
                              <input
                                className="ar-route-list-comment"
                                type="text"
                                value={publishedRouteCommentDraftByClient[item.clientId] ?? item.comment ?? ""}
                                onChange={(event) => handlePublishedRouteCommentChange(item.clientId, event.target.value)}
                                onBlur={() => commitPublishedRouteComment(item.clientId)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") event.currentTarget.blur();
                                }}
                                placeholder="Comentario..."
                                maxLength={25}
                                disabled={readOnly || hasIncidentBlock}
                              />
                            </td>
                            <td>
                              {isCustomRouteEditorOpen ? (
                                <input
                                  className="ar-route-list-route-custom"
                                  type="text"
                                  value={routeAssignment}
                                  onChange={(event) => handlePublishedRouteAssignmentChange(item.clientId, event.target.value)}
                                  onBlur={(event) => {
                                    const normalized = normalizeRouteAssignment(event.target.value);
                                    if (event.target.value !== (normalized ?? "")) handlePublishedRouteAssignmentChange(item.clientId, normalized ?? "");
                                    if (!normalized) setPublishedCustomRouteEditorByClient((current) => ({ ...current, [item.clientId]: false }));
                                  }}
                                  placeholder="Escribe ruta"
                                  maxLength={12}
                                  disabled={readOnly || hasIncidentBlock}
                                />
                              ) : (
                                <select
                                  className="ar-route-list-route"
                                  value={routeAssignment}
                                  onChange={(event) => {
                                    const selected = event.target.value;
                                    if (selected === "__custom") {
                                      setPublishedCustomRouteEditorByClient((current) => ({ ...current, [item.clientId]: true }));
                                      handlePublishedRouteAssignmentChange(item.clientId, "");
                                      return;
                                    }
                                    setPublishedCustomRouteEditorByClient((current) => ({ ...current, [item.clientId]: false }));
                                    handlePublishedRouteAssignmentChange(item.clientId, selected);
                                  }}
                                  disabled={readOnly || hasIncidentBlock}
                                >
                                  <option value="">Sin ruta</option>
                                  {ROUTE_ASSIGNMENT_OPTIONS.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                  ))}
                                  <option value="__custom">Otra</option>
                                </select>
                              )}
                            </td>
                            <td>
                              <select
                                className={`ar-route-urgency-select ar-route-urgency-select--${routeUrgency}`}
                                value={routeUrgency}
                                onChange={(event) => handlePublishedRouteUrgencyChange(item.clientId, event.target.value as RouteUrgency)}
                                disabled={readOnly || hasIncidentBlock}
                              >
                                {ROUTE_URGENCY_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="button ghost small ar-route-list-remove"
                                onClick={() => void handleRemoveFromPublishedRoute(item.clientId)}
                                disabled={readOnly}
                                title={readOnly ? "No tienes permiso para editar cuentas por cobrar." : undefined}
                              >
                                Sacar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="ar-active-route-mobile-list" aria-label="Ruta en calle editable">
                  {activeFilteredRouteItems.map((item) => {
                    const routeAssignment = item.routeAssignment ?? "";
                    const routeUrgency = item.urgency ?? "normal";
                    const isCustomRouteAssignment = !!routeAssignment && !ROUTE_ASSIGNMENT_OPTIONS.includes(routeAssignment);
                    const isCustomRouteEditorOpen = isCustomRouteAssignment || !!publishedCustomRouteEditorByClient[item.clientId];
                    const hasIncidentBlock = incidentActionsByUnit[item.unitId.trim().toUpperCase()]?.urgent === true;
                    return (
                      <article className={`ar-route-mobile-card ${routeUrgency !== "normal" ? `ar-route-mobile-card--${routeUrgency}` : ""}${hasIncidentBlock ? " ar-route-incident-blocked" : ""}`} key={`published-mobile-${item.clientId}`}>
                        <div className="ar-route-mobile-head">
                          <div className="ar-route-mobile-unit">
                            <strong className="ar-unit-id">{item.unitId}</strong>
                            <span title={item.clientName}>{item.clientName}</span>
                          </div>
                          <div className="ar-route-mobile-amount">
                            <small>Min. liberar</small>
                            <strong>{item.releaseAmount > 0 ? formatCurrency(item.releaseAmount) : "Monto pendiente"}</strong>
                          </div>
                        </div>
                        {routeUrgency !== "normal" ? (
                          <div className={`ar-route-alarm ar-route-alarm--${routeUrgency}`}>
                            {routeUrgency === "very_urgent" ? "Muy urgente" : "Urgente"}
                          </div>
                        ) : null}
                        {hasIncidentBlock ? <div className="ar-incident-route-block">Acción de siniestros obligatoria · solo se permite sacar la unidad de ruta</div> : null}
                        <div className="ar-route-mobile-meta">
                          <span>{item.daysLate > 0 ? `${item.daysLate} dias de atraso` : "Sin atraso"}</span>
                          <span>
                            Vencido {formatCurrency(item.overdueBalance)}
                            <small className="ar-overdue-chip-installments">{overdueInstallmentsText(item.overdueBalance, item.rentAmount)}</small>
                          </span>
                          <span>En calle {formatActiveRouteAddedAt(item.publishedAt)}</span>
                        </div>
                        <div className="ar-route-mobile-controls">
                          <label>
                            <span>Tipo</span>
                            <select
                              className="ar-route-list-type"
                              value={item.managementType ?? "solo_cobrar"}
                              onChange={(event) => handlePublishedRouteTypeChange(item.clientId, event.target.value as FieldManagementType)}
                              disabled={readOnly || hasIncidentBlock}
                            >
                              <option value="solo_cobrar">Solo cobrar</option>
                              <option value="cobrar_o_quitar">Cobrar o quitar</option>
                              <option value="desiste">Desiste</option>
                              <option value="quitar">Quitar</option>
                            </select>
                          </label>
                          <label>
                            <span>Min. liberar</span>
                            <input
                              className="ar-route-list-amount"
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={publishedRouteAmountDraftByClient[item.clientId] ?? (item.releaseAmount > 0 ? String(item.releaseAmount) : "")}
                              onChange={(event) => handlePublishedRouteReleaseAmountChange(item.clientId, event.target.value)}
                              onBlur={() => commitPublishedRouteReleaseAmount(item.clientId)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              disabled={readOnly || hasIncidentBlock}
                            />
                          </label>
                          <label>
                            <span>Ruta</span>
                            {isCustomRouteEditorOpen ? (
                              <input
                                className="ar-route-list-route-custom"
                                type="text"
                                value={routeAssignment}
                                onChange={(event) => handlePublishedRouteAssignmentChange(item.clientId, event.target.value)}
                                onBlur={(event) => {
                                  const normalized = normalizeRouteAssignment(event.target.value);
                                  if (event.target.value !== (normalized ?? "")) handlePublishedRouteAssignmentChange(item.clientId, normalized ?? "");
                                  if (!normalized) setPublishedCustomRouteEditorByClient((current) => ({ ...current, [item.clientId]: false }));
                                }}
                                placeholder="Escribe ruta"
                                maxLength={12}
                                disabled={readOnly || hasIncidentBlock}
                              />
                            ) : (
                              <select
                                className="ar-route-list-route"
                                value={routeAssignment}
                                onChange={(event) => {
                                  const selected = event.target.value;
                                  if (selected === "__custom") {
                                    setPublishedCustomRouteEditorByClient((current) => ({ ...current, [item.clientId]: true }));
                                    handlePublishedRouteAssignmentChange(item.clientId, "");
                                    return;
                                  }
                                  setPublishedCustomRouteEditorByClient((current) => ({ ...current, [item.clientId]: false }));
                                  handlePublishedRouteAssignmentChange(item.clientId, selected);
                                }}
                                disabled={readOnly || hasIncidentBlock}
                              >
                                <option value="">Sin ruta</option>
                                {ROUTE_ASSIGNMENT_OPTIONS.map((option) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                                <option value="__custom">Otra</option>
                              </select>
                            )}
                          </label>
                          <label className="ar-route-mobile-comment">
                            <span>Comentario</span>
                            <input
                              className="ar-route-list-comment"
                              type="text"
                              value={publishedRouteCommentDraftByClient[item.clientId] ?? item.comment ?? ""}
                              onChange={(event) => handlePublishedRouteCommentChange(item.clientId, event.target.value)}
                              onBlur={() => commitPublishedRouteComment(item.clientId)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              placeholder="Comentario..."
                              maxLength={25}
                              disabled={readOnly || hasIncidentBlock}
                            />
                          </label>
                          <label>
                            <span>Alarma</span>
                            <select
                              className={`ar-route-urgency-select ar-route-urgency-select--${routeUrgency}`}
                              value={routeUrgency}
                              onChange={(event) => handlePublishedRouteUrgencyChange(item.clientId, event.target.value as RouteUrgency)}
                              disabled={readOnly || hasIncidentBlock}
                            >
                              {ROUTE_URGENCY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <button
                          type="button"
                          className="button ghost small ar-route-list-remove ar-route-mobile-remove"
                          onClick={() => void handleRemoveFromPublishedRoute(item.clientId)}
                          disabled={readOnly}
                          title={readOnly ? "No tienes permiso para editar cuentas por cobrar." : undefined}
                        >
                          Sacar de Ruta en calle
                        </button>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="hint">
                {activeRouteLoading
                  ? "Cargando ruta en calle..."
                  : activeVisibleRouteItems.length > 0
                  ? "No hay clientes en esa ruta."
                  : "No hay clientes activos en Ruta en calle."}
              </p>
            )}
          </div>
        ) : (
          <ReceivablesLedgerTable
            tableScrollRef={tableScrollRef}
            viewMode={viewMode}
            selectedHistoryDate={selectedHistoryDate}
            selectedHistoryRows={selectedHistoryRows}
            rows={rows}
            collectionStatusByClient={collectionStatusByClient}
            clientStatusById={clientStatusById}
            todayDateKey={todayDateKey}
            now={now}
            isTodayCollectionClosed={isCollectionLocked}
            workflowTab={workflowTab}
            todayCollectionCuts={todayCollectionCuts}
            visibleCollectionCut={visibleCollectionCut}
            buildWhatsAppReceivableMessage={buildWhatsAppReceivableMessage}
            getWhatsAppGroupRows={getWhatsAppGroupRows}
            getStatementGroupRows={getStatementGroupRows}
            onSelectDetail={setSelectedDetailRow}
            onCollectionCutStatusChange={handleCollectionCutStatusChange}
            onCollectionCutCommentChange={handleCollectionCutCommentChange}
            onRouteTagChange={handleRouteTagChange}
            onRouteManagementTypeChange={handleRouteManagementTypeChange}
            onRouteManagementCommentChange={handleRouteManagementCommentChange}
            onRouteAssignmentChange={handleRouteAssignmentChange}
            onRouteUrgencyChange={handleRouteUrgencyChange}
            onRouteReleaseAmountChange={handleRouteReleaseAmountChange}
            onRemoveFromRoute={handleRemoveFromRoute}
            onWhatsAppMessageSent={handleWhatsAppMessageSent}
            onSupportNoteChange={handleSupportNoteChange}
            onContactTimeChange={handleContactTimeChange}
            onClearFilters={clearFilters}
            incidentActionsByUnit={incidentActionsByUnit}
          />
        )}
      </section>

      {selectedDetailRow && (
        <ReceivableDetailModal
          row={selectedDetailRow}
          onClose={() => setSelectedDetailRow(null)}
        />
      )}

      {pendingContactPrompt ? (
        <div className="modal-overlay" onClick={() => setPendingContactPrompt(null)}>
          <div
            className="modal confirm-modal ar-pending-contact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-contact-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="pending-contact-title">
                {pendingContactPrompt.step === "question" ? "Gestión pendiente" : "Hora de contacto"}
              </h2>
              <button type="button" className="modal-close" onClick={() => setPendingContactPrompt(null)} aria-label="Cerrar">X</button>
            </div>
            <div className="confirm-modal-body ar-pending-contact-body">
              {pendingContactRow ? (
                <span className="ar-pending-contact-client">
                  {pendingContactRow.unitId} · {pendingContactRow.name}
                </span>
              ) : null}
              {pendingContactPrompt.step === "question" ? (
                <>
                  <p>¿Gustas ponerle una hora de contacto?</p>
                  <div className="confirm-modal-actions">
                    <button type="button" className="button primary" onClick={openPendingContactTimeSelection}>Sí</button>
                    <button type="button" className="button ghost" onClick={leavePendingWithoutContactTime}>No, dejar pendiente</button>
                  </div>
                </>
              ) : (
                <>
                  {pendingContactTimeOptions.length > 0 ? (
                    <label className="form-field ar-pending-contact-field">
                      Selecciona la hora
                      <select
                        value={pendingContactPrompt.selectedTime}
                        onChange={(event) => setPendingContactPrompt((current) => current
                          ? { ...current, selectedTime: event.target.value }
                          : current)}
                        autoFocus
                      >
                        {pendingContactTimeOptions.map((time) => (
                          <option key={time} value={time}>{time}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p>Ya no quedan horarios de hoy disponibles en intervalos de 30 minutos.</p>
                  )}
                  <div className="confirm-modal-actions">
                    {pendingContactTimeOptions.length > 0 ? (
                      <button
                        type="button"
                        className="button primary"
                        onClick={confirmPendingContactTime}
                        disabled={!pendingContactPrompt.selectedTime}
                      >
                        Guardar hora
                      </button>
                    ) : (
                      <button type="button" className="button primary" onClick={leavePendingWithoutContactTime}>Dejar pendiente sin hora</button>
                    )}
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => setPendingContactPrompt((current) => current
                        ? { ...current, step: "question", selectedTime: "" }
                        : current)}
                    >
                      Volver
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isAddPublishedRouteOpen ? (
        <div className="modal-overlay" onClick={() => setIsAddPublishedRouteOpen(false)}>
          <div className="modal ar-add-route-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Agregar unidad a Ruta en calle</h2>
              <button type="button" className="modal-close" onClick={() => setIsAddPublishedRouteOpen(false)}>X</button>
            </div>
            <div className="modal-body">
              {publishedRouteDraftError ? <p className="error-text">{publishedRouteDraftError}</p> : null}
              <div className="form-grid">
                <label>Unidad
                  <select
                    value={publishedRouteDraft.clientId}
                    onChange={(event) => updatePublishedRouteDraftClient(event.target.value)}
                  >
                    <option value="">Seleccionar unidad</option>
                    {publishedRouteAddRows.map((row) => (
                      <option key={row.id} value={row.id}>{row.unitId} - {row.name}</option>
                    ))}
                  </select>
                </label>
                <label>Tipo
                  <select
                    value={publishedRouteDraft.type}
                    onChange={(event) => setPublishedRouteDraft((current) => ({ ...current, type: event.target.value as FieldManagementType }))}
                  >
                    <option value="solo_cobrar">Solo cobrar</option>
                    <option value="cobrar_o_quitar">Cobrar o quitar</option>
                    <option value="desiste">Desiste</option>
                    <option value="quitar">Quitar</option>
                  </select>
                </label>
                <label>MIN. LIBERAR
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={publishedRouteDraft.amount}
                    onChange={(event) => setPublishedRouteDraft((current) => ({ ...current, amount: event.target.value }))}
                    placeholder={publishedRouteSuggestedReleaseAmount > 0 ? publishedRouteSuggestedReleaseAmount.toFixed(2) : "0.00"}
                  />
                  {publishedRouteSuggestedReleaseAmount > 0 ? (
                    <span className="hint ar-add-route-suggestion">Sugerido: {formatCurrency(publishedRouteSuggestedReleaseAmount)}</span>
                  ) : null}
                </label>
                <label>Ruta
                  {isPublishedRouteDraftCustomRouteOpen ? (
                    <input
                      className="ar-route-list-route-custom"
                      value={publishedRouteDraft.routeAssignment}
                      onChange={(event) => setPublishedRouteDraft((current) => ({ ...current, routeAssignment: event.target.value.toUpperCase().slice(0, 12) }))}
                      onBlur={(event) => {
                        const normalized = normalizeRouteAssignment(event.target.value);
                        if (event.target.value !== (normalized ?? "")) {
                          setPublishedRouteDraft((current) => ({ ...current, routeAssignment: normalized ?? "" }));
                        }
                        if (!normalized) setIsPublishedRouteDraftCustomRouteOpen(false);
                      }}
                      placeholder="Escribe ruta"
                      maxLength={12}
                      autoFocus
                    />
                  ) : (
                    <select
                      className="ar-route-list-route"
                      value={publishedRouteDraft.routeAssignment}
                      onChange={(event) => {
                        const selected = event.target.value;
                        if (selected === "__custom") {
                          setPublishedRouteDraft((current) => ({ ...current, routeAssignment: "" }));
                          setIsPublishedRouteDraftCustomRouteOpen(true);
                          return;
                        }
                        setPublishedRouteDraft((current) => ({ ...current, routeAssignment: selected }));
                      }}
                    >
                      <option value="">Sin ruta</option>
                      {ROUTE_ASSIGNMENT_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                      <option value="__custom">Otra</option>
                    </select>
                  )}
                </label>
                <label>Alarma
                  <select
                    value={publishedRouteDraft.urgency}
                    onChange={(event) => setPublishedRouteDraft((current) => ({ ...current, urgency: event.target.value as RouteUrgency }))}
                  >
                    {ROUTE_URGENCY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>Comentario
                  <input
                    value={publishedRouteDraft.comment}
                    onChange={(event) => setPublishedRouteDraft((current) => ({ ...current, comment: event.target.value }))}
                    placeholder="Comentario..."
                    maxLength={25}
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="button primary" onClick={() => void handleAddPublishedRoute()} disabled={!canSavePublishedRouteDraft}>
                  Agregar
                </button>
                <button type="button" className="button ghost" onClick={() => setIsAddPublishedRouteOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isClearManagementConfirmOpen ? (
        <div className="modal-overlay" onClick={cancelClearCollectionManagement}>
          <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Limpiar gestion</h2>
              <button type="button" className="modal-close" onClick={cancelClearCollectionManagement} disabled={isClearingCollectionManagement}>X</button>
            </div>
            <div className="confirm-modal-body">
              <p>
                Esta accion borra los estados, notas y asignaciones vivas de cuentas por cobrar
                {clearableManagementRecordsCount > 0 ? ` (${clearableManagementRecordsCount} registro${clearableManagementRecordsCount === 1 ? "" : "s"}).` : "."}
              </p>
              <label className="form-field">
                Escribe {CLEAR_COLLECTION_MANAGEMENT_CONFIRMATION} para confirmar
                <input
                  value={clearManagementConfirmation}
                  onChange={(event) => setClearManagementConfirmation(event.target.value)}
                  disabled={isClearingCollectionManagement}
                  autoFocus
                />
              </label>
              <div className="confirm-modal-actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="button danger"
                  onClick={() => void handleClearCollectionManagement()}
                  disabled={isClearingCollectionManagement || !canConfirmClearManagement}
                >
                  {isClearingCollectionManagement ? "Limpiando..." : "Limpiar gestion"}
                </button>
                <button type="button" className="button ghost" onClick={cancelClearCollectionManagement} disabled={isClearingCollectionManagement}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
