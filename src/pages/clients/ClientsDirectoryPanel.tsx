import type { KeyboardEvent } from "react";
import { formatCurrency, formatDate } from "../../format";
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
  onUnlinkClient: (client: Client) => void;
  onCreateClientFromUnit: (unitId: string) => void;
  readOnly?: boolean;
};

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.currentTarget.blur();
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
  onUnlinkClient,
  onCreateClientFromUnit,
  readOnly = false
}: Props) {
  const visibleClientCount = rows.filter((row) => row.client !== null).length;

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
          <div className="clients-general-filters client-directory-filters" style={{ marginBottom: 12 }}>
            <select
              value={groupFilter}
              onChange={(event) => onGroupFilterChange(event.target.value as GeneralGroupFilterKey)}
              title="Filtrar por grupo"
            >
              <option value="ALL">Todos</option>
              <option value="T">Grupo T</option>
              <option value="A">Grupo A</option>
              <option value="B">Grupo B</option>
              <option value="C">Grupo C</option>
              <option value="D">Grupo D</option>
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
            <span className="clients-filter-count">
              {visibleClientCount} cliente{visibleClientCount === 1 ? "" : "s"} visible{visibleClientCount === 1 ? "" : "s"}
            </span>
            {(planFilter !== "ALL" || weeklyChargeDayFilter !== "ALL" || unitSearch || clientSearch) && (
              <button type="button" className="clients-filter-clear" onClick={onClearSearch}>
                Limpiar
              </button>
            )}
          </div>

          <div className="table-scroll client-directory-table-wrap">
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
                  rows.map(({ client, unitId, debtStartDate, nextChargeDate }) => {
                    const vehicle = fleetDetailsByUnit[unitId];
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
                      <tr key={client?.id ?? `fleet-${unitId}`} className={!client ? "clients-row--no-driver" : ""}>
                        <td>
                          <strong className="clients-unit-id">{unitId}</strong>
                          <div className="debt-meta">{vehicle?.plate ? `Placa ${vehicle.plate}` : "Sin placa registrada"}</div>
                          <div className="debt-meta">{vehicle?.brand_model ?? "Sin modelo registrado"}</div>
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
                              <div className="debt-meta">Unidad disponible para asignacion.</div>
                            </>
                          )}
                        </td>
                        <td>
                          {client ? (
                            <>
                              <strong>{formatCurrency(client.rentAmount)}</strong>
                              <span
                                className={`badge ${client.frequency === "daily" ? "badge-good" : client.frequency === "weekly" ? "badge-warning" : client.frequency === "biweekly" ? "badge-debt" : "badge-good"}`}
                                style={{ marginLeft: 8 }}
                              >
                                {FREQUENCY_LABEL[client.frequency]}
                              </span>
                              <div className="debt-meta">{nextChargeLabel}</div>
                            </>
                          ) : "-"}
                        </td>
                        <td>
                          {client ? (
                            <label className="client-inline-edit">
                              <span>Debe</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                defaultValue={client.balance}
                                readOnly={readOnly}
                                onBlur={(event) => onBalanceChange(client, event.currentTarget.value)}
                                onKeyDown={blurOnEnter}
                              />
                            </label>
                          ) : "-"}
                        </td>
                        <td>
                          {client ? (
                            <div className="client-inline-edit client-inline-edit--installments">
                              <label>
                                <span>Pagadas</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  defaultValue={client.installmentsPaid}
                                  readOnly={readOnly}
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
                                  readOnly={readOnly}
                                  onBlur={(event) => onInstallmentsChange(client, "agreed", event.currentTarget.value)}
                                  onKeyDown={blurOnEnter}
                                />
                              </label>
                              <small>Restan: {client.installmentsRemaining}</small>
                            </div>
                          ) : "-"}
                        </td>
                        <td>
                          {client ? (
                            <div className="client-inline-edit client-inline-edit--charges-column">
                              <label>
                                <span>Concepto</span>
                                <input
                                  type="text"
                                  defaultValue={firstOtherCharge?.label ?? ""}
                                  placeholder="Ej. Mant."
                                  data-client-charge-label={client.id}
                                  readOnly={readOnly}
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
                                  readOnly={readOnly}
                                  onBlur={(event) => {
                                    const labelInput = event.currentTarget
                                      .closest(".client-inline-edit")
                                      ?.querySelector<HTMLInputElement>("input[data-client-charge-label]");
                                    onOtherChargesChange(client, labelInput?.value ?? "", event.currentTarget.value);
                                  }}
                                  onKeyDown={blurOnEnter}
                                />
                              </label>
                            </div>
                          ) : "-"}
                        </td>
                        <td>
                          {client ? (
                            <select
                              className={operationalToneClass(client.status)}
                              value={client.status}
                              onChange={(event) => onStatusChange(client, event.target.value as Client["status"])}
                              disabled={readOnly}
                              title={client.statusComment ? `Motivo: ${client.statusComment}` : undefined}
                            >
                              {STATUS_EDIT_OPTIONS.map((status) => (
                                <option
                                  key={status}
                                  value={status}
                                  disabled={status === "cliente_enfermo" && client.frequency !== "daily"}
                                >
                                  {STATUS_LABEL[status]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="badge badge-warning">Libre</span>
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
                              !readOnly && (
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
        </>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 12 }}>
            Clientes sin unidad asignada o con unidad no registrada en flota. Estado aplicado: Inactivo.
          </p>
          <div className="table-scroll client-directory-table-wrap">
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
                  legacyClients.map((client) => (
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
        </>
      )}
    </section>
  );
}
