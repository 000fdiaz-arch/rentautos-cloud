import { useEffect, useMemo, useRef, useState } from "react";
import { exportReceivablesToExcel, exportReceivablesToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import { loadCloudCollectionClosures, saveCloudCollectionClosures } from "../cloudData";
import { supabase } from "../lib/supabase";
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
import type {
  CollectionStatus,
  CollectionStatusRecord,
  FieldManagementType,
  RouteExportFormat
} from "./receivables/receivablesTypes";
import { ReceivableTableRow } from "./receivables/ReceivableTableRow";
import { ReceivablesFiltersPanel } from "./receivables/ReceivablesFiltersPanel";
import { exportRouteCollection } from "./receivables/routeCollectionExport";
import {
  COLLECTION_STATUS_OPTIONS,
  COLLECTION_CUT_OPTIONS,
  INITIAL_EXPORT_FIELDS,
  clientOperationalStatusLabel,
  getCollectionClosureCuts,
  getCollectionClosureDateKeys,
  hasCollectionClosureCut,
  formatDateForTitle,
  isToday,
  normalizeComment,
  normalizeFieldManagementComment,
  normalizeSupportNote,
  parseCollectionStatusMapFromStorage,
  pendingSummaryText,
  planLabelForExport,
  renderSortIcon,
  stateToneClass,
  toTimestamp,
  type CollectionClosureItem,
  type CollectionClosureSnapshot,
  type CollectionClosuresByDate,
  type CollectionCutKey,
  type CollectionStatusFilter,
  type DashboardFilter,
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
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>("none");
  const [viewMode, setViewMode] = useState<ReceivablesViewMode>("cartera");
  const [collectionClosuresByDate, setCollectionClosuresByDate] = useState<CollectionClosuresByDate>({});
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

  const tableScrollRef = useRef<HTMLDivElement>(null);
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
    if (!dataOwnerUserId) {
      setCollectionClosuresByDate({});
      return;
    }
    let cancelled = false;
    const syncFromCloud = () => {
      void loadCloudCollectionClosures(dataOwnerUserId)
        .then((rows) => {
          if (!cancelled) setCollectionClosuresByDate(rows as CollectionClosuresByDate);
        })
        .catch((error) => {
          console.error("No se pudo cargar historial de cierres de cobranza.", error);
        });
    };
    syncFromCloud();
    const client = supabase;
    if (!client) {
      return () => {
        cancelled = true;
      };
    }
    const channel = client
      .channel(`collection-closures-live-${dataOwnerUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "collection_closures_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, syncFromCloud)
      .subscribe();
    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId]);

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
    return buildReceivableRows(clients, payments, now);
  }, [clients, now, payments]);

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

  const summary = useMemo(() => computeReceivableSummary(baseRows, payments, now), [baseRows, now, payments]);
  const filteredRows = useMemo(() => filterReceivableRows(baseRows, filters), [baseRows, filters]);
  const filteredByDashboardRows = useMemo(() => {
    if (dashboardFilter === "none") return filteredRows;
    if (dashboardFilter === "totalPorCobrar") return filteredRows.filter((row) => row.totalPending > 0);
    if (dashboardFilter === "totalVencido") return filteredRows.filter((row) => row.state === "vencido" || row.state === "critico");
    if (dashboardFilter === "proximoAVencer") return filteredRows.filter((row) => row.state === "proximo" || row.state === "venceHoy");
    if (dashboardFilter === "clientesMorosos") return filteredRows.filter((row) => row.state === "critico");
    if (dashboardFilter === "cobradoEsteMes") {
      return filteredRows.filter((row) => {
        if (!row.lastPaymentDate) return false;
        const parsed = new Date(`${row.lastPaymentDate}T12:00:00`);
        return parsed.getFullYear() === now.getFullYear() && parsed.getMonth() === now.getMonth();
      });
    }
    return filteredRows;
  }, [dashboardFilter, filteredRows, now]);
  const filteredByCollectionStatusRows = useMemo(() => {
    if (collectionStatusFilter === "all") return filteredByDashboardRows;
    return filteredByDashboardRows.filter((row) => getEffectiveStatus(row) === collectionStatusFilter);
  }, [collectionStatusFilter, filteredByDashboardRows, collectionStatusByClient, now]);

  const rows = useMemo(
    () => sortReceivableRows(filteredByCollectionStatusRows, sortField, sortDirection),
    [filteredByCollectionStatusRows, sortDirection, sortField]
  );
  const todayDateKey = useMemo(() => {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [now]);
  const isTodayCollectionClosed = hasCollectionClosureCut(collectionClosuresByDate, todayDateKey, "night");
  const todayCollectionCuts = useMemo(
    () => getCollectionClosureCuts(collectionClosuresByDate[todayDateKey]),
    [collectionClosuresByDate, todayDateKey]
  );
  const selectedHistoryCuts = useMemo(
    () => selectedHistoryDate ? getCollectionClosureCuts(collectionClosuresByDate[selectedHistoryDate]) : {},
    [collectionClosuresByDate, selectedHistoryDate]
  );
  const selectedHistoryRows = useMemo(() => {
    const rowsByClient = new Map<string, {
      clientId: string;
      unitId: string;
      clientName: string;
      lastPaymentDate: string | null;
      receivableState: string;
      totalPending: number;
      cuts: Partial<Record<CollectionCutKey, CollectionClosureItem>>;
    }>();
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
    () => baseRows.filter((row) => hasRouteCollection(row)).length,
    [baseRows, collectionStatusByClient]
  );
  const pendingCollectionRowsCount = useMemo(
    () => baseRows.filter((row) => row.totalPending > 0 && !getEffectiveStatus(row)).length,
    [baseRows, collectionStatusByClient, now]
  );
  const dashboardFilterLabel = {
    none: "",
    totalPorCobrar: "Total por cobrar",
    totalVencido: "Saldo vencido",
    proximoAVencer: "Proximo a vencer",
    clientesMorosos: "Morosos criticos",
    cobradoEsteMes: "Cobrados este mes"
  } satisfies Record<DashboardFilter, string>;

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
    setDashboardFilter("none");
  }

  function toggleDashboardFilter(value: DashboardFilter): void {
    setDashboardFilter((current) => (current === value ? "none" : value));
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

  function buildWhatsAppReceivableMessage(row: ReceivableRow): string {
    const today = formatDateForTitle(now);
    const firstName = row.name.trim().split(/\s+/)[0] || row.name;
    const lastPayment = row.lastPaymentDate
      ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`))
      : "Sin pagos registrados";
    const pending = formatCurrency(row.totalPending);
    const installmentsText = row.overdueInstallments > 0
      ? `${row.overdueInstallments} cuota${row.overdueInstallments === 1 ? "" : "s"} atrasada${row.overdueInstallments === 1 ? "" : "s"}`
      : "Sin cuotas atrasadas";
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
      `${emoji.warning} Tiene un saldo pendiente al ${today}.`,
      "",
      `${emoji.money} Monto a pagar: ${pending}`,
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
    const stored = collectionStatusByClient[row.id]?.status;
    if (stored) return stored;
    if (hasAutoPaidStatus(row)) return "paid";
    return "";
  }

  function getCutItemsForClient(
    cuts: Partial<Record<CollectionCutKey, { items: CollectionClosureItem[] }>>,
    clientId: string
  ): Partial<Record<CollectionCutKey, CollectionClosureItem>> {
    const cutItems: Partial<Record<CollectionCutKey, CollectionClosureItem>> = {};
    for (const option of COLLECTION_CUT_OPTIONS) {
      const item = cuts[option.key]?.items.find((cutItem) => cutItem.clientId === clientId);
      if (item) cutItems[option.key] = item;
    }
    return cutItems;
  }

  function renderCutStatusCell(item: CollectionClosureItem | undefined) {
    if (!item) return <span className="ar-cut-empty">Sin corte</span>;
    const label = COLLECTION_STATUS_OPTIONS.find((option) => option.value === item.collectionStatus)?.label ?? "Sin estado";
    return (
      <div className="ar-cut-cell-content">
        <span className={`ar-cut-status ar-cut-status--${item.collectionStatus}`}>{label}</span>
        {item.comment ? <span className="hint ar-cut-comment">Comentario: {item.comment}</span> : null}
        <div className="ar-cut-actions">
          {item.whatsAppMessageSentAt ? <span>WhatsApp enviado</span> : item.whatsAppMessageCopiedAt ? <span>WhatsApp abierto</span> : null}
          {item.managementAmount ? (
            <span>
              Ruta {formatCurrency(item.managementAmount)}
              {item.managementType === "cobrar_o_quitar" ? " / quitar" : ""}
            </span>
          ) : null}
          {item.managementComment ? <span>{item.managementComment}</span> : null}
        </div>
      </div>
    );
  }

  function renderHistoryCutStack(item: CollectionClosureItem | undefined, cutKey: CollectionCutKey) {
    return (
      <div className={`ar-cut-stack-row ar-cut-stack-row--${cutKey}`}>
        <span className="ar-cut-stack-label">
          {cutKey === "morning" ? "AM" : cutKey === "afternoon" ? "PM" : "CIERRE"}
        </span>
        {renderCutStatusCell(item)}
      </div>
    );
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
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: note,
        supportNoteUpdatedAt: new Date().toISOString()
      };
      optimisticStatusByClientRef.current[clientId] = updatedRecord;
      return {
        ...current,
        [clientId]: updatedRecord
      };
    });
  }

  function computeCutTotals(items: CollectionClosureItem[]): Record<CollectionStatus, number> {
    const totals: Record<CollectionStatus, number> = {
      no_answer: 0,
      reminder: 0,
      call_later: 0,
      paid: 0,
      route_collection: 0
    };
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

  function updateCollectionCutItem(cutKey: CollectionCutKey, clientId: string, patch: { status?: string; comment?: string }): void {
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

    const itemsWithoutClient = existingItems.filter((item) => item.clientId !== clientId);
    let nextItems = itemsWithoutClient;
    if (nextStatus === "no_answer" || nextStatus === "reminder" || nextStatus === "call_later" || nextStatus === "paid" || nextStatus === "route_collection") {
      const nextComment = patch.comment !== undefined ? patch.comment : existingItem?.comment ?? "";
      nextItems = [
        ...itemsWithoutClient,
        buildCutItem(row, nextStatus, nextComment)
      ].sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true }));
    }

    const nextClosure: CollectionClosureSnapshot = {
      date: todayDateKey,
      cutKey,
      cutLabel: cutOption?.shortLabel ?? "Corte",
      closedAt: existingClosure?.closedAt ?? new Date().toISOString(),
      actor: existingClosure?.actor ?? "Operador",
      reason: cutOption?.label ?? "Corte de cobranza",
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
    updateCollectionCutItem(cutKey, clientId, { status: nextStatus });
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
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt
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
        whatsAppMessageCopiedAt: new Date().toISOString(),
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: message,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt
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
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt ?? new Date().toISOString(),
        whatsAppMessageSentAt: new Date().toISOString(),
        whatsAppMessageText: message,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt
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
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt
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
        whatsAppMessageCopiedAt: previous?.whatsAppMessageCopiedAt,
        whatsAppMessageSentAt: previous?.whatsAppMessageSentAt,
        whatsAppMessageText: previous?.whatsAppMessageText,
        supportNote: previous?.supportNote,
        supportNoteUpdatedAt: previous?.supportNoteUpdatedAt
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
    const headers = ["Unidad", "Pendiente", "Ult. pago / Estado", "ESTADO COBRANZA", "COBRO EN RUTA"];
    setIsExporting(true);
    setExportError(null);
    try {
      await exportReceivablesToExcel(headers, rows.map((row) => headers.map((header) => {
        const effectiveStatus = getEffectiveStatus(row);
        const collectionStatusLabel = COLLECTION_STATUS_OPTIONS.find((option) => option.value === effectiveStatus)?.label ?? "Seleccionar";
        if (header === "Unidad") return row.unitId;
        if (header === "Pendiente") {
          return `${pendingSummaryText(row.totalPending, row.rentAmount)} | Letra: ${formatCurrency(row.rentAmount)} | ${row.name}`;
        }
        if (header === "Ult. pago / Estado") {
          const sourceClient = clients.find((client) => client.id === row.id);
          const operationalStatus = sourceClient?.status ?? "activo";
          const lastPaymentLabel = row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "Sin pagos";
          return `${lastPaymentLabel} | ${STATE_LABEL[row.state]} | ${clientOperationalStatusLabel(operationalStatus)}`;
        }
        if (header === "ESTADO COBRANZA") return collectionStatusLabel;
        if (header === "COBRO EN RUTA") return hasRouteCollection(row) ? "SI" : "NO";
        return "";
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

  async function handleExportCobroEnRuta(formatOverride?: RouteExportFormat): Promise<void> {
    setExportError(null);
    setIsExporting(true);
    try {
      const exported = await exportRouteCollection({
        rows: baseRows,
        statusByClient: collectionStatusByClient,
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
    const cutLabel = cutOption?.shortLabel ?? "Corte";
    setIsSavingCollectionCut(cutKey);
    try {
      const closureTotals: Record<CollectionStatus, number> = {
        no_answer: 0,
        reminder: 0,
        call_later: 0,
        paid: 0,
        route_collection: 0
      };
      const closureItems = baseRows.map((row) => {
        const statusRecord = collectionStatusByClient[row.id];
        const status = getEffectiveStatus(row) || "reminder";
        closureTotals[status] += 1;
        return {
          clientId: row.id,
          unitId: row.unitId,
          clientName: row.name,
          lastPaymentDate: row.lastPaymentDate,
          receivableState: row.state,
          totalPending: row.totalPending,
          collectionStatus: status,
          comment: status === "call_later" ? (statusRecord?.comment ?? "").slice(0, 5) : "",
          autoApplied: !statusRecord?.status,
          managementType: statusRecord?.managementType,
          managementAmount: statusRecord?.managementAmount,
          managementComment: statusRecord?.managementComment,
          whatsAppMessageCopiedAt: statusRecord?.whatsAppMessageCopiedAt,
          whatsAppMessageSentAt: statusRecord?.whatsAppMessageSentAt
        };
      });
      const snapshot = {
        date: todayDateKey,
        cutKey,
        cutLabel,
        closedAt: new Date().toISOString(),
        actor: "Operador",
        reason: cutOption?.label ?? cutLabel,
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
      setSelectedHistoryDate(todayDateKey);
      setCollectionCutMessage(`${cutLabel} guardado con ${closureItems.length} registro(s).`);
    } catch (error) {
      console.error("No se pudo guardar el corte de cobranza.", error);
      setCollectionCutMessage("No se pudo guardar el corte de cobranza.");
    } finally {
      setIsSavingCollectionCut(null);
    }
  }
  return (
    <>
      <section className="hero ar-hero">
        <div>
          <h1>Cuentas por Cobrar</h1>
          <p>Control de saldos vencidos, cobros en ruta y seguimiento diario.</p>
        </div>
      </section>

      {dashboardFilter !== "none" && (
        <div className="ar-quick-filter-banner">
          <div className="ar-quick-filter-content">
            <span className="ar-quick-filter-badge">Filtro rapido</span>
            <strong className="ar-quick-filter-title">{dashboardFilterLabel[dashboardFilter]}</strong>
            <span className="ar-quick-filter-subtitle">La tabla muestra {rows.length} registro(s) despues de aplicar filtros.</span>
          </div>
          <button type="button" className="button ghost small" onClick={() => setDashboardFilter("none")}>Quitar filtro</button>
        </div>
      )}

      <ReceivablesFiltersPanel
        filters={filters}
        availableGroups={availableGroups}
        onFilterChange={updateFilter}
        onStateFilterToggle={handleStateFilterToggle}
        onClearFilters={clearFilters}
      />

      <section className="panel ar-ledger-panel">
        <div className="panel-head"><h2>Cartera de clientes</h2></div>
        <div className="table-scroll ar-ledger-scroll" ref={tableScrollRef}>
          <table className="ar-table ar-table--compact">
            <tbody>
              {viewMode === "historial" ? (
                selectedHistoryRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                      No hay datos en este cierre.
                    </td>
                  </tr>
                ) : selectedHistoryRows.map((item) => (
                  <tr key={`${selectedHistoryDate}-${item.clientId}`}>
                    <td><strong className="ar-unit-id">{item.unitId}</strong></td>
                    <td className="ar-pending-cell">
                      <div className="ar-client-money-layout">
                        <div className="ar-client-money-main">
                          <span className="client-name">{formatCurrency(item.totalPending)}</span>
                          <span className="debt-meta ar-truncate-line" title={item.clientName}>{item.clientName}</span>
                        </div>
                        <div className="ar-account-status-stack">
                          <span className="ar-last-payment-date">
                            {item.lastPaymentDate ? formatDate(new Date(`${item.lastPaymentDate}T12:00:00`)) : "Sin pagos"}
                          </span>
                          <span className={stateToneClass(item.receivableState as ReceivableState)}>{STATE_LABEL[item.receivableState as ReceivableState] ?? item.receivableState}</span>
                        </div>
                      </div>
                    </td>
                    <td className="ar-support-note-cell"><span className="hint">-</span></td>
                    <td className="ar-cut-cell ar-cut-cell--stacked">
                      <div className="ar-cut-stack">
                        {COLLECTION_CUT_OPTIONS.map((option) => (
                          <div key={option.key}>
                            {renderHistoryCutStack(item.cuts[option.key], option.key)}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                    No hay resultados para los filtros seleccionados.
                  </td>
                </tr>
              ) : rows.map((row) => (
                <ReceivableTableRow
                  key={row.id}
                  row={row}
                  statusRecord={collectionStatusByClient[row.id]}
                  operationalStatus={clientStatusById.get(row.id) ?? "activo"}
                  todayDateKey={todayDateKey}
                  now={now}
                  isTodayCollectionClosed={isTodayCollectionClosed}
                  collectionCutItems={getCutItemsForClient(todayCollectionCuts, row.id)}
                  whatsAppMessage={buildWhatsAppReceivableMessage(row)}
                  onSelectDetail={setSelectedDetailRow}
                  onCollectionCutStatusChange={handleCollectionCutStatusChange}
                  onCollectionCutCommentChange={handleCollectionCutCommentChange}
                  onWhatsAppMessageCopied={handleWhatsAppMessageCopied}
                  onWhatsAppMessageSent={handleWhatsAppMessageSent}
                  onEditWhatsAppPhone={handleOpenWhatsAppPhoneModal}
                  onSupportNoteChange={handleSupportNoteChange}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {whatsAppModalClientId && (() => {
        const client = clients.find((item) => item.id === whatsAppModalClientId);
        const row = baseRows.find((item) => item.id === whatsAppModalClientId);
        if (!client && !row) return null;
        return (
          <div className="modal-overlay">
            <div className="modal ar-detail-modal ar-whatsapp-phone-modal">
              <div className="modal-header">
                <h2>WhatsApp - {row?.unitId ?? client?.unitId}</h2>
                <button type="button" className="modal-close" onClick={() => setWhatsAppModalClientId(null)}>X</button>
              </div>
              <div className="modal-body">
                <div className="ar-detail-grid">
                  <div><span className="hint">Cliente</span><p><strong>{row?.name ?? client?.name}</strong></p></div>
                  <div><span className="hint">Unidad</span><p>{row?.unitId ?? client?.unitId}</p></div>
                </div>
                <label className="ar-field-management-label ar-whatsapp-phone-field">
                  WhatsApp
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={whatsAppPhoneDraft}
                    onChange={(event) => {
                      setWhatsAppPhoneDraft(normalizeWhatsAppDraft(event.target.value));
                      setWhatsAppPhoneError("");
                    }}
                    placeholder="Ej. 68842222"
                    autoFocus
                  />
                </label>
                {whatsAppPhoneError ? <span className="hint error-text">{whatsAppPhoneError}</span> : null}
              </div>
              <div className="modal-actions ar-detail-actions">
                <button type="button" className="button ghost" onClick={() => setWhatsAppModalClientId(null)} disabled={isSavingWhatsAppPhone}>Cancelar</button>
                <button type="button" className="button primary" onClick={() => void handleSaveWhatsAppPhone()} disabled={isSavingWhatsAppPhone}>
                  {isSavingWhatsAppPhone ? "Guardando..." : "Guardar WhatsApp"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {selectedDetailRow && <div className="modal-overlay"><div className="modal ar-detail-modal"><div className="modal-header"><h2>Detalle de cuenta - {selectedDetailRow.unitId}</h2><button type="button" className="modal-close" onClick={() => setSelectedDetailRow(null)}>X</button></div><div className="modal-body"><div className="ar-detail-grid"><div><span className="hint">Cliente</span><p><strong>{selectedDetailRow.name}</strong></p></div><div><span className="hint">Cedula</span><p>{selectedDetailRow.cedula}</p></div><div><span className="hint">Unidad</span><p>{selectedDetailRow.unitId}</p></div><div><span className="hint">Grupo</span><p>{selectedDetailRow.group || "-"}</p></div><div><span className="hint">Datos contrato</span><p>{PLAN_LABEL[selectedDetailRow.plan]} | Total contrato: {formatCurrency(selectedDetailRow.contractTotal)}</p></div><div><span className="hint">Proxima fecha pago</span><p>{selectedDetailRow.nextDueDate ? formatDate(new Date(`${selectedDetailRow.nextDueDate}T12:00:00`)) : "-"}</p></div><div><span className="hint">Saldo vencido</span><p className="amount-debt">{formatCurrency(selectedDetailRow.overdueBalance)}</p></div><div><span className="hint">Total pendiente</span><p className="amount-debt">{formatCurrency(selectedDetailRow.totalPending)}</p></div></div></div><div className="modal-actions ar-detail-actions"><button type="button" className="button ghost" onClick={() => setSelectedDetailRow(null)}>Cerrar</button></div></div></div>}
    </>
  );
}
