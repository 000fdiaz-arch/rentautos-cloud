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
import type { Client, Payment } from "../types";

type Props = {
  clients: Client[];
  payments: Payment[];
};

const STATE_FILTER_OPTIONS: Array<{ value: ReceivableState; label: string }> = [
  { value: "alDia", label: "Al dia" },
  { value: "proximo", label: "Proximo a vencer" },
  { value: "venceHoy", label: "Vence hoy" },
  { value: "vencido", label: "Vencido" },
  { value: "critico", label: "Moroso critico" }
];

type DashboardFilter = "none" | "totalPorCobrar" | "totalVencido" | "proximoAVencer" | "clientesMorosos" | "cobradoEsteMes";
type ExportFieldKey = "unitId" | "name" | "rentAmount" | "pendingSummary" | "lastPaymentDate" | "state";
type ExportField = { key: ExportFieldKey; label: string; enabled: boolean };

const INITIAL_EXPORT_FIELDS: ExportField[] = [
  { key: "unitId", label: "Unidad", enabled: true },
  { key: "name", label: "Nombre", enabled: true },
  { key: "rentAmount", label: "Letra", enabled: true },
  { key: "pendingSummary", label: "Cuentas pendiente", enabled: true },
  { key: "lastPaymentDate", label: "Ultima fecha de pago", enabled: true },
  { key: "state", label: "Estado", enabled: true }
];

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

function installmentText(value: number): string {
  return value === 1 ? "cuota" : "cuotas";
}

function pendingInstallmentsFromBalance(totalPending: number, rentAmount: number): number {
  if (totalPending <= 0) return 0;
  if (rentAmount <= 0) return 0;
  return Math.ceil(totalPending / rentAmount);
}

function pendingSummaryText(totalPending: number, rentAmount: number): string {
  const pendingInstallments = pendingInstallmentsFromBalance(totalPending, rentAmount);
  return `${formatCurrency(totalPending)} (${pendingInstallments} ${installmentText(pendingInstallments)})`;
}

export default function ReceivablesPage({ clients, payments }: Props) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [filters, setFilters] = useState<ReceivableFilters>(DEFAULT_RECEIVABLE_FILTERS);
  const [sortField, setSortField] = useState<ReceivableSortField>("unitId");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>("none");
  const [selectedDetailRow, setSelectedDetailRow] = useState<ReceivableRow | null>(null);
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
    if (clients.length === 0) {
      return createMockReceivableRows(now);
    }
    return buildReceivableRows(clients, payments, now);
  }, [clients, now, payments]);

  const filteredRows = useMemo(() => filterReceivableRows(baseRows, filters), [baseRows, filters]);
  const dashboardFilteredRows = useMemo(() => {
    if (dashboardFilter === "none") return filteredRows;
    if (dashboardFilter === "totalPorCobrar") {
      return filteredRows.filter((row) => row.totalPending > 0);
    }
    if (dashboardFilter === "totalVencido" || dashboardFilter === "clientesMorosos") {
      return filteredRows.filter((row) => row.state === "vencido" || row.state === "critico");
    }
    if (dashboardFilter === "proximoAVencer") {
      return filteredRows.filter((row) => row.state === "proximo" || row.state === "venceHoy");
    }
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    return filteredRows.filter((row) => {
      if (!row.lastPaymentDate) return false;
      const parsed = new Date(`${row.lastPaymentDate}T12:00:00`);
      return parsed.getFullYear() === currentYear && parsed.getMonth() === currentMonth;
    });
  }, [dashboardFilter, filteredRows, now]);

  const rows = useMemo(() => sortReceivableRows(dashboardFilteredRows, sortField, sortDirection), [dashboardFilteredRows, sortDirection, sortField]);

  const summary = useMemo(() => computeReceivableSummary(filteredRows, payments, now), [filteredRows, now, payments]);
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.clientSearch.trim()) count += 1;
    if (filters.unitSearch.trim()) count += 1;
    if (filters.cedulaSearch.trim()) count += 1;
    if (filters.state.length > 0) count += 1;
    if (filters.group !== "all") count += 1;
    if (filters.plan !== "all") count += 1;
    if (filters.dateFrom) count += 1;
    if (filters.dateTo) count += 1;
    return count;
  }, [filters]);

  useEffect(() => {
    if (topScrollInnerRef.current && tableScrollRef.current) {
      topScrollInnerRef.current.style.width = `${tableScrollRef.current.scrollWidth}px`;
    }
  }, [rows]);

  function handleTopScroll() {
    if (tableScrollRef.current && topScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  }

  function handleTableScroll() {
    if (topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  }

  function updateFilter<K extends keyof ReceivableFilters>(key: K, value: ReceivableFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleStateFilter(state: ReceivableState) {
    setFilters((current) => {
      const exists = current.state.includes(state);
      return {
        ...current,
        state: exists
          ? current.state.filter((value) => value !== state)
          : [...current.state, state]
      };
    });
  }

  function clearFilters() {
    setFilters(DEFAULT_RECEIVABLE_FILTERS);
    setDashboardFilter("none");
  }

  function handleSort(field: ReceivableSortField) {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  }

  function toExportBody(currentRows: ReceivableRow[]): (string | number)[][] {
    const enabledFields = exportFields.filter((field) => field.enabled);
    return currentRows.map((row) =>
      enabledFields.map((field) => {
        if (field.key === "unitId") return row.unitId;
        if (field.key === "name") return row.name;
        if (field.key === "rentAmount") return row.rentAmount;
        if (field.key === "pendingSummary") return pendingSummaryText(row.totalPending, row.rentAmount);
        if (field.key === "lastPaymentDate") return row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : "-";
        return STATE_LABEL[row.state];
      })
    );
  }

  function getExportHeaders(): string[] {
    return exportFields.filter((field) => field.enabled).map((field) => field.label);
  }

  async function handleExportExcel() {
    const headers = getExportHeaders();
    if (headers.length === 0) {
      setExportError("Selecciona al menos una columna para exportar.");
      return;
    }
    setIsExporting(true);
    setExportError(null);
    try {
      await exportReceivablesToExcel(
        headers,
        toExportBody(rows),
        now
      );
    } catch {
      setExportError("No se pudo exportar el archivo Excel.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportPdf() {
    const headers = getExportHeaders();
    if (headers.length === 0) {
      setExportError("Selecciona al menos una columna para exportar.");
      return;
    }
    setIsExporting(true);
    setExportError(null);
    try {
      await exportReceivablesToPdf(
        headers,
        toExportBody(rows),
        now
      );
    } catch {
      setExportError("No se pudo exportar el archivo PDF.");
    } finally {
      setIsExporting(false);
    }
  }

  function handleDashboardFilterClick(nextFilter: DashboardFilter) {
    if (dashboardFilter === nextFilter) {
      setDashboardFilter("none");
      return;
    }
    setDashboardFilter(nextFilter);
  }

  const dashboardFilterLabel = useMemo(() => {
    if (dashboardFilter === "totalPorCobrar") return "Total por cobrar";
    if (dashboardFilter === "totalVencido") return "Vencido + critico";
    if (dashboardFilter === "proximoAVencer") return "Proximo a vencer (incluye hoy)";
    if (dashboardFilter === "clientesMorosos") return "Clientes morosos";
    if (dashboardFilter === "cobradoEsteMes") return "Cobrado este mes";
    return "";
  }, [dashboardFilter]);
  const dashboardFilterDescription = useMemo(() => {
    if (dashboardFilter === "totalPorCobrar") return "Muestra clientes con saldo pendiente mayor a 0.";
    if (dashboardFilter === "totalVencido") return "Muestra clientes en vencido y moroso critico.";
    if (dashboardFilter === "proximoAVencer") return "Muestra proximos a vencer e incluye vencimientos de hoy.";
    if (dashboardFilter === "clientesMorosos") return "Muestra clientes en estado vencido o moroso critico.";
    if (dashboardFilter === "cobradoEsteMes") return "Muestra clientes con ultimo pago registrado durante este mes.";
    return "";
  }, [dashboardFilter]);

  return (
    <>
      <section className="hero ar-hero">
        <div>
          <h1>Cuentas por Cobrar</h1>
          <p>Control de saldos vencidos, proximos a vencer y pagos pendientes.</p>
        </div>
      </section>

      <section className="summary-grid ar-summary-grid">
        <button type="button" className={`summary-card summary-card--interactive ${dashboardFilter === "totalPorCobrar" ? "summary-card--selected" : ""}`} onClick={() => handleDashboardFilterClick("totalPorCobrar")}>
          <span>Total por cobrar</span>
          <strong>{formatCurrency(summary.totalPorCobrar)}</strong>
        </button>
        <button type="button" className={`summary-card summary-card--interactive ar-summary-card--debt ${dashboardFilter === "totalVencido" ? "summary-card--selected" : ""}`} onClick={() => handleDashboardFilterClick("totalVencido")}>
          <span>Vencido + critico</span>
          <strong>{formatCurrency(summary.totalVencido)}</strong>
        </button>
        <button type="button" className={`summary-card summary-card--interactive ar-summary-card--warn ${dashboardFilter === "proximoAVencer" ? "summary-card--selected" : ""}`} onClick={() => handleDashboardFilterClick("proximoAVencer")}>
          <span>Proximo a vencer (incluye hoy)</span>
          <strong>{formatCurrency(summary.proximoAVencer)}</strong>
        </button>
        <button type="button" className={`summary-card summary-card--interactive ar-summary-card--neutral ${dashboardFilter === "clientesMorosos" ? "summary-card--selected" : ""}`} onClick={() => handleDashboardFilterClick("clientesMorosos")}>
          <span>Clientes morosos</span>
          <strong>{summary.clientesMorosos}</strong>
        </button>
      </section>
      <section className="ar-secondary-metric-row">
        <button type="button" className={`ar-secondary-metric ${dashboardFilter === "cobradoEsteMes" ? "ar-secondary-metric--active" : ""}`} onClick={() => handleDashboardFilterClick("cobradoEsteMes")}>
          <span>Cobrado este mes</span>
          <strong>{formatCurrency(summary.cobradoEsteMes)}</strong>
        </button>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Filtros</h2>
          <div className="ar-filter-actions">
            {activeFiltersCount > 0 && <span className="ar-filter-count">{activeFiltersCount} activo(s)</span>}
            <button type="button" className="button ghost small" onClick={clearFilters}>Limpiar filtros</button>
          </div>
        </div>
        {dashboardFilter !== "none" && (
          <div className="ar-quick-filter-banner">
            <div className="ar-quick-filter-content">
              <span className="ar-quick-filter-badge">Origen: Dashboard</span>
              <strong className="ar-quick-filter-title">Filtro rapido activo: {dashboardFilterLabel}</strong>
              <span className="ar-quick-filter-subtitle">{dashboardFilterDescription}</span>
            </div>
            <button type="button" className="button ghost small" onClick={() => setDashboardFilter("none")}>
              Quitar filtro rapido
            </button>
          </div>
        )}
        <div className="ar-filters-grid">
          <div className="ar-filter-field">
            <span className="ar-filter-label">Buscar cliente</span>
            <input
              type="text"
              placeholder="Nombre del cliente"
              value={filters.clientSearch}
              onChange={(event) => updateFilter("clientSearch", event.target.value)}
            />
          </div>
          <div className="ar-filter-field">
            <span className="ar-filter-label">Buscar unidad</span>
            <input
              type="text"
              placeholder="Ej. A-101"
              value={filters.unitSearch}
              onChange={(event) => updateFilter("unitSearch", event.target.value)}
            />
          </div>
          <div className="ar-filter-field">
            <span className="ar-filter-label">Buscar cedula</span>
            <input
              type="text"
              placeholder="Cedula"
              value={filters.cedulaSearch}
              onChange={(event) => updateFilter("cedulaSearch", event.target.value)}
            />
          </div>
          <div className="ar-filter-field ar-filter-field--states">
            <span className="ar-filter-label">Estado</span>
            <div className="ar-state-chips">
              <button
                type="button"
                className={`ar-state-chip ${filters.state.length === 0 ? "ar-state-chip--active" : ""}`}
                onClick={() => updateFilter("state", [])}
                aria-pressed={filters.state.length === 0}
              >
                Todos
              </button>
              {STATE_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`ar-state-chip ${filters.state.includes(option.value) ? "ar-state-chip--active" : ""}`}
                  onClick={() => toggleStateFilter(option.value)}
                  aria-pressed={filters.state.includes(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ar-filter-field">
            <span className="ar-filter-label">Grupo</span>
            <select value={filters.group} onChange={(event) => updateFilter("group", event.target.value as ReceivableFilters["group"])}>
              <option value="all">Todos</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
              <option value="T">T</option>
            </select>
          </div>
          <div className="ar-filter-field">
            <span className="ar-filter-label">Tipo de plan</span>
            <select value={filters.plan} onChange={(event) => updateFilter("plan", event.target.value as ReceivableFilters["plan"])}>
              <option value="all">Todos</option>
              <option value="daily">Diario</option>
              <option value="weekly">Semanal</option>
              <option value="biweekly">Quincenal</option>
              <option value="monthly">Mensual</option>
            </select>
          </div>
          <div className="ar-filter-field">
            <span className="ar-filter-label">Fecha desde</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => updateFilter("dateFrom", event.target.value)}
            />
          </div>
          <div className="ar-filter-field">
            <span className="ar-filter-label">Fecha hasta</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => updateFilter("dateTo", event.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Cartera de clientes</h2>
          <div className="ar-filter-actions">
            <button type="button" className="button ghost small" onClick={() => setIsExportConfigOpen((open) => !open)}>
              {isExportConfigOpen ? "Cerrar campos" : "Campos exportables"}
            </button>
            <button type="button" className="button primary small" onClick={handleExportExcel} disabled={isExporting}>
              {isExporting ? "Exportando..." : "Exportar Excel"}
            </button>
            <button type="button" className="button ghost small" onClick={handleExportPdf} disabled={isExporting}>
              Exportar PDF
            </button>
            <span className="hint">Mostrando {rows.length} registro(s)</span>
          </div>
        </div>
        {isExportConfigOpen && (
          <div className="export-panel">
            <p className="export-title">Selecciona las columnas a exportar</p>
            <div className="export-fields">
              {exportFields.map((field) => (
                <label key={field.key} className="export-field-label">
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    onChange={() =>
                      setExportFields((current) =>
                        current.map((item) => (item.key === field.key ? { ...item, enabled: !item.enabled } : item))
                      )
                    }
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>
        )}
        {exportError && <p className="hint error-text">{exportError}</p>}

        {rows.length === 0 ? (
          <p className="empty">No hay resultados para los filtros seleccionados.</p>
        ) : (
          <>
            <div className="top-scroll" ref={topScrollRef} onScroll={handleTopScroll}>
              <div ref={topScrollInnerRef} className="top-scroll-inner" />
            </div>
            <div className="table-scroll" ref={tableScrollRef} onScroll={handleTableScroll}>
              <table className="ar-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="sort-button" onClick={() => handleSort("unitId")}>
                        Unidad
                        <span className={`sort-icon ${sortField === "unitId" ? "active" : ""}`}>{renderSortIcon(sortField === "unitId", sortDirection)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-button" onClick={() => handleSort("rentAmount")}>
                        Letra
                        <span className={`sort-icon ${sortField === "rentAmount" ? "active" : ""}`}>{renderSortIcon(sortField === "rentAmount", sortDirection)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-button" onClick={() => handleSort("totalPending")}>
                        Cuentas pendiente
                        <span className={`sort-icon ${sortField === "totalPending" ? "active" : ""}`}>{renderSortIcon(sortField === "totalPending", sortDirection)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-button" onClick={() => handleSort("lastPaymentDate")}>
                        Ultima fecha de pago
                        <span className={`sort-icon ${sortField === "lastPaymentDate" ? "active" : ""}`}>{renderSortIcon(sortField === "lastPaymentDate", sortDirection)}</span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sort-button" onClick={() => handleSort("state")}>
                        Estado
                        <span className={`sort-icon ${sortField === "state" ? "active" : ""}`}>{renderSortIcon(sortField === "state", sortDirection)}</span>
                      </button>
                    </th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.unitId}</strong></td>
                      <td>
                        <strong className={row.rentAmount > 0 ? "amount-debt" : "amount-good"}>{formatCurrency(row.rentAmount)}</strong>
                      </td>
                      <td>
                        <span className="client-name">{pendingSummaryText(row.totalPending, row.rentAmount)}</span>
                        <span className="debt-meta">{row.name}</span>
                      </td>
                      <td>
                        {row.lastPaymentDate ? (
                          formatDate(new Date(`${row.lastPaymentDate}T12:00:00`))
                        ) : (
                          <span className="amount-muted">Sin pagos</span>
                        )}
                      </td>
                      <td><span className={stateToneClass(row.state)}>{STATE_LABEL[row.state]}</span></td>
                      <td className="actions-cell ar-actions-cell">
                        <button type="button" className="button ghost small" onClick={() => setSelectedDetailRow(row)}>Ver detalle</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {selectedDetailRow && (
        <div className="modal-overlay">
          <div className="modal ar-detail-modal">
            <div className="modal-header">
              <h2>Detalle de cuenta - {selectedDetailRow.unitId}</h2>
              <button type="button" className="modal-close" onClick={() => setSelectedDetailRow(null)}>X</button>
            </div>
            <div className="modal-body">
              <div className="ar-detail-grid">
                <div>
                  <span className="hint">Cliente</span>
                  <p><strong>{selectedDetailRow.name}</strong></p>
                </div>
                <div>
                  <span className="hint">Cedula</span>
                  <p>{selectedDetailRow.cedula}</p>
                </div>
                <div>
                  <span className="hint">Unidad</span>
                  <p>{selectedDetailRow.unitId}</p>
                </div>
                <div>
                  <span className="hint">Grupo</span>
                  <p>{selectedDetailRow.group || "-"}</p>
                </div>
                <div>
                  <span className="hint">Datos contrato</span>
                  <p>{PLAN_LABEL[selectedDetailRow.plan]} | Total contrato: {formatCurrency(selectedDetailRow.contractTotal)}</p>
                </div>
                <div>
                  <span className="hint">Proxima fecha pago</span>
                  <p>{selectedDetailRow.nextDueDate ? formatDate(new Date(`${selectedDetailRow.nextDueDate}T12:00:00`)) : "-"}</p>
                </div>
                <div>
                  <span className="hint">Saldo vencido</span>
                  <p className="amount-debt">{formatCurrency(selectedDetailRow.overdueBalance)}</p>
                </div>
                <div>
                  <span className="hint">Total pendiente</span>
                  <p className="amount-debt">{formatCurrency(selectedDetailRow.totalPending)}</p>
                </div>
                <div>
                  <span className="hint">Cuotas vencidas</span>
                  <p>{selectedDetailRow.overdueInstallments}</p>
                </div>
                <div>
                  <span className="hint">Otros cargos</span>
                  <p>{formatCurrency(selectedDetailRow.totalOtherCharges)}</p>
                </div>
                <div>
                  <span className="hint">% pagado</span>
                  <p>{selectedDetailRow.percentPaid}%</p>
                </div>
              </div>

              <h3 className="ar-subtitle">Ultimos pagos</h3>
              {selectedDetailRow.recentPayments.length === 0 ? (
                <p className="hint">Sin pagos registrados.</p>
              ) : (
                <div className="table-scroll ar-mini-table-wrap">
                  <table className="ar-mini-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Monto</th>
                        <th>A renta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDetailRow.recentPayments.map((payment) => (
                        <tr key={payment.id}>
                          <td>{formatDate(new Date(`${payment.dateApplied}T12:00:00`))}</td>
                          <td>{formatCurrency(payment.amountReceived)}</td>
                          <td>{formatCurrency(payment.appliedToRent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-actions ar-detail-actions">
              <button type="button" className="button ghost" onClick={() => setSelectedDetailRow(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
