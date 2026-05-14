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
};

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

const COLLECTION_STATUS_KEY = "cobrapp.module3.street_management.v1";
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

function parseStoredCollectionRecord(value: unknown): CollectionStatusRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = row.status;
  const comment = typeof row.comment === "string" ? normalizeComment(row.comment.trim()) : "";
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString();

  if (status === "no_answer" || status === "reminder" || status === "call_later" || status === "paid") {
    return { status, comment, updatedAt };
  }

  const legacyActionType = row.actionType;
  if (legacyActionType === "cobrar") {
    return { status: "reminder", comment, updatedAt };
  }
  if (legacyActionType === "quitarOCobrar") {
    return { status: "call_later", comment, updatedAt };
  }

  return null;
}

export default function ReceivablesPage({ clients, payments, hideCollectedThisMonth = false }: Props) {
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
  const [exportFields, setExportFields] = useState<ExportField[]>(INITIAL_EXPORT_FIELDS);
  const [stickyToolbarTop, setStickyToolbarTop] = useState<number>(58);

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const subActionsRowRef = useRef<HTMLDivElement>(null);

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
    try {
      const raw = window.localStorage.getItem(COLLECTION_STATUS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const next: Record<string, CollectionStatusRecord> = {};
      for (const [clientId, value] of Object.entries(parsed as Record<string, unknown>)) {
        const row = parseStoredCollectionRecord(value);
        if (!row) continue;
        next[clientId] = row;
      }
      setCollectionStatusByClient(next);
    } catch {
      setCollectionStatusByClient({});
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLLECTION_STATUS_KEY, JSON.stringify(collectionStatusByClient));
  }, [collectionStatusByClient]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLECTION_CLOSURES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      setCollectionClosuresByDate(parsed as CollectionClosuresByDate);
    } catch {
      setCollectionClosuresByDate({});
    }
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

  function handleStateFilterChange(value: string) {
    if (value === "all") {
      updateFilter("state", []);
      return;
    }
    updateFilter("state", [value as ReceivableState]);
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

  function getEffectiveStatus(row: ReceivableRow): CollectionStatus | "" {
    const stored = collectionStatusByClient[row.id]?.status;
    if (stored) return stored;
    if (hasAutoPaidStatus(row)) return "paid";
    return "";
  }

  function handleCollectionStatusChange(clientId: string, nextStatus: string): void {
    if (nextStatus !== "no_answer" && nextStatus !== "reminder" && nextStatus !== "call_later" && nextStatus !== "paid") {
      setCollectionStatusByClient((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
      return;
    }
    setCollectionStatusByClient((current) => {
      const currentComment = current[clientId]?.comment ?? "";
      return {
        ...current,
        [clientId]: {
          status: nextStatus,
          comment: nextStatus === "call_later" ? normalizeComment(currentComment) : "",
          updatedAt: new Date().toISOString()
        }
      };
    });
  }

  function handleCallLaterCommentChange(clientId: string, value: string): void {
    setCollectionStatusByClient((current) => {
      const currentStatus = current[clientId]?.status ?? "call_later";
      return {
        ...current,
        [clientId]: {
          status: currentStatus,
          comment: normalizeComment(value),
          updatedAt: new Date().toISOString()
        }
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

  return (
    <>
      <section className="hero ar-hero"><div><h1>Cuentas por Cobrar</h1><p>Control de saldos vencidos y proximos a vencer.</p></div></section>
      <section className="summary-grid ar-summary-grid">
        <button type="button" className={`summary-card summary-card--interactive ${dashboardFilter === "totalPorCobrar" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "totalPorCobrar" ? "none" : "totalPorCobrar")}><span>Total por cobrar</span><strong>{formatCurrency(summary.totalPorCobrar)}</strong></button>
        <button type="button" className={`summary-card summary-card--interactive ar-summary-card--debt ${dashboardFilter === "totalVencido" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "totalVencido" ? "none" : "totalVencido")}><span>Vencido + critico</span><strong>{formatCurrency(summary.totalVencido)}</strong></button>
        <button type="button" className={`summary-card summary-card--interactive ${dashboardFilter === "proximoAVencer" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "proximoAVencer" ? "none" : "proximoAVencer")}><span>Proximos a vencer</span><strong>{formatCurrency(summary.proximoAVencer)}</strong></button>
        <button type="button" className={`summary-card summary-card--interactive ar-summary-card--debt ${dashboardFilter === "clientesMorosos" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "clientesMorosos" ? "none" : "clientesMorosos")}><span>Clientes morosos</span><strong>{summary.clientesMorosos}</strong></button>
      </section>
      {!hideCollectedThisMonth && <section className="ar-secondary-metric-row"><button type="button" className={`ar-secondary-metric ${dashboardFilter === "cobradoEsteMes" ? "ar-secondary-metric--active" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "cobradoEsteMes" ? "none" : "cobradoEsteMes")}><span>Cobrado este mes</span><strong>{formatCurrency(summary.cobradoEsteMes)}</strong></button></section>}

      <section className="panel">
        <div className="panel-head"><h2>Filtros</h2><div className="ar-filter-actions"><button type="button" className="button ghost small" onClick={clearFilters}>Limpiar filtros</button></div></div>
        <div className="ar-filters-grid">
          <div className="ar-filter-field"><span className="ar-filter-label">Buscar unidad</span><input type="text" value={filters.unitSearch} onChange={(event) => updateFilter("unitSearch", event.target.value)} /></div>
          <div className="ar-filter-field">
            <span className="ar-filter-label">Estado</span>
            <select value={filters.state[0] ?? "all"} onChange={(event) => handleStateFilterChange(event.target.value)}>
              <option value="all">Todos</option>
              {STATE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
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
                const hasManualStatus = !!collectionStatusByClient[row.id]?.status;
                const effectiveStatus = getEffectiveStatus(row);
                const storedComment = collectionStatusByClient[row.id]?.comment ?? "";
                const sourceClient = clients.find((client) => client.id === row.id);
                const operationalStatus = sourceClient?.status ?? "activo";
                return (
                  <tr key={row.id}>
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
                      <button type="button" className="button ghost small" onClick={() => setSelectedDetailRow(row)}>Ver detalle</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selectedDetailRow && <div className="modal-overlay"><div className="modal ar-detail-modal"><div className="modal-header"><h2>Detalle de cuenta - {selectedDetailRow.unitId}</h2><button type="button" className="modal-close" onClick={() => setSelectedDetailRow(null)}>X</button></div><div className="modal-body"><div className="ar-detail-grid"><div><span className="hint">Cliente</span><p><strong>{selectedDetailRow.name}</strong></p></div><div><span className="hint">Cedula</span><p>{selectedDetailRow.cedula}</p></div><div><span className="hint">Unidad</span><p>{selectedDetailRow.unitId}</p></div><div><span className="hint">Grupo</span><p>{selectedDetailRow.group || "-"}</p></div><div><span className="hint">Datos contrato</span><p>{PLAN_LABEL[selectedDetailRow.plan]} | Total contrato: {formatCurrency(selectedDetailRow.contractTotal)}</p></div><div><span className="hint">Proxima fecha pago</span><p>{selectedDetailRow.nextDueDate ? formatDate(new Date(`${selectedDetailRow.nextDueDate}T12:00:00`)) : "-"}</p></div><div><span className="hint">Saldo vencido</span><p className="amount-debt">{formatCurrency(selectedDetailRow.overdueBalance)}</p></div><div><span className="hint">Total pendiente</span><p className="amount-debt">{formatCurrency(selectedDetailRow.totalPending)}</p></div></div></div><div className="modal-actions ar-detail-actions"><button type="button" className="button ghost" onClick={() => setSelectedDetailRow(null)}>Cerrar</button></div></div></div>}
    </>
  );
}
