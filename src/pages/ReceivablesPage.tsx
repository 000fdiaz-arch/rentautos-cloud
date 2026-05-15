import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { exportReceivablesToExcel, exportReceivablesToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import {
  buildReceivableRows,
  computeReceivableSummary,
  createMockReceivableRows,
  DEFAULT_RECEIVABLE_FILTERS,
  filterReceivableRows,
  getGroupFromUnit,
  PLAN_LABEL,
  sortReceivableRows,
  STATE_LABEL,
  type ReceivableFilters,
  type ReceivableRow,
  type ReceivableSortField,
  type ReceivableState,
  type SortDirection
} from "../receivables";
import type { Client, Payment } from "../types";

type Props = {
  clients: Client[];
  payments: Payment[];
  hideCollectedThisMonth?: boolean;
  streetManagementData?: Record<string, unknown>;
  onStreetManagementPersist?: (value: Record<string, unknown>) => Promise<boolean> | boolean;
};

type DashboardFilter =
  | "none"
  | "totalPorCobrar"
  | "totalVencido"
  | "proximoAVencer"
  | "clientesMorosos"
  | "cobradoEsteMes";

type ExportFieldKey = "unitId" | "name" | "rentAmount" | "pendingSummary" | "lastPaymentDate" | "state";
type ExportField = { key: ExportFieldKey; label: string; enabled: boolean };
type CollectionStatusFilter = "all" | CollectionStatus;
type GroupFilter = "all" | string;

type CollectionStatus = "no_answer" | "reminder" | "call_later" | "paid";

type CollectionStatusRecord = {
  status: CollectionStatus;
  comment: string;
  updatedAt: string;
  managementType?: FieldManagementType;
  managementAmount?: number;
  managementComment?: string;
  managementUpdatedAt?: string;
};
type FieldManagementType = "solo_cobrar" | "cobrar_o_quitar";
type RouteExportFormat = "jpg" | "pdf" | "excel";

type CollectionClosureItem = {
  clientId: string;
  unitId: string;
  clientName: string;
  lastPaymentDate: string | null;
  receivableState: string;
  totalPending: number;
  collectionStatus: CollectionStatus;
  comment: string;
  autoApplied: boolean;
};

type CollectionClosureSnapshot = {
  date: string;
  closedAt: string;
  actor: string;
  reason: string;
  totals: Record<CollectionStatus, number>;
  items: CollectionClosureItem[];
};

type CollectionClosuresByDate = Record<string, CollectionClosureSnapshot>;

type ReceivablesViewMode = "cartera" | "historial";

const STATE_FILTER_OPTIONS: Array<{ value: ReceivableState; label: string }> = [
  { value: "alDia", label: "Al dia" },
  { value: "proximo", label: "Proximo a vencer" },
  { value: "venceHoy", label: "Vence hoy" },
  { value: "vencido", label: "Vencido" },
  { value: "critico", label: "Moroso critico" }
];

const COLLECTION_STATUS_OPTIONS: Array<{ value: CollectionStatus; label: string }> = [
  { value: "no_answer", label: "Llamada no responde, se dejo mensaje." },
  { value: "reminder", label: "Mensaje recordatorio." },
  { value: "call_later", label: "Llamar mas tarde." },
  { value: "paid", label: "Pago confirmado." }
];

const INITIAL_EXPORT_FIELDS: ExportField[] = [
  { key: "unitId", label: "Unidad", enabled: true },
  { key: "name", label: "Nombre", enabled: true },
  { key: "rentAmount", label: "Letra", enabled: true },
  { key: "pendingSummary", label: "Cuentas pendiente", enabled: true },
  { key: "lastPaymentDate", label: "Ultima fecha de pago", enabled: true },
  { key: "state", label: "Estado", enabled: true }
];

const COLLECTION_CLOSURES_KEY = "cobrapp.module3.collection_closures.v1";

function renderSortIcon(active: boolean, direction: SortDirection): string {
  if (!active) return "<>";
  return direction === "asc" ? "^" : "v";
}

function stateToneClass(state: ReceivableRow["state"]): string {
  if (state === "alDia") return "ar-badge ar-badge--good";
  if (state === "proximo") return "ar-badge ar-badge--warn";
  if (state === "venceHoy") return "ar-badge ar-badge--today";
  if (state === "vencido") return "ar-badge ar-badge--debt";
  return "ar-badge ar-badge--critical";
}

function clientOperationalStatusLabel(status: Client["status"]): string {
  if (status === "activo") return "Activo";
  if (status === "cliente_enfermo") return "Enfermo";
  if (status === "taller") return "Taller";
  if (status === "chapisteria") return "Chapisteria";
  if (status === "custodia") return "Custodia";
  if (status === "en_busqueda") return "En busqueda";
  return "Archivado";
}

function clientOperationalStatusTone(status: Client["status"]): string {
  if (status === "activo") return "ar-badge ar-badge--good";
  if (status === "cliente_enfermo") return "ar-badge ar-badge--warn";
  if (status === "taller" || status === "chapisteria") return "ar-badge ar-badge--today";
  if (status === "custodia" || status === "en_busqueda") return "ar-badge ar-badge--debt";
  return "ar-badge ar-badge--critical";
}

function pendingSummaryText(totalPending: number, rentAmount: number): string {
  const pendingInstallments = rentAmount > 0 ? Math.ceil(totalPending / rentAmount) : 0;
  if (pendingInstallments <= 0) return formatCurrency(totalPending);
  const label = pendingInstallments === 1 ? "cuota atrasada" : "cuotas atrasadas";
  return `${formatCurrency(totalPending)} (${pendingInstallments} ${label})`;
}

function isToday(date: Date, now: Date): boolean {
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function normalizeComment(value: string): string {
  return value.slice(0, 5);
}

function normalizeFieldManagementComment(value: string): string {
  return value.slice(0, 25);
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateForTitle(value: Date): string {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = value.getFullYear();
  return `${day}/${month}/${year}`;
}

function planLabelForExport(plan: ReceivableRow["plan"]): string {
  return PLAN_LABEL[plan] ?? "Plan";
}

function lateInstallmentsLabel(totalPending: number, rentAmount: number): string {
  if (rentAmount <= 0) return "0";
  const installments = Math.ceil(totalPending / rentAmount);
  if (installments <= 0) return "0";
  return installments === 1 ? "1 cuota" : `${installments} cuotas`;
}

function parseStoredCollectionRecord(value: unknown): CollectionStatusRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = row.status;
  const comment = typeof row.comment === "string" ? normalizeComment(row.comment.trim()) : "";
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString();
  const managementType = row.managementType === "solo_cobrar" || row.managementType === "cobrar_o_quitar" ? row.managementType : undefined;
  const rawManagementAmount = typeof row.managementAmount === "number" ? row.managementAmount : Number(row.managementAmount);
  const managementAmount = Number.isFinite(rawManagementAmount) && rawManagementAmount > 0 ? rawManagementAmount : undefined;
  const managementComment = typeof row.managementComment === "string" ? normalizeFieldManagementComment(row.managementComment.trim()) : "";
  const managementUpdatedAt = typeof row.managementUpdatedAt === "string" ? row.managementUpdatedAt : undefined;

  if (status === "no_answer" || status === "reminder" || status === "call_later" || status === "paid") {
    return { status, comment, updatedAt, managementType, managementAmount, managementComment, managementUpdatedAt };
  }

  const legacyActionType = row.actionType;
  if (legacyActionType === "cobrar") {
    return { status: "reminder", comment, updatedAt, managementType: "solo_cobrar", managementAmount, managementComment, managementUpdatedAt };
  }
  if (legacyActionType === "quitarOCobrar") {
    return { status: "call_later", comment, updatedAt, managementType: "cobrar_o_quitar", managementAmount, managementComment, managementUpdatedAt };
  }

  return null;
}

function parseCollectionStatusMapFromStorage(raw: string | null): Record<string, CollectionStatusRecord> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, CollectionStatusRecord> = {};
    for (const [clientId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const row = parseStoredCollectionRecord(value);
      if (!row) continue;
      next[clientId] = row;
    }
    return next;
  } catch {
    return {};
  }
}

function parseCollectionClosuresFromStorage(raw: string | null): CollectionClosuresByDate {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CollectionClosuresByDate;
  } catch {
    return {};
  }
}

export default function ReceivablesPage({
  clients,
  payments,
  hideCollectedThisMonth = false,
  streetManagementData,
  onStreetManagementPersist
}: Props) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [filters, setFilters] = useState<ReceivableFilters>(DEFAULT_RECEIVABLE_FILTERS);
  const [sortField, setSortField] = useState<ReceivableSortField>("unitId");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>("none");
  const [selectedDetailRow, setSelectedDetailRow] = useState<ReceivableRow | null>(null);
  const [collectionStatusByClient, setCollectionStatusByClient] = useState<Record<string, CollectionStatusRecord>>({});
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<CollectionStatusFilter>("all");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [viewMode, setViewMode] = useState<ReceivablesViewMode>("cartera");
  const [collectionClosuresByDate, setCollectionClosuresByDate] = useState<CollectionClosuresByDate>({});
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportConfigOpen, setIsExportConfigOpen] = useState<boolean>(false);
  const [routeExportFormat, setRouteExportFormat] = useState<RouteExportFormat>("jpg");
  const [isRouteExportMenuOpen, setIsRouteExportMenuOpen] = useState<boolean>(false);
  const [exportFields, setExportFields] = useState<ExportField[]>(INITIAL_EXPORT_FIELDS);
  const [stickyToolbarTop, setStickyToolbarTop] = useState<number>(58);
  const [fieldManagementModalClientId, setFieldManagementModalClientId] = useState<string | null>(null);
  const [fieldManagementDraftByClient, setFieldManagementDraftByClient] = useState<
    Record<string, { type: FieldManagementType | ""; amount: string; comment: string }>
  >({});
  const [fieldManagementErrorByClient, setFieldManagementErrorByClient] = useState<Record<string, string>>({});
  const [statusSavingByClient, setStatusSavingByClient] = useState<Record<string, boolean>>({});

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const subActionsRowRef = useRef<HTMLDivElement>(null);
  const persistStreetTimerRef = useRef<number | null>(null);
  const lastStreetSnapshotRef = useRef<string>("");
  const streetPersistPendingRef = useRef<boolean>(false);
  const optimisticStatusByClientRef = useRef<Record<string, CollectionStatusRecord>>({});
  const saveTokenByClientRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    function recalculateStickyOffsets(): void {
      const nav = document.querySelector(".app-nav") as HTMLElement | null;
      const toolbarTop = nav?.offsetHeight ?? 58;
      setStickyToolbarTop(toolbarTop);
    }

    recalculateStickyOffsets();
    window.addEventListener("resize", recalculateStickyOffsets);

    const resizeObserver = new ResizeObserver(() => {
      recalculateStickyOffsets();
    });

    if (subActionsRowRef.current) resizeObserver.observe(subActionsRowRef.current);
    const nav = document.querySelector(".app-nav") as HTMLElement | null;
    if (nav) resizeObserver.observe(nav);

    return () => {
      window.removeEventListener("resize", recalculateStickyOffsets);
      resizeObserver.disconnect();
    };
  }, []);

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
    };
  }, []);

  useEffect(() => {
    setCollectionClosuresByDate(parseCollectionClosuresFromStorage(window.localStorage.getItem(COLLECTION_CLOSURES_KEY)));
  }, []);

  useEffect(() => {
    const syncFromStorage = () => {
      setCollectionClosuresByDate(parseCollectionClosuresFromStorage(window.localStorage.getItem(COLLECTION_CLOSURES_KEY)));
    };
    const onStorage = (event: StorageEvent): void => {
      if (event.key === COLLECTION_CLOSURES_KEY) syncFromStorage();
    };
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(syncFromStorage, 3000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const historyDates = Object.keys(collectionClosuresByDate).sort((a, b) => b.localeCompare(a));
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
    return buildReceivableRows(clients, payments, now);
  }, [clients, now, payments]);

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

  const filteredRows = useMemo(() => filterReceivableRows(baseRows, filters), [baseRows, filters]);
  const filteredByGroupRows = useMemo(() => {
    if (groupFilter === "all") return filteredRows;
    return filteredRows.filter((row) => getGroupFromUnit(row.unitId) === groupFilter);
  }, [filteredRows, groupFilter]);
  const filteredByCollectionStatusRows = useMemo(() => {
    if (collectionStatusFilter === "all") return filteredByGroupRows;
    return filteredByGroupRows.filter((row) => getEffectiveStatus(row) === collectionStatusFilter);
  }, [collectionStatusFilter, filteredByGroupRows, collectionStatusByClient, now]);

  const dashboardFilteredRows = useMemo(() => {
    if (dashboardFilter === "none") return filteredByCollectionStatusRows;
    if (dashboardFilter === "totalPorCobrar") return filteredByCollectionStatusRows.filter((row) => row.totalPending > 0);
    if (dashboardFilter === "totalVencido" || dashboardFilter === "clientesMorosos") {
      return filteredByCollectionStatusRows.filter((row) => row.state === "vencido" || row.state === "critico");
    }
    if (dashboardFilter === "proximoAVencer") {
      return filteredByCollectionStatusRows.filter((row) => row.state === "proximo" || row.state === "venceHoy");
    }
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    return filteredByCollectionStatusRows.filter((row) => {
      if (!row.lastPaymentDate) return false;
      const parsed = new Date(`${row.lastPaymentDate}T12:00:00`);
      return parsed.getFullYear() === currentYear && parsed.getMonth() === currentMonth;
    });
  }, [dashboardFilter, filteredByCollectionStatusRows, now]);

  const rows = useMemo(() => sortReceivableRows(dashboardFilteredRows, sortField, sortDirection), [dashboardFilteredRows, sortDirection, sortField]);
  const summary = useMemo(() => computeReceivableSummary(filteredRows, payments, now), [filteredRows, now, payments]);
  const routeCollectionRows = useMemo(
    () =>
      baseRows
        .filter((row) => {
          const management = collectionStatusByClient[row.id];
          return !!management?.managementType && !!management.managementAmount && management.managementAmount > 0;
        })
        .sort((a, b) => a.unitId.localeCompare(b.unitId)),
    [baseRows, collectionStatusByClient]
  );
  const routeCollectionTotal = useMemo(
    () => routeCollectionRows.reduce((acc, row) => acc + (collectionStatusByClient[row.id]?.managementAmount ?? 0), 0),
    [collectionStatusByClient, routeCollectionRows]
  );
  const todayDateKey = useMemo(() => {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [now]);
  const isTodayCollectionClosed = !!collectionClosuresByDate[todayDateKey];
  const selectedHistoryClosure = selectedHistoryDate ? collectionClosuresByDate[selectedHistoryDate] ?? null : null;

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
    setGroupFilter("all");
    setCollectionStatusFilter("all");
    setDashboardFilter("none");
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
    const hasType = management.managementType === "solo_cobrar" || management.managementType === "cobrar_o_quitar";
    return hasType && !!management.managementAmount && management.managementAmount > 0;
  }

  function getEffectiveStatus(row: ReceivableRow): CollectionStatus | "" {
    const stored = collectionStatusByClient[row.id]?.status;
    if (stored) return stored;
    if (hasAutoPaidStatus(row)) return "paid";
    return "";
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
      const updatedRecord: CollectionStatusRecord = {
        status: nextStatus,
        comment: nextStatus === "call_later" ? normalizeComment(currentComment) : "",
        updatedAt: new Date().toISOString()
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
      const updatedRecord: CollectionStatusRecord = {
        status: currentStatus,
        comment: normalizeComment(value),
        updatedAt: new Date().toISOString()
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
        managementType: draft.type,
        managementAmount: parsedAmount,
        managementComment: normalizeFieldManagementComment(draft.comment),
        managementUpdatedAt: new Date().toISOString()
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
    const headers = exportFields.filter((field) => field.enabled).map((field) => field.label);
    if (headers.length === 0) return setExportError("Selecciona al menos una columna para exportar.");
    setIsExporting(true);
    setExportError(null);
    try {
      await exportReceivablesToExcel(headers, rows.map((row) => headers.map((header) => {
        if (header === "Unidad") return row.unitId;
        if (header === "Nombre") return row.name;
        if (header === "Letra") return row.rentAmount;
        if (header === "Cuentas pendiente") return pendingSummaryText(row.totalPending, row.rentAmount);
        if (header === "Ultima fecha de pago") return row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "-";
        return STATE_LABEL[row.state];
      })), now);
    } catch {
      setExportError("No se pudo exportar el archivo Excel.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportPdf() {
    const headers = exportFields.filter((field) => field.enabled).map((field) => field.label);
    if (headers.length === 0) return setExportError("Selecciona al menos una columna para exportar.");
    setIsExporting(true);
    setExportError(null);
    try {
      await exportReceivablesToPdf(headers, rows.map((row) => headers.map((header) => {
        if (header === "Unidad") return row.unitId;
        if (header === "Nombre") return row.name;
        if (header === "Letra") return row.rentAmount;
        if (header === "Cuentas pendiente") return pendingSummaryText(row.totalPending, row.rentAmount);
        if (header === "Ultima fecha de pago") return row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "-";
        return STATE_LABEL[row.state];
      })), now);
    } catch {
      setExportError("No se pudo exportar el archivo PDF.");
    } finally {
      setIsExporting(false);
    }
  }

  function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): void {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = fileName;
    link.click();
  }

  function truncateTextToWidth(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): string {
    const value = text.replace(/\s+/g, " ").trim();
    if (!value) return "-";
    if (ctx.measureText(value).width <= maxWidth) return value;
    const ellipsis = "...";
    const words = value.split(" ");
    let byWord = "";
    for (const word of words) {
      const candidate = byWord ? `${byWord} ${word}` : word;
      if (ctx.measureText(`${candidate}${ellipsis}`).width <= maxWidth) {
        byWord = candidate;
      } else {
        break;
      }
    }
    if (byWord) return `${byWord}${ellipsis}`;

    let low = 0;
    let high = value.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = `${value.slice(0, mid)}${ellipsis}`;
      if (ctx.measureText(candidate).width <= maxWidth) low = mid;
      else high = mid - 1;
    }
    return `${value.slice(0, low)}${ellipsis}`;
  }

  function drawCellText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    align: CanvasTextAlign = "left"
  ): void {
    const safeMaxWidth = Math.max(12, maxWidth);
    const clipped = truncateTextToWidth(ctx, text, safeMaxWidth);
    ctx.textAlign = align;
    const drawX = align === "right" ? x + safeMaxWidth : x;
    ctx.fillText(clipped, drawX, y);
    ctx.textAlign = "left";
  }

  function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    const safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
  }

  async function handleExportCobroEnRuta(formatOverride?: RouteExportFormat): Promise<void> {
    setExportError(null);
    setIsExporting(true);
    try {
      const exportFormat = formatOverride ?? routeExportFormat;
      const candidates = baseRows
        .filter((row) => {
          const management = collectionStatusByClient[row.id];
          return !!management?.managementType && !!management.managementAmount && management.managementAmount > 0;
        })
        .sort((a, b) => a.unitId.localeCompare(b.unitId));

      if (candidates.length === 0) {
        setExportError("No hay registros con Cobro en Ruta para exportar.");
        return;
      }

      const totalToCollect = candidates.reduce((acc, row) => acc + (collectionStatusByClient[row.id]?.managementAmount ?? 0), 0);
      const rows = candidates;

      if (exportFormat === "pdf") {
        const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
          import("jspdf"),
          import("jspdf-autotable")
        ]);
        const doc = new JsPDF({ orientation: "landscape", format: "a4" });
        const headers = ["Unidad", "Cliente", "Cuotas", "Tipo", "Monto", "Coment."];
        const body = rows.map((row) => {
          const management = collectionStatusByClient[row.id];
          const cuotas = `${formatCurrency(row.totalPending)} (${lateInstallmentsLabel(row.totalPending, row.rentAmount)})`;
          const tipo = management?.managementType === "solo_cobrar" ? "Solo cobrar" : "Cobrar/quitar";
          const monto = formatCurrency(management?.managementAmount ?? 0);
          const comentario = (management?.managementComment ?? "").trim().slice(0, 25) || "-";
          return [row.unitId, row.name, cuotas, tipo, monto, comentario];
        });
        autoTable(doc, {
          head: [headers],
          body,
          startY: 14,
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [248, 250, 252] }
        });
        doc.save(`lista-cobro-en-ruta-${now.toISOString().slice(0, 10)}.pdf`);
        return;
      }

      if (exportFormat === "excel") {
        const xlsx = await import("xlsx");
        const headers = ["Unidad", "Cliente", "Cuotas", "Tipo", "Monto", "Coment."];
        const dataRows = rows.map((row) => {
          const management = collectionStatusByClient[row.id];
          const cuotas = `${formatCurrency(row.totalPending)} (${lateInstallmentsLabel(row.totalPending, row.rentAmount)})`;
          const tipo = management?.managementType === "solo_cobrar" ? "Solo cobrar" : "Cobrar/quitar";
          const monto = management?.managementAmount ?? 0;
          const comentario = (management?.managementComment ?? "").trim().slice(0, 25) || "-";
          return [row.unitId, row.name, cuotas, tipo, monto, comentario];
        });
        const worksheet = xlsx.utils.aoa_to_sheet([headers, ...dataRows]);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "Cobro en ruta");
        const bytes = xlsx.write(workbook, { type: "array", bookType: "xlsx" });
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `lista-cobro-en-ruta-${now.toISOString().slice(0, 10)}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      const canvas = document.createElement("canvas");
      const width = 1600;
      const outerLeft = 30;
      const outerRight = width - 30;
      const tableTop = 34;
      const headerHeight = 64;
      const minRowHeight = 54;
      const maxRowHeight = 68;
      const baseBodyHeight = 1100;
      const densityRowHeight = Math.floor(baseBodyHeight / Math.max(1, rows.length));
      const rowHeight = Math.max(minRowHeight, Math.min(maxRowHeight, densityRowHeight));
      const rowFont = Math.max(17, Math.min(24, Math.floor(rowHeight * 0.42)));
      const bottomMargin = 96;
      const minHeight = 700;
      const contentHeight = tableTop + headerHeight + rows.length * rowHeight + bottomMargin + 64;
      const height = Math.max(minHeight, contentHeight);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const tableWidth = outerRight - outerLeft;
      const tableBottom = tableTop + headerHeight + rows.length * rowHeight;

      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, width, height);
      const colX = {
        unidad: outerLeft + 28,
        cliente: outerLeft + 155,
        cuotas: outerLeft + 700,
        tipo: outerLeft + 995,
        monto: outerLeft + 1170,
        comentario: outerLeft + 1320
      };

      drawRoundedRect(ctx, outerLeft, tableTop, tableWidth, headerHeight + rows.length * rowHeight, 8);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#dbe1ea";
      ctx.lineWidth = 1;
      ctx.stroke();

      const headerGradient = ctx.createLinearGradient(outerLeft, tableTop, outerRight, tableTop + headerHeight);
      headerGradient.addColorStop(0, "#0f766e");
      headerGradient.addColorStop(1, "#0b5e58");
      drawRoundedRect(ctx, outerLeft, tableTop, tableWidth, headerHeight, 8);
      ctx.fillStyle = headerGradient;
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 24px Segoe UI, Arial, sans-serif";
      const headerY = tableTop + 41;
      ctx.fillText("Unidad", colX.unidad, headerY);
      ctx.fillText("Cliente", colX.cliente, headerY);
      ctx.fillText("Cuotas", colX.cuotas, headerY);
      ctx.fillText("Tipo", colX.tipo, headerY);
      ctx.fillText("Monto", colX.monto, headerY);
      ctx.fillText("Coment.", colX.comentario, headerY);

      rows.forEach((row, index) => {
        const y = tableTop + headerHeight + index * rowHeight;
        const management = collectionStatusByClient[row.id];
        ctx.fillStyle = index % 2 === 0 ? "#fcfdff" : "#f7f9fc";
        ctx.fillRect(outerLeft, y, tableWidth, rowHeight);
        ctx.strokeStyle = "#e7edf5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(outerLeft, y + rowHeight);
        ctx.lineTo(outerRight, y + rowHeight);
        ctx.stroke();

        const clientName = row.name;
        const cuotas = `${formatCurrency(row.totalPending)} (${lateInstallmentsLabel(row.totalPending, row.rentAmount)})`;
        const tipo = management?.managementType === "solo_cobrar" ? "Solo cobrar" : "Cobrar/quitar";
        const monto = formatCurrency(management?.managementAmount ?? 0);
        const comentarioRaw = (management?.managementComment ?? "").trim();
        const comentarioMax25 = comentarioRaw.slice(0, 25);
        const colPadding = 18;
        const clienteWidth = colX.cuotas - colX.cliente - colPadding;
        const cuotasWidth = colX.tipo - colX.cuotas - colPadding;
        const tipoWidth = colX.monto - colX.tipo - colPadding;
        const montoWidth = colX.comentario - colX.monto - colPadding;
        const commentMaxWidth = outerRight - colX.comentario - colPadding;
        const rowBaseline = y + Math.floor(rowHeight * 0.66);

        ctx.font = `bold ${rowFont}px Segoe UI, Arial, sans-serif`;
        ctx.fillStyle = "#0b5e58";
        ctx.fillText(row.unitId, colX.unidad, rowBaseline);
        ctx.font = `${rowFont}px Segoe UI, Arial, sans-serif`;
        ctx.fillStyle = "#1e293b";
        drawCellText(ctx, clientName, colX.cliente, rowBaseline, clienteWidth);
        drawCellText(ctx, cuotas, colX.cuotas, rowBaseline, cuotasWidth);

        const badgeX = colX.tipo;
        const badgeY = y + Math.floor((rowHeight - 32) / 2);
        const badgeHeight = 32;
        const badgeText = tipo;
        ctx.font = `600 ${Math.max(14, rowFont - 5)}px Segoe UI, Arial, sans-serif`;
        const badgeTextWidth = ctx.measureText(badgeText).width;
        const badgeWidth = Math.min(tipoWidth, Math.max(122, badgeTextWidth + 42));
        drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 8);
        const isSoloCobrar = management?.managementType === "solo_cobrar";
        const badgeBg = isSoloCobrar ? "#e8f7ee" : "#eff6ff";
        const badgeDot = isSoloCobrar ? "#1dbf73" : "#3b82f6";
        const badgeTextColor = isSoloCobrar ? "#0b6b47" : "#1e40af";
        ctx.fillStyle = badgeBg;
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = badgeDot;
        ctx.arc(badgeX + 16, badgeY + badgeHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = badgeTextColor;
        ctx.fillText(badgeText, badgeX + 28, badgeY + 22);

        ctx.font = `bold ${rowFont}px Segoe UI, Arial, sans-serif`;
        ctx.fillStyle = "#0b5e58";
        drawCellText(ctx, monto, colX.monto, rowBaseline, montoWidth, "right");
        ctx.font = `${Math.max(15, rowFont - 1)}px Segoe UI, Arial, sans-serif`;
        ctx.fillStyle = "#334155";
        drawCellText(ctx, comentarioMax25, colX.comentario, rowBaseline, commentMaxWidth);
      });

      ctx.fillStyle = "#7c8ea6";
      ctx.font = "22px Segoe UI, Arial, sans-serif";
      const generatedAt = now.toLocaleString("es-PA", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      const soloCobrarCount = rows.filter((row) => collectionStatusByClient[row.id]?.managementType === "solo_cobrar").length;
      const cobrarQuitarCount = rows.filter((row) => collectionStatusByClient[row.id]?.managementType === "cobrar_o_quitar").length;
      const leftFooterText = `Unidades enviadas: ${rows.length} | Solo cobrar: ${soloCobrarCount} | Cobrar/quitar: ${cobrarQuitarCount} | Esperado recolectar: ${formatCurrency(totalToCollect)}`;
      const footerLineOneY = tableBottom + 46;
      const footerLineTwoY = tableBottom + 74;
      ctx.fillText(leftFooterText, outerLeft, footerLineOneY);
      const footerText = `(Reporte generado el ${generatedAt})`;
      ctx.fillText(footerText, outerLeft, footerLineTwoY);

      const fileName = `lista-cobro-en-ruta-${now.toISOString().slice(0, 10)}.png`;
      downloadCanvas(canvas, fileName);
    } catch {
      setExportError("No se pudo exportar Cobro en Ruta.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      <section className="hero ar-hero"><div><h1>Cuentas por Cobrar</h1><p>Control de saldos vencidos y proximos a vencer.</p></div></section>
      <section className="summary-grid ar-summary-grid">
        <button type="button" className={`summary-card summary-card--interactive ${dashboardFilter === "totalPorCobrar" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "totalPorCobrar" ? "none" : "totalPorCobrar")}><span>Total por cobrar</span><strong>{formatCurrency(summary.totalPorCobrar)}</strong></button>
        <button type="button" className={`summary-card summary-card--interactive ar-summary-card--debt ${dashboardFilter === "totalVencido" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "totalVencido" ? "none" : "totalVencido")}><span>Vencido + critico</span><strong>{formatCurrency(summary.totalVencido)}</strong></button>
        <button type="button" className={`summary-card summary-card--interactive ${dashboardFilter === "proximoAVencer" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "proximoAVencer" ? "none" : "proximoAVencer")}><span>Proximos a vencer</span><strong>{formatCurrency(summary.proximoAVencer)}</strong></button>
        <button type="button" className={`summary-card summary-card--interactive ar-summary-card--debt ${dashboardFilter === "clientesMorosos" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "clientesMorosos" ? "none" : "clientesMorosos")}><span>Clientes morosos</span><strong>{summary.clientesMorosos}</strong></button>
        <div className="summary-card ar-summary-card--route">
          <span>Cobro en ruta</span>
          <strong>{routeCollectionRows.length} | {formatCurrency(routeCollectionTotal)}</strong>
        </div>
      </section>
      {!hideCollectedThisMonth && <section className="ar-secondary-metric-row"><button type="button" className={`ar-secondary-metric ${dashboardFilter === "cobradoEsteMes" ? "ar-secondary-metric--active" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "cobradoEsteMes" ? "none" : "cobradoEsteMes")}><span>Cobrado este mes</span><strong>{formatCurrency(summary.cobradoEsteMes)}</strong></button></section>}

      <section className="panel">
        <div className="panel-head"><h2>Filtros</h2><div className="ar-filter-actions"><button type="button" className="button ghost small" onClick={clearFilters}>Limpiar filtros</button></div></div>
        <div className="ar-filters-grid">
          <div className="ar-filter-field"><span className="ar-filter-label">Buscar unidad</span><input type="text" value={filters.unitSearch} onChange={(event) => updateFilter("unitSearch", event.target.value)} /></div>
          <div className="ar-filter-field ar-filter-field--states">
            <span className="ar-filter-label">Estado</span>
            <div className="ar-state-chips" role="group" aria-label="Filtro de estado">
              <button
                type="button"
                className={`ar-state-chip ${filters.state.length === 0 ? "ar-state-chip--active" : ""}`}
                onClick={() => handleStateFilterToggle("all")}
              >
                Todos
              </button>
              {STATE_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`ar-state-chip ${filters.state.includes(option.value) ? "ar-state-chip--active" : ""}`}
                  onClick={() => handleStateFilterToggle(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        className="panel"
        style={
          {
            "--ar-sticky-toolbar-top": `${stickyToolbarTop}px`
          } as CSSProperties
        }
      >
        <div className="panel-head"><h2>Cartera de clientes</h2></div>
        <div className="ar-view-tabs" role="tablist" aria-label="Vistas de cuentas por cobrar">
          <button type="button" className={`button small ${viewMode === "cartera" ? "primary" : "ghost"}`} onClick={() => setViewMode("cartera")}>
            Cartera
          </button>
          <button type="button" className={`button small ${viewMode === "historial" ? "primary" : "ghost"}`} onClick={() => setViewMode("historial")}>
            Historial
          </button>
          {viewMode === "cartera" && isTodayCollectionClosed && (
            <span className="hint" style={{ marginLeft: 10 }}>Gestion de cobranza cerrada hoy. Solo lectura.</span>
          )}
        </div>
        <div className="ar-sticky-stack" ref={subActionsRowRef}>
          <div className="ar-sub-actions-row">
            <div className="ar-filter-actions">
              <button type="button" className="button ghost small" onClick={() => setIsExportConfigOpen((open) => !open)}>{isExportConfigOpen ? "Cerrar campos" : "Campos exportables"}</button>
              <button type="button" className="button primary small" onClick={handleExportExcel} disabled={isExporting}>{isExporting ? "Exportando..." : "Exportar Excel"}</button>
              <button type="button" className="button ghost small" onClick={handleExportPdf} disabled={isExporting}>Exportar PDF</button>
              <span className="hint">Mostrando {rows.length} registro(s)</span>
              <label className="ar-toolbar-filter">
                <span className="ar-toolbar-filter-label">Cobranza</span>
                <select
                  className="ar-toolbar-filter-select"
                  value={collectionStatusFilter}
                  onChange={(event) => setCollectionStatusFilter(event.target.value as CollectionStatusFilter)}
                  disabled={viewMode === "historial"}
                >
                  <option value="all">Todos</option>
                  {COLLECTION_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="ar-toolbar-filter">
                <span className="ar-toolbar-filter-label">Grupo</span>
                <select
                  className="ar-toolbar-filter-select"
                  value={groupFilter}
                  onChange={(event) => setGroupFilter(event.target.value)}
                  disabled={viewMode === "historial"}
                >
                  <option value="all">Todos</option>
                  {availableGroups.map((group) => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ar-export-route-menu-wrap">
              <button
                type="button"
                className="button small ar-export-route-btn"
                onClick={() => setIsRouteExportMenuOpen((open) => !open)}
                disabled={isExporting}
                aria-haspopup="menu"
                aria-expanded={isRouteExportMenuOpen}
              >
                Export Cobro en Ruta ({routeExportFormat.toUpperCase()})
              </button>
              {isRouteExportMenuOpen && (
                <div className="ar-export-route-menu" role="menu" aria-label="Formatos de exportacion">
                  <button
                    type="button"
                    className="ar-export-route-menu-item"
                    onClick={() => {
                      setRouteExportFormat("pdf");
                      setIsRouteExportMenuOpen(false);
                      void handleExportCobroEnRuta("pdf");
                    }}
                    disabled={isExporting}
                  >
                    PDF
                  </button>
                  <button
                    type="button"
                    className="ar-export-route-menu-item"
                    onClick={() => {
                      setRouteExportFormat("jpg");
                      setIsRouteExportMenuOpen(false);
                      void handleExportCobroEnRuta("jpg");
                    }}
                    disabled={isExporting}
                  >
                    JPG
                  </button>
                  <button
                    type="button"
                    className="ar-export-route-menu-item"
                    onClick={() => {
                      setRouteExportFormat("excel");
                      setIsRouteExportMenuOpen(false);
                      void handleExportCobroEnRuta("excel");
                    }}
                    disabled={isExporting}
                  >
                    EXCEL
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="ar-columns-head">
            <button type="button" className="sort-button ar-columns-head-btn" onClick={() => handleSort("unitId")}>Unidad <span className={`sort-icon ${sortField === "unitId" ? "active" : ""}`}>{renderSortIcon(sortField === "unitId", sortDirection)}</span></button>
            <button type="button" className="sort-button ar-columns-head-btn" onClick={() => handleSort("totalPending")}>Pendiente <span className={`sort-icon ${sortField === "totalPending" ? "active" : ""}`}>{renderSortIcon(sortField === "totalPending", sortDirection)}</span></button>
            <button type="button" className="sort-button ar-columns-head-btn" onClick={() => handleSort("lastPaymentDate")}>Ult. pago / Estado <span className={`sort-icon ${sortField === "lastPaymentDate" ? "active" : ""}`}>{renderSortIcon(sortField === "lastPaymentDate", sortDirection)}</span></button>
            <span className="ar-columns-head-label">Estado cobranza</span>
            <span className="ar-columns-head-label">Acciones</span>
          </div>
        </div>
        {viewMode === "historial" && (
          <div className="ar-history-panel">
            <div className="ar-history-controls">
              <label className="ar-toolbar-filter">
                <span className="ar-toolbar-filter-label">Fecha de cierre</span>
                <select
                  className="ar-toolbar-filter-select"
                  value={selectedHistoryDate}
                  onChange={(event) => setSelectedHistoryDate(event.target.value)}
                >
                  {Object.keys(collectionClosuresByDate).sort((a, b) => b.localeCompare(a)).map((dateKey) => (
                    <option key={dateKey} value={dateKey}>
                      {formatDate(new Date(`${dateKey}T12:00:00`))}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!selectedHistoryClosure ? (
              <p className="hint">No hay cierres de cobranza guardados.</p>
            ) : (
              <>
                <div className="summary-grid ar-summary-grid" style={{ marginTop: 10 }}>
                  <div className="summary-card"><span>No responde</span><strong>{selectedHistoryClosure.totals.no_answer ?? 0}</strong></div>
                  <div className="summary-card"><span>Recordatorio</span><strong>{selectedHistoryClosure.totals.reminder ?? 0}</strong></div>
                  <div className="summary-card"><span>Llamar mas tarde</span><strong>{selectedHistoryClosure.totals.call_later ?? 0}</strong></div>
                  <div className="summary-card"><span>Pago confirmado</span><strong>{selectedHistoryClosure.totals.paid ?? 0}</strong></div>
                </div>
                <p className="hint" style={{ marginTop: 8 }}>
                  Cierre: {formatDate(new Date(`${selectedHistoryClosure.date}T12:00:00`))} | Operador: {selectedHistoryClosure.actor} | Motivo: {selectedHistoryClosure.reason}
                </p>
              </>
            )}
          </div>
        )}
        {isExportConfigOpen && <div className="export-panel"><p className="export-title">Selecciona las columnas a exportar</p><div className="export-fields">{exportFields.map((field) => <label key={field.key} className="export-field-label"><input type="checkbox" checked={field.enabled} onChange={() => setExportFields((current) => current.map((item) => (item.key === field.key ? { ...item, enabled: !item.enabled } : item)))} />{field.label}</label>)}</div></div>}
        {exportError && <p className="hint error-text">{exportError}</p>}
        <div className="table-scroll" ref={tableScrollRef}>
          <table className="ar-table ar-table--compact">
            <tbody>
              {viewMode === "historial" ? (
                !selectedHistoryClosure || selectedHistoryClosure.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty" style={{ textAlign: "center" }}>
                      No hay datos en este cierre.
                    </td>
                  </tr>
                ) : selectedHistoryClosure.items.map((item) => (
                  <tr key={`${selectedHistoryClosure.date}-${item.clientId}`}>
                    <td><strong className="ar-unit-id">{item.unitId}</strong></td>
                    <td className="ar-pending-cell">
                      <span className="client-name">{formatCurrency(item.totalPending)}</span>
                      <span className="debt-meta ar-truncate-line" title={item.clientName}>{item.clientName}</span>
                    </td>
                    <td>
                      <div>{item.lastPaymentDate ? formatDate(new Date(`${item.lastPaymentDate}T12:00:00`)) : <span className="amount-muted">Sin pagos</span>}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                        <span className={stateToneClass(item.receivableState as ReceivableState)}>{STATE_LABEL[item.receivableState as ReceivableState] ?? item.receivableState}</span>
                      </div>
                    </td>
                    <td className="ar-collection-cell">
                      <div className="ar-collection-wrap">
                        <span>{COLLECTION_STATUS_OPTIONS.find((option) => option.value === item.collectionStatus)?.label ?? "Sin estado"}</span>
                        {item.comment ? <span className="hint ar-collection-note">Comentario: {item.comment}</span> : null}
                      </div>
                    </td>
                    <td className="ar-actions-cell ar-actions-cell--compact">
                      <span className="hint">Cerrado</span>
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty" style={{ textAlign: "center" }}>
                    No hay resultados para los filtros seleccionados.
                  </td>
                </tr>
              ) : rows.map((row) => {
                const paidToday = hasPaymentToday(row);
                const autoPaid = hasAutoPaidStatus(row);
                const routeCollection = hasRouteCollection(row);
                const hasManualStatus = !!collectionStatusByClient[row.id]?.status;
                const effectiveStatus = getEffectiveStatus(row);
                const storedComment = collectionStatusByClient[row.id]?.comment ?? "";
                const sourceClient = clients.find((client) => client.id === row.id);
                const operationalStatus = sourceClient?.status ?? "activo";
                const isSavingStatus = !!statusSavingByClient[row.id];
                return (
                  <tr key={row.id} className={collectionStatusByClient[row.id]?.managementType ? "ar-row--route" : ""}>
                    <td><strong className="ar-unit-id">{row.unitId}</strong></td>
                    <td className="ar-pending-cell">
                      <span className="client-name">{pendingSummaryText(row.totalPending, row.rentAmount)}</span>
                      <span className={`debt-meta ${row.rentAmount > 0 ? "amount-debt" : "amount-good"}`}>Letra: {formatCurrency(row.rentAmount)}</span>
                      <span className="debt-meta ar-truncate-line" title={row.name}>{row.name}</span>
                    </td>
                    <td>
                      <div>{row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : <span className="amount-muted">Sin pagos</span>}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                        <span className={stateToneClass(row.state)}>{STATE_LABEL[row.state]}</span>
                        <span className={clientOperationalStatusTone(operationalStatus)}>
                          {clientOperationalStatusLabel(operationalStatus)}
                        </span>
                      </div>
                    </td>
                    <td className="ar-collection-cell">
                      <div className="ar-collection-wrap">
                        {routeCollection && (
                          <span className="ar-route-collection-tag">
                            COBRO EN RUTA
                            <button
                              type="button"
                              className="ar-route-collection-remove"
                              onClick={() => handleRemoveFieldManagement(row.id)}
                              aria-label={`Quitar cobro en ruta de ${row.unitId}`}
                              title="Quitar de cobro en ruta"
                              disabled={isTodayCollectionClosed || isSavingStatus}
                            >
                              x
                            </button>
                          </span>
                        )}
                        <select
                          className="ar-collection-select"
                          value={effectiveStatus}
                          onChange={(event) => handleCollectionStatusChange(row.id, event.target.value)}
                          disabled={isTodayCollectionClosed || isSavingStatus}
                        >
                          <option value="">Seleccionar</option>
                          {COLLECTION_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        {effectiveStatus === "call_later" && (
                          <input
                            type="text"
                            className="ar-collection-comment"
                            maxLength={5}
                            placeholder="Comentario (max 5)"
                            value={storedComment}
                            onChange={(event) => handleCallLaterCommentChange(row.id, event.target.value)}
                            disabled={isTodayCollectionClosed || isSavingStatus}
                          />
                        )}
                        {autoPaid && !hasManualStatus && (
                          <span className="hint ar-collection-note">
                            {paidToday ? "Sugerido automatico por pago de hoy." : "Sugerido automatico por cliente al dia."}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="ar-actions-cell ar-actions-cell--compact">
                      <div className="ar-actions-stack">
                        <button type="button" className="button ghost small" onClick={() => setSelectedDetailRow(row)}>Ver detalle</button>
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => handleOpenFieldManagementModal(row.id)}
                          disabled={isTodayCollectionClosed || isSavingStatus}
                        >
                          Cobro en Ruta
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {fieldManagementModalClientId && (() => {
        const row = rows.find((item) => item.id === fieldManagementModalClientId) ?? baseRows.find((item) => item.id === fieldManagementModalClientId) ?? null;
        if (!row) return null;
        const draft = fieldManagementDraftByClient[row.id] ?? {
          type: collectionStatusByClient[row.id]?.managementType ?? "",
          amount: collectionStatusByClient[row.id]?.managementAmount ? String(collectionStatusByClient[row.id]?.managementAmount) : "",
          comment: collectionStatusByClient[row.id]?.managementComment ?? ""
        };
        const error = fieldManagementErrorByClient[row.id] ?? "";
        return (
          <div className="modal-overlay">
            <div className="modal ar-detail-modal ar-field-management-modal">
              <div className="modal-header">
                <h2>Cobro en Ruta - {row.unitId}</h2>
                <button type="button" className="modal-close" onClick={() => setFieldManagementModalClientId(null)}>X</button>
              </div>
              <div className="modal-body">
                <div className="ar-detail-grid">
                  <div><span className="hint">Unidad</span><p><strong>{row.unitId}</strong></p></div>
                  <div><span className="hint">Cliente</span><p><strong>{row.name}</strong></p></div>
                  <div><span className="hint">Pendiente</span><p className="amount-debt">{pendingSummaryText(row.totalPending, row.rentAmount)}</p></div>
                  <div><span className="hint">Ult. pago</span><p>{row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "Sin pagos"}</p></div>
                </div>
                <div className="ar-field-management-box ar-field-management-box--modal">
                  <label className="ar-field-management-label">
                    Tipo de gestion
                    <select
                      value={draft.type}
                      onChange={(event) => handleFieldManagementDraftChange(row.id, { type: event.target.value as FieldManagementType | "" })}
                    >
                      <option value="">Seleccionar</option>
                      <option value="solo_cobrar">Solo cobrar</option>
                      <option value="cobrar_o_quitar">Cobrar o quitar</option>
                    </select>
                  </label>
                  <label className="ar-field-management-label">
                    Monto a pagar
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={draft.amount}
                      onChange={(event) => handleFieldManagementDraftChange(row.id, { amount: event.target.value })}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="ar-field-management-label">
                    Comentario (max 25)
                    <input
                      type="text"
                      maxLength={25}
                      value={draft.comment}
                      onChange={(event) => handleFieldManagementDraftChange(row.id, { comment: event.target.value })}
                    />
                  </label>
                  {error ? <span className="hint error-text">{error}</span> : null}
                </div>
              </div>
              <div className="modal-actions ar-detail-actions">
                <button type="button" className="button ghost" onClick={() => setFieldManagementModalClientId(null)}>Cancelar</button>
                <button type="button" className="button primary" onClick={() => handleSaveFieldManagement(row.id)}>Guardar cobro en ruta</button>
              </div>
            </div>
          </div>
        );
      })()}

      {selectedDetailRow && <div className="modal-overlay"><div className="modal ar-detail-modal"><div className="modal-header"><h2>Detalle de cuenta - {selectedDetailRow.unitId}</h2><button type="button" className="modal-close" onClick={() => setSelectedDetailRow(null)}>X</button></div><div className="modal-body"><div className="ar-detail-grid"><div><span className="hint">Cliente</span><p><strong>{selectedDetailRow.name}</strong></p></div><div><span className="hint">Cedula</span><p>{selectedDetailRow.cedula}</p></div><div><span className="hint">Unidad</span><p>{selectedDetailRow.unitId}</p></div><div><span className="hint">Grupo</span><p>{selectedDetailRow.group || "-"}</p></div><div><span className="hint">Datos contrato</span><p>{PLAN_LABEL[selectedDetailRow.plan]} | Total contrato: {formatCurrency(selectedDetailRow.contractTotal)}</p></div><div><span className="hint">Proxima fecha pago</span><p>{selectedDetailRow.nextDueDate ? formatDate(new Date(`${selectedDetailRow.nextDueDate}T12:00:00`)) : "-"}</p></div><div><span className="hint">Saldo vencido</span><p className="amount-debt">{formatCurrency(selectedDetailRow.overdueBalance)}</p></div><div><span className="hint">Total pendiente</span><p className="amount-debt">{formatCurrency(selectedDetailRow.totalPending)}</p></div></div></div><div className="modal-actions ar-detail-actions"><button type="button" className="button ghost" onClick={() => setSelectedDetailRow(null)}>Cerrar</button></div></div></div>}
    </>
  );
}
