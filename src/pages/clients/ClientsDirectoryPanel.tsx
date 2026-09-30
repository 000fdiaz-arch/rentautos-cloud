import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { formatCurrency, formatDate } from "../../format";
import { otherChargeDateKey } from "../../otherCharges";
import type { Client } from "../../types";
import type { FleetDetail } from "./ClientsDialogs";
import {
  FREQUENCY_LABEL,
  FREQUENCY_OPTIONS,
  STATUS_EDIT_OPTIONS,
  STATUS_LABEL,
  WEEKLY_CHARGE_DAY_OPTIONS
} from "./clientConstants";
import { formatPaymentDateKey, operationalToneClass } from "./clientRules";
import type {
  ClientDirectoryRow,
  ClientsViewTab,
  ExportField,
  ExportFieldKey,
  GeneralGroupFilterKey,
  PlanFilterKey,
  WeeklyChargeDayFilterKey
} from "./clientTypes";
import { toDateKey } from "../../billing";
import { statusBadgeClass, statusLabel } from "../controlUnits/controlUnitsRules";
import { ClientsDirectoryCards } from "./ClientsDirectoryCards";

const DIRECTORY_PAGE_SIZE = 15;
const DIRECTORY_SORT_STORAGE_KEY = "rentautos-client-directory-sort";

type DirectorySortKey = "unit" | "client" | "balance" | "overdue";

function readStoredDirectorySort(): DirectorySortKey {
  if (typeof window === "undefined") return "unit";
  try {
    const stored = window.localStorage.getItem(DIRECTORY_SORT_STORAGE_KEY);
    return stored === "client" || stored === "balance" || stored === "overdue" ? stored : "unit";
  } catch {
    return "unit";
  }
}

type Props = {
  rows: ClientDirectoryRow[];
  legacyClients: Client[];
  fleetDetailsByUnit: Record<string, FleetDetail>;
  viewTab: ClientsViewTab;
  onViewTabChange: (tab: ClientsViewTab) => void;
  isExportOpen: boolean;
  exportFields: ExportField[];
  isExporting: boolean;
  exportError: string | null;
  exportRowCount: number;
  onToggleExport: () => void;
  onToggleExportField: (key: ExportFieldKey) => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
  groupFilter: GeneralGroupFilterKey;
  groupOptions: string[];
  planFilter: PlanFilterKey;
  weeklyChargeDayFilter: WeeklyChargeDayFilterKey;
  unitSearch: string;
  clientSearch: string;
  onGroupFilterChange: (filter: GeneralGroupFilterKey) => void;
  onPlanFilterChange: (filter: PlanFilterKey) => void;
  onWeeklyChargeDayFilterChange: (filter: WeeklyChargeDayFilterKey) => void;
  onUnitSearchChange: (value: string) => void;
  onClientSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onOpenNewClient: () => void;
  onBalanceChange: (client: Client, value: string) => void;
  onInstallmentsChange: (client: Client, field: "paid" | "agreed", value: string) => void;
  onOtherChargesChange: (client: Client, label: string, value: string) => void;
  onStatusChange: (client: Client, status: Client["status"]) => void;
  onShowVehicle: (unitId: string) => void;
  onShowClient: (clientId: string) => void;
  onEditClient: (client: Client) => void;
  onOpenProvisionalRental: (client: Client) => void;
  onUnlinkClient: (client: Client) => void;
  onCreateClientFromUnit: (unitId: string) => void;
  readOnly?: boolean;
};

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.currentTarget.blur();
}

function DirectoryPagination({
  page,
  totalPages,
  totalRows,
  onChange
}: {
  page: number;
  totalPages: number;
  totalRows: number;
  onChange: (page: number) => void;
}) {
  if (totalRows <= DIRECTORY_PAGE_SIZE) return null;

  const firstRow = (page - 1) * DIRECTORY_PAGE_SIZE + 1;
  const lastRow = Math.min(page * DIRECTORY_PAGE_SIZE, totalRows);

  return (
    <nav className="client-directory-pagination" aria-label="Paginacion de clientes">
      <span>{firstRow}-{lastRow} de {totalRows}</span>
      <div>
        <button
          type="button"
          className="button ghost small"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Anterior
        </button>
        <strong>Pagina {page} de {totalPages}</strong>
        <button
          type="button"
          className="button ghost small"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}

export function ClientsDirectoryPanel({
  rows,
  legacyClients,
  fleetDetailsByUnit,
  viewTab,
  onViewTabChange,
  isExportOpen,
  exportFields,
  isExporting,
  exportError,
  exportRowCount,
  onToggleExport,
  onToggleExportField,
  onExportExcel,
  onExportPdf,
  groupFilter,
  groupOptions,
  planFilter,
  weeklyChargeDayFilter,
  unitSearch,
  clientSearch,
  onGroupFilterChange,
  onPlanFilterChange,
  onWeeklyChargeDayFilterChange,
  onUnitSearchChange,
  onClientSearchChange,
  onClearSearch,
  onOpenNewClient,
  onBalanceChange,
  onInstallmentsChange,
  onOtherChargesChange,
  onStatusChange,
  onShowVehicle,
  onShowClient,
  onEditClient,
  onOpenProvisionalRental,
  onUnlinkClient,
  onCreateClientFromUnit,
  readOnly = false
}: Props) {
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<DirectorySortKey>(readStoredDirectorySort);
  const visibleClientCount = new Set(
    rows.flatMap((row) => row.client ? [row.client.id] : [])
  ).size;
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    if (sortBy === "client") {
      return (left.client?.name ?? "").localeCompare(right.client?.name ?? "", "es", { sensitivity: "base" });
    }
    if (sortBy === "balance") {
      const leftBalance = left.assignmentKind === "provisional"
        ? left.client?.activeProvisionalRental?.balance ?? 0
        : left.client?.balance ?? 0;
      const rightBalance = right.assignmentKind === "provisional"
        ? right.client?.activeProvisionalRental?.balance ?? 0
        : right.client?.balance ?? 0;
      return rightBalance - leftBalance;
    }
    if (sortBy === "overdue") {
      const leftDate = left.debtStartDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightDate = right.debtStartDate?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftDate - rightDate;
    }
    return left.unitId.localeCompare(right.unitId, "es", { numeric: true, sensitivity: "base" });
  }), [rows, sortBy]);
  const sortedLegacyClients = useMemo(() => [...legacyClients].sort((left, right) => (
    sortBy === "client"
      ? left.name.localeCompare(right.name, "es", { sensitivity: "base" })
      : left.unitId.localeCompare(right.unitId, "es", { numeric: true, sensitivity: "base" })
  )), [legacyClients, sortBy]);
  const activeRowCount = viewTab === "current" ? sortedRows.length : sortedLegacyClients.length;
  const totalPages = Math.max(1, Math.ceil(activeRowCount / DIRECTORY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * DIRECTORY_PAGE_SIZE;
  const pagedRows = sortedRows.slice(pageStart, pageStart + DIRECTORY_PAGE_SIZE);
  const pagedLegacyClients = sortedLegacyClients.slice(pageStart, pageStart + DIRECTORY_PAGE_SIZE);
  const activeFilterCount = [
    groupFilter !== "ALL",
    planFilter !== "ALL",
    planFilter === "weekly" && weeklyChargeDayFilter !== "ALL",
    Boolean(unitSearch.trim()),
    Boolean(clientSearch.trim())
  ].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;

  useEffect(() => {
    setPage(1);
  }, [viewTab, groupFilter, planFilter, weeklyChargeDayFilter, unitSearch, clientSearch]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DIRECTORY_SORT_STORAGE_KEY, sortBy);
    } catch {
      // The directory remains usable when storage is unavailable.
    }
    setPage(1);
  }, [sortBy]);

  function handlePageChange(nextPage: number): void {
    setPage(Math.max(1, Math.min(nextPage, totalPages)));
    window.requestAnimationFrame(() => {
      document.querySelector(".clients-luxury-page .panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Clientes</h2>
          <p className="hint">Consulta rapida de cliente, unidad asignada y datos del contrato.</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="button ghost" onClick={onToggleExport}>
            {isExportOpen ? "Cerrar exportacion" : "Exportar"}
          </button>
          {!readOnly && (
            <button type="button" className="button primary" onClick={onOpenNewClient}>
              Agregar cliente
            </button>
          )}
        </div>
      </div>

      <div className="cash-view-tabs" style={{ margin: "12px 0" }}>
        <button
          type="button"
          className={`button ghost small ${viewTab === "current" ? "cash-tab-active" : ""}`}
          onClick={() => onViewTabChange("current")}
        >
          Clientes
        </button>
        <button
          type="button"
          className={`button ghost small ${viewTab === "legacy" ? "cash-tab-active" : ""}`}
          onClick={() => onViewTabChange("legacy")}
        >
          Clientes archivados
        </button>
      </div>

      {isExportOpen && (
        <div className="export-panel">
          <p className="export-title">Selecciona las columnas a exportar:</p>
          <div className="export-fields">
            {exportFields.map((field) => (
              <label key={field.key} className="export-field-label">
                <input
                  type="checkbox"
                  checked={field.enabled}
                  onChange={() => onToggleExportField(field.key)}
                />
                {field.label}
              </label>
            ))}
          </div>
          <div className="export-actions">
            <button type="button" className="button primary" onClick={onExportExcel} disabled={isExporting}>
              {isExporting ? "Exportando..." : "Descargar Excel"}
            </button>
            <button type="button" className="button ghost" onClick={onExportPdf} disabled={isExporting}>
              Descargar PDF
            </button>
          </div>
          {exportError !== null && <p className="hint error-text">{exportError}</p>}
          <p className="hint">Se exportan los {exportRowCount} clientes visibles con los filtros actuales.</p>
        </div>
      )}

      {viewTab === "current" ? (
        <>
          <button
            type="button"
            className="client-directory-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="client-directory-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <span>Filtros y orden</span>
            <strong>{activeFilterCount > 0 ? `${activeFilterCount} activo${activeFilterCount === 1 ? "" : "s"}` : filtersOpen ? "Ocultar" : "Mostrar"}</strong>
          </button>
          <div
            id="client-directory-filters"
            className={`clients-general-filters client-directory-filters${filtersOpen ? " is-mobile-open" : ""}`}
          >
            <select
              value={groupFilter}
              onChange={(event) => onGroupFilterChange(event.target.value as GeneralGroupFilterKey)}
              title="Filtrar por grupo"
            >
              <option value="ALL">Todos</option>
              {groupOptions.map((group) => (
                <option key={group} value={group}>Grupo {group}</option>
              ))}
            </select>
            <select
              value={planFilter}
              onChange={(event) => onPlanFilterChange(event.target.value as PlanFilterKey)}
              title="Filtrar por tipo de plan"
            >
              <option value="ALL">Todos los planes</option>
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {planFilter === "weekly" && (
              <select
                value={weeklyChargeDayFilter}
                onChange={(event) => onWeeklyChargeDayFilterChange(event.target.value as WeeklyChargeDayFilterKey)}
                title="Filtrar por dia semanal"
              >
                <option value="ALL">Todos los dias</option>
                {WEEKLY_CHARGE_DAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
            <input
              type="search"
              value={unitSearch}
              onChange={(event) => onUnitSearchChange(event.target.value)}
              placeholder="Buscar unidad"
              aria-label="Buscar por numero de unidad"
            />
            <input
              type="search"
              value={clientSearch}
              onChange={(event) => onClientSearchChange(event.target.value)}
              placeholder="Buscar cliente"
              aria-label="Buscar por nombre del cliente"
            />
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as DirectorySortKey)}
              aria-label="Ordenar clientes"
              title="Ordenar clientes"
            >
              <option value="unit">Ordenar por unidad</option>
              <option value="client">Ordenar por cliente</option>
              <option value="balance">Mayor saldo primero</option>
              <option value="overdue">Mayor atraso primero</option>
            </select>
            <span className="clients-filter-count">
              {visibleClientCount} cliente{visibleClientCount === 1 ? "" : "s"} visible{visibleClientCount === 1 ? "" : "s"}
            </span>
            {hasActiveFilters && (
              <button type="button" className="clients-filter-clear" onClick={onClearSearch}>
                Limpiar
              </button>
            )}
          </div>

          <DirectoryPagination
            page={currentPage}
            totalPages={totalPages}
            totalRows={rows.length}
            onChange={handlePageChange}
          />

          <div className="table-scroll client-directory-table-wrap client-directory-desktop">
            <table className="client-directory-table">
              <colgroup>
                <col className="client-directory-col-unit" />
                <col className="client-directory-col-client" />
                <col className="client-directory-col-contract" />
                <col className="client-directory-col-balance" />
                <col className="client-directory-col-installments" />
                <col className="client-directory-col-charges" />
                <col className="client-directory-col-status" />
                <col className="client-directory-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Unidad</th>
                  <th>Cliente</th>
                  <th>Contrato</th>
                  <th>Saldo</th>
                  <th>Cuotas</th>
                  <th>Otros cargos</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty">Aun no hay clientes con ese filtro.</td>
                  </tr>
                ) : (
                  pagedRows.map(({ client, unitId, assignmentKind, debtStartDate, nextChargeDate }) => {
                    const vehicle = fleetDetailsByUnit[unitId];
                    const fleetStatus = String(vehicle?.operational_status ?? "libre").trim().toLowerCase() || "libre";
                    const isOrphanedProvisional = !client && fleetStatus === "provisional_rental";
                    const isUnassignedUnitAvailable = !client && fleetStatus === "libre";
                    const isProvisionalRow = assignmentKind === "provisional" && Boolean(client?.activeProvisionalRental);
                    const provisionalRental = isProvisionalRow ? client?.activeProvisionalRental : undefined;
                    const primaryUnitId = client?.unitId.trim().toUpperCase() ?? "";
                    const activeProvisionalUnitId = client?.activeProvisionalRental?.unitId.trim().toUpperCase() ?? "";
                    const rowKey = client
                      ? `client-${client.id}-${assignmentKind ?? "unassigned"}-${unitId}`
                      : `fleet-${unitId}`;
                    const otherChargesTotal = client
                      ? client.otherCharges.reduce((sum, charge) => sum + charge.amount, 0)
                      : 0;
                    const firstOtherCharge = client?.otherCharges[0];
                    const nextChargeLabel = client
                      ? debtStartDate
                        ? `Debe desde ${formatDate(debtStartDate)}`
                        : nextChargeDate
                          ? `Al dia hasta ${formatPaymentDateKey(toDateKey(nextChargeDate))}`
                          : "Al dia"
                      : "-";
                    return (
                      <tr key={rowKey} className={!client ? "clients-row--no-driver" : ""}>
                        <td>
                          <strong className="clients-unit-id">{unitId}</strong>
                          <div className="debt-meta">{vehicle?.plate ? `Placa ${vehicle.plate}` : "Sin placa registrada"}</div>
                          <div className="debt-meta">{vehicle?.brand_model ?? "Sin modelo registrado"}</div>
                          {isProvisionalRow && (
                            <div className="provisional-rental-row-badge">
                              <span>AUTO PROVISIONAL/ALQUILER DE AUTO</span>
                              <strong>Unidad principal: {primaryUnitId || "-"}</strong>
                            </div>
                          )}
                          {!isProvisionalRow && activeProvisionalUnitId && (
                            <div className="provisional-rental-link-badge">
                              <span>Provisional activo</span>
                              <strong>{activeProvisionalUnitId}</strong>
                            </div>
                          )}
                        </td>
                        <td>
                          {client ? (
                            <>
                              <strong>{client.name}</strong>
                              <div className="debt-meta">Cedula: {client.cedula ?? "-"}</div>
                              <div className="debt-meta">Primer cobro: {client.firstChargeDate ?? "-"}</div>
                            </>
                          ) : (
                            <>
                              <strong>Sin cliente asignado</strong>
                              <div className="debt-meta">
                                {isOrphanedProvisional
                                  ? "Estado provisional sin cliente vinculado. Requiere revision."
                                  : isUnassignedUnitAvailable
                                    ? "Unidad disponible para asignacion."
                                    : `Unidad sin cliente con estado ${statusLabel(fleetStatus)}.`}
                              </div>
                            </>
                          )}
                        </td>
                        <td>
                          {client ? (
                            <>
                              <strong>{formatCurrency(provisionalRental?.rentAmount ?? client.rentAmount)}</strong>
                              <span
                                className={`badge ${(provisionalRental?.frequency ?? client.frequency) === "daily" ? "badge-good" : (provisionalRental?.frequency ?? client.frequency) === "weekly" ? "badge-warning" : (provisionalRental?.frequency ?? client.frequency) === "biweekly" ? "badge-debt" : "badge-good"}`}
                                style={{ marginLeft: 8 }}
                              >
                                {FREQUENCY_LABEL[provisionalRental?.frequency ?? client.frequency]}
                              </span>
                              <div className="debt-meta">
                                {provisionalRental ? `Proximo cobro: ${provisionalRental.nextChargeDate ?? "-"}` : nextChargeLabel}
                              </div>
                            </>
                          ) : "-"}
                        </td>
                        <td>
                          {client ? (
                            provisionalRental ? (
                              <div className="client-rental-balance">
                                <span>Provisional</span>
                                <strong>{formatCurrency(provisionalRental.balance)}</strong>
                                <small>Cuenta regular pausada</small>
                              </div>
                            ) : <label className="client-inline-edit">
                              <span>Debe</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                defaultValue={client.balance}
                                readOnly={readOnly || Boolean(client.activeProvisionalRental)}
                                onBlur={(event) => onBalanceChange(client, event.currentTarget.value)}
                                onKeyDown={blurOnEnter}
                              />
                            </label>
                          ) : "-"}
                        </td>
                        <td>
                          {client ? (isProvisionalRow ? (
                            <span className="debt-meta">Cobros de alquiler</span>
                          ) : (
                            <div className="client-inline-edit client-inline-edit--installments">
                              <label>
                                <span>Pagadas</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  defaultValue={client.installmentsPaid}
                                  readOnly={readOnly || Boolean(client.activeProvisionalRental)}
                                  onBlur={(event) => onInstallmentsChange(client, "paid", event.currentTarget.value)}
                                  onKeyDown={blurOnEnter}
                                />
                              </label>
                              <label>
                                <span>Total</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  defaultValue={client.installmentsAgreed}
                                  readOnly={readOnly || Boolean(client.activeProvisionalRental)}
                                  onBlur={(event) => onInstallmentsChange(client, "agreed", event.currentTarget.value)}
                                  onKeyDown={blurOnEnter}
                                />
                              </label>
                              <small>Emitidas: {client.installmentsIssued ?? 0}{client.installmentsIssuedEstimateNeedsReview ? " (revisar)" : ""} · Restan: {client.installmentsRemaining}</small>
                            </div>
                          )) : "-"}
                        </td>
                        <td>
                          {client ? (isProvisionalRow ? "-" : (
                            <div className="client-inline-edit client-inline-edit--charges-column">
                              <label>
                                <span>Concepto</span>
                                <input
                                  type="text"
                                  defaultValue={firstOtherCharge?.label ?? ""}
                                  placeholder="Ej. Mant."
                                  data-client-charge-label={client.id}
                                  readOnly={readOnly || Boolean(client.activeProvisionalRental)}
                                  onBlur={(event) => {
                                    const amountInput = event.currentTarget
                                      .closest(".client-inline-edit")
                                      ?.querySelector<HTMLInputElement>("input[data-client-charge-amount]");
                                    onOtherChargesChange(client, event.currentTarget.value, amountInput?.value ?? "0");
                                  }}
                                  onKeyDown={blurOnEnter}
                                />
                              </label>
                              <label>
                                <span>Monto</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  defaultValue={otherChargesTotal}
                                  data-client-charge-amount={client.id}
                                  readOnly={readOnly || Boolean(client.activeProvisionalRental)}
                                  onBlur={(event) => {
                                    const labelInput = event.currentTarget
                                      .closest(".client-inline-edit")
                                      ?.querySelector<HTMLInputElement>("input[data-client-charge-label]");
                                    onOtherChargesChange(client, labelInput?.value ?? "", event.currentTarget.value);
                                  }}
                                  onKeyDown={blurOnEnter}
                                />
                              </label>
                              <small>Más antiguo: {firstOtherCharge ? otherChargeDateKey(firstOtherCharge) || "sin fecha registrada" : "-"}</small>
                            </div>
                          )) : "-"}
                        </td>
                        <td>
                          {client ? (isProvisionalRow ? (
                            <span className="badge badge-warning">Auto provisional/alquilado</span>
                          ) : (
                            <select
                              className={operationalToneClass(client.status)}
                              value={client.status}
                              onChange={(event) => onStatusChange(client, event.target.value as Client["status"])}
                              disabled={readOnly}
                              title={client.statusComment ? `Motivo: ${client.statusComment}` : undefined}
                            >
                              {STATUS_EDIT_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {STATUS_LABEL[status]}
                                </option>
                              ))}
                            </select>
                          )) : (
                            <span className={statusBadgeClass(fleetStatus)}>
                              {isOrphanedProvisional ? "Provisional sin cliente" : statusLabel(fleetStatus)}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="client-directory-actions">
                            <button type="button" className="button ghost small" onClick={() => onShowVehicle(unitId)}>
                              Ver unidad
                            </button>
                            {client ? (
                              <>
                                <button type="button" className="button ghost small" onClick={() => onShowClient(client.id)}>
                                  Ver cliente
                                </button>
                                {!readOnly && (
                                  <>
                                    <button type="button" className="button ghost small" onClick={() => onEditClient(client)}>
                                      Editar
                                    </button>
                                    <button type="button" className="button primary small" onClick={() => onOpenProvisionalRental(client)}>
                                      {client.activeProvisionalRental ? "Ver alquiler" : "Unidad alquilada"}
                                    </button>
                                    <button
                                      type="button"
                                      className="button ghost small"
                                      onClick={() => onUnlinkClient(client)}
                                      title="Desvincular cliente de esta unidad"
                                    >
                                      Desvincular
                                    </button>
                                  </>
                                )}
                              </>
                            ) : (
                              !readOnly && isUnassignedUnitAvailable && (
                                <button
                                  type="button"
                                  className="button primary small"
                                  onClick={() => onCreateClientFromUnit(unitId)}
                                >
                                  Crear Cliente
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <ClientsDirectoryCards
            rows={pagedRows}
            fleetDetailsByUnit={fleetDetailsByUnit}
            onBalanceChange={onBalanceChange}
            onInstallmentsChange={onInstallmentsChange}
            onOtherChargesChange={onOtherChargesChange}
            onStatusChange={onStatusChange}
            onShowVehicle={onShowVehicle}
            onShowClient={onShowClient}
            onEditClient={onEditClient}
            onOpenProvisionalRental={onOpenProvisionalRental}
            onUnlinkClient={onUnlinkClient}
            onCreateClientFromUnit={onCreateClientFromUnit}
            readOnly={readOnly}
          />
          <DirectoryPagination
            page={currentPage}
            totalPages={totalPages}
            totalRows={rows.length}
            onChange={handlePageChange}
          />
        </>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 12 }}>
            Clientes sin unidad asignada o con unidad no registrada en flota. Estado aplicado: Inactivo.
          </p>
          <DirectoryPagination
            page={currentPage}
            totalPages={totalPages}
            totalRows={legacyClients.length}
            onChange={handlePageChange}
          />
          <div className="table-scroll client-directory-table-wrap client-directory-desktop">
            <table className="client-directory-table client-directory-table--legacy">
              <colgroup>
                <col className="client-directory-col-client" />
                <col className="client-directory-col-status" />
                <col className="client-directory-col-unit" />
                <col className="client-directory-col-status" />
                <col className="client-directory-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Cedula</th>
                  <th>Unidad/ID</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {legacyClients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">No hay clientes archivados.</td>
                  </tr>
                ) : (
                  pagedLegacyClients.map((client) => (
                    <tr key={client.id}>
                      <td><strong>{client.name}</strong></td>
                      <td>{client.cedula ?? "-"}</td>
                      <td>{client.unitId?.trim() ? client.unitId : "-"}</td>
                      <td><span className="badge badge-warning">Inactivo</span></td>
                      <td>
                        <div className="client-directory-actions">
                          <button type="button" className="button ghost small" onClick={() => onShowClient(client.id)}>
                            Ver cliente
                          </button>
                          {!readOnly && (
                            <button type="button" className="button ghost small" onClick={() => onEditClient(client)}>
                              Editar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="client-directory-mobile client-legacy-cards">
            {pagedLegacyClients.length === 0 ? (
              <p className="empty">No hay clientes archivados.</p>
            ) : pagedLegacyClients.map((client) => (
              <article key={`legacy-mobile-${client.id}`} className="client-legacy-card">
                <div>
                  <span className="client-card-eyebrow">Cliente archivado</span>
                  <strong>{client.name}</strong>
                </div>
                <dl>
                  <div><dt>Cedula</dt><dd>{client.cedula ?? "-"}</dd></div>
                  <div><dt>Unidad/ID</dt><dd>{client.unitId?.trim() ? client.unitId : "-"}</dd></div>
                </dl>
                <span className="badge badge-warning">Inactivo</span>
                <div className="client-card-actions">
                  <button type="button" className="button ghost" onClick={() => onShowClient(client.id)}>Ver cliente</button>
                  {!readOnly && (
                    <button type="button" className="button ghost" onClick={() => onEditClient(client)}>Editar</button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <DirectoryPagination
            page={currentPage}
            totalPages={totalPages}
            totalRows={legacyClients.length}
            onChange={handlePageChange}
          />
        </>
      )}
    </section>
  );
}
