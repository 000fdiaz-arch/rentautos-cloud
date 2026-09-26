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
  notifiedSavingId: string | null;
  handleAddNotifiedPayment: () => void;
  notifiedUntilNoonOnly: boolean;
  setNotifiedUntilNoonOnly: Dispatch<SetStateAction<boolean>>;
  notifiedRowsFiltered: NotifiedPayment[];
  routeReviewRows: NotifiedPayment[];
  routeReviewError: string;
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
  handleDeleteNotifiedPayment: (row: NotifiedPayment) => void;
};

export default function NotifiedPaymentsPanel({
  notifiedSectionRef,
  isNotifiedOpen,
  notifiedForm,
  setNotifiedForm,
  notifiedClientMatch,
  notifiedErrors,
  notifiedSavingId,
  handleAddNotifiedPayment,
  notifiedUntilNoonOnly,
  setNotifiedUntilNoonOnly,
  notifiedRowsFiltered,
  routeReviewRows,
  routeReviewError,
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
  const linkedReportIds = new Set(notifiedRowsFiltered.map((row) => row.routeReportId).filter(Boolean));
  const visibleRouteRows = routeReviewRows.filter((row) => {
    if (row.routeReportId && linkedReportIds.has(row.routeReportId)) return false;
    if (!notifiedUntilNoonOnly) return true;
    const createdAt = new Date(row.createdAt);
    return !Number.isNaN(createdAt.getTime()) && (
      createdAt.getHours() < 12 || (
        createdAt.getHours() === 12 && createdAt.getMinutes() === 0 && createdAt.getSeconds() === 0
      )
    );
  });
  const direction = notifiedSortDirection === "asc" ? 1 : -1;
  const rows = [...notifiedRowsFiltered, ...visibleRouteRows].sort((left, right) => {
    const getClient = (clientId: string) => clients.find((client) => client.id === clientId);
    if (notifiedSortField === "amount") {
      const comparison = (left.amount - right.amount) * direction;
      if (comparison !== 0) return comparison;
    } else if (notifiedSortField === "unit") {
      const comparison = (getClient(left.clientId)?.unitId ?? "").localeCompare(getClient(right.clientId)?.unitId ?? "") * direction;
      if (comparison !== 0) return comparison;
    } else if (notifiedSortField === "client") {
      const comparison = (getClient(left.clientId)?.name ?? "").localeCompare(getClient(right.clientId)?.name ?? "") * direction;
      if (comparison !== 0) return comparison;
    } else {
      const comparison = left.createdAt.localeCompare(right.createdAt) * direction;
      if (comparison !== 0) return comparison;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });

  return (
    <section id="payment-panel-notified" role="tabpanel" aria-labelledby="payment-tab-notified" ref={notifiedSectionRef} className="panel" style={{ display: isNotifiedOpen ? undefined : "none" }}>
            <div className="panel-head">
              <h2>Pagos notificados (pendientes)</h2>
            </div>

            {isNotifiedOpen && (
            <>
            <p className="hint">Ingresa la unidad y el monto. Si la unidad está activa en Ruta en calle, también aparecerá allí como Pago notificado.</p>

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
            {routeReviewError ? <p className="error-list">{routeReviewError}</p> : null}

            <div style={{ marginTop: 14 }}>
              <button type="button" className="button primary" disabled={notifiedSavingId === "new"} onClick={handleAddNotifiedPayment}>
                {notifiedSavingId === "new" ? "Guardando..." : "Guardar pago notificado"}
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

            {rows.length === 0 ? (
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
                      <th>Estado</th>
                      <th>Equipo</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const client = clients.find((c) => c.id === row.clientId);
                      const isEditing = editingNotifiedId === row.id;
                      const isRouteReview = Boolean(row.routeReportId);
                      const routeMethodLabel = row.routePaymentMethod === "cash"
                        ? "Efectivo"
                        : row.routePaymentMethod === "mixed" ? "Mixto" : "Banca";
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
                          <td>{isRouteReview ? `Pago notificado · ${routeMethodLabel}` : row.paymentMethod === "bank" ? "Por confirmar banca" : "Notificado"}</td>
                          <td>{row.routeAssignment || row.collectionTeam || "—"}</td>
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
                            ) : !isRouteReview ? (
                              <button
                                type="button"
                                className="button ghost small"
                                onClick={() => handleStartEditNotified(row)}
                              >
                                Editar
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="button danger small"
                              disabled={notifiedSavingId === row.id}
                              onClick={() => handleDeleteNotifiedPayment(row)}
                            >
                              {notifiedSavingId === row.id ? "Procesando..." : isRouteReview ? "Devolver" : "Eliminar"}
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
