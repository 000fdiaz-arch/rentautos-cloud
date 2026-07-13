import type { Dispatch, RefObject, SetStateAction } from "react";
import { formatCurrency } from "../../format";
import type { Client } from "../../types";
import type {
  NotifiedPayment,
  NotifiedPaymentForm,
  NotifiedSortField,
  SortDirection
} from "./paymentTypes";

type Props = {
  notifiedSectionRef: RefObject<HTMLElement>;
  isNotifiedOpen: boolean;
  notifiedForm: NotifiedPaymentForm;
  setNotifiedForm: Dispatch<SetStateAction<NotifiedPaymentForm>>;
  notifiedClientMatch?: Client;
  notifiedErrors: string[];
  handleAddNotifiedPayment: () => void;
  notifiedUntilNoonOnly: boolean;
  setNotifiedUntilNoonOnly: Dispatch<SetStateAction<boolean>>;
  notifiedRowsFiltered: NotifiedPayment[];
  handleSortNotified: (field: NotifiedSortField) => void;
  notifiedSortField: NotifiedSortField;
  notifiedSortDirection: SortDirection;
  clients: Client[];
  editingNotifiedId: string | null;
  editingNotifiedForm: NotifiedPaymentForm;
  setEditingNotifiedForm: Dispatch<SetStateAction<NotifiedPaymentForm>>;
  editingNotifiedClientMatch?: Client;
  handleSaveEditNotified: (row: NotifiedPayment) => void;
  handleCancelEditNotified: () => void;
  handleStartEditNotified: (row: NotifiedPayment) => void;
  handleDeleteNotifiedPayment: (id: string) => void;
};

export default function NotifiedPaymentsPanel({
  notifiedSectionRef,
  isNotifiedOpen,
  notifiedForm,
  setNotifiedForm,
  notifiedClientMatch,
  notifiedErrors,
  handleAddNotifiedPayment,
  notifiedUntilNoonOnly,
  setNotifiedUntilNoonOnly,
  notifiedRowsFiltered,
  handleSortNotified,
  notifiedSortField,
  notifiedSortDirection,
  clients,
  editingNotifiedId,
  editingNotifiedForm,
  setEditingNotifiedForm,
  editingNotifiedClientMatch,
  handleSaveEditNotified,
  handleCancelEditNotified,
  handleStartEditNotified,
  handleDeleteNotifiedPayment
}: Props) {
  return (
    <section id="payment-panel-notified" role="tabpanel" aria-labelledby="payment-tab-notified" ref={notifiedSectionRef} className="panel" style={{ display: isNotifiedOpen ? undefined : "none" }}>
            <div className="panel-head">
              <h2>Pagos notificados (pendientes)</h2>
            </div>

            {isNotifiedOpen && (
            <>
            <p className="hint">Ingresa la unidad y el monto. El sistema trae automaticamente el cliente.</p>

            <div className="payment-form-grid" style={{ marginTop: 12 }}>
              <div className="payment-field-group">
                <label className="payment-label">Unidad</label>
                <input
                  type="text"
                  className="payment-input"
                  placeholder="Ej. T01"
                  value={notifiedForm.unitId}
                  onChange={(e) => setNotifiedForm((f) => ({ ...f, unitId: e.target.value }))}
                />
              </div>

              <div className="payment-field-group">
                <label className="payment-label">Monto notificado (USD)</label>
                <input
                  type="number"
                  className="payment-input payment-input--amount"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={notifiedForm.amount}
                  onChange={(e) => setNotifiedForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>

            <div className="hint" style={{ marginTop: 6 }}>
              {notifiedForm.unitId.trim() === ""
                ? "Cliente detectado: -"
                : notifiedClientMatch
                  ? `Cliente detectado: ${notifiedClientMatch.unitId} - ${notifiedClientMatch.name}`
                  : "Cliente detectado: unidad no encontrada"}
            </div>

            {notifiedErrors.length > 0 && (
              <ul className="error-list">{notifiedErrors.map((e) => <li key={e}>{e}</li>)}</ul>
            )}

            <div style={{ marginTop: 14 }}>
              <button type="button" className="button primary" onClick={handleAddNotifiedPayment}>
                Guardar pago notificado
              </button>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={notifiedUntilNoonOnly}
                  onChange={(e) => setNotifiedUntilNoonOnly(e.target.checked)}
                />
                Solo registros hasta 12:00 PM
              </label>
            </div>

            {notifiedRowsFiltered.length === 0 ? (
              <p className="empty">No hay pagos notificados pendientes.</p>
            ) : (
              <div className="table-scroll" style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>
                        <button type="button" className="button ghost small" onClick={() => handleSortNotified("unit")}>
                          Unidad {notifiedSortField === "unit" ? (notifiedSortDirection === "desc" ? "v" : "^") : ""}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="button ghost small" onClick={() => handleSortNotified("client")}>
                          Cliente {notifiedSortField === "client" ? (notifiedSortDirection === "desc" ? "v" : "^") : ""}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="button ghost small" onClick={() => handleSortNotified("amount")}>
                          Monto {notifiedSortField === "amount" ? (notifiedSortDirection === "desc" ? "v" : "^") : ""}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="button ghost small" onClick={() => handleSortNotified("createdAt")}>
                          Hora {notifiedSortField === "createdAt" ? (notifiedSortDirection === "desc" ? "v" : "^") : ""}
                        </button>
                      </th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifiedRowsFiltered.map((row) => {
                      const client = clients.find((c) => c.id === row.clientId);
                      const isEditing = editingNotifiedId === row.id;
                      return (
                        <tr key={row.id}>
                          <td>
                            {isEditing ? (
                              <input
                                type="text"
                                className="payment-input"
                                value={editingNotifiedForm.unitId}
                                onChange={(e) => setEditingNotifiedForm((prev) => ({ ...prev, unitId: e.target.value }))}
                                placeholder="Unidad"
                                style={{ minWidth: 90 }}
                              />
                            ) : (
                              client?.unitId ?? "-"
                            )}
                          </td>
                          <td>
                            {isEditing
                              ? (editingNotifiedClientMatch?.name ?? "Cliente no encontrado")
                              : (client?.name ?? "Cliente no encontrado")}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                className="payment-input payment-input--amount"
                                min="0.01"
                                step="0.01"
                                value={editingNotifiedForm.amount}
                                onChange={(e) => setEditingNotifiedForm((prev) => ({ ...prev, amount: e.target.value }))}
                                style={{ minWidth: 100 }}
                              />
                            ) : (
                              <span className="amount-good">{formatCurrency(row.amount)}</span>
                            )}
                          </td>
                          <td>{new Date(row.createdAt).toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}</td>
                          <td className="actions-cell">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  className="button primary small"
                                  onClick={() => handleSaveEditNotified(row)}
                                >
                                  Guardar
                                </button>
                                <button
                                  type="button"
                                  className="button ghost small"
                                  onClick={handleCancelEditNotified}
                                >
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="button ghost small"
                                onClick={() => handleStartEditNotified(row)}
                              >
                                Editar
                              </button>
                            )}
                            <button
                              type="button"
                              className="button danger small"
                              onClick={() => handleDeleteNotifiedPayment(row.id)}
                            >
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </>
            )}
          </section>
  );
}
