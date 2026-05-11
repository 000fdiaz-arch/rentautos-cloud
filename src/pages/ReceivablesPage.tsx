import { useEffect, useMemo, useRef, useState } from "react";
import { exportReceivablesToExcel, exportReceivablesToPdf } from "../exporters";
import { formatCurrency, formatDate } from "../format";
import {
  buildReceivableRows,
  computeReceivableSummary,
  createMockReceivableRows,
  DEFAULT_RECEIVABLE_FILTERS,
  filterReceivableRows,
  PLAN_LABEL,
  sortReceivableRows,
  STATE_LABEL,
  type ReceivableFilters,
  type ReceivableRow,
  type ReceivableState,
  type ReceivableSortField,
  type SortDirection
} from "../receivables";
import { closePendingPromisesAsRescheduled, formatPromiseStatusLabel } from "../paymentPromises";
import type { Client, Payment, PaymentPromise } from "../types";

type Props = {
  clients: Client[];
  payments: Payment[];
  paymentPromises: PaymentPromise[];
  onPaymentPromisesChange: (next: PaymentPromise[]) => void;
  canManagePromises?: boolean;
  hideCollectedThisMonth?: boolean;
};

const STATE_FILTER_OPTIONS: Array<{ value: ReceivableState; label: string }> = [
  { value: "alDia", label: "Al dia" },
  { value: "proximo", label: "Proximo a vencer" },
  { value: "venceHoy", label: "Vence hoy" },
  { value: "vencido", label: "Vencido" },
  { value: "critico", label: "Moroso critico" }
];

type DashboardFilter =
  | "none"
  | "totalPorCobrar"
  | "totalVencido"
  | "proximoAVencer"
  | "clientesMorosos"
  | "cobradoEsteMes"
  | "promesasHoy"
  | "promesasVencidas";
type ExportFieldKey = "unitId" | "name" | "rentAmount" | "pendingSummary" | "lastPaymentDate" | "state";
type ExportField = { key: ExportFieldKey; label: string; enabled: boolean };
type PromiseFilter = {
  status: "all" | PaymentPromise["status"];
  dateFrom: string;
  dateTo: string;
  withActive: "all" | "with" | "without";
};

type PromiseForm = {
  date: string;
  time: string;
  amountPromised: string;
  comment: string;
};

const INITIAL_EXPORT_FIELDS: ExportField[] = [
  { key: "unitId", label: "Unidad", enabled: true },
  { key: "name", label: "Nombre", enabled: true },
  { key: "rentAmount", label: "Letra", enabled: true },
  { key: "pendingSummary", label: "Cuentas pendiente", enabled: true },
  { key: "lastPaymentDate", label: "Ultima fecha de pago", enabled: true },
  { key: "state", label: "Estado", enabled: true }
];

const DEFAULT_PROMISE_FILTERS: PromiseFilter = {
  status: "all",
  dateFrom: "",
  dateTo: "",
  withActive: "all"
};

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

function promiseToneClass(status: PaymentPromise["status"]): string {
  if (status === "fulfilled") return "ar-badge ar-badge--good";
  if (status === "fulfilled_late") return "ar-badge ar-badge--today";
  if (status === "incomplete") return "ar-badge ar-badge--warn";
  if (status === "overdue") return "ar-badge ar-badge--critical";
  if (status === "pending") return "ar-badge ar-badge--debt";
  return "ar-badge";
}

function pendingSummaryText(totalPending: number, rentAmount: number): string {
  const pendingInstallments = rentAmount > 0 ? Math.ceil(totalPending / rentAmount) : 0;
  const label = pendingInstallments === 1 ? "cuota" : "cuotas";
  return `${formatCurrency(totalPending)} (${pendingInstallments} ${label})`;
}

function isToday(date: Date, now: Date): boolean {
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function toIsoFromForm(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export default function ReceivablesPage({ clients, payments, paymentPromises, onPaymentPromisesChange, canManagePromises = true, hideCollectedThisMonth = false }: Props) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [filters, setFilters] = useState<ReceivableFilters>(DEFAULT_RECEIVABLE_FILTERS);
  const [promiseFilters, setPromiseFilters] = useState<PromiseFilter>(DEFAULT_PROMISE_FILTERS);
  const [sortField, setSortField] = useState<ReceivableSortField>("unitId");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>("none");
  const [selectedDetailRow, setSelectedDetailRow] = useState<ReceivableRow | null>(null);
  const [promiseTargetRow, setPromiseTargetRow] = useState<ReceivableRow | null>(null);
  const [promiseForm, setPromiseForm] = useState<PromiseForm>({ date: "", time: "", amountPromised: "", comment: "" });
  const [promiseError, setPromiseError] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportConfigOpen, setIsExportConfigOpen] = useState<boolean>(false);
  const [exportFields, setExportFields] = useState<ExportField[]>(INITIAL_EXPORT_FIELDS);

  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topScrollInnerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timerId);
  }, []);

  const baseRows = useMemo(() => {
    if (clients.length === 0) return createMockReceivableRows(now);
    return buildReceivableRows(clients, payments, now);
  }, [clients, now, payments]);

  const activePromiseByClient = useMemo(() => {
    const map = new Map<string, PaymentPromise>();
    for (const promise of paymentPromises) {
      if (promise.status !== "pending" && promise.status !== "incomplete") continue;
      const current = map.get(promise.clientId);
      if (!current || promise.createdAt > current.createdAt) map.set(promise.clientId, promise);
    }
    return map;
  }, [paymentPromises]);

  const filteredRows = useMemo(() => filterReceivableRows(baseRows, filters), [baseRows, filters]);
  const filteredByPromiseRows = useMemo(() => {
    return filteredRows.filter((row) => {
      const promise = activePromiseByClient.get(row.id);
      if (promiseFilters.withActive === "with" && !promise) return false;
      if (promiseFilters.withActive === "without" && promise) return false;
      if (!promise) return promiseFilters.status === "all";
      if (promiseFilters.status !== "all" && promise.status !== promiseFilters.status) return false;
      const dueDate = promise.dueAt.slice(0, 10);
      if (promiseFilters.dateFrom && dueDate < promiseFilters.dateFrom) return false;
      if (promiseFilters.dateTo && dueDate > promiseFilters.dateTo) return false;
      return true;
    });
  }, [activePromiseByClient, filteredRows, promiseFilters]);

  const dashboardFilteredRows = useMemo(() => {
    if (dashboardFilter === "none") return filteredByPromiseRows;
    if (dashboardFilter === "totalPorCobrar") return filteredByPromiseRows.filter((row) => row.totalPending > 0);
    if (dashboardFilter === "totalVencido" || dashboardFilter === "clientesMorosos") return filteredByPromiseRows.filter((row) => row.state === "vencido" || row.state === "critico");
    if (dashboardFilter === "proximoAVencer") return filteredByPromiseRows.filter((row) => row.state === "proximo" || row.state === "venceHoy");
    if (dashboardFilter === "promesasHoy") return filteredByPromiseRows.filter((row) => {
      const promise = activePromiseByClient.get(row.id);
      return !!promise && isToday(new Date(promise.dueAt), now);
    });
    if (dashboardFilter === "promesasVencidas") return filteredByPromiseRows.filter((row) => activePromiseByClient.get(row.id)?.status === "overdue");
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    return filteredByPromiseRows.filter((row) => {
      if (!row.lastPaymentDate) return false;
      const parsed = new Date(`${row.lastPaymentDate}T12:00:00`);
      return parsed.getFullYear() === currentYear && parsed.getMonth() === currentMonth;
    });
  }, [activePromiseByClient, dashboardFilter, filteredByPromiseRows, now]);

  const rows = useMemo(() => sortReceivableRows(dashboardFilteredRows, sortField, sortDirection), [dashboardFilteredRows, sortDirection, sortField]);
  const summary = useMemo(() => computeReceivableSummary(filteredByPromiseRows, payments, now), [filteredByPromiseRows, now, payments]);
  const promiseTodayCount = useMemo(() => paymentPromises.filter((promise) => (promise.status === "pending" || promise.status === "incomplete") && isToday(new Date(promise.dueAt), now)).length, [now, paymentPromises]);
  const promiseOverdueCount = useMemo(() => paymentPromises.filter((promise) => promise.status === "overdue").length, [paymentPromises]);

  useEffect(() => {
    if (topScrollInnerRef.current && tableScrollRef.current) {
      topScrollInnerRef.current.style.width = `${tableScrollRef.current.scrollWidth}px`;
    }
  }, [rows]);

  function updateFilter<K extends keyof ReceivableFilters>(key: K, value: ReceivableFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleStateFilter(state: ReceivableState) {
    setFilters((current) => {
      const exists = current.state.includes(state);
      return { ...current, state: exists ? current.state.filter((value) => value !== state) : [...current.state, state] };
    });
  }

  function clearFilters() {
    setFilters(DEFAULT_RECEIVABLE_FILTERS);
    setPromiseFilters(DEFAULT_PROMISE_FILTERS);
    setDashboardFilter("none");
  }

  function handleSort(field: ReceivableSortField) {
    if (sortField === field) return setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    setSortField(field);
    setSortDirection("asc");
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

  function getPromiseForRow(row: ReceivableRow): PaymentPromise | undefined {
    return activePromiseByClient.get(row.id);
  }

  function openPromiseDrawer(row: ReceivableRow): void {
    if (!canManagePromises) return;
    setPromiseTargetRow(row);
    const current = getPromiseForRow(row);
    if (!current) return setPromiseForm({ date: "", time: "", amountPromised: "", comment: "" });
    const due = new Date(current.dueAt);
    const hh = String(due.getHours()).padStart(2, "0");
    const mm = String(due.getMinutes()).padStart(2, "0");
    setPromiseForm({
      date: current.dueAt.slice(0, 10),
      time: `${hh}:${mm}`,
      amountPromised: String(current.amountPromised),
      comment: current.comment
    });
  }

  function savePromise(): void {
    if (!canManagePromises) return;
    if (!promiseTargetRow) return;
    const amount = Number(promiseForm.amountPromised);
    if (!promiseForm.date || !promiseForm.time || !Number.isFinite(amount) || amount <= 0) return setPromiseError("Completa fecha, hora y monto prometido valido.");
    const dueAt = toIsoFromForm(promiseForm.date, promiseForm.time);
    const nowIso = new Date().toISOString();
    const current = getPromiseForRow(promiseTargetRow);
    let next = [...paymentPromises];
    if (!current) {
      next = closePendingPromisesAsRescheduled(next, promiseTargetRow.id);
      next.push({
        id: crypto.randomUUID(),
        clientId: promiseTargetRow.id,
        clientName: promiseTargetRow.name,
        clientUnit: promiseTargetRow.unitId,
        amountPromised: amount,
        amountCollectedWithinWindow: 0,
        amountCollectedTotal: 0,
        amountMissing: amount,
        dueAt,
        createdAt: nowIso,
        updatedAt: nowIso,
        comment: promiseForm.comment.trim(),
        status: "pending"
      });
    } else {
      next = next.map((promise) => promise.id === current.id
        ? { ...promise, amountPromised: amount, dueAt, comment: promiseForm.comment.trim(), status: "pending", updatedAt: nowIso }
        : promise);
    }
    onPaymentPromisesChange(next);
    setPromiseError("");
    setPromiseTargetRow(null);
  }

  function cancelPromise(promiseId: string): void {
    if (!canManagePromises) return;
    const nowIso = new Date().toISOString();
    onPaymentPromisesChange(paymentPromises.map((promise) => promise.id === promiseId
      ? { ...promise, status: "cancelled", closedAt: nowIso, updatedAt: nowIso, closedReason: "Cancelada por cobradora." }
      : promise));
    setPromiseTargetRow(null);
  }

function promiseDisplayText(promise: PaymentPromise | undefined): string {
    if (!promise) return "Sin promesa";
    if (promise.status === "incomplete") return `Incompleta (${formatCurrency(promise.amountMissing)} pendiente)`;
    if (promise.status === "pending" && isToday(new Date(promise.dueAt), now)) {
      return `Hoy ${new Date(promise.dueAt).toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" })}`;
    }
  return formatPromiseStatusLabel(promise.status);
}

function summarizeComment(comment: string, max = 42): string {
  const clean = comment.trim();
  if (!clean) return "";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
}

  function handleTopScroll() {
    if (tableScrollRef.current && topScrollRef.current) tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  }

  function handleTableScroll() {
    if (topScrollRef.current && tableScrollRef.current) topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
  }

  return (
    <>
      <section className="hero ar-hero"><div><h1>Cuentas por Cobrar</h1><p>Control de saldos vencidos, proximos a vencer y promesas de pago.</p></div></section>
      <section className="summary-grid ar-summary-grid">
        <button type="button" className={`summary-card summary-card--interactive ${dashboardFilter === "totalPorCobrar" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "totalPorCobrar" ? "none" : "totalPorCobrar")}><span>Total por cobrar</span><strong>{formatCurrency(summary.totalPorCobrar)}</strong></button>
        <button type="button" className={`summary-card summary-card--interactive ar-summary-card--debt ${dashboardFilter === "totalVencido" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "totalVencido" ? "none" : "totalVencido")}><span>Vencido + critico</span><strong>{formatCurrency(summary.totalVencido)}</strong></button>
        <button type="button" className={`summary-card summary-card--interactive ${dashboardFilter === "promesasHoy" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "promesasHoy" ? "none" : "promesasHoy")}><span>Promesas para hoy</span><strong>{promiseTodayCount}</strong></button>
        <button type="button" className={`summary-card summary-card--interactive ar-summary-card--debt ${dashboardFilter === "promesasVencidas" ? "summary-card--selected" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "promesasVencidas" ? "none" : "promesasVencidas")}><span>Promesas vencidas</span><strong>{promiseOverdueCount}</strong></button>
      </section>
      {!hideCollectedThisMonth && <section className="ar-secondary-metric-row"><button type="button" className={`ar-secondary-metric ${dashboardFilter === "cobradoEsteMes" ? "ar-secondary-metric--active" : ""}`} onClick={() => setDashboardFilter(dashboardFilter === "cobradoEsteMes" ? "none" : "cobradoEsteMes")}><span>Cobrado este mes</span><strong>{formatCurrency(summary.cobradoEsteMes)}</strong></button></section>}

      <section className="panel">
        <div className="panel-head"><h2>Filtros</h2><div className="ar-filter-actions"><button type="button" className="button ghost small" onClick={clearFilters}>Limpiar filtros</button></div></div>
        <div className="ar-filters-grid">
          <div className="ar-filter-field"><span className="ar-filter-label">Buscar cliente</span><input type="text" value={filters.clientSearch} onChange={(event) => updateFilter("clientSearch", event.target.value)} /></div>
          <div className="ar-filter-field"><span className="ar-filter-label">Buscar unidad</span><input type="text" value={filters.unitSearch} onChange={(event) => updateFilter("unitSearch", event.target.value)} /></div>
          <div className="ar-filter-field"><span className="ar-filter-label">Buscar cedula</span><input type="text" value={filters.cedulaSearch} onChange={(event) => updateFilter("cedulaSearch", event.target.value)} /></div>
          <div className="ar-filter-field ar-filter-field--states"><span className="ar-filter-label">Estado</span><div className="ar-state-chips"><button type="button" className={`ar-state-chip ${filters.state.length === 0 ? "ar-state-chip--active" : ""}`} onClick={() => updateFilter("state", [])}>Todos</button>{STATE_FILTER_OPTIONS.map((option) => <button key={option.value} type="button" className={`ar-state-chip ${filters.state.includes(option.value) ? "ar-state-chip--active" : ""}`} onClick={() => toggleStateFilter(option.value)}>{option.label}</button>)}</div></div>
          <div className="ar-filter-field"><span className="ar-filter-label">Estado promesa</span><select value={promiseFilters.status} onChange={(event) => setPromiseFilters((current) => ({ ...current, status: event.target.value as PromiseFilter["status"] }))}><option value="all">Todas</option><option value="pending">Pendiente</option><option value="incomplete">Incompleta</option><option value="overdue">Vencida</option><option value="fulfilled">Cumplida</option><option value="fulfilled_late">Cumplida tarde</option></select></div>
          <div className="ar-filter-field"><span className="ar-filter-label">Promesa activa</span><select value={promiseFilters.withActive} onChange={(event) => setPromiseFilters((current) => ({ ...current, withActive: event.target.value as PromiseFilter["withActive"] }))}><option value="all">Todos</option><option value="with">Con promesa</option><option value="without">Sin promesa</option></select></div>
          <div className="ar-filter-field"><span className="ar-filter-label">Promesa desde</span><input type="date" value={promiseFilters.dateFrom} onChange={(event) => setPromiseFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></div>
          <div className="ar-filter-field"><span className="ar-filter-label">Promesa hasta</span><input type="date" value={promiseFilters.dateTo} onChange={(event) => setPromiseFilters((current) => ({ ...current, dateTo: event.target.value }))} /></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Cartera de clientes</h2><div className="ar-filter-actions"><button type="button" className="button ghost small" onClick={() => setIsExportConfigOpen((open) => !open)}>{isExportConfigOpen ? "Cerrar campos" : "Campos exportables"}</button><button type="button" className="button primary small" onClick={handleExportExcel} disabled={isExporting}>{isExporting ? "Exportando..." : "Exportar Excel"}</button><button type="button" className="button ghost small" onClick={handleExportPdf} disabled={isExporting}>Exportar PDF</button><span className="hint">Mostrando {rows.length} registro(s)</span></div></div>
        {isExportConfigOpen && <div className="export-panel"><p className="export-title">Selecciona las columnas a exportar</p><div className="export-fields">{exportFields.map((field) => <label key={field.key} className="export-field-label"><input type="checkbox" checked={field.enabled} onChange={() => setExportFields((current) => current.map((item) => (item.key === field.key ? { ...item, enabled: !item.enabled } : item)))} />{field.label}</label>)}</div></div>}
        {exportError && <p className="hint error-text">{exportError}</p>}
        {rows.length === 0 ? <p className="empty">No hay resultados para los filtros seleccionados.</p> : <>
          <div className="top-scroll" ref={topScrollRef} onScroll={handleTopScroll}><div ref={topScrollInnerRef} className="top-scroll-inner" /></div>
          <div className="table-scroll" ref={tableScrollRef} onScroll={handleTableScroll}>
            <table className="ar-table"><thead><tr><th><button type="button" className="sort-button" onClick={() => handleSort("unitId")}>Unidad <span className={`sort-icon ${sortField === "unitId" ? "active" : ""}`}>{renderSortIcon(sortField === "unitId", sortDirection)}</span></button></th><th><button type="button" className="sort-button" onClick={() => handleSort("rentAmount")}>Letra <span className={`sort-icon ${sortField === "rentAmount" ? "active" : ""}`}>{renderSortIcon(sortField === "rentAmount", sortDirection)}</span></button></th><th><button type="button" className="sort-button" onClick={() => handleSort("totalPending")}>Cuentas pendiente <span className={`sort-icon ${sortField === "totalPending" ? "active" : ""}`}>{renderSortIcon(sortField === "totalPending", sortDirection)}</span></button></th><th><button type="button" className="sort-button" onClick={() => handleSort("lastPaymentDate")}>Ultima fecha de pago <span className={`sort-icon ${sortField === "lastPaymentDate" ? "active" : ""}`}>{renderSortIcon(sortField === "lastPaymentDate", sortDirection)}</span></button></th><th><button type="button" className="sort-button" onClick={() => handleSort("state")}>Estado <span className={`sort-icon ${sortField === "state" ? "active" : ""}`}>{renderSortIcon(sortField === "state", sortDirection)}</span></button></th><th>Promesa</th><th>Acciones</th></tr></thead>
              <tbody>{rows.map((row) => { const promise = getPromiseForRow(row); return <tr key={row.id}><td><strong>{row.unitId}</strong></td><td><strong className={row.rentAmount > 0 ? "amount-debt" : "amount-good"}>{formatCurrency(row.rentAmount)}</strong></td><td><span className="client-name">{pendingSummaryText(row.totalPending, row.rentAmount)}</span><span className="debt-meta">{row.name}</span></td><td>{row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : <span className="amount-muted">Sin pagos</span>}</td><td><span className={stateToneClass(row.state)}>{STATE_LABEL[row.state]}</span></td><td>{promise ? <><span className={promiseToneClass(promise.status)}>{promiseDisplayText(promise)}</span><div className="debt-meta">Limite: {formatDate(new Date(promise.dueAt))} {new Date(promise.dueAt).toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" })}</div><div className="debt-meta">Prometido: {formatCurrency(promise.amountPromised)}</div><div className="debt-meta">Cobrado: {formatCurrency(promise.amountCollectedWithinWindow)}</div><div className="debt-meta">Faltante: {formatCurrency(promise.amountMissing)}</div>{promise.comment.trim() && <div className="debt-meta" title={promise.comment.trim()}>Comentario: {summarizeComment(promise.comment, 80)}</div>}</> : <span className="amount-muted">Sin promesa</span>}</td><td className="actions-cell ar-actions-cell"><button type="button" className="button ghost small" onClick={() => setSelectedDetailRow(row)}>Ver detalle</button>{canManagePromises && <button type="button" className="button ghost small" onClick={() => openPromiseDrawer(row)}>Promesa</button>}</td></tr>; })}</tbody></table>
          </div>
        </>}
      </section>

      {selectedDetailRow && <div className="modal-overlay"><div className="modal ar-detail-modal"><div className="modal-header"><h2>Detalle de cuenta - {selectedDetailRow.unitId}</h2><button type="button" className="modal-close" onClick={() => setSelectedDetailRow(null)}>X</button></div><div className="modal-body"><div className="ar-detail-grid"><div><span className="hint">Cliente</span><p><strong>{selectedDetailRow.name}</strong></p></div><div><span className="hint">Cedula</span><p>{selectedDetailRow.cedula}</p></div><div><span className="hint">Unidad</span><p>{selectedDetailRow.unitId}</p></div><div><span className="hint">Grupo</span><p>{selectedDetailRow.group || "-"}</p></div><div><span className="hint">Datos contrato</span><p>{PLAN_LABEL[selectedDetailRow.plan]} | Total contrato: {formatCurrency(selectedDetailRow.contractTotal)}</p></div><div><span className="hint">Proxima fecha pago</span><p>{selectedDetailRow.nextDueDate ? formatDate(new Date(`${selectedDetailRow.nextDueDate}T12:00:00`)) : "-"}</p></div><div><span className="hint">Saldo vencido</span><p className="amount-debt">{formatCurrency(selectedDetailRow.overdueBalance)}</p></div><div><span className="hint">Total pendiente</span><p className="amount-debt">{formatCurrency(selectedDetailRow.totalPending)}</p></div></div><h3 className="ar-subtitle">Historial de promesas</h3><div className="table-scroll ar-mini-table-wrap"><table className="ar-mini-table"><thead><tr><th>Creada</th><th>Limite</th><th>Monto</th><th>Estado</th><th>Comentario</th></tr></thead><tbody>{paymentPromises.filter((promise) => promise.clientId === selectedDetailRow.id).slice(0, 10).map((promise) => <tr key={promise.id}><td>{formatDate(new Date(promise.createdAt))}</td><td>{formatDate(new Date(promise.dueAt))}</td><td>{formatCurrency(promise.amountPromised)}</td><td>{formatPromiseStatusLabel(promise.status)}</td><td>{promise.comment.trim() || "-"}</td></tr>)}</tbody></table></div></div><div className="modal-actions ar-detail-actions"><button type="button" className="button ghost" onClick={() => setSelectedDetailRow(null)}>Cerrar</button></div></div></div>}

      {promiseTargetRow && canManagePromises && <div className="modal-overlay"><div className="modal ar-detail-modal"><div className="modal-header"><h2>Registrar promesa - {promiseTargetRow.unitId}</h2><button type="button" className="modal-close" onClick={() => setPromiseTargetRow(null)}>X</button></div><div className="modal-body"><div className="form-grid"><label>Fecha<input type="date" value={promiseForm.date} onChange={(event) => setPromiseForm((current) => ({ ...current, date: event.target.value }))} /></label><label>Hora<input type="time" value={promiseForm.time} onChange={(event) => setPromiseForm((current) => ({ ...current, time: event.target.value }))} /></label><label>Monto prometido<input type="number" min="0" step="0.01" value={promiseForm.amountPromised} onChange={(event) => setPromiseForm((current) => ({ ...current, amountPromised: event.target.value }))} /></label><label>Comentarios<input type="text" value={promiseForm.comment} onChange={(event) => setPromiseForm((current) => ({ ...current, comment: event.target.value }))} /></label></div>{promiseError && <p className="hint error-text">{promiseError}</p>}</div><div className="modal-actions ar-detail-actions">{getPromiseForRow(promiseTargetRow) && <button type="button" className="button danger" onClick={() => cancelPromise(getPromiseForRow(promiseTargetRow)!.id)}>Cancelar promesa</button>}<button type="button" className="button primary" onClick={savePromise}>Guardar promesa</button><button type="button" className="button ghost" onClick={() => setPromiseTargetRow(null)}>Cerrar</button></div></div></div>}
    </>
  );
}
