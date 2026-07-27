import { memo, useState } from "react";
import { formatCurrency, formatDate } from "../../format";
import { PLAN_LABEL, STATE_LABEL, WEEKDAY_LABEL, type ReceivableRow } from "../../receivables";
import type { Client } from "../../types";
import type { CollectionStatus, CollectionStatusRecord } from "./receivablesTypes";
import {
  COLLECTION_CUT_OPTIONS,
  DAILY_COLLECTION_STATUS_OPTIONS,
  clientOperationalStatusLabel,
  clientOperationalStatusTone,
  pendingSummaryText,
  stateToneClass,
  type CollectionClosureItem,
  type CollectionCutKey
} from "./receivablesPageRules";

type Props = {
  row: ReceivableRow;
  statusRecord?: CollectionStatusRecord;
  operationalStatus: Client["status"];
  todayDateKey: string;
  now: Date;
  isTodayCollectionClosed: boolean;
  collectionCutItems: Partial<Record<CollectionCutKey, CollectionClosureItem>>;
  visibleCutKey: CollectionCutKey | "all";
  whatsAppMessage: string;
  onSelectDetail: (row: ReceivableRow) => void;
  onCollectionCutStatusChange: (cutKey: CollectionCutKey, clientId: string, nextStatus: string) => void;
  onCollectionCutCommentChange: (cutKey: CollectionCutKey, clientId: string, value: string) => void;
  onWhatsAppMessageCopied: (clientId: string, message: string) => void;
  onWhatsAppMessageSent: (clientId: string, message: string) => void;
  onEditWhatsAppPhone: (clientId: string) => void;
  onSupportNoteChange: (clientId: string, value: string) => void;
};

function normalizeWhatsAppPhone(value: string | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 8) return `507${digits}`;
  if (digits.length >= 10) return digits;
  return "";
}

function WhatsAppIcon() {
  return (
    <svg className="ar-whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4.2a7.8 7.8 0 0 0-6.64 11.9l-.73 3.27 3.35-.7A7.8 7.8 0 1 0 12 4.2Z" />
      <path d="M9.05 8.2c-.23.14-.92.62-.92 1.78 0 1.58 1.29 3.15 2.38 4.02 1.13.9 2.86 1.82 4.22 1.43.62-.18 1.07-.77 1.17-1.24.04-.2 0-.36-.18-.45l-1.55-.74c-.21-.1-.4-.07-.55.12l-.52.66c-.14.17-.34.22-.55.13a5.8 5.8 0 0 1-2.44-2.1c-.12-.2-.1-.4.05-.56l.47-.5c.14-.15.18-.36.1-.55l-.7-1.63c-.08-.18-.27-.32-.48-.37Z" />
    </svg>
  );
}

function cutDisplayLabel(cutKey: CollectionCutKey): string {
  if (cutKey === "night") return "Gestion";
  if (cutKey === "morning") return "Corte 1";
  return "Corte 2";
}

function getStatusOptionsForCut(_cutKey: CollectionCutKey): Array<{ value: CollectionStatus; label: string }> {
  return DAILY_COLLECTION_STATUS_OPTIONS;
}

function lastPaymentLabel(lastPaymentDate: string | null, now: Date): string {
  if (!lastPaymentDate) return "Sin pagos";
  const paymentDate = new Date(`${lastPaymentDate}T12:00:00`);
  const referenceDate = new Date(now);
  paymentDate.setHours(0, 0, 0, 0);
  referenceDate.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((referenceDate.getTime() - paymentDate.getTime()) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "PAGÓ HOY";
  if (days === 1) return "Último pago hace 1 día";
  return `Último pago hace ${days} días`;
}

function dateKeyLabel(dateKey: string | null): string {
  if (!dateKey) return "-";
  return formatDate(new Date(`${dateKey}T12:00:00`));
}

function planDetailLabel(row: ReceivableRow): string {
  if (row.plan === "weekly" && row.weeklyChargeDay) return `${PLAN_LABEL[row.plan]} / ${WEEKDAY_LABEL[row.weeklyChargeDay]}`;
  return PLAN_LABEL[row.plan];
}

function hasOverdueDebt(row: ReceivableRow): boolean {
  return row.overdueBalance > 0 || row.overdueInstallments > 0 || row.state === "vencido" || row.state === "critico";
}

function shouldDefaultToCovered(row: ReceivableRow): boolean {
  return row.state !== "vencido" && row.state !== "critico";
}

function ReceivableTableRowComponent({
  row,
  statusRecord,
  operationalStatus,
  now,
  isTodayCollectionClosed,
  collectionCutItems,
  visibleCutKey,
  whatsAppMessage,
  onSelectDetail,
  onCollectionCutStatusChange,
  onCollectionCutCommentChange,
  onWhatsAppMessageCopied,
  onWhatsAppMessageSent,
  onEditWhatsAppPhone,
  onSupportNoteChange
}: Props) {
  const [copiedWhatsAppMessage, setCopiedWhatsAppMessage] = useState(false);
  const messageWasCopied = copiedWhatsAppMessage || !!statusRecord?.whatsAppMessageCopiedAt;
  const messageWasSent = !!statusRecord?.whatsAppMessageSentAt;
  const requiresWhatsAppManagement = hasOverdueDebt(row);
  const whatsAppIsResolved = messageWasSent || !requiresWhatsAppManagement;
  const whatsAppPhone = normalizeWhatsAppPhone(row.whatsAppPhone);
  const lastPaymentIsToday = row.lastPaymentDate
    ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) === formatDate(now)
    : false;
  const sentAt = statusRecord?.whatsAppMessageSentAt ? new Date(statusRecord.whatsAppMessageSentAt) : null;
  const sentTime = sentAt && !Number.isNaN(sentAt.getTime())
    ? sentAt.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" })
    : "";
  const whatsAppButtonTitle = !requiresWhatsAppManagement
    ? "Realizado: sin saldo atrasado"
    : messageWasSent
      ? `WhatsApp enviado${sentTime ? ` a las ${sentTime}` : ""}`
      : messageWasCopied
        ? "WhatsApp abierto: confirma cuando lo envies"
        : whatsAppPhone
          ? "Abrir WhatsApp y copiar mensaje"
          : "Falta WhatsApp: agregar o editar numero";
  const whatsAppTone = whatsAppIsResolved ? "sent" : messageWasCopied ? "opened" : whatsAppPhone ? "ready" : "missing";
  const visibleCutOptions = visibleCutKey === "all"
    ? COLLECTION_CUT_OPTIONS
    : COLLECTION_CUT_OPTIONS.filter((option) => option.key === visibleCutKey);

  async function handleWhatsAppClick(): Promise<void> {
    if (!whatsAppPhone) {
      onEditWhatsAppPhone(row.id);
      return;
    }
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

  function renderCutCell(cutKey: CollectionCutKey) {
    const item = collectionCutItems[cutKey];
    const rawValue = item?.collectionStatus ?? (cutKey === "night" && shouldDefaultToCovered(row) ? "covered" : "");
    const statusOptions = getStatusOptionsForCut(cutKey);
    const value = statusOptions.some((option) => option.value === rawValue) ? rawValue : "";
    return (
      <div className={`ar-cut-stack-row ar-cut-stack-row--${cutKey}`}>
        <span className="ar-cut-stack-label">{cutDisplayLabel(cutKey)}</span>
        <div className="ar-cut-cell-content">
          <select
            className={`ar-cut-select ar-cut-select--${value || "empty"}`}
            value={value}
            onChange={(event) => onCollectionCutStatusChange(cutKey, row.id, event.target.value)}
            disabled={isTodayCollectionClosed}
          >
            <option value="">Seleccionar</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {item?.comment ? (
            <span className="hint ar-cut-comment">Comentario: {item.comment}</span>
          ) : null}
          <div className="ar-cut-actions">
            {item?.whatsAppMessageSentAt ? <span>WhatsApp enviado</span> : item?.whatsAppMessageCopiedAt ? <span>WhatsApp abierto</span> : null}
            {item?.managementAmount ? (
              <span>
                Ruta {formatCurrency(item.managementAmount)}
                {item.managementType === "cobrar_o_quitar" ? " / quitar" : ""}
              </span>
            ) : null}
            {item?.managementComment ? <span>{item.managementComment}</span> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <tr className="ar-card-row">
      <td colSpan={4} className="ar-card-cell">
        <article className={`ar-receivable-card ${statusRecord?.managementType ? "ar-receivable-card--route" : ""}`}>
          <div className="ar-card-finance">
            <div className="ar-client-money-main">
              <div className="ar-client-summary-grid">
                <div className="ar-card-actions ar-card-actions--compact">
                  <strong className="ar-unit-id">{row.unitId}</strong>
                  {whatsAppIsResolved ? (
                    <span
                      className="ar-whatsapp-status ar-whatsapp-status--sent ar-whatsapp-icon-button ar-whatsapp-icon-button--sent"
                      title={whatsAppButtonTitle}
                      aria-label={whatsAppButtonTitle}
                    >
                      <WhatsAppIcon />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`button ghost small ar-whatsapp-link ar-whatsapp-unit-button ar-whatsapp-icon-button ar-whatsapp-icon-button--${whatsAppTone}`}
                      onClick={() => void handleWhatsAppClick()}
                      disabled={isTodayCollectionClosed}
                      title={whatsAppButtonTitle}
                      aria-label={whatsAppButtonTitle}
                    >
                      <WhatsAppIcon />
                    </button>
                  )}
                  <span className={clientOperationalStatusTone(operationalStatus)}>
                    {clientOperationalStatusLabel(operationalStatus)}
                  </span>
                  {!whatsAppIsResolved && messageWasCopied ? (
                    <div className="ar-whatsapp-confirm-box ar-whatsapp-confirm-box--unit ar-whatsapp-confirm-box--inline">
                      <span>Confirma cuando lo envies.</span>
                      <button
                        type="button"
                        className="button small ar-whatsapp-confirm-button"
                        onClick={handleConfirmWhatsAppSent}
                        disabled={isTodayCollectionClosed}
                      >
                        Enviado
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="ar-client-summary-main">
                  <span className="client-name ar-balance-main">{pendingSummaryText(row.totalPending, row.rentAmount)}</span>
                  <span className={`debt-meta ar-rent-line ${row.rentAmount > 0 ? "amount-debt" : "amount-good"}`}>Letra: {formatCurrency(row.rentAmount)}</span>
                  <span className="debt-meta ar-truncate-line ar-client-person" title={row.name}>{row.name}</span>
                  <div className="ar-payment-state-row">
                    <span className={`ar-last-payment-date ${lastPaymentIsToday ? "ar-last-payment-date--today" : ""}`}>
                      {lastPaymentLabel(row.lastPaymentDate, now)}
                    </span>
                    <span className={stateToneClass(row.state)}>{STATE_LABEL[row.state]}</span>
                  </div>
                  <div className="ar-card-key-grid">
                    <span className="ar-metric-chip ar-metric-chip--plan"><small>Plan</small>{planDetailLabel(row)}</span>
                    <span className="ar-metric-chip ar-metric-chip--date"><small>Proximo</small>{dateKeyLabel(row.nextDueDate)}</span>
                    <span className="ar-metric-chip ar-metric-chip--late"><small>Atraso</small>{row.daysLate > 0 ? `${row.daysLate} dias` : "Sin atraso"}</span>
                    <span className="ar-metric-chip ar-metric-chip--debt"><small>Vencido</small>{formatCurrency(row.overdueBalance)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="ar-card-workflow">
            <div className="ar-card-management ar-cut-cell ar-cut-cell--stacked">
              <div className="ar-cut-stack">
                {visibleCutOptions.map((option) => (
                  <div key={option.key}>
                    {renderCutCell(option.key)}
                  </div>
                ))}
              </div>
            </div>
            <div className="ar-note-shell ar-support-note-cell">
              <span className="ar-note-title">Nota</span>
              <textarea
                className="ar-support-note-inline"
                value={statusRecord?.supportNote ?? ""}
                onChange={(event) => onSupportNoteChange(row.id, event.target.value)}
                placeholder="Escribe una nota rapida..."
                maxLength={300}
                rows={3}
                disabled={isTodayCollectionClosed}
              />
            </div>
          </div>
        </article>
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
  previous.collectionCutItems === next.collectionCutItems &&
  previous.visibleCutKey === next.visibleCutKey &&
  previous.whatsAppMessage === next.whatsAppMessage &&
  previous.onCollectionCutStatusChange === next.onCollectionCutStatusChange &&
  previous.onCollectionCutCommentChange === next.onCollectionCutCommentChange &&
  previous.onWhatsAppMessageCopied === next.onWhatsAppMessageCopied &&
  previous.onWhatsAppMessageSent === next.onWhatsAppMessageSent &&
  previous.onEditWhatsAppPhone === next.onEditWhatsAppPhone &&
  previous.onSupportNoteChange === next.onSupportNoteChange
));
