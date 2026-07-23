import { memo, useState } from "react";
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
  whatsAppMessage: string;
  onSelectDetail: (row: ReceivableRow) => void;
  onRemoveFieldManagement: (clientId: string) => void;
  onCollectionStatusChange: (clientId: string, nextStatus: string) => void;
  onWhatsAppMessageCopied: (clientId: string, message: string) => void;
  onWhatsAppMessageSent: (clientId: string, message: string) => void;
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

function normalizeWhatsAppPhone(value: string | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 8) return `507${digits}`;
  if (digits.length >= 10) return digits;
  return "";
}

function ReceivableTableRowComponent({
  row,
  statusRecord,
  operationalStatus,
  now,
  isTodayCollectionClosed,
  whatsAppMessage,
  onSelectDetail,
  onRemoveFieldManagement,
  onCollectionStatusChange,
  onWhatsAppMessageCopied,
  onWhatsAppMessageSent,
  onCallLaterCommentChange,
  onOpenFieldManagementModal
}: Props) {
  const [copiedWhatsAppMessage, setCopiedWhatsAppMessage] = useState(false);
  const paidToday = hasPaymentToday(row, now);
  const autoPaid = row.state === "alDia" || paidToday;
  const routeCollection = hasRouteCollection(statusRecord);
  const hasManualStatus = !!statusRecord?.status;
  const effectiveStatus = getEffectiveStatus(row, statusRecord, now);
  const storedComment = statusRecord?.comment ?? "";
  const messageWasCopied = copiedWhatsAppMessage || !!statusRecord?.whatsAppMessageCopiedAt;
  const messageWasSent = !!statusRecord?.whatsAppMessageSentAt;
  const whatsAppPhone = normalizeWhatsAppPhone(row.whatsAppPhone);
  const sentAt = statusRecord?.whatsAppMessageSentAt ? new Date(statusRecord.whatsAppMessageSentAt) : null;
  const sentTime = sentAt && !Number.isNaN(sentAt.getTime())
    ? sentAt.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" })
    : "";

  async function handleWhatsAppClick(): Promise<void> {
    window.open(whatsAppPhone ? `https://wa.me/${whatsAppPhone}` : "https://wa.me/", "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(whatsAppMessage);
      onWhatsAppMessageCopied(row.id, whatsAppMessage);
      setCopiedWhatsAppMessage(true);
      window.setTimeout(() => setCopiedWhatsAppMessage(false), 2500);
    } catch {
      window.alert("No se pudo copiar el mensaje. Copialo manualmente antes de confirmar el envio.");
    }
  }

  function handleConfirmWhatsAppSent(): void {
    onWhatsAppMessageSent(row.id, whatsAppMessage);
  }

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
          <button
            type="button"
            className="button ghost small ar-whatsapp-link"
            onClick={() => void handleWhatsAppClick()}
            disabled={isTodayCollectionClosed}
          >
            {messageWasSent ? "Reenviar WhatsApp" : "Copiar y abrir WhatsApp"}
          </button>
          {messageWasSent ? (
            <span className="ar-whatsapp-status ar-whatsapp-status--sent">
              Enviado{sentTime ? ` ${sentTime}` : ""}
            </span>
          ) : messageWasCopied ? (
            <div className="ar-whatsapp-confirm-box">
              <span>{whatsAppPhone ? "Chat abierto. Pegalo en WhatsApp y envialo." : "Sin numero guardado. Busca el chat, pega el mensaje y envialo."}</span>
              <button
                type="button"
                className="button small ar-whatsapp-confirm-button"
                onClick={handleConfirmWhatsAppSent}
                disabled={isTodayCollectionClosed}
              >
                Si, ya lo envie
              </button>
            </div>
          ) : null}
          {!whatsAppPhone && !messageWasSent && (
            <span className="ar-whatsapp-phone-missing">Falta WhatsApp</span>
          )}
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
  previous.whatsAppMessage === next.whatsAppMessage &&
  previous.onWhatsAppMessageCopied === next.onWhatsAppMessageCopied &&
  previous.onWhatsAppMessageSent === next.onWhatsAppMessageSent
));
