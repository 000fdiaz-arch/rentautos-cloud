import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { exportReceivablesToExcel, exportReceivablesToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import {
  loadCloudCollectionClosures,
  loadCloudStreetManagement,
  loadControlUnits,
  saveCloudCollectionClosures,
  saveCloudStreetManagement,
  syncCloudStreetManagementDelta,
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
import type { Client, Payment } from "../types";
import type {
  CollectionStatus,
  CollectionStatusRecord,
  FieldManagementType,
  RouteExportFormat,
  WhatsAppContactFilter
} from "./receivables/receivablesTypes";
import { ReceivableDetailModal } from "./receivables/ReceivableDetailModal";
import { ReceivablesFiltersPanel } from "./receivables/ReceivablesFiltersPanel";
import { ReceivablesLedgerTable, type ReceivablesHistoryRow } from "./receivables/ReceivablesLedgerTable";
import { WhatsAppPhoneModal } from "./receivables/WhatsAppPhoneModal";
import { exportRouteCollection } from "./receivables/routeCollectionExport";
import {
  COLLECTION_STATUS_OPTIONS,
  COLLECTION_STATUS_HELP,
  COLLECTION_CUT_OPTIONS,
  DAILY_COLLECTION_STATUS_OPTIONS,
  ROUTE_COLLECTION_STATUS_OPTIONS,
  INITIAL_EXPORT_FIELDS,
  clientOperationalStatusLabel,
  getCollectionClosureCuts,
  getCollectionClosureDateKeys,
  formatDateForTitle,
  isToday,
  normalizeComment,
  normalizeContactTime,
  normalizeFieldManagementComment,
  normalizeRouteAssignment,
  normalizeSupportNote,
  parseCollectionStatusMapFromStorage,
  pendingSummaryText,
  planLabelForExport,
  renderSortIcon,
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
  receivablesDateKey?: string;
  streetManagementData?: Record<string, unknown>;
  onStreetManagementPersist?: (value: Record<string, unknown>) => Promise<boolean> | boolean;
};

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

function isWhatsAppEligibleUnit(row: ReceivableRow): boolean {
  return row.hasActiveClient && (row.operationalStatus ?? "activo").trim().toLowerCase() === "activo";
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

function getWhatsAppContactStatus(row: ReceivableRow, record: CollectionStatusRecord | undefined): Exclude<WhatsAppContactFilter, "all" | "pending"> {
  if (!hasPendingRentForWhatsApp(row)) return "sent";
  if (record?.whatsAppMessageSentAt) return "sent";
  if (record?.whatsAppMessageCopiedAt) return "opened";
  if (!normalizeWhatsAppPhoneForFilter(row.whatsAppPhone)) return "missing";
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
  if (payment.clientId !== clientId || payment.amountReceived < releaseAmount) return false;
  const createdTimestamp = toTimestamp(payment.createdAt);
  if (createdTimestamp > 0) return createdTimestamp >= routeStartedAt;
  return !!routeDateKey && payment.dateApplied >= routeDateKey;
}

function hasRouteReleaseAmount(record: CollectionStatusRecord | undefined): boolean {
  const amount = record?.routeReleaseAmount ?? record?.managementAmount;
  return typeof amount === "number" && amount > 0;
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

export default function ReceivablesPage({
  clients,
  payments,
  onClientsChange,
  dataOwnerUserId,
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
  const [whatsAppContactFilter, setWhatsAppContactFilter] = useState<WhatsAppContactFilter>("all");
  const [prioritizeContactTime, setPrioritizeContactTime] = useState<boolean>(false);
  const [workflowTab, setWorkflowTab] = useState<ReceivablesWorkflowTab>("management");
  const viewMode: ReceivablesViewMode = "cartera";
  const [collectionClosuresByDate, setCollectionClosuresByDate] = useState<CollectionClosuresByDate>({});
  const [collectionClosuresLoaded, setCollectionClosuresLoaded] = useState<boolean>(false);
  const [isCollectionClosuresLoading, setIsCollectionClosuresLoading] = useState<boolean>(false);
  const [visibleCollectionCut] = useState<CollectionCutKey | "all">("night");
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [collectionCutMessage, setCollectionCutMessage] = useState<string | null>(null);
  const [isSavingCollectionCut, setIsSavingCollectionCut] = useState<CollectionCutKey | null>(null);
  const [isClearingCollectionManagement, setIsClearingCollectionManagement] = useState<boolean>(false);
  const [isExportConfigOpen, setIsExportConfigOpen] = useState<boolean>(false);
  const [routeExportFormat, setRouteExportFormat] = useState<RouteExportFormat>("jpg");
  const [isRouteExportMenuOpen, setIsRouteExportMenuOpen] = useState<boolean>(false);
  const [exportFields, setExportFields] = useState<ExportField[]>(INITIAL_EXPORT_FIELDS);
  const [fieldManagementModalClientId, setFieldManagementModalClientId] = useState<string | null>(null);
  const [whatsAppModalClientId, setWhatsAppModalClientId] = useState<string | null>(null);
  const [whatsAppPhoneDraft, setWhatsAppPhoneDraft] = useState<string>("");
  const [whatsAppPhoneError, setWhatsAppPhoneError] = useState<string>("");
  const [isSavingWhatsAppPhone, setIsSavingWhatsAppPhone] = useState<boolean>(false);
  const [fieldManagementDraftByClient, setFieldManagementDraftByClient] = useState<
    Record<string, { type: FieldManagementType | ""; amount: string; comment: string }>
  >({});
  const [fieldManagementErrorByClient, setFieldManagementErrorByClient] = useState<Record<string, string>>({});
  const [statusSavingByClient, setStatusSavingByClient] = useState<Record<string, boolean>>({});
  const [fleetUnits, setFleetUnits] = useState<ControlUnitRow[]>([]);

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const persistStreetTimerRef = useRef<number | null>(null);
  const lastStreetSnapshotRef = useRef<string>("");
  const streetPersistPendingRef = useRef<boolean>(false);
  const streetManagementLoadedRef = useRef<boolean>(false);
  const optimisticStatusByClientRef = useRef<Record<string, CollectionStatusRecord>>({});
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
      toTimestamp(record.whatsAppMessageCopiedAt),
      toTimestamp(record.whatsAppMessageSentAt),
      toTimestamp(record.paymentPromiseUpdatedAt)
    );
  }

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timerId);
  }, []);

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

  useEffect(() => {
    void loadStreetManagementFromCloud();
  }, [loadStreetManagementFromCloud]);

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

  const baseRows = useMemo(() => {
    if (clients.length === 0) return createMockReceivableRows(receivablesDate);
    return buildReceivableRows(clients, payments, receivablesDate, fleetUnits);
  }, [clients, fleetUnits, payments, receivablesDate]);

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [collectionStatusFilter, filters, sortDirection, sortField, viewMode, whatsAppContactFilter, workflowTab]);

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

  useEffect(() => {
    const routeEntries = Object.entries(collectionStatusByClient).filter(([, record]) => (
      record.status === "route" &&
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
      if (!previous || previous.status !== "route") continue;
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "contacted",
        updatedAt: new Date().toISOString(),
        managementType: undefined,
        managementAmount: undefined,
        managementComment: "",
        managementUpdatedAt: undefined,
        routeReleaseAmount: undefined,
        routeReleaseUpdatedAt: undefined,
        routeAssignment: undefined,
        routeAssignmentUpdatedAt: undefined
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      nextStatusByClient[clientId] = updatedRecord;
      changedStatus = true;
    }
    if (changedStatus) {
      setCollectionStatusByClient(nextStatusByClient);
      latestCollectionStatusByClientRef.current = nextStatusByClient;
    }
  }, [collectionStatusByClient, payments]);

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
  const routeWorkflowRowsCount = useMemo(
    () => baseRows.filter((row) => isRouteWorkflowRow(row)).length,
    [baseRows, collectionStatusByClient, todayCollectionCuts]
  );
  const managementWorkflowRowsCount = baseRows.length;
  const workflowRows = useMemo(() => (
    workflowTab === "route"
      ? filteredRows.filter((row) => isRouteWorkflowRow(row))
      : filteredRows
  ), [filteredRows, workflowTab, collectionStatusByClient, todayCollectionCuts]);
  const collectionStatusCounts = useMemo(() => {
    const counts = createEmptyCollectionStatusCounts();
    for (const row of workflowRows) {
      const status = getWorkflowStatus(row) || "unassigned";
      counts[status] += 1;
    }
    return counts;
  }, [workflowRows, collectionStatusByClient, todayCollectionCuts]);
  const routePendingCount = collectionStatusCounts.route + collectionStatusCounts.route_collection;
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
    if (collectionStatusFilter === "all") return workflowRows;
    return workflowRows.filter((row) => getWorkflowStatus(row) === collectionStatusFilter);
  }, [collectionStatusFilter, workflowRows, collectionStatusByClient, now, todayCollectionCuts, workflowTab]);
  const whatsAppContactCounts = useMemo(() => {
    const counts: Record<WhatsAppContactFilter, number> = {
      all: filteredByCollectionStatusRows.length,
      pending: 0,
      missing: 0,
      ready: 0,
      opened: 0,
      sent: 0
    };
    for (const row of filteredByCollectionStatusRows) {
      const status = getWhatsAppContactStatus(row, collectionStatusByClient[row.id]);
      counts[status] += 1;
      if (status !== "sent") counts.pending += 1;
    }
    return counts;
  }, [collectionStatusByClient, filteredByCollectionStatusRows]);
  const whatsAppAlertCount = whatsAppContactFilter === "sent"
    ? whatsAppContactCounts.sent
    : whatsAppContactCounts.pending;
  const whatsAppAlertText = whatsAppContactFilter === "sent"
    ? `${whatsAppAlertCount} WhatsApp completado${whatsAppAlertCount === 1 ? "" : "s"}`
    : `${whatsAppAlertCount} WhatsApp pendientes`;
  const filteredByWhatsAppRows = useMemo(() => {
    if (whatsAppContactFilter === "all") return filteredByCollectionStatusRows;
    if (whatsAppContactFilter === "pending") {
      return filteredByCollectionStatusRows.filter((row) => (
        getWhatsAppContactStatus(row, collectionStatusByClient[row.id]) !== "sent"
      ));
    }
    return filteredByCollectionStatusRows.filter((row) => (
      getWhatsAppContactStatus(row, collectionStatusByClient[row.id]) === whatsAppContactFilter
    ));
  }, [collectionStatusByClient, filteredByCollectionStatusRows, whatsAppContactFilter]);

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
    const pendingWhatsAppRows = baseRows.filter((row) => getWhatsAppContactStatus(row, collectionStatusByClient[row.id]) !== "sent");
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
    if (dailyStatus) return dailyStatus;
    const stored = statusByClient[row.id]?.status;
    if (stored === "unassigned" || stored === "pending" || stored === "contacted" || stored === "covered" || stored === "route") return stored;
    if (stored === "paid") return "covered";
    if (stored === "route_collection") return "route";
    if (shouldDefaultToCovered(row)) return "covered";
    return "unassigned";
  }

  function buildClosureBlockersForStatus(statusByClient: Record<string, CollectionStatusRecord>) {
    const pendingManagementRows = baseRows.filter((row) => {
      const status = getEffectiveStatusFromMap(row, statusByClient);
      return status === "unassigned";
    });
    const pendingWhatsAppRows = baseRows.filter((row) => getWhatsAppContactStatus(row, statusByClient[row.id]) !== "sent");
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
    setWhatsAppContactFilter("all");
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

  function shouldDefaultToCovered(row: ReceivableRow): boolean {
    return row.totalPending <= 0;
  }

  function hasRouteCollection(row: ReceivableRow): boolean {
    const management = collectionStatusByClient[row.id];
    if (!management) return false;
    const hasType = management.managementType === "solo_cobrar" || management.managementType === "cobrar_o_quitar";
    return hasType && !!management.managementAmount && management.managementAmount > 0;
  }

  function isNightRouteCollection(row: ReceivableRow): boolean {
    const status = getCutItemForClient("night", row.id)?.collectionStatus;
    const storedStatus = collectionStatusByClient[row.id]?.status;
    return status === "route" || status === "route_collection" || storedStatus === "route" || storedStatus === "route_collection";
  }

  function isRouteWorkflowRow(row: ReceivableRow): boolean {
    const record = collectionStatusByClient[row.id];
    const status = getEffectiveStatus(row);
    return (
      status === "route" ||
      status === "route_collection" ||
      status === "route_not_sent" ||
      (status === "paid" && !!record?.managementType) ||
      (status === "call_later" && !!record?.managementType) ||
      hasRouteCollection(row) ||
      isNightRouteCollection(row)
    );
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
    const emoji = {
      hello: String.fromCodePoint(0x1F44B),
      info: `${String.fromCodePoint(0x2139)}${String.fromCodePoint(0xFE0F)}`,
      warning: `${String.fromCodePoint(0x26A0)}${String.fromCodePoint(0xFE0F)}`,
      money: String.fromCodePoint(0x1F4B5),
      pin: String.fromCodePoint(0x1F4CC),
      check: String.fromCodePoint(0x2705),
      thanks: String.fromCodePoint(0x1F64F)
    };

    const message = [
      `${emoji.hello} Hola, ${firstName}.`,
      "",
      hasOverdue && hasCurrent
        ? `${emoji.warning} Tiene saldo pendiente al ${today}.`
        : hasCurrent
          ? `${emoji.info} Saldo corriente ${currentPeriodLabel[row.plan]}: ${formatCurrency(currentAmount)}`
          : `${emoji.warning} Tiene renta vencida al ${today}.`,
      "",
      ...(hasOverdue && hasCurrent
        ? [
            `${emoji.money} Total pendiente: ${formatCurrency(totalPending)}`,
            `${emoji.pin} Detalle: ${mixedInstallmentsText || "incluye renta vencida y saldo corriente"}`
          ]
        : hasCurrent
          ? [
              `${emoji.pin} Detalle: ${installmentText(currentAmount, "corriente") || installmentsText}`
            ]
          : [
              `${emoji.money} Renta vencida: ${formatCurrency(overdueAmount)}`,
              `${emoji.pin} Ultimo pago: ${lastPayment}`,
              `${emoji.pin} Detalle: ${installmentsText}`
            ]),
      "",
      hasCurrent && !hasOverdue
        ? `${emoji.check} Por favor, realice el pago durante el periodo correspondiente.`
        : `${emoji.check} Agradecemos pueda realizar el pago pronto.`,
      "",
      `${emoji.thanks} Gracias.`
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
    const emoji = {
      hello: String.fromCodePoint(0x1F44B),
      info: `${String.fromCodePoint(0x2139)}${String.fromCodePoint(0xFE0F)}`,
      warning: `${String.fromCodePoint(0x26A0)}${String.fromCodePoint(0xFE0F)}`,
      money: String.fromCodePoint(0x1F4B5),
      pin: String.fromCodePoint(0x1F4CC),
      check: String.fromCodePoint(0x2705),
      thanks: String.fromCodePoint(0x1F64F)
    };
    const unitBlocks = groupRows.map((item) => {
      const amount = hasCurrent ? Math.max(0, item.totalPending) : overdueRentForWhatsAppDate(item, now);
      return `Unidad ${item.unitId}: ${formatCurrency(amount)}`;
    });

    return [
      `${emoji.hello} Hola, ${firstName}.`,
      "",
      hasOverdue && hasCurrent
        ? `${emoji.warning} Tiene saldo pendiente al ${today}:`
        : hasCurrent
          ? `${emoji.info} Saldo corriente del dia de hoy:`
          : `${emoji.warning} Renta vencida al ${today}:`,
      unitBlocks.join("\n"),
      hasCurrent
        ? `${emoji.money} Total pendiente: ${formatCurrency(totalPendingRent)}`
        : `${emoji.money} Total renta vencida: ${formatCurrency(totalOverdueRent)}`,
      ...(hasOverdue && hasCurrent ? [`${emoji.pin} Detalle: ${mixedGroupDetail || "incluye renta vencida y saldo corriente"}`] : []),
      "",
      hasCurrent && !hasOverdue
        ? `${emoji.check} Por favor, realice el pago durante el periodo correspondiente.`
        : `${emoji.check} Agradecemos pueda realizar el pago pronto.`,
      "",
      `${emoji.thanks} Gracias.`
    ].join("\n");
  }

  function getWhatsAppGroupRows(row: ReceivableRow): ReceivableRow[] {
    return whatsAppGroupRowsByClient.get(row.id) ?? [row];
  }

  function getEffectiveStatus(row: ReceivableRow): CollectionStatus | "" {
    const dailyStatus = getCutItemForClient("night", row.id)?.collectionStatus;
    if (dailyStatus) return dailyStatus;
    const stored = collectionStatusByClient[row.id]?.status;
    if (stored === "unassigned" || stored === "pending" || stored === "contacted" || stored === "covered" || stored === "route") return stored;
    if (stored === "paid") return "covered";
    if (stored === "route_collection") return "route";
    if (shouldDefaultToCovered(row)) return "covered";
    return "unassigned";
  }

  function getWorkflowStatus(row: ReceivableRow): CollectionStatus | "" {
    if (workflowTab === "route") {
      const stored = collectionStatusByClient[row.id]?.status;
      if (stored === "route" || stored === "route_collection" || stored === "route_not_sent" || stored === "paid" || stored === "call_later") return stored;
    }
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

  function normalizeWhatsAppDraft(value: string): string {
    return value.replace(/\D/g, "").slice(0, 12);
  }

  function handleOpenWhatsAppPhoneModal(clientId: string): void {
    if (isTodayCollectionClosed) return;
    const client = clients.find((item) => item.id === clientId);
    setWhatsAppModalClientId(clientId);
    setWhatsAppPhoneDraft(normalizeWhatsAppDraft(client?.whatsAppPhone ?? ""));
    setWhatsAppPhoneError("");
  }

  async function handleSaveWhatsAppPhone(): Promise<void> {
    if (isTodayCollectionClosed) return;
    if (!whatsAppModalClientId) return;
    const normalized = normalizeWhatsAppDraft(whatsAppPhoneDraft);
    if (normalized.length > 0 && normalized.length < 8) {
      setWhatsAppPhoneError("Ingresa al menos 8 digitos.");
      return;
    }
    if (!onClientsChange) {
      setWhatsAppPhoneError("No tienes permisos para actualizar este WhatsApp en la nube.");
      return;
    }
    setIsSavingWhatsAppPhone(true);
    setWhatsAppPhoneError("");
    try {
      const nextClients = clients.map((client) => (
        client.id === whatsAppModalClientId
          ? { ...client, whatsAppPhone: normalized || undefined }
          : client
      ));
      await onClientsChange(nextClients);
      setWhatsAppModalClientId(null);
      setWhatsAppPhoneDraft("");
    } catch (error) {
      console.error("No se pudo guardar el WhatsApp del cliente.", error);
      setWhatsAppPhoneError("No se pudo guardar el WhatsApp. Intenta nuevamente.");
    } finally {
      setIsSavingWhatsAppPhone(false);
    }
  }

  function handleSupportNoteChange(clientId: string, value: string): void {
    if (isTodayCollectionClosed) return;
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
    if (isTodayCollectionClosed) return;
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
    const emptyStatus: Record<string, CollectionStatusRecord> = {};
    const clearMarker: Record<string, unknown> = { __clearedAt: { updatedAt: new Date().toISOString() } };
    if (persistStreetTimerRef.current) {
      window.clearTimeout(persistStreetTimerRef.current);
      persistStreetTimerRef.current = null;
    }
    optimisticStatusByClientRef.current = {};
    saveTokenByClientRef.current = {};
    latestCollectionStatusByClientRef.current = emptyStatus;
    lastStreetSnapshotRef.current = JSON.stringify(emptyStatus);
    streetPersistPendingRef.current = false;
    setStatusSavingByClient({});
    setCollectionStatusByClient(emptyStatus);
    if (dataOwnerUserId) {
      await saveCloudStreetManagement(dataOwnerUserId, clearMarker);
    } else if (onStreetManagementPersist) {
      const ok = await onStreetManagementPersist(clearMarker);
      if (ok === false) throw new Error("No se pudieron limpiar los estados vivos de cobranza.");
    }
  }

  async function handleClearCollectionManagement(): Promise<void> {
    setCollectionCutMessage(null);
    setExportError(null);
    setIsClearingCollectionManagement(true);
    try {
      await clearLiveCollectionStatusAfterClosure();
      setCollectionStatusFilter("all");
      setWhatsAppContactFilter("all");
      setFieldManagementModalClientId(null);
      setWhatsAppModalClientId(null);
      setIsRouteExportMenuOpen(false);
      setCollectionCutMessage("Gestion limpiada. La cartera volvio al formato de inicio.");
    } catch (error) {
      console.error("No se pudo limpiar la gestion de cobranza.", error);
      setCollectionCutMessage("No se pudo limpiar la gestion de cobranza.");
    } finally {
      setIsClearingCollectionManagement(false);
    }
  }

  function handleCollectionCutStatusChange(cutKey: CollectionCutKey, clientId: string, nextStatus: string): void {
    if (isTodayCollectionClosed) return;
    const nowIso = new Date().toISOString();
    if (cutKey !== "night") return;
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: nextStatus as CollectionStatus,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: undefined,
        managementAmount: undefined,
        managementComment: "",
        managementUpdatedAt: undefined,
        routeReleaseAmount: undefined,
        routeReleaseUpdatedAt: undefined,
        routeAssignment: undefined,
        routeAssignmentUpdatedAt: undefined,
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

  function handleRouteWorkflowStatusChange(clientId: string, nextStatus: string): void {
    if (isTodayCollectionClosed) return;
    if (!ROUTE_COLLECTION_STATUS_OPTIONS.some((option) => option.value === nextStatus)) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: nextStatus as CollectionStatus,
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
    if (isTodayCollectionClosed) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: previous?.status ?? "route",
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
  }

  function handleRouteManagementCommentChange(clientId: string, value: string): void {
    if (isTodayCollectionClosed) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: previous?.status ?? "route",
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: previous?.managementType ?? "solo_cobrar",
        managementAmount: previous?.managementAmount ?? previous?.routeReleaseAmount,
        managementComment: normalizeFieldManagementComment(value),
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
  }

  function handleRouteAssignmentChange(clientId: string, value: string): void {
    if (isTodayCollectionClosed) return;
    const routeAssignment = normalizeRouteAssignment(value);
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: previous?.status ?? "route",
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
  }

  function handleRemoveFromRoute(clientId: string): void {
    if (isTodayCollectionClosed) return;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      if (!previous) return current;
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: "unassigned",
        comment: previous.comment ?? "",
        updatedAt: nowIso,
        managementType: undefined,
        managementAmount: undefined,
        managementComment: "",
        managementUpdatedAt: undefined,
        routeReleaseAmount: undefined,
        routeReleaseUpdatedAt: undefined,
        routeAssignment: undefined,
        routeAssignmentUpdatedAt: undefined,
        whatsAppMessageCopiedAt: previous.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous.whatsAppMessageSentAt,
        whatsAppMessageText: previous.whatsAppMessageText,
        supportNote: previous.supportNote,
        supportNoteUpdatedAt: previous.supportNoteUpdatedAt,
        paymentPromiseDate: previous.paymentPromiseDate,
        paymentPromiseUpdatedAt: previous.paymentPromiseUpdatedAt
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  function handleRouteReleaseAmountChange(clientId: string, value: string): void {
    if (isTodayCollectionClosed) return;
    const parsedAmount = parsePositiveMoneyInput(value);
    const nextAmount = parsedAmount ?? undefined;
    const nowIso = new Date().toISOString();
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const previousRouteStatus = previous?.status && ROUTE_COLLECTION_STATUS_OPTIONS.some((option) => option.value === previous.status)
        ? previous.status
        : "route";
      const updatedRecord: CollectionStatusRecord = {
        ...previous,
        status: previousRouteStatus,
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
  }

  function handleCollectionCutCommentChange(cutKey: CollectionCutKey, clientId: string, value: string): void {
    if (isTodayCollectionClosed) return;
    if (cutKey !== "night") return;
    handleSupportNoteChange(clientId, value);
  }

  function markClientStatusAsSaving(clientId: string): void {
    saveTokenByClientRef.current[clientId] = (saveTokenByClientRef.current[clientId] ?? 0) + 1;
    setStatusSavingByClient((current) => ({ ...current, [clientId]: true }));
  }

  function handleCollectionStatusChange(clientId: string, nextStatus: string): void {
    if (isTodayCollectionClosed) return;
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

  function handleWhatsAppMessageCopied(clientId: string, message: string): void {
    if (isTodayCollectionClosed) return;
    const targetRows = whatsAppGroupRowsByClient.get(clientId) ?? baseRows.filter((row) => row.id === clientId);
    const targetClientIds = targetRows.length > 0 ? targetRows.map((row) => row.id) : [clientId];
    for (const targetClientId of targetClientIds) markClientStatusAsSaving(targetClientId);
    const copiedAt = new Date().toISOString();
    setCollectionStatusByClient((current) => {
      const next = { ...current };
      for (const targetClientId of targetClientIds) {
        const previous = current[targetClientId];
        const updatedRecord: CollectionStatusRecord = {
          ...previous,
          status: previous?.status ?? "unassigned",
          comment: previous?.comment ?? "",
          updatedAt: copiedAt,
          managementType: previous?.managementType,
          managementAmount: previous?.managementAmount,
          managementComment: previous?.managementComment,
          managementUpdatedAt: previous?.managementUpdatedAt,
          routeReleaseAmount: previous?.routeReleaseAmount,
          routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
          routeAssignment: previous?.routeAssignment,
          routeAssignmentUpdatedAt: previous?.routeAssignmentUpdatedAt,
          whatsAppMessageCopiedAt: copiedAt,
          whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
          whatsAppMessageText: message,
          supportNote: previous?.supportNote,
          supportNoteUpdatedAt: previous?.supportNoteUpdatedAt,
          contactTime: previous?.contactTime,
          contactTimeUpdatedAt: previous?.contactTimeUpdatedAt,
          paymentPromiseDate: previous?.paymentPromiseDate,
          paymentPromiseUpdatedAt: previous?.paymentPromiseUpdatedAt
        };
        optimisticStatusByClientRef.current[targetClientId] = updatedRecord;
        next[targetClientId] = updatedRecord;
      }
      return next;
    });
  }

  function handleWhatsAppMessageSent(clientId: string, message: string): void {
    if (isTodayCollectionClosed) return;
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
    if (isTodayCollectionClosed) return;
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
    if (isTodayCollectionClosed) return;
    markClientStatusAsSaving(clientId);
    const draft = fieldManagementDraftByClient[clientId] ?? { type: "", amount: "", comment: "" };
    if (draft.type !== "solo_cobrar" && draft.type !== "cobrar_o_quitar") {
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
    if (isTodayCollectionClosed) return;
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

  async function handleExportCobroEnRuta(formatOverride?: RouteExportFormat): Promise<void> {
    setExportError(null);
    setIsExporting(true);
    try {
      let statusByClientForRoute = { ...collectionStatusByClient };
      if (dataOwnerUserId) {
        const cloudStreetManagement = await loadCloudStreetManagement(dataOwnerUserId);
        statusByClientForRoute = parseCollectionStatusMapFromStorage(JSON.stringify(cloudStreetManagement));
      }
      const isRouteRowFromMap = (row: ReceivableRow): boolean => {
        const storedStatus = statusByClientForRoute[row.id]?.status;
        return storedStatus === "route" || storedStatus === "route_collection";
      };
      const hasRouteCollectionFromMap = (row: ReceivableRow): boolean => {
        const management = statusByClientForRoute[row.id];
        const hasType = management?.managementType === "solo_cobrar" || management?.managementType === "cobrar_o_quitar";
        return hasType && !!management?.managementAmount && management.managementAmount > 0;
      };
      const routeRowsMissingAmount = baseRows.filter((row) => isRouteRowFromMap(row) && !hasRouteReleaseAmount(statusByClientForRoute[row.id]));
      if (routeRowsMissingAmount.length > 0) {
        setExportError(routeMissingAmountMessage(routeRowsMissingAmount));
        return;
      }
      const routeRowsMissingAssignment = baseRows.filter((row) => {
        if (!isRouteRowFromMap(row)) return false;
        const routeAssignment = statusByClientForRoute[row.id]?.routeAssignment;
        return !routeAssignment || routeAssignment.trim().length === 0;
      });
      if (routeRowsMissingAssignment.length > 0) {
        setExportError(routeMissingAssignmentMessage(routeRowsMissingAssignment));
        return;
      }
      const previousStatusByClientForRoute = { ...statusByClientForRoute };
      const exportedAt = new Date().toISOString();
      for (const row of baseRows) {
        if (!isRouteRowFromMap(row) || hasRouteCollectionFromMap(row)) continue;
        const previous = statusByClientForRoute[row.id];
        const routeReleaseAmount = previous?.routeReleaseAmount ?? previous?.managementAmount;
        statusByClientForRoute[row.id] = {
          status: "route_collection",
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
      const exported = await exportRouteCollection({
        rows: baseRows,
        statusByClient: statusByClientForRoute,
        format: formatOverride ?? routeExportFormat,
        now
      });
      if (!exported) setExportError("No hay registros con Cobro en Ruta para exportar.");
    } catch {
      setExportError("No se pudo exportar Cobro en Ruta.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleSaveCollectionCut(cutKey: CollectionCutKey): Promise<void> {
    setCollectionCutMessage(null);
    setExportError(null);
    if (isTodayCollectionClosed) {
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
        getEffectiveStatusFromMap(row, statusByClientForClosure) === "route" &&
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

  const whatsAppModalClient = whatsAppModalClientId
    ? clients.find((item) => item.id === whatsAppModalClientId)
    : undefined;
  const whatsAppModalRow = whatsAppModalClientId
    ? baseRows.find((item) => item.id === whatsAppModalClientId)
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
                onClick={() => void handleClearCollectionManagement()}
                disabled={isClearingCollectionManagement}
              >
                {isClearingCollectionManagement ? "Limpiando gestion..." : "Limpiar gestion"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="ar-workflow-tabs" role="tablist" aria-label="Flujo de cuentas por cobrar">
          <button
            type="button"
            role="tab"
            aria-selected={workflowTab === "management"}
            className={workflowTab === "management" ? "is-active" : ""}
            onClick={() => {
              setWorkflowTab("management");
              setCollectionStatusFilter("all");
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
            }}
          >
            Cobro en Ruta <strong>{routeWorkflowRowsCount}</strong>
          </button>
        </div>

        <div className="ar-ledger-toolbar">
          <div className="ar-view-tabs">
            <label className="ar-toolbar-filter ar-toolbar-filter--management">
              <span className="ar-toolbar-filter-label">{workflowTab === "route" ? "Ruta" : "Gestion"}</span>
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
            <label className="ar-toolbar-filter">
              <span className="ar-toolbar-filter-label">WhatsApp</span>
              <select
                className="ar-toolbar-filter-select"
                value={whatsAppContactFilter}
                onChange={(event) => setWhatsAppContactFilter(event.target.value as WhatsAppContactFilter)}
              >
                <option value="all">Todos</option>
                <option value="pending">No completados</option>
                <option value="missing">Sin numero</option>
                <option value="ready">Por enviar</option>
                <option value="opened">Pendientes</option>
                <option value="sent">Completados</option>
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
            <span className="ar-results-count">Mostrando {rows.length} de {workflowTab === "route" ? routeWorkflowRowsCount : managementWorkflowRowsCount}</span>
            {workflowTab === "route" ? (
              <div className="ar-route-export-actions">
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => void handleExportCobroEnRuta()}
                  disabled={isExporting || routeWorkflowRowsCount === 0}
                >
                  {isExporting ? "Exportando..." : "Exportar ruta"}
                </button>
                <select
                  className="ar-route-export-format"
                  value={routeExportFormat}
                  onChange={(event) => setRouteExportFormat(event.target.value as RouteExportFormat)}
                  disabled={isExporting}
                  aria-label="Formato de exportacion de cobro en ruta"
                >
                  <option value="jpg">JPG</option>
                  <option value="pdf">PDF</option>
                  <option value="excel">Excel</option>
                </select>
              </div>
            ) : null}
          </div>
        </div>

        <ReceivablesFiltersPanel
          filters={filters}
          availableGroups={availableGroups}
          onFilterChange={updateFilter}
          onStateFilterToggle={handleStateFilterToggle}
          onClearFilters={clearFilters}
        />

        {collectionCutMessage ? <p className="hint">{collectionCutMessage}</p> : null}
        {exportError ? <p className="hint error-text">{exportError}</p> : null}
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
          isTodayCollectionClosed={isTodayCollectionClosed}
          workflowTab={workflowTab}
          todayCollectionCuts={todayCollectionCuts}
          visibleCollectionCut={visibleCollectionCut}
          buildWhatsAppReceivableMessage={buildWhatsAppReceivableMessage}
          getWhatsAppGroupRows={getWhatsAppGroupRows}
          onSelectDetail={setSelectedDetailRow}
          onCollectionCutStatusChange={workflowTab === "route"
            ? (_cutKey, clientId, nextStatus) => handleRouteWorkflowStatusChange(clientId, nextStatus)
            : handleCollectionCutStatusChange}
          onCollectionCutCommentChange={handleCollectionCutCommentChange}
          onRouteManagementTypeChange={handleRouteManagementTypeChange}
          onRouteManagementCommentChange={handleRouteManagementCommentChange}
          onRouteAssignmentChange={handleRouteAssignmentChange}
          onRouteReleaseAmountChange={handleRouteReleaseAmountChange}
          onRemoveFromRoute={handleRemoveFromRoute}
          onWhatsAppMessageCopied={handleWhatsAppMessageCopied}
          onWhatsAppMessageSent={handleWhatsAppMessageSent}
          onEditWhatsAppPhone={handleOpenWhatsAppPhoneModal}
          onSupportNoteChange={handleSupportNoteChange}
          onContactTimeChange={handleContactTimeChange}
          onClearFilters={clearFilters}
        />
      </section>

      {whatsAppModalClientId && (
        <WhatsAppPhoneModal
          client={whatsAppModalClient}
          row={whatsAppModalRow}
          draft={whatsAppPhoneDraft}
          error={whatsAppPhoneError}
          saving={isSavingWhatsAppPhone}
          onDraftChange={(value) => {
            setWhatsAppPhoneDraft(normalizeWhatsAppDraft(value));
            setWhatsAppPhoneError("");
          }}
          onClose={() => setWhatsAppModalClientId(null)}
          onSave={() => void handleSaveWhatsAppPhone()}
        />
      )}

      {selectedDetailRow && (
        <ReceivableDetailModal
          row={selectedDetailRow}
          onClose={() => setSelectedDetailRow(null)}
        />
      )}
    </>
  );
}
