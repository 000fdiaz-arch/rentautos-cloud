import { useEffect, useMemo, useRef, useState } from "react";
import { exportReceivablesToExcel, exportReceivablesToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import { loadCloudCollectionClosures } from "../cloudData";
import { supabase } from "../lib/supabase";
import {
  buildReceivableRows,
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
import { exportRouteCollection } from "./receivables/routeCollectionExport";
import {
  COLLECTION_STATUS_OPTIONS,
  INITIAL_EXPORT_FIELDS,
  STATE_FILTER_OPTIONS,
  clientOperationalStatusLabel,
  clientOperationalStatusTone,
  formatDateForTitle,
  isToday,
  normalizeComment,
  normalizeFieldManagementComment,
  parseCollectionStatusMapFromStorage,
  pendingSummaryText,
  planLabelForExport,
  renderSortIcon,
  stateToneClass,
  toTimestamp,
  type CollectionClosuresByDate,
  type CollectionStatusFilter,
  type ExportField,
  type GroupFilter,
  type ReceivablesViewMode
} from "./receivables/receivablesPageRules";

const INITIAL_VISIBLE_RECEIVABLE_ROWS = 120;
const VISIBLE_RECEIVABLE_ROWS_STEP = 120;

type Props = {
  clients: Client[];
  payments: Payment[];
  dataOwnerUserId?: string | null;
  streetManagementData?: Record<string, unknown>;
  onStreetManagementPersist?: (value: Record<string, unknown>) => Promise<boolean> | boolean;
};

export default function ReceivablesPage({
  clients,
  payments,
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
  const [visibleRowLimit, setVisibleRowLimit] = useState<number>(INITIAL_VISIBLE_RECEIVABLE_ROWS);
  const [fieldManagementModalClientId, setFieldManagementModalClientId] = useState<string | null>(null);
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

  const filteredRows = useMemo(() => filterReceivableRows(baseRows, filters), [baseRows, filters]);
  const filteredByGroupRows = useMemo(() => {
    if (groupFilter === "all") return filteredRows;
    return filteredRows.filter((row) => getGroupFromUnit(row.unitId) === groupFilter);
  }, [filteredRows, groupFilter]);
  const filteredByCollectionStatusRows = useMemo(() => {
    if (collectionStatusFilter === "all") return filteredByGroupRows;
    return filteredByGroupRows.filter((row) => getEffectiveStatus(row) === collectionStatusFilter);
  }, [collectionStatusFilter, filteredByGroupRows, collectionStatusByClient, now]);

  const rows = useMemo(
    () => sortReceivableRows(filteredByCollectionStatusRows, sortField, sortDirection),
    [filteredByCollectionStatusRows, sortDirection, sortField]
  );
  const visibleRows = useMemo(() => rows.slice(0, visibleRowLimit), [rows, visibleRowLimit]);
  const hasMoreRows = visibleRows.length < rows.length;
  const todayDateKey = useMemo(() => {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [now]);
  const isTodayCollectionClosed = !!collectionClosuresByDate[todayDateKey];
  const selectedHistoryClosure = selectedHistoryDate ? collectionClosuresByDate[selectedHistoryDate] ?? null : null;

  function updateFilter<K extends keyof ReceivableFilters>(key: K, value: ReceivableFilters[K]) {
    setVisibleRowLimit(INITIAL_VISIBLE_RECEIVABLE_ROWS);
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
    setVisibleRowLimit(INITIAL_VISIBLE_RECEIVABLE_ROWS);
    setFilters(DEFAULT_RECEIVABLE_FILTERS);
    setGroupFilter("all");
    setCollectionStatusFilter("all");
  }

  function handleSort(field: ReceivableSortField) {
    setVisibleRowLimit(INITIAL_VISIBLE_RECEIVABLE_ROWS);
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

  function buildWhatsAppReceivableUrl(row: ReceivableRow): string {
    const today = formatDateForTitle(now);
    const pending = formatCurrency(row.totalPending);
    const installmentsText = row.overdueInstallments > 0
      ? ` (${row.overdueInstallments} cuota${row.overdueInstallments === 1 ? "" : "s"} atrasada${row.overdueInstallments === 1 ? "" : "s"})`
      : "";
    const message = [
      `Hola ${row.name}.`,
      `Saldo pendiente al ${today}: ${pending}${installmentsText}.`,
      "Por favor realizar el pago. Gracias."
    ].join("\n");
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
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
  return (
    <>
      <section className="hero ar-hero"><div><h1>Cuentas por Cobrar</h1><p>Control de saldos vencidos y proximos a vencer.</p></div></section>

      <section className="panel ar-filters-panel">
        <div className="ar-filters-head">
          <div>
            <h2>Filtros</h2>
            <span className="hint">Refina la cartera visible</span>
          </div>
          <button type="button" className="button ghost small" onClick={clearFilters}>Limpiar</button>
        </div>
        <div className="ar-filters-grid">
          <label className="ar-filter-field">
            <span className="ar-filter-label">Unidad</span>
            <input
              type="text"
              placeholder="Ej. T35"
              value={filters.unitSearch}
              onChange={(event) => updateFilter("unitSearch", event.target.value)}
            />
          </label>
          <label className="ar-filter-field">
            <span className="ar-filter-label">Cliente</span>
            <input
              type="text"
              placeholder="Nombre"
              value={filters.clientSearch}
              onChange={(event) => updateFilter("clientSearch", event.target.value)}
            />
          </label>
          <label className="ar-filter-field">
            <span className="ar-filter-label">Cedula</span>
            <input
              type="text"
              placeholder="Documento"
              value={filters.cedulaSearch}
              onChange={(event) => updateFilter("cedulaSearch", event.target.value)}
            />
          </label>
          <label className="ar-filter-field">
            <span className="ar-filter-label">Plan</span>
            <select
              value={filters.plan}
              onChange={(event) => updateFilter("plan", event.target.value as ReceivableFilters["plan"])}
            >
              <option value="all">Todos</option>
              <option value="daily">Diario</option>
              <option value="weekly">Semanal</option>
              <option value="biweekly">Quincenal</option>
              <option value="monthly">Mensual</option>
            </select>
          </label>
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

      <section className="panel">
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
        <div className="ar-sticky-stack">
          <div className="ar-sub-actions-row">
            <div className="ar-filter-actions">
              <button type="button" className="button ghost small" onClick={() => setIsExportConfigOpen((open) => !open)}>{isExportConfigOpen ? "Cerrar campos" : "Campos exportables"}</button>
              <button type="button" className="button primary small" onClick={handleExportExcel} disabled={isExporting}>{isExporting ? "Exportando..." : "Exportar Excel"}</button>
              <button type="button" className="button ghost small" onClick={handleExportPdf} disabled={isExporting}>Exportar PDF</button>
              <span className="hint">Mostrando {visibleRows.length} de {rows.length} registro(s)</span>
              <label className="ar-toolbar-filter">
                <span className="ar-toolbar-filter-label">Cobranza</span>
                <select
                  className="ar-toolbar-filter-select"
                  value={collectionStatusFilter}
                  onChange={(event) => {
                    setVisibleRowLimit(INITIAL_VISIBLE_RECEIVABLE_ROWS);
                    setCollectionStatusFilter(event.target.value as CollectionStatusFilter);
                  }}
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
                  onChange={(event) => {
                    setVisibleRowLimit(INITIAL_VISIBLE_RECEIVABLE_ROWS);
                    setGroupFilter(event.target.value);
                  }}
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
            <thead>
              <tr>
                <th>
                  <button type="button" className="sort-button ar-columns-head-btn" onClick={() => handleSort("unitId")}>
                    Unidad <span className={`sort-icon ${sortField === "unitId" ? "active" : ""}`}>{renderSortIcon(sortField === "unitId", sortDirection)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-button ar-columns-head-btn" onClick={() => handleSort("totalPending")}>
                    Pendiente <span className={`sort-icon ${sortField === "totalPending" ? "active" : ""}`}>{renderSortIcon(sortField === "totalPending", sortDirection)}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="sort-button ar-columns-head-btn" onClick={() => handleSort("lastPaymentDate")}>
                    Ult. pago / Estado <span className={`sort-icon ${sortField === "lastPaymentDate" ? "active" : ""}`}>{renderSortIcon(sortField === "lastPaymentDate", sortDirection)}</span>
                  </button>
                </th>
                <th>Estado cobranza</th>
                <th>Acciones</th>
              </tr>
            </thead>
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
              ) : visibleRows.map((row) => {
                const paidToday = hasPaymentToday(row);
                const autoPaid = hasAutoPaidStatus(row);
                const routeCollection = hasRouteCollection(row);
                const hasManualStatus = !!collectionStatusByClient[row.id]?.status;
                const effectiveStatus = getEffectiveStatus(row);
                const storedComment = collectionStatusByClient[row.id]?.comment ?? "";
                const operationalStatus = clientStatusById.get(row.id) ?? "activo";
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
                              disabled={isTodayCollectionClosed}
                            >
                              x
                            </button>
                          </span>
                        )}
                        <select
                          className="ar-collection-select"
                          value={effectiveStatus}
                          onChange={(event) => handleCollectionStatusChange(row.id, event.target.value)}
                          disabled={isTodayCollectionClosed}
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
                            disabled={isTodayCollectionClosed}
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
                        <a
                          className="button ghost small ar-whatsapp-link"
                          href={buildWhatsAppReceivableUrl(row)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          WhatsApp
                        </a>
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => handleOpenFieldManagementModal(row.id)}
                          disabled={isTodayCollectionClosed}
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
        {viewMode === "cartera" && hasMoreRows && (
          <div className="ar-load-more-row">
            <button
              type="button"
              className="button ghost small"
              onClick={() => setVisibleRowLimit((current) => current + VISIBLE_RECEIVABLE_ROWS_STEP)}
            >
              Mostrar {Math.min(VISIBLE_RECEIVABLE_ROWS_STEP, rows.length - visibleRows.length)} mas
            </button>
            <button
              type="button"
              className="button ghost small"
              onClick={() => setVisibleRowLimit(rows.length)}
            >
              Mostrar todos
            </button>
          </div>
        )}
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
