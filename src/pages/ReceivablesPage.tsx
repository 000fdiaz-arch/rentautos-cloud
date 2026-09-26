import RouteSearchPage, { type RouteSearchPageProps } from "./RouteSearchPage";
import "./receivables/receivablesResponsive.css";
import { getBusinessDateKey } from "../billing";
import { getRouteWorkItems, routeRentAmountForDay } from "../routeReviewRules";
import { loadRoutePaymentReports } from "../cloud/routeReportCloudData";
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
  activeRouteDeltaFromPayload,
  applyActiveRouteDelta,
  loadCloudCollectionClosures,
  loadCloudLatestPaymentsForReceivableTargets,
  paymentMatchesTargetIdentity,
  loadCloudActiveRouteItems,
  loadCloudStreetManagement,
  loadCollisionCases,
  loadControlUnits,
  removeCloudActiveRouteItem,
  saveCloudActiveRouteItem,
  saveCloudCollectionClosures,
  saveCloudStreetManagement,
  syncCloudStreetManagementDelta,
  type ActiveRouteItem,
  type ActiveRouteDelta,
  type CollisionCaseRecord,
  type ControlUnitRow
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
import type { BillingFrequency, Client, Payment } from "../types";
import type {
  CollectionStatus,
  CollectionStatusRecord,
  DailyContactResult,
  DailyContactShift,
  FieldManagementType,
  RouteUrgency,
  RouteExportFormat,
  WhatsAppContactFilter
} from "./receivables/receivablesTypes";
import { ReceivableDetailModal } from "./receivables/ReceivableDetailModal";
import { ReceivablesFiltersPanel } from "./receivables/ReceivablesFiltersPanel";
import { ReceivablesLedgerTable, type ReceivablesHistoryRow } from "./receivables/ReceivablesLedgerTable";
import { ReceivablesPriorityList, type PriorityRouteRequest } from "./receivables/ReceivablesPriorityList";
import {
  buildPriorityReceivables,
  formatCalendarDuration,
  priorityOverdueInstallmentCount,
  priorityTenureBucket,
  routeUrgencyForPriority,
  type PriorityTenureBucket,
  type ReceivablePriorityLevel
} from "./receivables/receivablesPriority";
import { buildJudicialActionsByUnit } from "./receivables/incidentReceivableActions";
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

const RECEIVABLES_PERF_LOGS_ENABLED = import.meta.env.VITE_PERF_LOGS === "1";
const STREET_MANAGEMENT_SAVE_DEBOUNCE_MS = 650;

async function measureReceivablesAsync<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!RECEIVABLES_PERF_LOGS_ENABLED) return task();
  const startedAt = performance.now();
  try {
    return await task();
  } finally {
    console.info(`[Rentautos perf] receivables ${label}: ${Math.round(performance.now() - startedAt)}ms`);
  }
}

function measureReceivablesSync<T>(label: string, task: () => T): T {
  if (!RECEIVABLES_PERF_LOGS_ENABLED) return task();
  const startedAt = performance.now();
  try {
    return task();
  } finally {
    console.info(`[Rentautos perf] receivables ${label}: ${Math.round(performance.now() - startedAt)}ms`);
  }
}

type Props = {
  routePermissions?: Pick<RouteSearchPageProps, "currentUserId" | "canReportPayment" | "readOnly" | "canRemoveFromRoute" | "onRegisterPayment" | "paymentsLoading">;
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


type ManagementRouteDraft = {
  clientId: string;
  unitId: string;
  clientName: string;
  amount: string;
  routeAssignment: string;
  customRoute: boolean;
  managementType: FieldManagementType;
  urgency: RouteUrgency;
  comment: string;
};

type EssentialManagementFilter = "all" | "pending" | "contacted" | "automatic";
type EssentialPortfolioFilter = "all" | "portfolio-1" | "portfolio-2";
type EssentialPriorityLevelFilter = "all" | ReceivablePriorityLevel;
type EssentialPlanFilter = "all" | BillingFrequency;
type EssentialInstallmentFilter = "all" | `${number}`;
type EssentialPaymentDaysFilter = "all" | "no-payments" | `${number}`;
type EssentialTenureFilter = "all" | PriorityTenureBucket;
type EssentialContactChecklistFilter = "all" | `${DailyContactShift}:pending` | `${DailyContactShift}:contacted`;
type EssentialFilterKey =
  | "search"
  | "portfolio"
  | "operational"
  | "management"
  | "priority"
  | "plan"
  | "installments"
  | "paymentDays"
  | "tenure"
  | "contactChecklist";

const STATEMENT_SUGGESTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const CLEAR_COLLECTION_MANAGEMENT_CONFIRMATION = "LIMPIAR GESTION";

function normalizeEssentialFilterValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function essentialPaymentDaysAgo(dateKey: string | null, now: Date): number | null {
  if (!dateKey) return null;
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

const ESSENTIAL_TENURE_OPTIONS: Array<{ value: PriorityTenureBucket; label: string }> = [
  { value: "up_to_30", label: "Hasta 1 mes" },
  { value: "one_to_three", label: "1 a 3 meses" },
  { value: "three_to_six", label: "3 a 6 meses" },
  { value: "six_to_twelve", label: "6 a 12 meses" },
  { value: "one_to_two_years", label: "1 a 2 años" },
  { value: "two_years_plus", label: "2 años o más" }
];

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

function overdueRentForWhatsAppDate(row: ReceivableRow, date: Date): number {
  void date;
  return Math.max(0, Math.min(row.totalPending, row.overdueBalance));
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
  return item.releaseAmount > 0 && routeRentAmountForDay(payments, item, getBusinessDateKey()) >= item.releaseAmount;
}

function routeMissingAmountMessage(rows: ReceivableRow[]): string {
  const units = rows.map((row) => row.unitId).filter(Boolean);
  const visibleUnits = units.slice(0, 8).join(", ");
  const extraCount = Math.max(0, units.length - 8);
  const unitText = visibleUnits ? ` Unidad${units.length === 1 ? "" : "es"}: ${visibleUnits}${extraCount > 0 ? ` y ${extraCount} mas` : ""}.` : "";
  return `Falta Min. liberar en ${rows.length} unidad(es) en cobro en ruta.${unitText}`;
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

function paymentRefreshSignature(payment: Payment): string {
  return JSON.stringify([
    payment.clientId,
    payment.clientUnit,
    payment.clientName,
    payment.clientCedula,
    payment.dateApplied,
    payment.createdAt,
    payment.amountReceived,
    payment.appliedToRent,
    payment.centavosAhorro,
    payment.otherChargesApplied,
    payment.finesApplied,
    payment.ticketsApplied
  ]);
}

export default function ReceivablesPage({
  routePermissions,
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
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean>(false);
  const [workflowTab, setWorkflowTab] = useState<ReceivablesWorkflowTab>("management");
  const [essentialSearch, setEssentialSearch] = useState("");
  const [essentialPortfolioFilter, setEssentialPortfolioFilter] = useState<EssentialPortfolioFilter>("all");
  const [essentialOperationalFilter, setEssentialOperationalFilter] = useState("all");
  const [essentialManagementFilter, setEssentialManagementFilter] = useState<EssentialManagementFilter>("all");
  const [essentialPriorityLevelFilter, setEssentialPriorityLevelFilter] = useState<EssentialPriorityLevelFilter>("all");
  const [essentialPlanFilter, setEssentialPlanFilter] = useState<EssentialPlanFilter>("all");
  const [essentialInstallmentFilter, setEssentialInstallmentFilter] = useState<EssentialInstallmentFilter>("all");
  const [essentialPaymentDaysFilter, setEssentialPaymentDaysFilter] = useState<EssentialPaymentDaysFilter>("all");
  const [essentialTenureFilter, setEssentialTenureFilter] = useState<EssentialTenureFilter>("all");
  const [essentialContactChecklistFilter, setEssentialContactChecklistFilter] = useState<EssentialContactChecklistFilter>("all");
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
  const [autoRouteSending, setAutoRouteSending] = useState(false);
  const [autoRouteErrors, setAutoRouteErrors] = useState<Record<string, string>>({});
  const [autoRouteRetry, setAutoRouteRetry] = useState(0);
  const autoRouteAttempted = useRef(new Set<string>());
  const autoRouteBusy = useRef(false);
  const [isRouteExportMenuOpen, setIsRouteExportMenuOpen] = useState<boolean>(false);
  const [managementRouteDraft, setManagementRouteDraft] = useState<ManagementRouteDraft | null>(null);
  const [exportFields, setExportFields] = useState<ExportField[]>(INITIAL_EXPORT_FIELDS);
  const [fieldManagementModalClientId, setFieldManagementModalClientId] = useState<string | null>(null);
  const [fieldManagementDraftByClient, setFieldManagementDraftByClient] = useState<
    Record<string, { type: FieldManagementType | ""; amount: string; comment: string }>
  >({});
  const [fieldManagementErrorByClient, setFieldManagementErrorByClient] = useState<Record<string, string>>({});
  const [statusSavingByClient, setStatusSavingByClient] = useState<Record<string, boolean>>({});
  const [fleetUnits, setFleetUnits] = useState<ControlUnitRow[]>([]);
  const [collisionCases, setCollisionCases] = useState<CollisionCaseRecord[]>([]);
  const [supplementalLastPayments, setSupplementalLastPayments] = useState<Payment[]>([]);
  const [activeRouteItems, setActiveRouteItems] = useState<ActiveRouteItem[]>([]);
  const [activeRouteLoading, setActiveRouteLoading] = useState<boolean>(false);
  const [activeRouteError, setActiveRouteError] = useState<string>("");
  const [activeRouteMessage, setActiveRouteMessage] = useState<string>("");
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
  const streetPersistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastQueuedStreetSnapshotRef = useRef<string>("");
  const lastStreetSnapshotRef = useRef<string>("");
  const streetPersistPendingRef = useRef<boolean>(false);
  const streetManagementLoadedRef = useRef<boolean>(false);
  const optimisticStatusByClientRef = useRef<Record<string, CollectionStatusRecord>>({});
  const activeRouteItemsRef = useRef<ActiveRouteItem[]>([]);
  const activeRouteLoadingRef = useRef(false);
  const activeRouteLoadIdRef = useRef(0);
  const activeRoutePendingDeltasRef = useRef<ActiveRouteDelta[]>([]);
  const saveTokenByClientRef = useRef<Record<string, number>>({});
  const latestCollectionStatusByClientRef = useRef<Record<string, CollectionStatusRecord>>({});
  const streetManagementDataRef = useRef<Record<string, unknown>>(streetManagementData ?? {});
  const paymentSignaturesRef = useRef<Map<string, string>>(new Map(payments.map((payment) => [payment.id, paymentRefreshSignature(payment)])));
  const paymentsByIdRef = useRef<Map<string, Payment>>(new Map(payments.map((payment) => [payment.id, payment])));
  const affectedLatestPaymentTokenRef = useRef<Map<string, number>>(new Map());
  const dataOwnerUserIdRef = useRef(dataOwnerUserId);
  const onStreetManagementPersistRef = useRef(onStreetManagementPersist);
  dataOwnerUserIdRef.current = dataOwnerUserId;
  onStreetManagementPersistRef.current = onStreetManagementPersist;

  function collectionRecordTimestamp(record: CollectionStatusRecord | undefined): number {
    if (!record) return 0;
    return Math.max(
      toTimestamp(record.updatedAt),
      toTimestamp(record.managementUpdatedAt),
      toTimestamp(record.routeReleaseUpdatedAt),
      toTimestamp(record.supportNoteUpdatedAt),
      toTimestamp(record.contactTimeUpdatedAt),
      toTimestamp(record.operationalReviewedAt),
      toTimestamp(record.routeUrgencyUpdatedAt),
      toTimestamp(record.priorityDebtCapUpdatedAt),
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
    if (!dataOwnerUserId) { setCollisionCases([]); return; }
    let cancelled = false;
    measureReceivablesAsync("judicial actions load", () => loadCollisionCases(dataOwnerUserId))
      .then((collisions) => {
        if (cancelled) return;
        setCollisionCases(collisions);
      })
      .catch((error) => {
        console.error("No se pudieron cargar las acciones judiciales en cuentas por cobrar.", error);
        if (!cancelled) setCollisionCases([]);
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
      const cloudData = await measureReceivablesAsync(
        "street management load",
        () => loadCloudStreetManagement(dataOwnerUserId)
      );
      applyStreetManagementData(cloudData);
    } catch (error) {
      console.error("No se pudo cargar gestion de cobranza desde nube.", error);
      applyStreetManagementData(streetManagementDataRef.current);
    }
  }, [applyStreetManagementData, dataOwnerUserId]);

  const loadActiveRouteFromCloud = useCallback(async (): Promise<void> => {
    const loadId = ++activeRouteLoadIdRef.current;
    activeRoutePendingDeltasRef.current = [];
    if (!dataOwnerUserId) {
      activeRouteLoadingRef.current = false;
      setActiveRouteItems([]);
      activeRouteItemsRef.current = [];
      setActiveRouteLoading(false);
      setActiveRouteError("");
      return;
    }
    activeRouteLoadingRef.current = true;
    setActiveRouteLoading(true);
    setActiveRouteError("");
    try {
      const loadedRows = await measureReceivablesAsync(
        "active route load",
        () => loadCloudActiveRouteItems(dataOwnerUserId)
      );
      if (loadId !== activeRouteLoadIdRef.current) return;
      const rows = activeRoutePendingDeltasRef.current.reduce(applyActiveRouteDelta, loadedRows);
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
      if (loadId !== activeRouteLoadIdRef.current) return;
      console.error("No se pudo cargar la ruta en calle.", error);
      setActiveRouteError("No se pudo cargar la Ruta en calle.");
    } finally {
      if (loadId === activeRouteLoadIdRef.current) {
        activeRoutePendingDeltasRef.current = [];
        activeRouteLoadingRef.current = false;
        setActiveRouteLoading(false);
      }
    }
  }, [dataOwnerUserId]);

  useEffect(() => {
    void loadStreetManagementFromCloud();
  }, [loadStreetManagementFromCloud]);

  useEffect(() => {
    void loadActiveRouteFromCloud();
  }, [loadActiveRouteFromCloud]);

  useEffect(() => {
    if (!dataOwnerUserId) {
      setFleetUnits([]);
      return;
    }
    let cancelled = false;
    measureReceivablesAsync("fleet units load", () => loadControlUnits(dataOwnerUserId))
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

  const enqueueStreetManagementPersist = useCallback((
    nextSnapshot: Record<string, CollectionStatusRecord>,
    serialized: string,
    ownerUserId: string | null | undefined,
    localPersist: Props["onStreetManagementPersist"]
  ): Promise<void> => {
    const queueKey = `${ownerUserId ?? "local"}:${serialized}`;
    if (serialized === lastStreetSnapshotRef.current || queueKey === lastQueuedStreetSnapshotRef.current) {
      return streetPersistQueueRef.current;
    }
    lastQueuedStreetSnapshotRef.current = queueKey;
    streetPersistPendingRef.current = true;
    const saveTokenSnapshot = { ...saveTokenByClientRef.current };
    const run = async (): Promise<void> => {
      let persisted = false;
      const previousSnapshot = parseCollectionStatusMapFromStorage(lastStreetSnapshotRef.current);
      try {
        if (ownerUserId) {
          await syncCloudStreetManagementDelta(
            ownerUserId,
            previousSnapshot as Record<string, unknown>,
            nextSnapshot as Record<string, unknown>
          );
          persisted = true;
        } else if (localPersist) {
          persisted = (await localPersist(nextSnapshot as Record<string, unknown>)) !== false;
        } else {
          persisted = true;
        }
        if (persisted) lastStreetSnapshotRef.current = serialized;
      } catch (error) {
        console.error("No se pudo guardar la gestion de cobranza.", error);
        setCollectionCutMessage("No se pudo guardar la gestion de cobranza. Revisa la conexion e intenta nuevamente.");
      } finally {
        if (lastQueuedStreetSnapshotRef.current === queueKey) lastQueuedStreetSnapshotRef.current = "";
        const latestSerialized = JSON.stringify(latestCollectionStatusByClientRef.current);
        if (latestSerialized === serialized || latestSerialized === lastStreetSnapshotRef.current) {
          streetPersistPendingRef.current = false;
        }
        setStatusSavingByClient((current) => {
          const next = { ...current };
          for (const [clientId, token] of Object.entries(saveTokenSnapshot)) {
            if (saveTokenByClientRef.current[clientId] === token) next[clientId] = false;
          }
          return next;
        });
      }
    };
    const queued = streetPersistQueueRef.current.catch(() => undefined).then(run);
    streetPersistQueueRef.current = queued;
    return queued;
  }, []);

  const flushStreetManagementPersist = useCallback((): void => {
    if (!streetPersistPendingRef.current) return;
    if (persistStreetTimerRef.current) {
      window.clearTimeout(persistStreetTimerRef.current);
      persistStreetTimerRef.current = null;
    }
    const latestSnapshot = latestCollectionStatusByClientRef.current;
    const serialized = JSON.stringify(latestSnapshot);
    if (serialized === lastStreetSnapshotRef.current) {
      streetPersistPendingRef.current = false;
      return;
    }
    void enqueueStreetManagementPersist(
      latestSnapshot,
      serialized,
      dataOwnerUserIdRef.current,
      onStreetManagementPersistRef.current
    );
  }, [enqueueStreetManagementPersist]);

  useEffect(() => {
    const serialized = JSON.stringify(collectionStatusByClient);
    latestCollectionStatusByClientRef.current = collectionStatusByClient;
    if (dataOwnerUserId && !streetManagementLoadedRef.current) return;
    if (serialized === lastStreetSnapshotRef.current) return;
    streetPersistPendingRef.current = true;
    if (persistStreetTimerRef.current) window.clearTimeout(persistStreetTimerRef.current);
    persistStreetTimerRef.current = window.setTimeout(() => {
      persistStreetTimerRef.current = null;
      void enqueueStreetManagementPersist(
        collectionStatusByClient,
        serialized,
        dataOwnerUserId,
        onStreetManagementPersist
      );
    }, STREET_MANAGEMENT_SAVE_DEBOUNCE_MS);
  }, [collectionStatusByClient, dataOwnerUserId, enqueueStreetManagementPersist, onStreetManagementPersist]);

  useEffect(() => {
    const flushWhenHidden = (): void => {
      if (document.visibilityState === "hidden") flushStreetManagementPersist();
    };
    window.addEventListener("pagehide", flushStreetManagementPersist);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushStreetManagementPersist);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flushStreetManagementPersist();
    };
  }, [flushStreetManagementPersist]);

  const loadCollectionClosuresFromCloud = useCallback(async (): Promise<void> => {
    if (!dataOwnerUserId) {
      setCollectionClosuresByDate({});
      setCollectionClosuresLoaded(false);
      return;
    }
    setIsCollectionClosuresLoading(true);
    try {
      const rows = await measureReceivablesAsync(
        "collection closures load",
        () => loadCloudCollectionClosures(dataOwnerUserId)
      );
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
    let subscribed = false;
    const channel = client
      .channel(`street-management-items-live-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "street_management_items_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, (payload) => {
        applyStreetManagementItemPayload(payload);
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (subscribed) void loadStreetManagementFromCloud();
        subscribed = true;
      });
    return () => {
      void client.removeChannel(channel);
    };
  }, [applyStreetManagementItemPayload, dataOwnerUserId, loadStreetManagementFromCloud]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase) return;
    const client = supabase;
    let subscribed = false;
    const channel = client
      .channel(`active-route-items-live-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_route_items_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, (payload) => {
        const delta = activeRouteDeltaFromPayload(payload);
        if (!delta) {
          void loadActiveRouteFromCloud();
          return;
        }
        if (activeRouteLoadingRef.current) activeRoutePendingDeltasRef.current.push(delta);
        activeRouteItemsRef.current = applyActiveRouteDelta(activeRouteItemsRef.current, delta);
        setActiveRouteItems(activeRouteItemsRef.current);
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (subscribed) void loadActiveRouteFromCloud();
        subscribed = true;
      });
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
  const judicialActionsByUnit = useMemo(
    () => buildJudicialActionsByUnit(collisionCases, todayDateKey),
    [collisionCases, todayDateKey]
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

  const activeReceivableLookupTargets = useMemo(() => clients
    .filter((client) => client.status !== "archivado" && !client.archivedAt)
    .map((client) => ({
      clientId: client.id,
      unitId: client.unitId,
      name: client.name,
      cedula: client.cedula
    })), [clients]);
  const activeReceivableLookupIdentityKey = JSON.stringify(activeReceivableLookupTargets);

  const baseRows = useMemo(() => {
    if (clients.length === 0) return createMockReceivableRows(receivablesDate);
    return measureReceivablesSync(
      "ledger calculation",
      () => buildReceivableRows(clients, receivablePayments, receivablesDate, fleetUnits)
    );
  }, [clients, fleetUnits, receivablePayments, receivablesDate]);

  useEffect(() => {
    setSupplementalLastPayments([]);
  }, [dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId || activeReceivableLookupTargets.length === 0) {
      setSupplementalLastPayments([]);
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    let retryCount = 0;
    const targetTokensAtLoad = new Map(activeReceivableLookupTargets.map((target) => [
      target.clientId,
      affectedLatestPaymentTokenRef.current.get(target.clientId) ?? 0
    ]));
    const loadLatestPayments = (): void => {
      void measureReceivablesAsync(
        "latest payments load",
        () => loadCloudLatestPaymentsForReceivableTargets(dataOwnerUserId, activeReceivableLookupTargets)
      )
        .then((latestPayments) => {
          if (cancelled) return;
          setSupplementalLastPayments((current) => {
            const targetsChangedWhileLoading = activeReceivableLookupTargets.filter((target) => (
              (affectedLatestPaymentTokenRef.current.get(target.clientId) ?? 0) !== targetTokensAtLoad.get(target.clientId)
            ));
            const unchangedTargets = activeReceivableLookupTargets.filter((target) => !targetsChangedWhileLoading.includes(target));
            return [
              ...current.filter((payment) => targetsChangedWhileLoading.some((target) => paymentMatchesTargetIdentity(payment, target))),
              ...latestPayments.filter((payment) => unchangedTargets.some((target) => paymentMatchesTargetIdentity(payment, target)))
            ];
          });
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
  }, [activeReceivableLookupIdentityKey, dataOwnerUserId]);

  useEffect(() => {
    const previousSignatures = paymentSignaturesRef.current;
    const previousPaymentsById = paymentsByIdRef.current;
    const nextSignatures = new Map(payments.map((payment) => [payment.id, paymentRefreshSignature(payment)]));
    paymentSignaturesRef.current = nextSignatures;
    paymentsByIdRef.current = new Map(payments.map((payment) => [payment.id, payment]));
    if (!dataOwnerUserId || activeReceivableLookupTargets.length === 0) return;

    const changedPayments: Payment[] = [];
    const currentById = new Map(payments.map((payment) => [payment.id, payment]));
    for (const payment of payments) {
      if (previousSignatures.get(payment.id) !== nextSignatures.get(payment.id)) changedPayments.push(payment);
    }
    for (const paymentId of previousSignatures.keys()) {
      if (nextSignatures.has(paymentId)) continue;
      const previousPayment = previousPaymentsById.get(paymentId);
      if (previousPayment) changedPayments.push(previousPayment);
    }
    if (changedPayments.length === 0) return;

    const affectedTargets = activeReceivableLookupTargets.filter((target) => (
      changedPayments.some((payment) => paymentMatchesTargetIdentity(payment, target))
    ));
    if (affectedTargets.length === 0) return;
    const targetTokens = new Map(affectedTargets.map((target) => {
      const token = (affectedLatestPaymentTokenRef.current.get(target.clientId) ?? 0) + 1;
      affectedLatestPaymentTokenRef.current.set(target.clientId, token);
      return [target.clientId, token] as const;
    }));
    void measureReceivablesAsync(
      "affected latest payments refresh",
      () => loadCloudLatestPaymentsForReceivableTargets(dataOwnerUserId, affectedTargets)
    ).then((latestPayments) => {
      if (dataOwnerUserIdRef.current !== dataOwnerUserId) return;
      const currentTargets = affectedTargets.filter((target) => (
        affectedLatestPaymentTokenRef.current.get(target.clientId) === targetTokens.get(target.clientId)
      ));
      if (currentTargets.length === 0) return;
      setSupplementalLastPayments((current) => [
        ...current.filter((payment) => !currentTargets.some((target) => paymentMatchesTargetIdentity(payment, target))),
        ...latestPayments.filter((payment) => (
          !currentById.has(payment.id) && currentTargets.some((target) => paymentMatchesTargetIdentity(payment, target))
        ))
      ]);
    }).catch((error) => {
      if (dataOwnerUserIdRef.current === dataOwnerUserId) console.error("No se pudo refrescar el ultimo pago afectado.", error);
    });
  }, [activeReceivableLookupIdentityKey, dataOwnerUserId, payments]);

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [collectionStatusFilter, essentialContactChecklistFilter, essentialInstallmentFilter, essentialManagementFilter, essentialOperationalFilter, essentialPaymentDaysFilter, essentialPlanFilter, essentialPortfolioFilter, essentialPriorityLevelFilter, essentialSearch, essentialTenureFilter, filters, routeTagFilter, sortDirection, sortField, viewMode, whatsAppContactFilter, workflowTab]);

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
      const routeStartedAt = record.routeTaggedAt ?? record.routeReleaseUpdatedAt ?? record.managementUpdatedAt ?? record.updatedAt;
      const hasReleasePayment = releaseAmount > 0 && routeRentAmountForDay(payments, { clientId, routeStartedAt }, getBusinessDateKey()) >= releaseAmount;
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
    [activeVisibleRouteClientIds, baseRows, blockingRemovedRouteClientIds, collectionStatusByClient, todayCollectionCuts]
  );
  const canDownloadPublishedRoute = activeVisibleRouteItems.length > 0;
  useEffect(() => {
    if (!dataOwnerUserId || !supabase || !clients.length || readOnly || isCollectionLocked || activeRouteLoading || activeRouteError || autoRouteBusy.current || !streetManagementLoadedRef.current) return;
    const candidates = baseRows.filter(row => {
      const record = collectionStatusByClient[row.id];
      return hasActiveOperationalClient(row) && record?.isRouteTagged && hasRouteReleaseAmount(record)
        && !!record.routeAssignment?.trim() && !statusSavingByClient[row.id]
        && !activeRouteItems.some(item => item.clientId === row.id && !item.removedAt)
        && !routeRemovalBlocksRecord(record, removedRouteItemByClient.get(row.id))
        && !autoRouteAttempted.current.has(JSON.stringify([dataOwnerUserId, row.id, record.updatedAt, autoRouteRetry]));
    });
    if (!candidates.length) return;
    const timer = window.setTimeout(() => {
      autoRouteBusy.current = true; setAutoRouteSending(true);
      void (async () => {
        try {
          for (const row of candidates) {
            const record = collectionStatusByClient[row.id];
            const key = JSON.stringify([dataOwnerUserId, row.id, record.updatedAt, autoRouteRetry]);
            autoRouteAttempted.current.add(key);
            const item = buildActiveRouteItem(row, record, new Date().toISOString());
            if (!item) continue;
            try {
              const { error } = await supabase!.rpc("publish_prepared_route_item", { p_user_id: dataOwnerUserId, p_item: item, p_expected_updated_at: record.updatedAt });
              if (error) throw error;
              setAutoRouteErrors(current => { const next = { ...current }; delete next[row.id]; return next; });
              setRouteExportMessage(row.unitId + " · Enviada a ruta.");
            } catch (cause) {
              console.error("No se pudo enviar la unidad a ruta.", cause);
              setAutoRouteErrors(current => ({ ...current, [row.id]: row.unitId }));
            }
          }
          await loadActiveRouteFromCloud();
        } finally { autoRouteBusy.current = false; setAutoRouteSending(false); }
      })();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dataOwnerUserId, clients.length, readOnly, isCollectionLocked, activeRouteLoading, activeRouteError, baseRows, collectionStatusByClient, statusSavingByClient, activeRouteItems, removedRouteItemByClient, autoRouteRetry, autoRouteSending, loadActiveRouteFromCloud]);

  async function retryAutoRoutePublication(): Promise<void> {
    if (!dataOwnerUserId || readOnly || autoRouteBusy.current) return;
    autoRouteBusy.current = true; setAutoRouteSending(true);
    try {
      const cloud = await loadCloudStreetManagement(dataOwnerUserId);
      await syncCloudStreetManagementDelta(dataOwnerUserId, cloud, { ...cloud, ...latestCollectionStatusByClientRef.current });
      await loadStreetManagementFromCloud();
      await loadActiveRouteFromCloud();
      autoRouteAttempted.current.clear(); setAutoRouteErrors({}); setAutoRouteRetry(value => value + 1);
    } catch (cause) { console.error("No se pudo reintentar el envío.", cause); }
    finally { autoRouteBusy.current = false; setAutoRouteSending(false); }
  }

  const publishedRouteAddRows = useMemo(
    () => baseRows.filter((row) => hasActiveOperationalClient(row) && !activeVisibleRouteClientIds.has(row.id)),
    [activeVisibleRouteClientIds, baseRows]
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
  const priorityWorkflowRowsCount = baseRows.filter((row) => hasActiveOperationalClient(row) && row.overdueBalance > 0).length;
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
  const essentialPriorityRows = useMemo(
    () => measureReceivablesSync(
      "priority calculation",
      () => buildPriorityReceivables(baseRows, clients, receivablePayments, collectionStatusByClient, now)
    ),
    [baseRows, clients, collectionStatusByClient, now, receivablePayments]
  );
  const essentialPriorityByClient = useMemo(
    () => new Map(essentialPriorityRows.map((item) => [item.row.id, item])),
    [essentialPriorityRows]
  );
  const essentialTenureLabelByClient = useMemo(() => {
    const priorityByClient = new Map(essentialPriorityRows.map((item) => [item.row.id, item]));
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    return new Map(baseRows.map((row) => {
      const priorityItem = priorityByClient.get(row.id);
      if (priorityItem) return [row.id, formatCalendarDuration(priorityItem.tenureStart, now)] as const;
      const client = clientsById.get(row.id);
      const createdAt = client?.createdAt ? new Date(client.createdAt) : null;
      const label = createdAt && !Number.isNaN(createdAt.getTime())
        ? formatCalendarDuration(createdAt, now)
        : "Sin antigüedad";
      return [row.id, label] as const;
    }));
  }, [baseRows, clients, essentialPriorityRows, now]);
  const matchesEssentialFilters = useCallback((row: ReceivableRow, omittedFilter?: EssentialFilterKey): boolean => {
    const search = normalizeEssentialFilterValue(essentialSearch);
    const operationalStatus = row.operationalStatus ?? clientStatusById.get(row.id) ?? "activo";
    const operationalValue = normalizeEssentialFilterValue(operationalStatus);
    const unitGroup = row.unitId.trim().charAt(0).toUpperCase();
    const portfolioValue: Exclude<EssentialPortfolioFilter, "all"> | "other" = ["A", "C", "E"].includes(unitGroup)
      ? "portfolio-1"
      : ["B", "D", "T"].includes(unitGroup)
        ? "portfolio-2"
        : "other";
    const isOperationallyActive = row.hasActiveClient && operationalValue === "activo";
    const statusRecord = collectionStatusByClient[row.id];
    const isOperationallyReviewed = statusRecord?.operationalReviewStatus === operationalValue;
    const managementValue: Exclude<EssentialManagementFilter, "all"> = isOperationallyActive
      ? statusRecord?.status === "contacted" ? "contacted" : "pending"
      : isOperationallyReviewed ? "automatic" : "pending";
    const [checklistShift, checklistStatus] = essentialContactChecklistFilter === "all"
      ? ["", ""]
      : essentialContactChecklistFilter.split(":");
    const checklistIsContacted = checklistShift
      ? statusRecord?.dailyContactAttemptsByDate?.[todayDateKey]?.[checklistShift as DailyContactShift]?.result === "contacted"
      : false;
    const priorityItem = essentialPriorityByClient.get(row.id);
    const overdueInstallments = priorityOverdueInstallmentCount(row.overdueBalance, row.rentAmount);
    const paymentDays = essentialPaymentDaysAgo(row.lastPaymentDate, now);

    return (omittedFilter === "search" || !search || normalizeEssentialFilterValue(`${row.unitId} ${row.name}`).includes(search))
      && (omittedFilter === "portfolio" || essentialPortfolioFilter === "all" || portfolioValue === essentialPortfolioFilter)
      && (omittedFilter === "operational" || essentialOperationalFilter === "all" || operationalValue === essentialOperationalFilter)
      && (omittedFilter === "management" || essentialManagementFilter === "all" || managementValue === essentialManagementFilter)
      && (omittedFilter === "priority" || essentialPriorityLevelFilter === "all" || priorityItem?.level === essentialPriorityLevelFilter)
      && (omittedFilter === "plan" || essentialPlanFilter === "all" || row.plan === essentialPlanFilter)
      && (omittedFilter === "installments" || essentialInstallmentFilter === "all" || overdueInstallments === Number(essentialInstallmentFilter))
      && (omittedFilter === "paymentDays" || essentialPaymentDaysFilter === "all"
        || (essentialPaymentDaysFilter === "no-payments" ? paymentDays === null : paymentDays === Number(essentialPaymentDaysFilter)))
      && (omittedFilter === "tenure" || essentialTenureFilter === "all"
        || (priorityItem ? priorityTenureBucket(priorityItem.tenureDays) === essentialTenureFilter : false))
      && (omittedFilter === "contactChecklist" || essentialContactChecklistFilter === "all"
        || (isOperationallyActive && (checklistStatus === "contacted" ? checklistIsContacted : !checklistIsContacted)));
  }, [clientStatusById, collectionStatusByClient, essentialContactChecklistFilter, essentialInstallmentFilter, essentialManagementFilter, essentialOperationalFilter, essentialPaymentDaysFilter, essentialPlanFilter, essentialPortfolioFilter, essentialPriorityByClient, essentialPriorityLevelFilter, essentialSearch, essentialTenureFilter, now, todayDateKey]);
  const essentialOperationalOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of baseRows) {
      if (!matchesEssentialFilters(row, "operational")) continue;
      const operationalStatus = row.operationalStatus ?? clientStatusById.get(row.id) ?? "activo";
      const value = normalizeEssentialFilterValue(operationalStatus);
      if (!value || options.has(value)) continue;
      options.set(value, clientOperationalStatusLabel(operationalStatus));
    }
    return Array.from(options, ([value, label]) => ({ value, label }))
      .sort((a, b) => {
        if (a.value === "activo") return -1;
        if (b.value === "activo") return 1;
        return a.label.localeCompare(b.label, "es");
      });
  }, [baseRows, clientStatusById, matchesEssentialFilters]);
  const essentialInstallmentOptions = useMemo(() => {
    const values = new Set(baseRows
      .filter((row) => matchesEssentialFilters(row, "installments"))
      .map((row) => priorityOverdueInstallmentCount(row.overdueBalance, row.rentAmount))
      .filter((value) => value > 0));
    if (essentialInstallmentFilter !== "all") values.add(Number(essentialInstallmentFilter));
    return Array.from(values).sort((a, b) => b - a);
  }, [baseRows, essentialInstallmentFilter, matchesEssentialFilters]);
  const essentialPaymentDayOptions = useMemo(() => {
    const values = new Set(baseRows
      .filter((row) => matchesEssentialFilters(row, "paymentDays"))
      .map((row) => essentialPaymentDaysAgo(row.lastPaymentDate, now))
      .filter((value): value is number => value !== null));
    if (essentialPaymentDaysFilter !== "all" && essentialPaymentDaysFilter !== "no-payments") {
      values.add(Number(essentialPaymentDaysFilter));
    }
    return Array.from(values).sort((a, b) => b - a);
  }, [baseRows, essentialPaymentDaysFilter, matchesEssentialFilters, now]);
  const essentialRows = useMemo(() => (
    baseRows
      .filter((row) => matchesEssentialFilters(row))
      .sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }))
  ), [baseRows, matchesEssentialFilters]);
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
    setEssentialSearch("");
    setEssentialPortfolioFilter("all");
    setEssentialOperationalFilter("all");
    setEssentialManagementFilter("all");
    setEssentialPriorityLevelFilter("all");
    setEssentialPlanFilter("all");
    setEssentialInstallmentFilter("all");
    setEssentialPaymentDaysFilter("all");
    setEssentialTenureFilter("all");
    setEssentialContactChecklistFilter("all");
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

  function getWhatsAppGroupRows(row: ReceivableRow): ReceivableRow[] | undefined {
    return whatsAppGroupRowsByClient.get(row.id);
  }

  function getStatementGroupRows(row: ReceivableRow): ReceivableRow[] | undefined {
    return statementGroupRowsByClient.get(row.id);
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
    if (isCollectionLocked) return;
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
    if (isCollectionLocked) return;
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

  function handleDailyContactAttemptChange(
    clientId: string,
    shift: DailyContactShift,
    result: DailyContactResult | "pending"
  ): void {
    if (isCollectionLocked) return;
    const row = baseRows.find((item) => item.id === clientId);
    if (!row || !hasActiveOperationalClient(row) || shouldDefaultToCovered(row)) return;
    markClientStatusAsSaving(clientId);
    const nowIso = new Date().toISOString();
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const attemptsByDate = { ...(previous?.dailyContactAttemptsByDate ?? {}) };
      const todayAttempts = { ...(attemptsByDate[todayDateKey] ?? {}) };
      if (result === "pending") delete todayAttempts[shift];
      else todayAttempts[shift] = { result, updatedAt: nowIso };
      if (Object.keys(todayAttempts).length > 0) attemptsByDate[todayDateKey] = todayAttempts;
      else delete attemptsByDate[todayDateKey];

      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: previous?.status ?? "unassigned",
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        dailyContactAttemptsByDate: Object.keys(attemptsByDate).length > 0 ? attemptsByDate : undefined
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return { ...current, [clientId]: updatedRecord };
    });
  }

  function handleOperationalReviewChange(clientId: string, operationalStatus: string, reviewed: boolean): void {
    if (isCollectionLocked) return;
    markClientStatusAsSaving(clientId);
    const nowIso = new Date().toISOString();
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: previous?.status ?? "unassigned",
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        operationalReviewStatus: reviewed ? normalizeEssentialFilterValue(operationalStatus) : undefined,
        operationalReviewedAt: reviewed ? nowIso : undefined
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
      if (!record.isRouteTagged) {
        const preservedSupportNote = record.supportNote ?? "";
        if ((record.priorityDebtCap && record.priorityDebtCap > 0) || preservedSupportNote.trim()) {
          activeRouteStatus[clientId] = {
            status: "unassigned",
            comment: "",
            updatedAt: nowIso,
            supportNote: preservedSupportNote || undefined,
            supportNoteUpdatedAt: preservedSupportNote ? record.supportNoteUpdatedAt ?? nowIso : undefined,
            priorityDebtCap: record.priorityDebtCap,
            priorityDebtCapUpdatedAt: record.priorityDebtCap && record.priorityDebtCap > 0
              ? record.priorityDebtCapUpdatedAt ?? nowIso
              : undefined
          };
        }
        continue;
      }
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
      setCollectionCutMessage("Gestión limpiada. Las notas se conservaron y la Ruta en calle se mantuvo activa.");
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
    if (isCollectionLocked) return;
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
    if (isCollectionLocked || cutKey !== "night") return;
    if (collectionStatusByClient[clientId]?.isRouteTagged && nextStatus !== "pending") return;
    applyCollectionCutStatus(clientId, nextStatus as CollectionStatus);
  }

  function handleRouteTagChange(clientId: string, tagged: boolean): void {
    if (isCollectionLocked) return;
    if (!tagged) {
      if (activeVisibleRouteClientIds.has(clientId)) void handleRemoveFromPublishedRoute(clientId);
      else handleRemoveFromRoute(clientId);
      return;
    }
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

  function handlePrioritySendToRoute(request: PriorityRouteRequest): void {
    if (isCollectionLocked) return;
    const routeCandidate = baseRows.find((row) => row.id === request.clientId);
    if (!routeCandidate || !hasActiveOperationalClient(routeCandidate)) return;
    const routeAssignment = normalizeRouteAssignment(request.routeAssignment);
    if (!routeAssignment || !(request.releaseAmount > 0)) return;
    const nowIso = new Date().toISOString();
    const releaseAmount = Math.round((request.releaseAmount + Number.EPSILON) * 100) / 100;
    markClientStatusAsSaving(request.clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[request.clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "pending",
        isRouteTagged: true,
        routeTaggedAt: nowIso,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: request.managementType,
        managementAmount: releaseAmount,
        managementComment: normalizeFieldManagementComment(request.comment),
        managementUpdatedAt: nowIso,
        routeReleaseAmount: releaseAmount,
        routeReleaseUpdatedAt: nowIso,
        routeAssignment,
        routeAssignmentUpdatedAt: nowIso,
        routeUrgency: normalizeRouteUrgency(request.urgency),
        routeUrgencyUpdatedAt: request.urgency === "normal" ? undefined : nowIso,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
        contactTime: previous?.contactTime,
        contactTimeUpdatedAt: previous?.contactTimeUpdatedAt,
        paymentPromiseDate: previous?.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt,
        priorityDebtCap: previous?.priorityDebtCap,
        priorityDebtCapUpdatedAt: previous?.priorityDebtCapUpdatedAt
      };
      optimisticStatusByClientRef.current[request.clientId] = updatedRecord;
      return { ...current, [request.clientId]: updatedRecord };
    });
    setRouteExportMessage(`${routeCandidate.unitId} · Preparada para envío automático a ${routeAssignment}.`);
  }

  function handleOpenManagementRoute(clientId: string): void {
    if (isCollectionLocked) return;
    const row = baseRows.find((item) => item.id === clientId);
    if (!row || !hasActiveOperationalClient(row)) return;
    const priorityItem = essentialPriorityByClient.get(clientId);
    setManagementRouteDraft({
      clientId: row.id,
      unitId: row.unitId,
      clientName: row.name,
      amount: row.overdueBalance > 0 ? String(Math.round(row.overdueBalance)) : "",
      routeAssignment: "",
      customRoute: false,
      managementType: "solo_cobrar",
      urgency: priorityItem ? routeUrgencyForPriority(priorityItem.level) : "normal",
      comment: ""
    });
  }

  function handleSaveManagementRoute(): void {
    if (!managementRouteDraft) return;
    const releaseAmount = Number(managementRouteDraft.amount);
    const routeAssignment = normalizeRouteAssignment(managementRouteDraft.routeAssignment);
    if (!(releaseAmount > 0) || !routeAssignment) return;
    handlePrioritySendToRoute({
      clientId: managementRouteDraft.clientId,
      releaseAmount,
      routeAssignment,
      managementType: managementRouteDraft.managementType,
      urgency: managementRouteDraft.urgency,
      comment: managementRouteDraft.comment.trim()
    });
    setManagementRouteDraft(null);
  }

  function handlePriorityDebtCapChange(clientId: string, value: number | null): void {
    if (isCollectionLocked) return;
    const normalizedValue = value && value > 0
      ? Math.round((value + Number.EPSILON) * 100) / 100
      : undefined;
    const previous = collectionStatusByClient[clientId];
    if (!previous && normalizedValue === undefined) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const currentRecord = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...currentRecord,
        status: currentRecord?.status ?? "unassigned",
        comment: currentRecord?.comment ?? "",
        updatedAt: nowIso,
        priorityDebtCap: normalizedValue,
        priorityDebtCapUpdatedAt: nowIso
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
    if (isCollectionLocked) return;
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
    if (isCollectionLocked) return;
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
    if (isCollectionLocked) return;
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
    if (isCollectionLocked) return;
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
    // A removed item is route history, not the route currently being edited.
    // Updating it while preparing a new route preserves its old start time and
    // can make an earlier same-day payment remove the new route immediately.
    const currentItem = activeRouteItemsRef.current.find((item) => item.clientId === clientId && !item.removedAt);
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
    updatePublishedRouteItem(clientId, (item) => ({ ...item, managementType }));
  }

  function handlePublishedRouteReleaseAmountChange(clientId: string, value: string): void {
    setPublishedRouteAmountDraftByClient((current) => ({
      ...current,
      [clientId]: value
    }));
  }

  function commitPublishedRouteReleaseAmount(clientId: string): void {
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
    setPublishedRouteCommentDraftByClient((current) => ({
      ...current,
      [clientId]: normalizeFieldManagementComment(value)
    }));
  }

  function commitPublishedRouteComment(clientId: string): void {
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
    updatePublishedRouteItem(clientId, (item) => ({
      ...item,
      routeAssignment: normalizeRouteAssignment(value),
      zone: activeRouteFilterValue(item.routeAssignment) === activeRouteFilterValue(normalizeRouteAssignment(value))
        ? item.zone
        : undefined
    }));
  }

  function handlePublishedRouteUrgencyChange(clientId: string, value: RouteUrgency): void {
    updatePublishedRouteItem(clientId, (item) => ({
      ...item,
      urgency: normalizeRouteUrgency(value)
    }));
  }

  function openAddPublishedRoute(clientId?: string): void {
    const firstRow = publishedRouteAddRows.find((row) => row.id === clientId) ?? publishedRouteAddRows[0];
    setPublishedRouteDraft({
      clientId: firstRow?.id ?? "",
      type: "solo_cobrar",
      amount: firstRow && firstRow.overdueBalance > 0 ? String(firstRow.overdueBalance) : "",
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
    if (isCollectionLocked) return;
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

  async function handleDownloadPublishedRoute(): Promise<void> {
    if (!canDownloadPublishedRoute) return;
    setExportError(null); setRouteExportMessage(""); setIsExporting(true);
    try {
      const rows: ReceivableRow[] = [];
      const statusByClient: Record<string, CollectionStatusRecord> = {};
      const [latestItems, latestReports] = dataOwnerUserId ? await Promise.all([
        loadCloudActiveRouteItems(dataOwnerUserId),
        loadRoutePaymentReports(dataOwnerUserId, { reviewOnly: true })
      ]) : [activeRouteItems, []];
      const workItems = getRouteWorkItems(latestItems, payments, getBusinessDateKey(), latestReports);
      for (const item of workItems) {
        const row = baseRows.find(candidate => candidate.id === item.clientId);
        if (!row) continue;
        rows.push({ ...row, unitId: item.unitId, name: item.clientName });
        statusByClient[item.clientId] = { status: "pending", isRouteTagged: true, updatedAt: item.publishedAt,
          routeAssignment: item.routeAssignment, routeReleaseAmount: item.releaseAmount, managementAmount: item.releaseAmount,
          managementType: item.managementType, routeUrgency: item.urgency, managementComment: item.comment, comment: "" };
      }
      const exported = await exportRouteCollection({ rows, statusByClient, format: routeExportFormat, now });
      if (!exported) throw new Error("No hay unidades en ruta para descargar.");
      setRouteExportMessage('Ruta descargada: ' + rows.length + ' unidades.');
    } catch (error) {
      console.error("No se pudo descargar la ruta.", error);
      setExportError("No se pudo descargar la ruta. Puedes volver a intentar.");
    } finally { setIsExporting(false); }
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
          whatsAppMessageSentAt: statusRecord?.whatsAppMessageSentAt,
          dailyContactAttempts: statusRecord?.dailyContactAttemptsByDate?.[todayDateKey]
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
  return (
    <>
      <section className="panel ar-ledger-panel ar-ledger-panel--essential">
        <div className="ar-ledger-command ar-ledger-command--essential">
          <div className="ar-ledger-title">
            <h1>Cuentas por cobrar</h1>
            <p>Saldo, atraso y seguimiento de cada unidad en un solo lugar.</p>
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
              Gestion <strong>{essentialRows.length}</strong>
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
              Ruta en calle
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
                {autoRouteSending ? "Enviando a ruta…" : routeWorkflowRowsCount + " por completar o enviar"}
              </button>
            ) : (
              <span className="ar-route-publish-copy">
                {canDownloadPublishedRoute ? "Enviada a ruta" : "Envío automático al completar monto y ruta"}
              </span>
            )}
            <button
              type="button"
              className="button ar-route-publish-button"
              onClick={() => void handleDownloadPublishedRoute()}
              disabled={isExporting || !canDownloadPublishedRoute}
            >
              {isExporting ? "Descargando..." : "Descargar ruta"}

            </button>
            <select
              className="ar-route-export-format ar-route-export-format--prominent"
              value={routeExportFormat}
              onChange={(event) => setRouteExportFormat(event.target.value as RouteExportFormat)}
              disabled={isExporting}
              aria-label="Formato para descargar cobro en ruta"
            >
              <option value="jpg">JPG</option>
              <option value="pdf">PDF</option>
              <option value="excel">Excel</option>
            </select>
          </div>
        </div>

        {workflowTab === "management" ? (
          <>
            <div className="ar-essential-toolbar">
              <div className="ar-essential-toolbar-fields">
                <label className="ar-essential-filter ar-essential-filter--search">
                  <span>Buscar</span>
                  <input
                    type="search"
                    value={essentialSearch}
                    onChange={(event) => setEssentialSearch(event.target.value)}
                    placeholder="Unidad o nombre del cliente"
                  />
                </label>
                <label className="ar-essential-filter">
                  <span>Cartera</span>
                  <select
                    value={essentialPortfolioFilter}
                    onChange={(event) => setEssentialPortfolioFilter(event.target.value as EssentialPortfolioFilter)}
                  >
                    <option value="all">Todas</option>
                    <option value="portfolio-1">Cartera 1 · A, C, E</option>
                    <option value="portfolio-2">Cartera 2 · B, D, T</option>
                  </select>
                </label>
                <label className="ar-essential-filter">
                  <span>Estado operativo</span>
                  <select
                    value={essentialOperationalFilter}
                    onChange={(event) => setEssentialOperationalFilter(event.target.value)}
                  >
                    <option value="all">Todos</option>
                    {essentialOperationalOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="ar-essential-filter">
                  <span>Gestión</span>
                  <select
                    value={essentialManagementFilter}
                    onChange={(event) => setEssentialManagementFilter(event.target.value as EssentialManagementFilter)}
                  >
                    <option value="all">Todos</option>
                    <option value="pending">Pendiente</option>
                    <option value="contacted">Contactado</option>
                    <option value="automatic">Automático</option>
                  </select>
                </label>
              </div>
              <div className="ar-essential-priority-filters" aria-label="Filtros de prioridad de cobranza">
                <label className="ar-essential-filter">
                  <span>Nivel de prioridad</span>
                  <select
                    value={essentialPriorityLevelFilter}
                    onChange={(event) => setEssentialPriorityLevelFilter(event.target.value as EssentialPriorityLevelFilter)}
                  >
                    <option value="all">Todos los niveles</option>
                    <option value="critical">Crítico</option>
                    <option value="high">Alto</option>
                    <option value="medium">Medio</option>
                    <option value="low">Bajo</option>
                  </select>
                </label>
                <label className="ar-essential-filter">
                  <span>Plan</span>
                  <select
                    value={essentialPlanFilter}
                    onChange={(event) => setEssentialPlanFilter(event.target.value as EssentialPlanFilter)}
                  >
                    <option value="all">Todos los planes</option>
                    {(Object.keys(PLAN_LABEL) as BillingFrequency[]).map((plan) => (
                      <option key={plan} value={plan}>{PLAN_LABEL[plan]}</option>
                    ))}
                  </select>
                </label>
                <label className="ar-essential-filter">
                  <span>Cuotas vencidas</span>
                  <select
                    value={essentialInstallmentFilter}
                    onChange={(event) => setEssentialInstallmentFilter(event.target.value as EssentialInstallmentFilter)}
                  >
                    <option value="all">Todas las cuotas</option>
                    {essentialInstallmentOptions.map((installments) => (
                      <option key={installments} value={String(installments)}>
                        {installments} cuota{installments === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ar-essential-filter">
                  <span>Último pago</span>
                  <select
                    value={essentialPaymentDaysFilter}
                    onChange={(event) => setEssentialPaymentDaysFilter(event.target.value as EssentialPaymentDaysFilter)}
                  >
                    <option value="all">Todos los días</option>
                    <option value="no-payments">Sin pagos</option>
                    {essentialPaymentDayOptions.map((days) => (
                      <option key={days} value={String(days)}>
                        {days === 0 ? "Hoy" : `${days} día${days === 1 ? "" : "s"}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ar-essential-filter">
                  <span>Antigüedad</span>
                  <select
                    value={essentialTenureFilter}
                    onChange={(event) => setEssentialTenureFilter(event.target.value as EssentialTenureFilter)}
                  >
                    <option value="all">Toda antigüedad</option>
                    {ESSENTIAL_TENURE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="ar-essential-filter">
                  <span>Checklist de contacto</span>
                  <select
                    value={essentialContactChecklistFilter}
                    onChange={(event) => setEssentialContactChecklistFilter(event.target.value as EssentialContactChecklistFilter)}
                  >
                    <option value="all">Todos los contactos</option>
                    <option value="morning:pending">Mañana · pendiente</option>
                    <option value="morning:contacted">Mañana · contactado</option>
                    <option value="afternoon:pending">Tarde · pendiente</option>
                    <option value="afternoon:contacted">Tarde · contactado</option>
                    <option value="night:pending">Noche · pendiente</option>
                    <option value="night:contacted">Noche · contactado</option>
                  </select>
                </label>
              </div>
              <span className="ar-essential-results-count">
                <strong>{essentialRows.length}</strong> de {managementWorkflowRowsCount} unidades
              </span>
            </div>

            <div className="ar-essential-column-guide" aria-hidden="true">
              <span>Unidad y cliente</span>
              <span>Información de cuenta</span>
              <span>Gestión y seguimiento</span>
            </div>
          </>
        ) : null}

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
              aria-controls="ar-ledger-advanced-filters"
            >
              <span>{mobileFiltersOpen ? "Ocultar filtros" : "Mostrar filtros"}</span>
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
        {routeExportMessage ? <p className="hint" role="status">{routeExportMessage}</p> : null}
        {activeRouteError || Object.keys(autoRouteErrors).length > 0 ? <div role="alert" className="error-text">{activeRouteError || "No se pudo confirmar el envío de " + Object.values(autoRouteErrors).join(", ") + ". Revisa la conexión y reintenta."} <button type="button" className="button ghost small" disabled={autoRouteSending} onClick={() => void retryAutoRoutePublication()}>Reintentar envío</button></div> : null}
        {exportError ? <p className="hint error-text">{exportError}</p> : null}
        {workflowTab === "route" ? (
          <div className="ar-active-route-panel ar-active-route-panel--tab">
            <div className="ar-active-route-head">
              <div>
                <strong>Ruta en calle</strong>
                <span>
                  Seguimiento y gestión
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
                  onClick={() => openAddPublishedRoute()}
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
            <RouteSearchPage dataOwnerUserId={dataOwnerUserId} clients={clients} payments={payments}
              {...routePermissions} readOnly={routePermissions?.readOnly ?? readOnly}
              renderManagementFields={readOnly ? undefined : (item) => <div className="route-collection-management-fields">
                <label className="route-collection-field">Ruta asignada<input key={item.routeAssignment} defaultValue={item.routeAssignment ?? ""} maxLength={12} onBlur={event => handlePublishedRouteAssignmentChange(item.clientId, event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
                <label className="route-collection-field">Tipo de gestión<select value={item.managementType ?? "solo_cobrar"} onChange={event => handlePublishedRouteTypeChange(item.clientId, event.target.value as FieldManagementType)}>
                  <option value="solo_cobrar">Solo cobrar</option><option value="cobrar_o_quitar">Cobrar o quitar</option><option value="desiste">Desiste</option><option value="quitar">Quitar</option>
                </select></label>
                <label className="route-collection-field">Mínimo original para liberar<input type="number" min="0" step="0.01" value={publishedRouteAmountDraftByClient[item.clientId] ?? item.releaseAmount}
                  onChange={event => handlePublishedRouteReleaseAmountChange(item.clientId, event.target.value)} onBlur={() => commitPublishedRouteReleaseAmount(item.clientId)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
                <label className="route-collection-field">Prioridad<select value={item.urgency ?? "normal"} onChange={event => handlePublishedRouteUrgencyChange(item.clientId, event.target.value as RouteUrgency)}>
                  <option value="normal">Normal</option><option value="urgent">Urgente</option><option value="very_urgent">Muy urgente</option>
                </select></label>
              </div>} />
          </div>
        ) : workflowTab === "priority" ? (
          <ReceivablesPriorityList
            rows={baseRows}
            clients={clients}
            payments={receivablePayments}
            collectionStatusByClient={collectionStatusByClient}
            now={receivablesDate}
            readOnly={isCollectionLocked}
            onSendToRoute={handlePrioritySendToRoute}
            onRemoveFromRoute={(clientId) => handleRouteTagChange(clientId, false)}
            onOpenRoute={() => setWorkflowTab("route")}
            onDebtCapChange={handlePriorityDebtCapChange}
          />
        ) : (
          <ReceivablesLedgerTable
            tableScrollRef={tableScrollRef}
            viewMode={viewMode}
            selectedHistoryDate={selectedHistoryDate}
            selectedHistoryRows={selectedHistoryRows}
            rows={essentialRows}
            collectionStatusByClient={collectionStatusByClient}
            clientStatusById={clientStatusById}
            tenureLabelByClient={essentialTenureLabelByClient}
            todayDateKey={todayDateKey}
            now={now}
            isTodayCollectionClosed={isCollectionLocked}
            workflowTab="management"
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
            onPersistPendingChanges={flushStreetManagementPersist}
            onDailyContactAttemptChange={handleDailyContactAttemptChange}
            onOperationalReviewChange={handleOperationalReviewChange}
            onOpenRoutePreparation={handleOpenManagementRoute}
            onOpenRoute={() => setWorkflowTab("route")}
            onClearFilters={clearFilters}
            incidentActionsByUnit={judicialActionsByUnit}
          />
        )}
      </section>

      {selectedDetailRow && (
        <ReceivableDetailModal
          row={selectedDetailRow}
          onClose={() => setSelectedDetailRow(null)}
        />
      )}

      {managementRouteDraft ? (
        <div className="modal-overlay" onClick={() => setManagementRouteDraft(null)}>
          <div
            className="modal ar-priority-route-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ar-management-route-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="ar-priority-modal-kicker">Preparación de cobro</span>
                <h2 id="ar-management-route-title">{managementRouteDraft.unitId} · {managementRouteDraft.clientName}</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setManagementRouteDraft(null)} aria-label="Cerrar">X</button>
            </div>
            <div className="modal-body">
              <p className="ar-priority-modal-rule">
                <strong>Monto prellenado:</strong> toda la renta vencida hasta ayer. Puedes editarlo; el cambio no modifica el saldo real del cliente.
              </p>
              <div className="ar-priority-route-grid">
                <label>Monto a cobrar
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={managementRouteDraft.amount}
                    onChange={(event) => setManagementRouteDraft((current) => current ? { ...current, amount: event.target.value } : current)}
                    autoFocus
                  />
                </label>
                <label>Ruta
                  {managementRouteDraft.customRoute ? (
                    <input
                      value={managementRouteDraft.routeAssignment}
                      maxLength={12}
                      placeholder="Escribe la ruta"
                      onChange={(event) => setManagementRouteDraft((current) => current
                        ? { ...current, routeAssignment: event.target.value.toUpperCase().slice(0, 12) }
                        : current)}
                    />
                  ) : (
                    <select
                      value={managementRouteDraft.routeAssignment}
                      onChange={(event) => {
                        if (event.target.value === "__custom") {
                          setManagementRouteDraft((current) => current ? { ...current, customRoute: true, routeAssignment: "" } : current);
                          return;
                        }
                        setManagementRouteDraft((current) => current ? { ...current, routeAssignment: event.target.value } : current);
                      }}
                    >
                      <option value="">Seleccionar ruta</option>
                      {ROUTE_ASSIGNMENT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      <option value="__custom">Otra</option>
                    </select>
                  )}
                </label>
                <label>Tipo de gestión
                  <select
                    value={managementRouteDraft.managementType}
                    onChange={(event) => setManagementRouteDraft((current) => current
                      ? { ...current, managementType: event.target.value as FieldManagementType }
                      : current)}
                  >
                    <option value="solo_cobrar">Solo cobrar</option>
                    <option value="cobrar_o_quitar">Cobrar o quitar</option>
                    <option value="desiste">Desiste</option>
                    <option value="quitar">Quitar</option>
                  </select>
                </label>
                <label>Urgencia
                  <select
                    value={managementRouteDraft.urgency}
                    onChange={(event) => setManagementRouteDraft((current) => current
                      ? { ...current, urgency: event.target.value as RouteUrgency }
                      : current)}
                  >
                    {ROUTE_URGENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="ar-priority-route-comment">Comentario para el cobrador
                  <textarea
                    maxLength={25}
                    rows={2}
                    value={managementRouteDraft.comment}
                    onChange={(event) => setManagementRouteDraft((current) => current ? { ...current, comment: event.target.value } : current)}
                  />
                </label>
              </div>
            </div>
            <div className="ar-priority-modal-actions">
              <span>
                {!(Number(managementRouteDraft.amount) > 0)
                  ? "El monto debe ser mayor que cero."
                  : !normalizeRouteAssignment(managementRouteDraft.routeAssignment)
                    ? "Falta seleccionar la ruta."
                    : "Lista para enviar automáticamente a Ruta en calle."}
              </span>
              <div>
                <button type="button" className="button ghost" onClick={() => setManagementRouteDraft(null)}>Cancelar</button>
                <button
                  type="button"
                  className="button primary"
                  disabled={!(Number(managementRouteDraft.amount) > 0) || !normalizeRouteAssignment(managementRouteDraft.routeAssignment)}
                  onClick={handleSaveManagementRoute}
                >
                  Listo
                </button>
              </div>
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
                Esta acción borra los estados, checklist y asignaciones vivas de cuentas por cobrar
                {clearableManagementRecordsCount > 0 ? ` (${clearableManagementRecordsCount} registro${clearableManagementRecordsCount === 1 ? "" : "s"}).` : "."}
                {" Las notas se conservarán."}
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
