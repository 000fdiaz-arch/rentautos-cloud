import { memo, type RefObject } from "react";
import { formatCurrency, formatDate } from "../../format";
import { STATE_LABEL, type ReceivableRow, type ReceivableState } from "../../receivables";
import type { Client } from "../../types";
import type { CollectionStatus, CollectionStatusRecord } from "./receivablesTypes";
import { ReceivableTableRow } from "./ReceivableTableRow";
import {
  COLLECTION_CUT_OPTIONS,
  COLLECTION_STATUS_OPTIONS,
  stateToneClass,
  type CollectionClosureItem,
  type CollectionCutKey,
  type ReceivablesViewMode
} from "./receivablesPageRules";

export type ReceivablesHistoryRow = {
  clientId: string;
  unitId: string;
  clientName: string;
  lastPaymentDate: string | null;
  receivableState: string;
  totalPending: number;
  cuts: Partial<Record<CollectionCutKey, CollectionClosureItem>>;
};

type Props = {
  tableScrollRef: RefObject<HTMLDivElement>;
  viewMode: ReceivablesViewMode;
  selectedHistoryDate: string;
  selectedHistoryRows: ReceivablesHistoryRow[];
  rows: ReceivableRow[];
  collectionStatusByClient: Record<string, CollectionStatusRecord>;
  clientStatusById: Map<string, Client["status"]>;
  todayDateKey: string;
  now: Date;
  isTodayCollectionClosed: boolean;
  todayCollectionCuts: Partial<Record<CollectionCutKey, { items: CollectionClosureItem[] }>>;
  visibleCollectionCut: CollectionCutKey | "all";
  buildWhatsAppReceivableMessage: (row: ReceivableRow) => string;
  onSelectDetail: (row: ReceivableRow) => void;
  onCollectionCutStatusChange: (cutKey: CollectionCutKey, clientId: string, nextStatus: string) => void;
  onCollectionCutCommentChange: (cutKey: CollectionCutKey, clientId: string, value: string) => void;
  onWhatsAppMessageCopied: (clientId: string, message: string) => void;
  onWhatsAppMessageSent: (clientId: string, message: string) => void;
  onEditWhatsAppPhone: (clientId: string) => void;
  onSupportNoteChange: (clientId: string, value: string) => void;
};

function getCutItemsForClient(
  cuts: Partial<Record<CollectionCutKey, { items: CollectionClosureItem[] }>>,
  clientId: string
): Partial<Record<CollectionCutKey, CollectionClosureItem>> {
  const cutItems: Partial<Record<CollectionCutKey, CollectionClosureItem>> = {};
  for (const option of COLLECTION_CUT_OPTIONS) {
    const item = cuts[option.key]?.items.find((cutItem) => cutItem.clientId === clientId);
    if (item) cutItems[option.key] = item;
  }
  return cutItems;
}

function renderCutStatusCell(item: CollectionClosureItem | undefined) {
  if (!item) return <span className="ar-cut-empty">Sin corte</span>;
  const label = COLLECTION_STATUS_OPTIONS.find((option) => option.value === item.collectionStatus)?.label ?? "Sin estado";
  return (
    <div className="ar-cut-cell-content">
      <span className={`ar-cut-status ar-cut-status--${item.collectionStatus}`}>{label}</span>
      {item.comment ? <span className="hint ar-cut-comment">Comentario: {item.comment}</span> : null}
      <div className="ar-cut-actions">
        {item.whatsAppMessageSentAt ? <span>WhatsApp enviado</span> : item.whatsAppMessageCopiedAt ? <span>WhatsApp abierto</span> : null}
        {item.managementAmount ? (
          <span>
            Ruta {formatCurrency(item.managementAmount)}
            {item.managementType === "cobrar_o_quitar" ? " / quitar" : ""}
          </span>
        ) : null}
        {item.managementComment ? <span>{item.managementComment}</span> : null}
      </div>
    </div>
  );
}

function renderHistoryCutStack(item: CollectionClosureItem | undefined, cutKey: CollectionCutKey) {
  return (
    <div className={`ar-cut-stack-row ar-cut-stack-row--${cutKey}`}>
      <span className="ar-cut-stack-label">
        {cutKey === "morning" ? "AM" : cutKey === "afternoon" ? "PM" : "CIERRE"}
      </span>
      {renderCutStatusCell(item)}
    </div>
  );
}

export const ReceivablesLedgerTable = memo(function ReceivablesLedgerTable({
  tableScrollRef,
  viewMode,
  selectedHistoryDate,
  selectedHistoryRows,
  rows,
  collectionStatusByClient,
  clientStatusById,
  todayDateKey,
  now,
  isTodayCollectionClosed,
  todayCollectionCuts,
  visibleCollectionCut,
  buildWhatsAppReceivableMessage,
  onSelectDetail,
  onCollectionCutStatusChange,
  onCollectionCutCommentChange,
  onWhatsAppMessageCopied,
  onWhatsAppMessageSent,
  onEditWhatsAppPhone,
  onSupportNoteChange
}: Props) {
  return (
    <div className="table-scroll ar-ledger-scroll" ref={tableScrollRef}>
      <table className="ar-table ar-table--compact">
        <tbody>
          {viewMode === "historial" ? (
            selectedHistoryRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                  No hay datos en este cierre.
                </td>
              </tr>
            ) : selectedHistoryRows.map((item) => (
              <tr key={`${selectedHistoryDate}-${item.clientId}`}>
                <td><strong className="ar-unit-id">{item.unitId}</strong></td>
                <td className="ar-pending-cell">
                  <div className="ar-client-money-layout">
                    <div className="ar-client-money-main">
                      <span className="client-name">{formatCurrency(item.totalPending)}</span>
                      <span className="debt-meta ar-truncate-line" title={item.clientName}>{item.clientName}</span>
                    </div>
                    <div className="ar-account-status-stack">
                      <span className="ar-last-payment-date">
                        {item.lastPaymentDate ? formatDate(new Date(`${item.lastPaymentDate}T12:00:00`)) : "Sin pagos"}
                      </span>
                      <span className={stateToneClass(item.receivableState as ReceivableState)}>
                        {STATE_LABEL[item.receivableState as ReceivableState] ?? item.receivableState}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="ar-support-note-cell"><span className="hint">-</span></td>
                <td className="ar-cut-cell ar-cut-cell--stacked">
                  <div className="ar-cut-stack">
                    {COLLECTION_CUT_OPTIONS.map((option) => (
                      <div key={option.key}>
                        {renderHistoryCutStack(item.cuts[option.key], option.key)}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                No hay resultados para los filtros seleccionados.
              </td>
            </tr>
          ) : rows.map((row) => (
            <ReceivableTableRow
              key={row.id}
              row={row}
              statusRecord={collectionStatusByClient[row.id]}
              operationalStatus={clientStatusById.get(row.id) ?? "activo"}
              todayDateKey={todayDateKey}
              now={now}
              isTodayCollectionClosed={isTodayCollectionClosed}
              collectionCutItems={getCutItemsForClient(todayCollectionCuts, row.id)}
              visibleCutKey={visibleCollectionCut}
              whatsAppMessage={buildWhatsAppReceivableMessage(row)}
              onSelectDetail={onSelectDetail}
              onCollectionCutStatusChange={onCollectionCutStatusChange}
              onCollectionCutCommentChange={onCollectionCutCommentChange}
              onWhatsAppMessageCopied={onWhatsAppMessageCopied}
              onWhatsAppMessageSent={onWhatsAppMessageSent}
              onEditWhatsAppPhone={onEditWhatsAppPhone}
              onSupportNoteChange={onSupportNoteChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});
