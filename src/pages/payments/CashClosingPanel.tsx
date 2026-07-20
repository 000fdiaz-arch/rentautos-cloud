import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { formatCurrency, formatDate } from "../../format";
import { downloadChargeCloseReportCsv } from "./chargeCloseReport";
import type {
  CashClosing,
  CashClosingAuditEvent,
  ChargeCloseReport,
  ChargeRun
} from "./paymentTypes";

type Props = {
  cashSectionRef: RefObject<HTMLElement>;
  isCashClosingOpen: boolean;
  cashClosingActor: string;
  setCashClosingActor: Dispatch<SetStateAction<string>>;
  cashClosingDate: string;
  setCashClosingDate: Dispatch<SetStateAction<string>>;
  operationalDateKey: string;
  handleCloseCashForDate: () => void | Promise<void>;
  isClosingCash: boolean;
  cashClosingInfo: string;
  cashClosingError: string;
  lastCloseReport: ChargeCloseReport | null;
  cashClosings: CashClosing[];
  cashClosingAudit: CashClosingAuditEvent[];
  chargeRuns: ChargeRun[];
  openReopenDialog: (date: string) => void;
};

type CashPanelTab = "cierre" | "reporte" | "historial" | "auditoria" | "cargos";

export default function CashClosingPanel({
  cashSectionRef,
  isCashClosingOpen,
  cashClosingActor,
  setCashClosingActor,
  cashClosingDate,
  setCashClosingDate,
  operationalDateKey,
  handleCloseCashForDate,
  isClosingCash,
  cashClosingInfo,
  cashClosingError,
  lastCloseReport,
  cashClosings,
  cashClosingAudit,
  chargeRuns,
  openReopenDialog
}: Props) {
  const [activeCashTab, setActiveCashTab] = useState<CashPanelTab>("cierre");

  const cashTabs: Array<{ id: CashPanelTab; label: string; visible: boolean }> = [
    { id: "cierre", label: "Cierre", visible: true },
    { id: "reporte", label: "Reporte", visible: !!lastCloseReport },
    { id: "historial", label: "Historial", visible: cashClosings.length > 0 },
    { id: "auditoria", label: "Auditoria", visible: cashClosingAudit.length > 0 },
    { id: "cargos", label: "Cargos", visible: chargeRuns.length > 0 }
  ];

  return (
    <section id="payment-panel-cash" role="tabpanel" aria-labelledby="payment-tab-cash" ref={cashSectionRef} className="panel" style={{ display: isCashClosingOpen ? undefined : "none" }}>
            <div className="panel-head">
              <h2>Cierre de caja</h2>
            </div>
            {isCashClosingOpen && (
            <>
            <div className="cash-view-tabs" style={{ marginTop: 12 }}>
              {cashTabs
                .filter((tab) => tab.visible || tab.id === activeCashTab)
                .map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`button ghost small ${activeCashTab === tab.id ? "cash-tab-active" : ""}`}
                    onClick={() => setActiveCashTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
            </div>

            <div hidden={activeCashTab !== "cierre"}>
              <div className="payment-form-grid" style={{ marginTop: 12 }}>
                <div className="payment-field-group">
                  <label className="payment-label">Usuario</label>
                  <input
                    type="text"
                    className="payment-input"
                    placeholder="Ej. Admin Turno A"
                    value={cashClosingActor}
                    onChange={(e) => setCashClosingActor(e.target.value)}
                  />
                </div>
                <div className="payment-field-group">
                  <label className="payment-label">Fecha pendiente a cerrar</label>
                  <input
                    type="date"
                    className="payment-input"
                    value={cashClosingDate}
                    onChange={(e) => setCashClosingDate(e.target.value)}
                  />
                  {cashClosingDate !== operationalDateKey && (
                    <p className="hint" style={{ marginTop: 6 }}>
                      Hoy operativo: {operationalDateKey}. Hay dias pendientes antes de llegar a hoy.
                    </p>
                  )}
                </div>
                <div className="payment-field-group" style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void handleCloseCashForDate()}
                    disabled={isClosingCash}
                  >
                    {isClosingCash ? "Cerrando..." : "Cerrar caja del dia"}
                  </button>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                Al cerrar caja, se bloqueara esa fecha y se aplicaran cargos automaticos del dia siguiente tras confirmacion.
              </p>
              {cashClosingInfo && <p className="hint recon-info">{cashClosingInfo}</p>}
              {cashClosingError && <p className="hint error-text">{cashClosingError}</p>}
            </div>

            {lastCloseReport && (
              <div hidden={activeCashTab !== "reporte"} style={{ marginTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong>Reporte de cierre {lastCloseReport.closingDate} - cobro {lastCloseReport.targetDate}</strong>
                    <div className="hint">
                      Esperados: {lastCloseReport.expectedClients}. Cobrados: {lastCloseReport.chargedClients}. Anomalias: {lastCloseReport.anomalyClients}. Total: {formatCurrency(lastCloseReport.chargedTotal)}.
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => downloadChargeCloseReportCsv(lastCloseReport)}
                    >
                      Descargar reporte CSV
                    </button>
                  </div>
                </div>
                {lastCloseReport.anomalyClients > 0 && (
                  <div className="table-scroll" style={{ marginTop: 10 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Unidad</th>
                          <th>Cliente</th>
                          <th>Motivo</th>
                          <th>LastCharge antes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastCloseReport.rows
                          .filter((row) => row.anomaly)
                          .slice(0, 50)
                          .map((row) => (
                            <tr key={`anomaly-${row.clientId}`}>
                              <td>{row.unitId}</td>
                              <td>{row.name}</td>
                              <td>{row.reason}</td>
                              <td>{row.lastChargeDateBefore}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {cashClosings.length > 0 && (
              <div hidden={activeCashTab !== "historial"}>
                <div className="table-scroll" style={{ marginTop: 10 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha cerrada</th>
                        <th>Cerrado en</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashClosings.slice(0, 12).map((c) => (
                        <tr key={c.date}>
                          <td>{c.date}</td>
                          <td>{formatDate(new Date(c.closedAt))}</td>
                          <td className="actions-cell">
                            <button type="button" className="button danger small" onClick={() => openReopenDialog(c.date)} disabled={isClosingCash}>
                              Reabrir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {cashClosingAudit.length > 0 && (
              <div hidden={activeCashTab !== "auditoria"}>
                <div className="table-scroll" style={{ marginTop: 10 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha caja</th>
                        <th>Accion</th>
                        <th>Usuario</th>
                        <th>Registrado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashClosingAudit.slice(0, 15).map((event) => (
                        <tr key={event.id}>
                          <td>{event.date}</td>
                          <td>{event.action === "close" ? "Cierre" : "Reapertura"}</td>
                          <td>{event.actor}</td>
                          <td>{formatDate(new Date(event.createdAt))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {chargeRuns.length > 0 && (
              <div hidden={activeCashTab !== "cargos"}>
                <div className="table-scroll" style={{ marginTop: 10 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Cierre base</th>
                        <th>Fecha cobrada</th>
                        <th>Esperados</th>
                        <th>Clientes cargados</th>
                        <th>Anomalias</th>
                        <th>Total cargado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chargeRuns.slice(0, 15).map((run) => (
                        <tr key={run.id}>
                          <td>{run.closingDate}</td>
                          <td>{run.targetDate}</td>
                          <td>{run.expectedClients ?? run.chargedClients}</td>
                          <td>{run.chargedClients}</td>
                          <td>{run.anomalyClients ?? 0}</td>
                          <td>{formatCurrency(run.chargedTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            </>
            )}
          </section>
  );
}
