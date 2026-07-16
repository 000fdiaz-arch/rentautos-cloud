import type { Dispatch, RefObject, SetStateAction } from "react";
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
  handleCloseCashForDate: () => void;
  cashClosingInfo: string;
  cashClosingError: string;
  lastCloseReport: ChargeCloseReport | null;
  cashClosings: CashClosing[];
  cashClosingAudit: CashClosingAuditEvent[];
  chargeRuns: ChargeRun[];
  openReopenDialog: (date: string) => void;
};

export default function CashClosingPanel({
  cashSectionRef,
  isCashClosingOpen,
  cashClosingActor,
  setCashClosingActor,
  cashClosingDate,
  setCashClosingDate,
  handleCloseCashForDate,
  cashClosingInfo,
  cashClosingError,
  lastCloseReport,
  cashClosings,
  cashClosingAudit,
  chargeRuns,
  openReopenDialog
}: Props) {
  return (
    <section id="payment-panel-cash" role="tabpanel" aria-labelledby="payment-tab-cash" ref={cashSectionRef} className="panel" style={{ display: isCashClosingOpen ? undefined : "none" }}>
            <div className="panel-head">
              <h2>Cierre de caja</h2>
            </div>
            {isCashClosingOpen && (
            <>
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
                <label className="payment-label">Fecha a cerrar</label>
                <input
                  type="date"
                  className="payment-input"
                  value={cashClosingDate}
                  onChange={(e) => setCashClosingDate(e.target.value)}
                />
              </div>
              <div className="payment-field-group" style={{ display: "flex", alignItems: "flex-end" }}>
                <button type="button" className="button primary" onClick={handleCloseCashForDate}>
                  Cerrar caja del dia
                </button>
              </div>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              Al cerrar caja, no se podran crear ni eliminar pagos con esa fecha.
            </p>
            {cashClosingInfo && <p className="hint recon-info">{cashClosingInfo}</p>}
            {cashClosingError && <p className="hint error-text">{cashClosingError}</p>}
            {lastCloseReport && (
              <div className="panel" style={{ marginTop: 10, padding: 12 }}>
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
                          <button type="button" className="button danger small" onClick={() => openReopenDialog(c.date)}>
                            Reabrir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cashClosingAudit.length > 0 && (
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
            )}
            {chargeRuns.length > 0 && (
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
            )}
            </>
            )}
          </section>
  );
}
