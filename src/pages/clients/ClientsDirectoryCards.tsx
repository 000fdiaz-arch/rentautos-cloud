import type { KeyboardEvent } from "react";
import { toDateKey } from "../../billing";
import { formatCurrency, formatDate } from "../../format";
import { otherChargeDateKey } from "../../otherCharges";
import type { Client } from "../../types";
import { statusBadgeClass, statusLabel } from "../controlUnits/controlUnitsRules";
import type { FleetDetail } from "./ClientsDialogs";
import {
  FREQUENCY_LABEL,
  STATUS_EDIT_OPTIONS,
  STATUS_LABEL
} from "./clientConstants";
import { formatPaymentDateKey, operationalToneClass } from "./clientRules";
import type { ClientDirectoryRow } from "./clientTypes";

type Props = {
  rows: ClientDirectoryRow[];
  fleetDetailsByUnit: Record<string, FleetDetail>;
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
  readOnly: boolean;
};

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.currentTarget.blur();
}

export function ClientsDirectoryCards({
  rows,
  fleetDetailsByUnit,
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
  readOnly
}: Props) {
  if (rows.length === 0) {
    return <p className="empty client-directory-mobile">Aun no hay clientes con ese filtro.</p>;
  }

  return (
    <div className="client-directory-mobile client-directory-cards">
      {rows.map(({ client, unitId, assignmentKind, debtStartDate, nextChargeDate }) => {
        const vehicle = fleetDetailsByUnit[unitId];
        const fleetStatus = String(vehicle?.operational_status ?? "libre").trim().toLowerCase() || "libre";
        const isOrphanedProvisional = !client && fleetStatus === "provisional_rental";
        const isUnassignedUnitAvailable = !client && fleetStatus === "libre";
        const isProvisionalRow = assignmentKind === "provisional" && Boolean(client?.activeProvisionalRental);
        const provisionalRental = isProvisionalRow ? client?.activeProvisionalRental : undefined;
        const primaryUnitId = client?.unitId.trim().toUpperCase() ?? "";
        const activeProvisionalUnitId = client?.activeProvisionalRental?.unitId.trim().toUpperCase() ?? "";
        const rowKey = client
          ? `mobile-client-${client.id}-${assignmentKind ?? "unassigned"}-${unitId}`
          : `mobile-fleet-${unitId}`;
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
          <article key={rowKey} className={`client-directory-card${!client ? " clients-row--no-driver" : ""}`}>
            <header className="client-card-header">
              <div>
                <span className="client-card-eyebrow">Unidad</span>
                <strong className="clients-unit-id">{unitId}</strong>
              </div>
              {client ? (isProvisionalRow ? (
                <span className="badge badge-warning">Auto provisional/alquilado</span>
              ) : (
                <select
                  className={operationalToneClass(client.status)}
                  value={client.status}
                  onChange={(event) => onStatusChange(client, event.target.value as Client["status"])}
                  disabled={readOnly}
                  title={client.statusComment ? `Motivo: ${client.statusComment}` : undefined}
                  aria-label={`Estado de ${client.name}`}
                >
                  {STATUS_EDIT_OPTIONS.map((status) => (
                    <option key={status} value={status}>{STATUS_LABEL[status]}</option>
                  ))}
                </select>
              )) : (
                <span className={statusBadgeClass(fleetStatus)}>
                  {isOrphanedProvisional ? "Provisional sin cliente" : statusLabel(fleetStatus)}
                </span>
              )}
            </header>

            <div className="client-card-vehicle-meta">
              <span>{vehicle?.plate ? `Placa ${vehicle.plate}` : "Sin placa registrada"}</span>
              <span>{vehicle?.brand_model ?? "Sin modelo registrado"}</span>
            </div>

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

            {client ? (
              <>
                <section className="client-card-person">
                  <span className="client-card-eyebrow">Cliente</span>
                  <strong>{client.name}</strong>
                  <div className="client-card-meta-grid">
                    <span>Cedula: {client.cedula ?? "-"}</span>
                    <span>Primer cobro: {client.firstChargeDate ?? "-"}</span>
                  </div>
                </section>

                <section className="client-card-contract">
                  <div>
                    <span className="client-card-eyebrow">Contrato</span>
                    <strong>{formatCurrency(provisionalRental?.rentAmount ?? client.rentAmount)}</strong>
                  </div>
                  <span className={`badge ${(provisionalRental?.frequency ?? client.frequency) === "daily" ? "badge-good" : (provisionalRental?.frequency ?? client.frequency) === "weekly" ? "badge-warning" : (provisionalRental?.frequency ?? client.frequency) === "biweekly" ? "badge-debt" : "badge-good"}`}>
                    {FREQUENCY_LABEL[provisionalRental?.frequency ?? client.frequency]}
                  </span>
                  <small>{provisionalRental ? `Proximo cobro: ${provisionalRental.nextChargeDate ?? "-"}` : nextChargeLabel}</small>
                </section>

                <details className="client-card-details">
                  <summary>
                    <span>Ver y editar detalles</span>
                    <strong>
                      Saldo {formatCurrency(provisionalRental?.balance ?? client.balance)}
                      {!isProvisionalRow ? ` · ${client.installmentsPaid}/${client.installmentsAgreed} cuotas` : ""}
                    </strong>
                  </summary>
                  <section className="client-card-edit-grid">
                  {provisionalRental ? (
                    <div className="client-rental-balance client-card-field-span">
                      <span>Saldo provisional</span>
                      <strong>{formatCurrency(provisionalRental.balance)}</strong>
                      <small>Cuenta regular pausada</small>
                    </div>
                  ) : (
                    <label className="client-card-field">
                      <span>Saldo pendiente</span>
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
                  )}

                  {!isProvisionalRow && (
                    <>
                      <label className="client-card-field">
                        <span>Cuotas pagadas</span>
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
                      <label className="client-card-field">
                        <span>Cuotas pactadas</span>
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
                      <div className="client-card-installment-note">
                        Emitidas: {client.installmentsIssued ?? 0}{client.installmentsIssuedEstimateNeedsReview ? " (revisar)" : ""} · Restan: {client.installmentsRemaining}
                      </div>
                      <label className="client-card-field">
                        <span>Concepto de otro cargo</span>
                        <input
                          type="text"
                          defaultValue={firstOtherCharge?.label ?? ""}
                          placeholder="Ej. Mantenimiento"
                          data-mobile-client-charge-label={client.id}
                          readOnly={readOnly || Boolean(client.activeProvisionalRental)}
                          onBlur={(event) => {
                            const amountInput = event.currentTarget
                              .closest(".client-card-edit-grid")
                              ?.querySelector<HTMLInputElement>("input[data-mobile-client-charge-amount]");
                            onOtherChargesChange(client, event.currentTarget.value, amountInput?.value ?? "0");
                          }}
                          onKeyDown={blurOnEnter}
                        />
                      </label>
                      <label className="client-card-field">
                        <span>Monto de otros cargos</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={otherChargesTotal}
                          data-mobile-client-charge-amount={client.id}
                          readOnly={readOnly || Boolean(client.activeProvisionalRental)}
                          onBlur={(event) => {
                            const labelInput = event.currentTarget
                              .closest(".client-card-edit-grid")
                              ?.querySelector<HTMLInputElement>("input[data-mobile-client-charge-label]");
                            onOtherChargesChange(client, labelInput?.value ?? "", event.currentTarget.value);
                          }}
                          onKeyDown={blurOnEnter}
                        />
                      </label>
                      <div className="client-card-installment-note">
                        Cargo mas antiguo: {firstOtherCharge ? otherChargeDateKey(firstOtherCharge) || "sin fecha registrada" : "-"}
                      </div>
                    </>
                  )}
                  </section>
                </details>

                <footer className="client-card-actions">
                  <button type="button" className="button primary" onClick={() => onShowClient(client.id)}>Ver cliente</button>
                  <details className="client-card-actions-menu">
                    <summary>Más acciones</summary>
                    <div>
                      <button type="button" className="button ghost" onClick={() => onShowVehicle(unitId)}>Ver unidad</button>
                      {!readOnly && <>
                      <button type="button" className="button ghost" onClick={() => onEditClient(client)}>Editar</button>
                      <button type="button" className="button ghost" onClick={() => onOpenProvisionalRental(client)}>
                        {client.activeProvisionalRental ? "Ver alquiler" : "Unidad alquilada"}
                      </button>
                      <button type="button" className="button ghost client-card-unlink" onClick={() => onUnlinkClient(client)}>Desvincular</button>
                      </>}
                    </div>
                  </details>
                </footer>
              </>
            ) : (
              <>
                <section className="client-card-empty-client">
                  <strong>Sin cliente asignado</strong>
                  <span>
                    {isOrphanedProvisional
                      ? "Estado provisional sin cliente vinculado. Requiere revision."
                      : isUnassignedUnitAvailable
                        ? "Unidad disponible para asignacion."
                        : `Unidad sin cliente con estado ${statusLabel(fleetStatus)}.`}
                  </span>
                </section>
                <footer className="client-card-actions">
                  <button type="button" className="button ghost" onClick={() => onShowVehicle(unitId)}>Ver unidad</button>
                  {!readOnly && isUnassignedUnitAvailable && (
                    <button type="button" className="button primary" onClick={() => onCreateClientFromUnit(unitId)}>Crear cliente</button>
                  )}
                </footer>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
