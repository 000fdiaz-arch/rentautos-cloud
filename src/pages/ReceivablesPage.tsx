import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { exportReceivablesToExcel, exportReceivablesToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import { loadCloudCollectionClosures, loadControlUnits, saveCloudCollectionClosures, type ControlUnitRow } from "../cloudData";
import { supabase } from "../lib/supabase";
import {
  buildReceivableRows,
  createMockReceivableRows,
  DEFAULT_RECEIVABLE_FILTERS,
  filterReceivableRows,
  getGroupFromUnit,
  sortReceivableRows,
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
  INITIAL_EXPORT_FIELDS,
  clientOperationalStatusLabel,
  getCollectionClosureCuts,
  getCollectionClosureDateKeys,
  formatDateForTitle,
  isToday,
  normalizeComment,
  normalizeFieldManagementComment,
  normalizeSupportNote,
  parseCollectionStatusMapFromStorage,
  pendingSummaryText,
  planLabelForExport,
  renderSortIcon,
  toTimestamp,
  type CollectionClosureItem,
  type CollectionClosureSnapshot,
  type CollectionClosuresByDate,
  type CollectionCutKey,
  type CollectionStatusFilter,
  type ExportField,
  type ReceivablesViewMode
} from "./receivables/receivablesPageRules";

type Props = {
  clients: Client[];
  payments: Payment[];
  onClientsChange?: (next: Client[]) => void | Promise<void>;
  dataOwnerUserId?: string | null;
  streetManagementData?: Record<string, unknown>;
  onStreetManagementPersist?: (value: Record<string, unknown>) => Promise<boolean> | boolean;
};

const WHATSAPP_REALIZED_CLEANUP_KEY = "cobrapp.module3.whatsapp_realized_cleanup.v1";

function getStatusOptionsForCut(cutKey: CollectionCutKey): Array<{ value: CollectionStatus; label: string; description: string }> {
  return cutKey === "night" ? DAILY_COLLECTION_STATUS_OPTIONS : COLLECTION_STATUS_OPTIONS;
}

function createEmptyCollectionStatusCounts(): Record<CollectionStatus, number> {
  return {
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

function hasOverdueDebtForWhatsApp(row: ReceivableRow): boolean {
  return row.overdueBalance > 0 || row.overdueInstallments > 0 || row.state === "vencido" || row.state === "critico";
}

function getWhatsAppContactStatus(row: ReceivableRow, record: CollectionStatusRecord | undefined): Exclude<WhatsAppContactFilter, "all" | "pending"> {
  if (!hasOverdueDebtForWhatsApp(row)) return "sent";
  if (record?.whatsAppMessageSentAt) return "sent";
  if (record?.whatsAppMessageCopiedAt) return "opened";
  if (!normalizeWhatsAppPhoneForFilter(row.whatsAppPhone)) return "missing";
  return "ready";
}

function removeWhatsAppAudit(record: CollectionStatusRecord): CollectionStatusRecord {
  const {
    whatsAppMessageCopiedAt: _whatsAppMessageCopiedAt,
    whatsAppMessageSentAt: _whatsAppMessageSentAt,
    whatsAppMessageText: _whatsAppMessageText,
    ...rest
  } = record;
  return rest;
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

export default function ReceivablesPage({
  clients,
  payments,
  onClientsChange,
  dataOwnerUserId,
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
  const [viewMode, setViewMode] = useState<ReceivablesViewMode>("cartera");
  const [collectionClosuresByDate, setCollectionClosuresByDate] = useState<CollectionClosuresByDate>({});
  const [collectionClosuresLoaded, setCollectionClosuresLoaded] = useState<boolean>(false);
  const [isCollectionClosuresLoading, setIsCollectionClosuresLoading] = useState<boolean>(false);
  const [visibleCollectionCut] = useState<CollectionCutKey | "all">("night");
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [collectionCutMessage, setCollectionCutMessage] = useState<string | null>(null);
  const [isSavingCollectionCut, setIsSavingCollectionCut] = useState<CollectionCutKey | null>(null);
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
  const optimisticStatusByClientRef = useRef<Record<string, CollectionStatusRecord>>({});
  const saveTokenByClientRef = useRef<Record<string, number>>({});
  const latestCollectionStatusByClientRef = useRef<Record<string, CollectionStatusRecord>>({});

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timerId);
  }, []);

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
    const parsed = parseCollectionStatusMapFromStorage(JSON.stringify(streetManagementData ?? {}));
    const merged: Record<string, CollectionStatusRecord> = { ...parsed };
    const optimistic = optimisticStatusByClientRef.current;
    for (const [clientId, optimisticRecord] of Object.entries(optimistic)) {
      const incoming = merged[clientId];
      if (!incoming || toTimestamp(incoming.updatedAt) < toTimestamp(optimisticRecord.updatedAt)) {
        merged[clientId] = optimisticRecord;
        continue;
      }
      delete optimistic[clientId];
    }
    const incomingSerialized = JSON.stringify(merged);
    if (streetPersistPendingRef.current && incomingSerialized !== lastStreetSnapshotRef.current) return;
    setCollectionStatusByClient(merged);
    lastStreetSnapshotRef.current = incomingSerialized;
  }, [streetManagementData]);

  useEffect(() => {
    const serialized = JSON.stringify(collectionStatusByClient);
    latestCollectionStatusByClientRef.current = collectionStatusByClient;
    if (serialized === lastStreetSnapshotRef.current) return;
    streetPersistPendingRef.current = true;

    if (persistStreetTimerRef.current) window.clearTimeout(persistStreetTimerRef.current);
    persistStreetTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const saveTokenSnapshot = { ...saveTokenByClientRef.current };
        if (onStreetManagementPersist) {
          const ok = await onStreetManagementPersist(collectionStatusByClient as Record<string, unknown>);
          if (ok === false) {
            setStatusSavingByClient((current) => {
              const next = { ...current };
              for (const [clientId, token] of Object.entries(saveTokenSnapshot)) {
                if (saveTokenByClientRef.current[clientId] === token) next[clientId] = false;
              }
              return next;
            });
            streetPersistPendingRef.current = false;
            return;
          }
        }
        lastStreetSnapshotRef.current = serialized;
        setStatusSavingByClient((current) => {
          const next = { ...current };
          for (const [clientId, token] of Object.entries(saveTokenSnapshot)) {
            if (saveTokenByClientRef.current[clientId] === token) next[clientId] = false;
          }
          return next;
        });
        streetPersistPendingRef.current = false;
      })();
    }, 100);
  }, [collectionStatusByClient, onStreetManagementPersist]);

  useEffect(() => {
    return () => {
      if (persistStreetTimerRef.current) window.clearTimeout(persistStreetTimerRef.current);
      if (streetPersistPendingRef.current && onStreetManagementPersist) {
        const latestStatusByClient = latestCollectionStatusByClientRef.current;
        lastStreetSnapshotRef.current = JSON.stringify(latestStatusByClient);
        void onStreetManagementPersist(latestStatusByClient as Record<string, unknown>);
      }
    };
  }, [onStreetManagementPersist]);

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
    if (viewMode !== "historial" || collectionClosuresLoaded) return;
    void loadCollectionClosuresFromCloud();
  }, [collectionClosuresLoaded, dataOwnerUserId, loadCollectionClosuresFromCloud, viewMode]);

  useEffect(() => {
    if (!dataOwnerUserId || !supabase || !collectionClosuresLoaded) return;
    const client = supabase;
    const channel = client
      .channel(`collection-closures-live-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "collection_closures_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, () => {
        void loadCollectionClosuresFromCloud();
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [collectionClosuresLoaded, dataOwnerUserId, loadCollectionClosuresFromCloud]);

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

  const baseRows = useMemo(() => {
    if (clients.length === 0) return createMockReceivableRows(now);
    return buildReceivableRows(clients, payments, now, fleetUnits);
  }, [clients, fleetUnits, now, payments]);

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [collectionStatusFilter, filters, sortDirection, sortField, viewMode, whatsAppContactFilter]);

  useEffect(() => {
    if (localStorage.getItem(WHATSAPP_REALIZED_CLEANUP_KEY) === "done") return;
    const entries = Object.entries(collectionStatusByClient);
    if (entries.length === 0) return;

    let changed = false;
    const cleaned = Object.fromEntries(entries.map(([clientId, record]) => {
      if (!record.whatsAppMessageCopiedAt && !record.whatsAppMessageSentAt && !record.whatsAppMessageText) {
        return [clientId, record] as const;
      }
      changed = true;
      return [clientId, removeWhatsAppAudit(record)] as const;
    }));

    if (changed) {
      localStorage.setItem(WHATSAPP_REALIZED_CLEANUP_KEY, "done");
      setCollectionStatusByClient(cleaned);
    }
  }, [collectionStatusByClient]);

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

  const todayDateKey = useMemo(() => {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [now]);
  const isTodayCollectionClosed = false;
  const todayCollectionCuts = useMemo(
    () => getCollectionClosureCuts(collectionClosuresByDate[todayDateKey]),
    [collectionClosuresByDate, todayDateKey]
  );

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
        routeReleaseUpdatedAt: undefined
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      nextStatusByClient[clientId] = updatedRecord;
      changedStatus = true;
    }
    if (changedStatus) {
      setCollectionStatusByClient(nextStatusByClient);
      latestCollectionStatusByClientRef.current = nextStatusByClient;
      if (onStreetManagementPersist) {
        lastStreetSnapshotRef.current = JSON.stringify(nextStatusByClient);
        void onStreetManagementPersist(nextStatusByClient as Record<string, unknown>);
      }
    }

    const todayClosure = todayCollectionCuts.night;
    if (!todayClosure) return;
    const nextItems = todayClosure.items.map((item) => (
      releasedClientIds.has(item.clientId) && item.collectionStatus === "route"
        ? { ...item, collectionStatus: "contacted" as CollectionStatus, autoApplied: false }
        : item
    ));
    if (nextItems.every((item, index) => item === todayClosure.items[index])) return;
    persistCollectionClosures({
      ...collectionClosuresByDate,
      [todayDateKey]: {
        date: todayDateKey,
        cuts: {
          ...todayCollectionCuts,
          night: {
            ...todayClosure,
            totals: computeCutTotals(nextItems),
            items: nextItems
          }
        }
      }
    });
  }, [collectionStatusByClient, collectionClosuresByDate, payments, todayCollectionCuts, todayDateKey]);

  const filteredRows = useMemo(() => filterReceivableRows(baseRows, filters), [baseRows, filters]);
  const collectionStatusCounts = useMemo(() => {
    const counts = createEmptyCollectionStatusCounts();
    for (const row of filteredRows) {
      const status = getEffectiveStatus(row) || "pending";
      counts[status] += 1;
    }
    return counts;
  }, [filteredRows, collectionStatusByClient, todayCollectionCuts]);
  const managementAlertCount = collectionStatusFilter === "covered"
    ? collectionStatusCounts.covered
    : collectionStatusCounts.pending + collectionStatusCounts.contacted + collectionStatusCounts.route;
  const managementAlertText = collectionStatusFilter === "covered"
    ? `${managementAlertCount} gestion${managementAlertCount === 1 ? "" : "es"} cubierta${managementAlertCount === 1 ? "" : "s"}`
    : `${managementAlertCount} gestion${managementAlertCount === 1 ? "" : "es"} pendiente${managementAlertCount === 1 ? "" : "s"}`;
  const collectionStatusFilterHelp = collectionStatusFilter === "all"
    ? "Muestra todos los estados de gestion."
    : COLLECTION_STATUS_HELP[collectionStatusFilter];
  const filteredByCollectionStatusRows = useMemo(() => {
    if (collectionStatusFilter === "all") return filteredRows;
    return filteredRows.filter((row) => getEffectiveStatus(row) === collectionStatusFilter);
  }, [collectionStatusFilter, filteredRows, collectionStatusByClient, now, todayCollectionCuts]);
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

  const sortedRows = useMemo(
    () => sortReceivableRows(filteredByWhatsAppRows, sortField, sortDirection),
    [filteredByWhatsAppRows, sortDirection, sortField]
  );
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
  const routeCollectionRowsCount = useMemo(
    () => baseRows.filter((row) => hasRouteCollection(row) || isNightRouteCollection(row)).length,
    [baseRows, collectionStatusByClient, todayCollectionCuts]
  );

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
    return status === "route" || status === "route_collection";
  }

  function buildWhatsAppReceivableMessage(row: ReceivableRow): string {
    const today = formatDateForTitle(now);
    const firstName = row.name.trim().split(/\s+/)[0] || row.name;
    const lastPayment = row.lastPaymentDate
      ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`))
      : "Sin pagos registrados";
    const pending = formatCurrency(row.overdueBalance);
    const installments = row.rentAmount > 0 ? Math.ceil(row.overdueBalance / row.rentAmount) : 0;
    const installmentsText = installments > 0
      ? `${installments} cuota${installments === 1 ? "" : "s"}`
      : "Sin cuotas vencidas";
    const emoji = {
      hello: String.fromCodePoint(0x1F44B),
      warning: `${String.fromCodePoint(0x26A0)}${String.fromCodePoint(0xFE0F)}`,
      money: String.fromCodePoint(0x1F4B5),
      pin: String.fromCodePoint(0x1F4CC),
      check: String.fromCodePoint(0x2705),
      thanks: String.fromCodePoint(0x1F64F)
    };
    const message = [
      `${emoji.hello} Hola, ${firstName}.`,
      "",
      `${emoji.warning} Tiene renta vencida al ${today}.`,
      "",
      `${emoji.money} Renta vencida: ${pending}`,
      `${emoji.pin} Ultimo pago: ${lastPayment}`,
      `${emoji.pin} Detalle: ${installmentsText}`,
      "",
      `${emoji.check} Por favor, realice el pago lo antes posible.`,
      "",
      `${emoji.thanks} Gracias.`
    ].join("\n");
    return message;
  }

  function getEffectiveStatus(row: ReceivableRow): CollectionStatus | "" {
    const dailyStatus = getCutItemForClient("night", row.id)?.collectionStatus;
    if (dailyStatus) return dailyStatus;
    const stored = collectionStatusByClient[row.id]?.status;
    if (stored === "pending" || stored === "contacted" || stored === "covered" || stored === "route") return stored;
    if (stored === "paid") return "covered";
    if (stored === "route_collection") return "route";
    if (shouldDefaultToCovered(row)) return "covered";
    return "pending";
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
    const client = clients.find((item) => item.id === clientId);
    setWhatsAppModalClientId(clientId);
    setWhatsAppPhoneDraft(normalizeWhatsAppDraft(client?.whatsAppPhone ?? ""));
    setWhatsAppPhoneError("");
  }

  async function handleSaveWhatsAppPhone(): Promise<void> {
    if (!whatsAppModalClientId) return;
    const normalized = normalizeWhatsAppDraft(whatsAppPhoneDraft);
    if (normalized.length > 0 && normalized.length < 8) {
      setWhatsAppPhoneError("Ingresa al menos 8 digitos.");
      return;
    }
    if (!onClientsChange) {
      setWhatsAppPhoneError("No tienes permisos para editar clientes desde esta pantalla.");
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
    markClientStatusAsSaving(clientId);
    const note = normalizeSupportNote(value);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        status: previous?.status ?? "reminder",
        comment: previous?.comment ?? "",
        updatedAt: previous?.updatedAt ?? new Date().toISOString(),
        managementType: previous?.managementType,
        managementAmount: previous?.managementAmount,
        managementComment: previous?.managementComment,
        managementUpdatedAt: previous?.managementUpdatedAt,
        routeReleaseAmount: previous?.routeReleaseAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: note,
        supportNoteUpdatedAt: new Date().toISOString(),
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

  function computeCutTotals(items: CollectionClosureItem[]): Record<CollectionStatus, number> {
    const totals = createEmptyCollectionStatusCounts();
    for (const item of items) totals[item.collectionStatus] += 1;
    return totals;
  }

  function buildCutItem(row: ReceivableRow, status: CollectionStatus, comment: string): CollectionClosureItem {
    const statusRecord = collectionStatusByClient[row.id];
    return {
      clientId: row.id,
      unitId: row.unitId,
      clientName: row.name,
      lastPaymentDate: row.lastPaymentDate,
      receivableState: row.state,
      totalPending: row.totalPending,
      collectionStatus: status,
      comment: status === "call_later" ? normalizeComment(comment) : "",
      autoApplied: false,
      managementType: statusRecord?.managementType,
      managementAmount: statusRecord?.managementAmount,
      managementComment: statusRecord?.managementComment,
      whatsAppMessageCopiedAt: statusRecord?.whatsAppMessageCopiedAt,
      whatsAppMessageSentAt: statusRecord?.whatsAppMessageSentAt
    };
  }

  function persistCollectionClosures(nextClosures: CollectionClosuresByDate): void {
    setCollectionClosuresByDate(nextClosures);
    setCollectionClosuresLoaded(true);
    if (!dataOwnerUserId) {
      setCollectionCutMessage("No se pudo guardar el corte: falta conexion con la nube del negocio.");
      return;
    }
    void saveCloudCollectionClosures(dataOwnerUserId, nextClosures as Record<string, unknown>)
      .catch((error) => {
        console.error("No se pudo guardar el corte de cobranza.", error);
        setCollectionCutMessage("No se pudo guardar el corte de cobranza.");
      });
  }

  function updateCollectionCutItem(cutKey: CollectionCutKey, clientId: string, patch: { status?: string; comment?: string; managementAmount?: number | null }): void {
    const row = baseRows.find((item) => item.id === clientId);
    if (!row) return;
    const cutOption = COLLECTION_CUT_OPTIONS.find((option) => option.key === cutKey);
    const existingCuts = getCollectionClosureCuts(collectionClosuresByDate[todayDateKey]);
    const existingClosure = existingCuts[cutKey];
    const existingItems = existingClosure?.items ?? [];
    const existingItem = existingItems.find((item) => item.clientId === clientId);
    const nextStatus = patch.status !== undefined
      ? patch.status
      : existingItem?.collectionStatus ?? "";
    const validStatuses = new Set(getStatusOptionsForCut(cutKey).map((option) => option.value));

    const itemsWithoutClient = existingItems.filter((item) => item.clientId !== clientId);
    let nextItems = itemsWithoutClient;
    if (validStatuses.has(nextStatus as CollectionStatus)) {
      const nextComment = patch.comment !== undefined ? patch.comment : existingItem?.comment ?? "";
      const hasManagementAmountPatch = Object.prototype.hasOwnProperty.call(patch, "managementAmount");
      const nextItem = buildCutItem(row, nextStatus as CollectionStatus, nextComment);
      if (hasManagementAmountPatch) {
        nextItem.managementAmount = patch.managementAmount ?? undefined;
        nextItem.managementType = nextStatus === "route" ? "solo_cobrar" : nextItem.managementType;
      }
      nextItems = [
        ...itemsWithoutClient,
        nextItem
      ].sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }));
    }

    const nextClosure: CollectionClosureSnapshot = {
      date: todayDateKey,
      cutKey,
      cutLabel: cutKey === "night" ? "Gestion diaria" : cutOption?.shortLabel ?? "Corte",
      closedAt: existingClosure?.closedAt ?? new Date().toISOString(),
      actor: existingClosure?.actor ?? "Operador",
      reason: cutKey === "night" ? "Gestion diaria de cobranza" : cutOption?.label ?? "Corte de cobranza",
      totals: computeCutTotals(nextItems),
      items: nextItems
    };
    const nextClosures: CollectionClosuresByDate = {
      ...collectionClosuresByDate,
      [todayDateKey]: {
        date: todayDateKey,
        cuts: {
          ...existingCuts,
          [cutKey]: nextClosure
        }
      }
    };
    persistCollectionClosures(nextClosures);
  }

  function handleCollectionCutStatusChange(cutKey: CollectionCutKey, clientId: string, nextStatus: string): void {
    const nowIso = new Date().toISOString();
    const previous = collectionStatusByClient[clientId];
    const routeReleaseAmount = nextStatus === "route" ? previous?.routeReleaseAmount : undefined;
    updateCollectionCutItem(cutKey, clientId, { status: nextStatus, managementAmount: routeReleaseAmount ?? null });
    if (cutKey !== "night") return;
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        status: nextStatus as CollectionStatus,
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: nextStatus === "route" ? "solo_cobrar" : undefined,
        managementAmount: nextStatus === "route" ? routeReleaseAmount : undefined,
        managementComment: nextStatus === "route" ? previous?.managementComment : "",
        managementUpdatedAt: nextStatus === "route" ? nowIso : undefined,
        routeReleaseAmount: nextStatus === "route" ? routeReleaseAmount : undefined,
        routeReleaseUpdatedAt: nextStatus === "route" ? nowIso : undefined,
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

  function handleRouteReleaseAmountChange(clientId: string, value: string): void {
    const parsedAmount = parsePositiveMoneyInput(value);
    const nextAmount = parsedAmount ?? undefined;
    const nowIso = new Date().toISOString();
    updateCollectionCutItem("night", clientId, { managementAmount: nextAmount ?? null });
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        status: "route",
        comment: previous?.comment ?? "",
        updatedAt: nowIso,
        managementType: "solo_cobrar",
        managementAmount: nextAmount,
        managementComment: previous?.managementComment ?? "",
        managementUpdatedAt: nowIso,
        routeReleaseAmount: nextAmount,
        routeReleaseUpdatedAt: nextAmount ? nowIso : undefined,
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
    updateCollectionCutItem(cutKey, clientId, { comment: value });
  }

  function markClientStatusAsSaving(clientId: string): void {
    saveTokenByClientRef.current[clientId] = (saveTokenByClientRef.current[clientId] ?? 0) + 1;
    setStatusSavingByClient((current) => ({ ...current, [clientId]: true }));
  }

  function handleCollectionStatusChange(clientId: string, nextStatus: string): void {
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
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        status: previous?.status ?? "reminder",
        comment: previous?.comment ?? "",
        updatedAt: new Date().toISOString(),
        managementType: previous?.managementType,
        managementAmount: previous?.managementAmount,
        managementComment: previous?.managementComment,
        managementUpdatedAt: previous?.managementUpdatedAt,
        routeReleaseAmount: previous?.routeReleaseAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        whatsAppMessageCopiedAt: new Date().toISOString(),
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: message,
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
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        status: previous?.status ?? "reminder",
        comment: previous?.comment ?? "",
        updatedAt: new Date().toISOString(),
        managementType: previous?.managementType,
        managementAmount: previous?.managementAmount,
        managementComment: previous?.managementComment,
        managementUpdatedAt: previous?.managementUpdatedAt,
        routeReleaseAmount: previous?.routeReleaseAmount,
        routeReleaseUpdatedAt: previous?.routeReleaseUpdatedAt,
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt ?? new Date().toISOString(),
        whatsAppMessageSentAt: new Date().toISOString(),
        whatsAppMessageText: message,
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

  function handleCallLaterCommentChange(clientId: string, value: string): void {
    markClientStatusAsSaving(clientId);
    setCollectionStatusByClient((current) => {
      const currentStatus = current[clientId]?.status ?? "call_later";
      const previous = current[clientId];
      const updatedRecord: CollectionStatusRecord = {
        status: currentStatus,
        comment: normalizeComment(value),
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
      const routeRowsMissingAmount = baseRows.filter((row) => isNightRouteCollection(row) && !hasRouteReleaseAmount(collectionStatusByClient[row.id]));
      if (routeRowsMissingAmount.length > 0) {
        setExportError(`Falta monto minimo para liberar en ${routeRowsMissingAmount.length} unidad(es) en cobro en ruta.`);
        return;
      }
      const statusByClientForRoute = { ...collectionStatusByClient };
      for (const row of baseRows) {
        if (!isNightRouteCollection(row) || hasRouteCollection(row)) continue;
        statusByClientForRoute[row.id] = {
          status: "route_collection",
          comment: "",
          updatedAt: new Date().toISOString(),
          managementType: "solo_cobrar",
          managementAmount: collectionStatusByClient[row.id]?.routeReleaseAmount ?? collectionStatusByClient[row.id]?.managementAmount,
          managementComment: "Ruta"
        };
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
    if (!dataOwnerUserId) {
      setCollectionCutMessage("No se pudo guardar el corte: falta conexion con la nube del negocio.");
      return;
    }
    const cutOption = COLLECTION_CUT_OPTIONS.find((option) => option.key === cutKey);
    const cutLabel = cutKey === "night" ? "Gestion diaria" : cutOption?.shortLabel ?? "Corte";
    if (cutKey === "night") {
      const routeRowsMissingAmount = baseRows.filter((row) => getEffectiveStatus(row) === "route" && !hasRouteReleaseAmount(collectionStatusByClient[row.id]));
      if (routeRowsMissingAmount.length > 0) {
        setCollectionCutMessage(`Falta monto minimo para liberar en ${routeRowsMissingAmount.length} unidad(es) en cobro en ruta.`);
        return;
      }
    }
    setIsSavingCollectionCut(cutKey);
    try {
      const validStatuses = new Set(getStatusOptionsForCut(cutKey).map((option) => option.value));
      const eligibleRows = cutKey === "night" ? baseRows : baseRows.filter((row) => isRowEligibleForCut(row, cutKey));
      const closureItems: CollectionClosureItem[] = [];
      for (const row of eligibleRows) {
        const statusRecord = collectionStatusByClient[row.id];
        const existingItem = getCutItemForClient(cutKey, row.id);
        const savedStatus = existingItem?.collectionStatus;
        const autoStatus = cutKey === "night"
          ? (shouldDefaultToCovered(row) ? "covered" : "pending")
          : (hasAutoPaidStatus(row) ? "paid" : "");
        const status = savedStatus && validStatuses.has(savedStatus) ? savedStatus : autoStatus;
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
          </div>
          {viewMode === "cartera" ? (
            <div className="ar-collection-cuts-actions">
              <button
                type="button"
                className="button ghost small"
                onClick={() => void handleSaveCollectionCut("night")}
                disabled={isSavingCollectionCut !== null}
              >
                {isSavingCollectionCut === "night" ? "Cerrando..." : "Cerrar gestion del dia"}
              </button>
              <button type="button" className="button ghost small" onClick={() => void handleExportExcel()} disabled={isExporting}>Excel</button>
              <button type="button" className="button ghost small" onClick={() => void handleExportPdf()} disabled={isExporting}>PDF</button>
              <div className="ar-export-route-menu-wrap">
                <button
                  type="button"
                  className="button small ar-export-route-btn"
                  onClick={() => setIsRouteExportMenuOpen((current) => !current)}
                  disabled={isExporting || routeCollectionRowsCount === 0}
                >
                  Cobro en ruta
                </button>
                {isRouteExportMenuOpen ? (
                  <div className="ar-export-route-menu">
                    {([
                      ["jpg", "Exportar JPG"],
                      ["pdf", "Exportar PDF"],
                      ["excel", "Exportar Excel"]
                    ] as Array<[RouteExportFormat, string]>).map(([format, label]) => (
                      <button
                        key={format}
                        type="button"
                        className="ar-export-route-menu-item"
                        onClick={() => {
                          setRouteExportFormat(format);
                          setIsRouteExportMenuOpen(false);
                          void handleExportCobroEnRuta(format);
                        }}
                        disabled={isExporting}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="ar-ledger-toolbar">
          <div className="ar-view-tabs">
            <button
              type="button"
              className={`button small ${viewMode === "cartera" ? "primary" : "ghost"}`}
              onClick={() => setViewMode("cartera")}
            >
              Cartera
            </button>
            <button
              type="button"
              className={`button small ${viewMode === "historial" ? "primary" : "ghost"}`}
              onClick={() => setViewMode("historial")}
              disabled={!dataOwnerUserId || isCollectionClosuresLoading}
            >
              {isCollectionClosuresLoading ? "Cargando..." : "Historial"}
            </button>
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
                {DAILY_COLLECTION_STATUS_OPTIONS.map((option) => (
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
            <span className="ar-results-count">Mostrando {rows.length} de {baseRows.length}</span>
            {viewMode === "historial" ? (
              <label className="ar-toolbar-filter">
                <span className="ar-toolbar-filter-label">Fecha</span>
                <select
                  className="ar-toolbar-filter-select"
                  value={selectedHistoryDate}
                  onChange={(event) => setSelectedHistoryDate(event.target.value)}
                >
                  {getCollectionClosureDateKeys(collectionClosuresByDate).map((dateKey) => (
                    <option key={dateKey} value={dateKey}>{formatDate(new Date(`${dateKey}T12:00:00`))}</option>
                  ))}
                </select>
              </label>
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
          todayCollectionCuts={todayCollectionCuts}
          visibleCollectionCut={visibleCollectionCut}
          buildWhatsAppReceivableMessage={buildWhatsAppReceivableMessage}
          onSelectDetail={setSelectedDetailRow}
          onCollectionCutStatusChange={handleCollectionCutStatusChange}
          onCollectionCutCommentChange={handleCollectionCutCommentChange}
          onRouteReleaseAmountChange={handleRouteReleaseAmountChange}
          onWhatsAppMessageCopied={handleWhatsAppMessageCopied}
          onWhatsAppMessageSent={handleWhatsAppMessageSent}
          onEditWhatsAppPhone={handleOpenWhatsAppPhoneModal}
          onSupportNoteChange={handleSupportNoteChange}
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
