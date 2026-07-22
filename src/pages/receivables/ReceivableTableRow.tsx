import { memo } from "react";
import { formatCurrency, formatDate } from "../../format";
import { STATE_LABEL, type ReceivableRow } from "../../receivables";
import type { Client } from "../../types";
import type { CollectionStatus, CollectionStatusRecord } from "./receivablesTypes";
import {
  COLLECTION_STATUS_OPTIONS,
  clientOperationalStatusLabel,
  clientOperationalStatusTone,
  isToday,
  pendingSummaryText,
  stateToneClass
} from "./receivablesPageRules";

type Props = {
  row: ReceivableRow;
  statusRecord?: CollectionStatusRecord;
  operationalStatus: Client["status"];
  todayDateKey: string;
  now: Date;
  isTodayCollectionClosed: boolean;
  whatsAppUrl: string;
  onSelectDetail: (row: ReceivableRow) => void;
  onRemoveFieldManagement: (clientId: string) => void;
  onCollectionStatusChange: (clientId: string, nextStatus: string) => void;
  onCallLaterCommentChange: (clientId: string, value: string) => void;
  onOpenFieldManagementModal: (clientId: string) => void;
};

function hasPaymentToday(row: ReceivableRow, now: Date): boolean {
  if (!row.lastPaymentDate) return false;
  return isToday(new Date(`${row.lastPaymentDate}T12:00:00`), now);
}

function getEffectiveStatus(row: ReceivableRow, statusRecord: CollectionStatusRecord | undefined, now: Date): CollectionStatus | "" {
  if (statusRecord?.status) return statusRecord.status;
  if (row.state === "alDia" || hasPaymentToday(row, now)) return "paid";
  return "";
}

function hasRouteCollection(statusRecord: CollectionStatusRecord | undefined): boolean {
  if (!statusRecord) return false;
  const hasType = statusRecord.managementType === "solo_cobrar" || statusRecord.managementType === "cobrar_o_quitar";
  return hasType && !!statusRecord.managementAmount && statusRecord.managementAmount > 0;
}

function ReceivableTableRowComponent({
  row,
  statusRecord,
  operationalStatus,
  now,
  isTodayCollectionClosed,
  whatsAppUrl,
  onSelectDetail,
  onRemoveFieldManagement,
  onCollectionStatusChange,
  onCallLaterCommentChange,
  onOpenFieldManagementModal
}: Props) {
  const paidToday = hasPaymentToday(row, now);
  const autoPaid = row.state === "alDia" || paidToday;
  const routeCollection = hasRouteCollection(statusRecord);
  const hasManualStatus = !!statusRecord?.status;
  const effectiveStatus = getEffectiveStatus(row, statusRecord, now);
  const storedComment = statusRecord?.comment ?? "";

  return (
    <tr className={statusRecord?.managementType ? "ar-row--route" : ""}>
      <td><strong className="ar-unit-id">{row.unitId}</strong></td>
      <td className="ar-pending-cell">
        <span className="client-name">{pendingSummaryText(row.totalPending, row.rentAmount)}</span>
        <span className={`debt-meta ${row.rentAmount > 0 ? "amount-debt" : "amount-good"}`}>Letra: {formatCurrency(row.rentAmount)}</span>
        <span className="debt-meta ar-truncate-line" title={row.name}>{row.name}</span>
      </td>
      <td>
        <div>{row.lastPaymentDate ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) : <span className="amount-muted">Sin pagos</span>}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          <span className={stateToneClass(row.state)}>{STATE_LABEL[row.state]}</span>
          <span className={clientOperationalStatusTone(operationalStatus)}>
            {clientOperationalStatusLabel(operationalStatus)}
          </span>
        </div>
      </td>
      <td className="ar-collection-cell">
        <div className="ar-collection-wrap">
          {routeCollection && (
            <span className="ar-route-collection-tag">
              COBRO EN RUTA
              <button
                type="button"
                className="ar-route-collection-remove"
                onClick={() => onRemoveFieldManagement(row.id)}
                aria-label={`Quitar cobro en ruta de ${row.unitId}`}
                title="Quitar de cobro en ruta"
                disabled={isTodayCollectionClosed}
              >
                x
              </button>
            </span>
          )}
          <select
            className="ar-collection-select"
            value={effectiveStatus}
            onChange={(event) => onCollectionStatusChange(row.id, event.target.value)}
            disabled={isTodayCollectionClosed}
          >
            <option value="">Seleccionar</option>
            {COLLECTION_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {effectiveStatus === "call_later" && (
            <input
              type="text"
              className="ar-collection-comment"
              maxLength={5}
              placeholder="Comentario (max 5)"
              value={storedComment}
              onChange={(event) => onCallLaterCommentChange(row.id, event.target.value)}
              disabled={isTodayCollectionClosed}
            />
          )}
          {autoPaid && !hasManualStatus && (
            <span className="hint ar-collection-note">
              {paidToday ? "Sugerido automatico por pago de hoy." : "Sugerido automatico por cliente al dia."}
            </span>
          )}
        </div>
      </td>
      <td className="ar-actions-cell ar-actions-cell--compact">
        <div className="ar-actions-stack">
          <button type="button" className="button ghost small" onClick={() => onSelectDetail(row)}>Ver detalle</button>
          <a className="button ghost small ar-whatsapp-link" href={whatsAppUrl} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <button
            type="button"
            className="button ghost small"
            onClick={() => onOpenFieldManagementModal(row.id)}
            disabled={isTodayCollectionClosed}
          >
            Cobro en Ruta
          </button>
        </div>
      </td>
    </tr>
  );
}

export const ReceivableTableRow = memo(ReceivableTableRowComponent, (previous, next) => (
  previous.row === next.row &&
  previous.statusRecord === next.statusRecord &&
  previous.operationalStatus === next.operationalStatus &&
  previous.todayDateKey === next.todayDateKey &&
  previous.isTodayCollectionClosed === next.isTodayCollectionClosed &&
  previous.whatsAppUrl === next.whatsAppUrl
));
