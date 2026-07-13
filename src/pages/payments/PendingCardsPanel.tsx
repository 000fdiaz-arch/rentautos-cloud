import type { Dispatch, RefObject, SetStateAction } from "react";
import { formatCurrency } from "../../format";
import type { PendingCardItem } from "../../types";
import type { PendingCardEditForm } from "./paymentTypes";

type Props = {
  pendingCardSectionRef: RefObject<HTMLElement>;
  isCardPendingOpen: boolean;
  cardPendingMessage: string;
  pendingCardItems: PendingCardItem[];
  bulkPendingCardFolio: string;
  setBulkPendingCardFolio: Dispatch<SetStateAction<string>>;
  handleApplyFolioToAllPendingCards: () => void;
  editingPendingCardId: string | null;
  editingPendingCardForm: PendingCardEditForm;
  setEditingPendingCardForm: Dispatch<SetStateAction<PendingCardEditForm>>;
  handleSaveEditPendingCard: (item: PendingCardItem) => void;
  handleCancelEditPendingCard: () => void;
  handleGeneratePendingCardReceipt: (item: PendingCardItem) => void;
  handleStartEditPendingCard: (item: PendingCardItem) => void;
  handleRemovePendingCard: (id: string) => void;
};

export default function PendingCardsPanel({
  pendingCardSectionRef,
  isCardPendingOpen,
  cardPendingMessage,
  pendingCardItems,
  bulkPendingCardFolio,
  setBulkPendingCardFolio,
  handleApplyFolioToAllPendingCards,
  editingPendingCardId,
  editingPendingCardForm,
  setEditingPendingCardForm,
  handleSaveEditPendingCard,
  handleCancelEditPendingCard,
  handleGeneratePendingCardReceipt,
  handleStartEditPendingCard,
  handleRemovePendingCard
}: Props) {
  return (
    <section id="payment-panel-cards" role="tabpanel" aria-labelledby="payment-tab-cards" ref={pendingCardSectionRef} className="panel" style={{ display: isCardPendingOpen ? undefined : "none" }}>
            <div className="panel-head">
              <h2>Pendientes por folio (Tarjeta)</h2>
            </div>
            {isCardPendingOpen && (
              <>
                <p className="hint">Estos pagos ya fueron aplicados al cliente. Este panel es solo para conciliacion bancaria por lote/folio.</p>
                {cardPendingMessage && (
                  <p className={`hint ${cardPendingMessage.startsWith("No se") || cardPendingMessage.startsWith("Debes") ? "error-text" : "recon-info"}`}>
                    {cardPendingMessage}
                  </p>
                )}
                {pendingCardItems.length === 0 ? (
                  <p className="empty">No hay pagos de tarjeta pendientes.</p>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, marginBottom: 8 }}>
                      <input
                        type="text"
                        className="payment-input"
                        style={{ maxWidth: 280 }}
                        placeholder="Folio final del lote"
                        value={bulkPendingCardFolio}
                        onChange={(e) => setBulkPendingCardFolio(e.target.value)}
                      />
                      <button type="button" className="button primary small" onClick={handleApplyFolioToAllPendingCards}>
                        Aplicar folio a todos
                      </button>
                    </div>
                    <div className="table-scroll" style={{ marginTop: 10 }}>
                      <table>
                      <thead>
                        <tr>
                          <th>Folio</th>
                          <th>Fecha registro</th>
                          <th>Fecha esperada banco</th>
                          <th>Unidad</th>
                          <th>Cliente</th>
                          <th>Monto esperado</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingCardItems.map((item) => (
                          <tr key={item.id}>
                            <td>
                              {editingPendingCardId === item.id ? (
                                <input
                                  type="text"
                                  className="payment-input"
                                  value={editingPendingCardForm.folio}
                                  onChange={(e) => setEditingPendingCardForm((prev) => ({ ...prev, folio: e.target.value }))}
                                />
                              ) : (
                                <code>{item.folio}</code>
                              )}
                            </td>
                            <td>{item.dateRegistered}</td>
                            <td>{item.expectedSettlementDate}</td>
                            <td>{item.clientUnit}</td>
                            <td>{item.clientName}</td>
                            <td><strong>{formatCurrency(item.amountExpected)}</strong></td>
                            <td className="actions-cell">
                              {editingPendingCardId === item.id ? (
                                <>
                                  <input
                                    type="text"
                                    className="payment-input"
                                    placeholder="Referencia opcional"
                                    value={editingPendingCardForm.reference}
                                    onChange={(e) => setEditingPendingCardForm((prev) => ({ ...prev, reference: e.target.value }))}
                                    style={{ minWidth: 180 }}
                                  />
                                  <button type="button" className="button primary small" onClick={() => handleSaveEditPendingCard(item)}>
                                    Guardar
                                  </button>
                                  <button type="button" className="button ghost small" onClick={handleCancelEditPendingCard}>
                                    Cancelar
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" className="button primary small" onClick={() => handleGeneratePendingCardReceipt(item)}>
                                    Comprobante
                                  </button>
                                  <button type="button" className="button ghost small" onClick={() => handleStartEditPendingCard(item)}>
                                    Editar
                                  </button>
                                  <button type="button" className="button danger small" onClick={() => handleRemovePendingCard(item.id)}>
                                    Eliminar
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
  );
}
