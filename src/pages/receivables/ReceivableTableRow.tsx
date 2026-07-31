import { memo, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatCurrency, formatDate } from "../../format";
import { PLAN_LABEL, STATE_LABEL, WEEKDAY_LABEL, type ReceivableRow } from "../../receivables";
import type { CollectionStatus, CollectionStatusRecord } from "./receivablesTypes";
import {
  COLLECTION_CUT_OPTIONS,
  DAILY_COLLECTION_STATUS_OPTIONS,
  ROUTE_COLLECTION_STATUS_OPTIONS,
  COLLECTION_STATUS_HELP,
  CONTACT_TIME_OPTIONS,
  clientOperationalStatusLabel,
  clientOperationalStatusTone,
  normalizeContactTime,
  shouldDefaultToCovered,
  stateToneClass,
  type CollectionClosureItem,
  type CollectionCutKey,
  type ReceivablesWorkflowTab
} from "./receivablesPageRules";

type Props = {
  row: ReceivableRow;
  statusRecord?: CollectionStatusRecord;
  operationalStatus: string;
  todayDateKey: string;
  now: Date;
  isTodayCollectionClosed: boolean;
  workflowTab: ReceivablesWorkflowTab;
  collectionCutItems: Partial<Record<CollectionCutKey, CollectionClosureItem>>;
  visibleCutKey: CollectionCutKey | "all";
  whatsAppMessage: string;
  whatsAppGroupRows?: ReceivableRow[];
  onSelectDetail: (row: ReceivableRow) => void;
  onCollectionCutStatusChange: (cutKey: CollectionCutKey, clientId: string, nextStatus: string) => void;
  onCollectionCutCommentChange: (cutKey: CollectionCutKey, clientId: string, value: string) => void;
  onRouteReleaseAmountChange: (clientId: string, value: string) => void;
  onWhatsAppMessageSent: (clientId: string, message: string) => void;
  onSupportNoteChange: (clientId: string, value: string) => void;
  onContactTimeChange: (clientId: string, value: string) => void;
};

function safeFilenamePart(value: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "cliente";
}

const STATEMENT_SUGGESTION_WINDOW_MS = 24 * 60 * 60 * 1000;

function hasTimestampWithinWindow(value: string | undefined, now: Date, windowMs: number): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return now.getTime() - date.getTime() < windowMs;
}

function hasLastPaymentOutsideSuggestionWindow(row: ReceivableRow, now: Date): boolean {
  const rawTimestamp = row.lastPaymentAt ?? (row.lastPaymentDate ? `${row.lastPaymentDate}T12:00:00` : "");
  if (!rawTimestamp) return true;
  const lastPaymentDate = new Date(rawTimestamp);
  if (Number.isNaN(lastPaymentDate.getTime())) return true;
  return now.getTime() - lastPaymentDate.getTime() >= STATEMENT_SUGGESTION_WINDOW_MS;
}

function formatElapsedDaysSince(value: string | null | undefined, now: Date): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const elapsedMs = Math.max(0, now.getTime() - date.getTime());
  const elapsedDays = Math.floor(elapsedMs / STATEMENT_SUGGESTION_WINDOW_MS);
  if (elapsedDays < 1) return "hace menos de 1 dia";
  return `hace ${elapsedDays} dia${elapsedDays === 1 ? "" : "s"}`;
}

function formatStatementTimestamp(value: string | null | undefined, now: Date): string {
  if (!value) return "Sin pagos registrados";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(new Date(`${value.slice(0, 10)}T12:00:00`));
  const elapsed = formatElapsedDaysSince(value, now);
  return `${formatDate(date)} ${date.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" })}${elapsed ? ` (${elapsed})` : ""}`;
}

function StatementBalanceCard({ row, now }: { row: ReceivableRow; now: Date }) {
  const planLabel = PLAN_LABEL[row.plan] ?? row.plan;
  const overdueRent = row.daysLate > 0 ? Math.max(0, row.overdueBalance) : 0;
  const currentRent = Math.max(0, row.totalPending - overdueRent);
  const showOverdueRent = overdueRent > 0;
  const overdueInstallments = showOverdueRent ? row.overdueInstallments : 0;
  const lastPaymentValue = row.lastPaymentAt ?? (row.lastPaymentDate ? `${row.lastPaymentDate}T12:00:00` : null);
  return (
    <div className="statement-card">
      <div className="statement-topbar">
        <div>
          <div className="statement-title">Estado de cuenta actualizado</div>
        </div>
        <div className="statement-date">Al {formatDate(now)}</div>
      </div>

      <div className="statement-identity">
        <div className="statement-unit-block">
          <span>Unidad</span>
          <strong>{row.unitId}</strong>
        </div>
        <div className="statement-client-block">
          <span>Cliente</span>
          <strong>{row.name || "Cliente"}</strong>
          <em>Plan {planLabel.toLowerCase()} / {formatCurrency(row.rentAmount)}</em>
        </div>
      </div>

      <div className="statement-total-panel">
        <span>Pendiente por pagar</span>
        <strong>{formatCurrency(Math.max(0, row.totalPending))}</strong>
      </div>

      <div className="statement-detail-panel">
        <div className="statement-section-title">Resumen para pago</div>
        {showOverdueRent ? (
          <div className="statement-detail-row">
            <span>Renta vencida <em>({overdueInstallments} cuota{overdueInstallments === 1 ? "" : "s"})</em></span>
            <strong>{formatCurrency(overdueRent)}</strong>
          </div>
        ) : null}
        <div className="statement-detail-row">
          <span>Saldo corriente{showOverdueRent ? "" : " (no vencido)"}</span>
          <strong>{formatCurrency(currentRent)}</strong>
        </div>
        <div className="statement-detail-row statement-detail-row--total">
          <span>Total pendiente</span>
          <strong>{formatCurrency(Math.max(0, row.totalPending))}</strong>
        </div>
      </div>

      <div className="statement-last-payment">
        <span>Ultimo pago recibido</span>
        <strong>{formatStatementTimestamp(lastPaymentValue, now)}</strong>
      </div>

      <div className="statement-note">
        Si ya realizo el pago recientemente, por favor ignore este aviso. Gracias.
      </div>
    </div>
  );
}

async function buildReceivableBalanceCanvas(row: ReceivableRow, now: Date): Promise<HTMLCanvasElement> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "528px";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    root.render(
      <div className="receipt-page">
        <div className="statement-export-frame">
          <StatementBalanceCard row={row} now={now} />
        </div>
      </div>
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (document.fonts?.ready) await document.fonts.ready;
    const target = host.querySelector(".statement-export-frame") as HTMLDivElement | null;
    if (!target) throw new Error("No se pudo renderizar el estado de cuenta.");
    const html2canvas = (await import("html2canvas")).default;
    return html2canvas(target, {
      scale: 1,
      backgroundColor: "#ffffff",
      useCORS: true,
      width: target.scrollWidth,
      height: target.scrollHeight
    });
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar la imagen."));
    }, "image/png");
  });
}

function downloadReceivableBalanceImage(row: ReceivableRow, canvas: HTMLCanvasElement): void {
  const link = document.createElement("a");
  link.download = `saldo-${safeFilenamePart(row.unitId)}-${safeFilenamePart(row.name)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function copyReceivableBalanceImage(row: ReceivableRow, now: Date): Promise<"copied" | "downloaded"> {
  const canvas = await buildReceivableBalanceCanvas(row, now);
  const blob = await canvasToPngBlob(canvas);
  const clipboard = navigator.clipboard as Clipboard & {
    write?: (items: ClipboardItem[]) => Promise<void>;
  };
  if (typeof clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
    await clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return "copied";
  }
  downloadReceivableBalanceImage(row, canvas);
  return "downloaded";
}

function BalanceImageIcon() {
  return (
    <svg className="ar-phone-edit-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M8 9.4h8" />
      <path d="M8 13h5" />
      <path d="M8 16.6h8" />
    </svg>
  );
}

function cutDisplayLabel(cutKey: CollectionCutKey): string {
  if (cutKey === "night") return "Gestion";
  return "Gestion";
}

function getStatusOptionsForCut(_cutKey: CollectionCutKey): Array<{ value: CollectionStatus; label: string; description: string }> {
  return DAILY_COLLECTION_STATUS_OPTIONS;
}

function getRouteStatusLabel(status: CollectionStatus): string {
  return ROUTE_COLLECTION_STATUS_OPTIONS.find((option) => option.value === status)?.label
    ?? DAILY_COLLECTION_STATUS_OPTIONS.find((option) => option.value === status)?.label
    ?? status;
}

function lastPaymentLabel(lastPaymentDate: string | null, now: Date): string {
  if (!lastPaymentDate) return "Sin pagos";
  const paymentDate = new Date(`${lastPaymentDate}T12:00:00`);
  const referenceDate = new Date(now);
  paymentDate.setHours(0, 0, 0, 0);
  referenceDate.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((referenceDate.getTime() - paymentDate.getTime()) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "PAGO HOY";
  if (days === 1) return "Ultimo pago hace 1 dia";
  return `Ultimo pago hace ${days} dias`;
}

function dateKeyLabel(dateKey: string | null): string {
  if (!dateKey) return "-";
  return formatDate(new Date(`${dateKey}T12:00:00`));
}

function planDetailLabel(row: ReceivableRow): string {
  if (!row.hasActiveClient) return "Sin plan";
  if (row.plan === "weekly" && row.weeklyChargeDay) return `${PLAN_LABEL[row.plan]} / ${WEEKDAY_LABEL[row.weeklyChargeDay]}`;
  return PLAN_LABEL[row.plan];
}

function isWhatsAppEligibleUnit(row: ReceivableRow, operationalStatus: string): boolean {
  return row.hasActiveClient && operationalStatus.trim().toLowerCase() === "activo";
}

function hasPendingRent(row: ReceivableRow, operationalStatus: string): boolean {
  return isWhatsAppEligibleUnit(row, operationalStatus) && row.totalPending > 0;
}

function defaultCollectionStatus(row: ReceivableRow, operationalStatus: string, cutKey: CollectionCutKey): CollectionStatus | "" {
  if (cutKey !== "night") return "";
  return shouldDefaultToCovered(row, operationalStatus) ? "covered" : "unassigned";
}

function contactTimeMinutes(value: string | undefined): number | null {
  const match = value?.match(/^(\d{1,2}):(\d{2})\s(AM|PM)$/);
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour12) || !Number.isFinite(minute)) return null;
  const hour24 = (hour12 % 12) + (match[3] === "PM" ? 12 : 0);
  return hour24 * 60 + minute;
}

function contactTimeMeta(value: string | undefined, now: Date): { tone: "missing" | "overdue" | "soon" | "scheduled"; label: string } {
  const minutes = contactTimeMinutes(value);
  if (minutes === null || !value) return { tone: "missing", label: "Llamada" };
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const diff = minutes - currentMinutes;
  if (diff < 0) return { tone: "overdue", label: "Vencida" };
  if (diff <= 60) return { tone: "soon", label: "Próxima" };
  return { tone: "scheduled", label: "Llamada" };
}

function ReceivableTableRowComponent({
  row,
  statusRecord,
  operationalStatus,
  now,
  isTodayCollectionClosed,
  workflowTab,
  collectionCutItems,
  visibleCutKey,
  whatsAppMessage,
  whatsAppGroupRows,
  onSelectDetail,
  onCollectionCutStatusChange,
  onCollectionCutCommentChange,
  onRouteReleaseAmountChange,
  onWhatsAppMessageSent,
  onSupportNoteChange,
  onContactTimeChange
}: Props) {
  const [isCopyingBalanceImage, setIsCopyingBalanceImage] = useState(false);
  const statementWasSentRecently = hasTimestampWithinWindow(statusRecord?.whatsAppMessageSentAt, now, STATEMENT_SUGGESTION_WINDOW_MS);
  const isEligibleForWhatsApp = isWhatsAppEligibleUnit(row, operationalStatus);
  const requiresWhatsAppManagement = hasPendingRent(row, operationalStatus);
  const requiresStatementSuggestion = requiresWhatsAppManagement &&
    hasLastPaymentOutsideSuggestionWindow(row, now) &&
    !statementWasSentRecently;
  const showStatementSuggestion = requiresStatementSuggestion || statementWasSentRecently;
  const whatsAppIsResolved = statementWasSentRecently || !requiresStatementSuggestion;
  const lastPaymentIsToday = row.lastPaymentDate
    ? formatDate(new Date(`${row.lastPaymentDate}T12:00:00`)) === formatDate(now)
    : false;
  const sentAt = statusRecord?.whatsAppMessageSentAt ? new Date(statusRecord.whatsAppMessageSentAt) : null;
  const sentTime = sentAt && !Number.isNaN(sentAt.getTime())
    ? sentAt.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" })
    : "";
  const deliveryStatusTitle = whatsAppIsResolved
    ? sentTime ? `Enviado a las ${sentTime}` : "Marcado como enviado"
    : "Sugerido: marcar como enviado si lo mandaste manualmente";
  const balanceImageTitle = "Copiar imagen de saldo";
  const visibleCutOptions = visibleCutKey === "all"
    ? COLLECTION_CUT_OPTIONS
    : COLLECTION_CUT_OPTIONS.filter((option) => option.key === visibleCutKey);
  const totalDue = row.overdueBalance + row.totalOtherCharges;
  const isRouteHighlighted = statusRecord?.managementType || statusRecord?.status === "route" || statusRecord?.status === "route_collection";
  const isRouteWorkflow = workflowTab === "route";
  const groupedWhatsAppRows = whatsAppGroupRows?.filter((item) => item.id !== row.id) ?? [];
  const groupedWhatsAppUnits = groupedWhatsAppRows.map((item) => item.unitId).filter(Boolean);
  const [contactTimeDraft, setContactTimeDraft] = useState(statusRecord?.contactTime ?? "");

  useEffect(() => {
    setContactTimeDraft(statusRecord?.contactTime ?? "");
  }, [statusRecord?.contactTime]);

  function handleConfirmWhatsAppSent(): void {
    onWhatsAppMessageSent(row.id, whatsAppMessage);
  }

  async function handleCopyBalanceImage(): Promise<void> {
    if (isCopyingBalanceImage) return;
    setIsCopyingBalanceImage(true);
    try {
      const result = await copyReceivableBalanceImage(row, now);
      if (result === "downloaded") {
        window.alert("Tu navegador no permitio copiar la imagen. Se descargo el estado de cuenta como respaldo.");
      }
    } catch {
      window.alert("No se pudo copiar la imagen del estado de cuenta. Intenta nuevamente desde un navegador compatible.");
    } finally {
      setIsCopyingBalanceImage(false);
    }
  }

  function handleContactTimeDraftChange(value: string): void {
    const draft = value.toUpperCase().replace(/\s+/g, " ").slice(0, 8);
    setContactTimeDraft(draft);
    const normalized = normalizeContactTime(draft);
    if (normalized || draft === "") onContactTimeChange(row.id, normalized ?? "");
  }

  function handleContactTimeDraftBlur(): void {
    const normalized = normalizeContactTime(contactTimeDraft);
    setContactTimeDraft(normalized ?? statusRecord?.contactTime ?? "");
  }

  function renderCutCell(cutKey: CollectionCutKey) {
    const item = collectionCutItems[cutKey];
    const rawValue = item?.collectionStatus ?? (cutKey === "night" ? statusRecord?.status : undefined) ?? defaultCollectionStatus(row, operationalStatus, cutKey);
    const statusOptions = workflowTab === "route" ? ROUTE_COLLECTION_STATUS_OPTIONS : getStatusOptionsForCut(cutKey);
    const value = statusOptions.some((option) => option.value === rawValue) ? rawValue : "";
    const routeReleaseAmount = item?.managementAmount ?? statusRecord?.routeReleaseAmount;
    const selectedStatusHelp = value ? COLLECTION_STATUS_HELP[value as CollectionStatus] : undefined;
    const showRouteReleaseField = workflowTab === "route" && (value === "route" || value === "route_collection" || value === "route_not_sent" || value === "call_later");
    return (
      <div className={`ar-cut-stack-row ar-cut-stack-row--${cutKey}`}>
        <div className="ar-cut-stack-head">
          <span className="ar-cut-stack-label">{cutDisplayLabel(cutKey)}</span>
          <span className={clientOperationalStatusTone(operationalStatus)}>
            {clientOperationalStatusLabel(operationalStatus)}
          </span>
          {!row.hasActiveClient ? <span className="ar-mini-badge ar-mini-badge--muted">Sin cliente</span> : null}
        </div>
        <div className="ar-cut-cell-content">
          <select
            className={`ar-cut-select ar-cut-select--${value || "empty"}`}
            value={value}
            title={selectedStatusHelp}
            aria-label={selectedStatusHelp ? `Gestion: ${selectedStatusHelp}` : "Gestion"}
            onChange={(event) => onCollectionCutStatusChange(cutKey, row.id, event.target.value)}
            disabled={isTodayCollectionClosed}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value} title={option.description}>{option.label}</option>
            ))}
          </select>
          {workflowTab === "management" && value === "route" ? (
            <span className="ar-route-tab-handoff">Asignado a Cobro en Ruta</span>
          ) : null}
          {item?.comment ? (
            <span className="hint ar-cut-comment">Comentario: {item.comment}</span>
          ) : null}
          {showRouteReleaseField ? (
            <label className="ar-route-release-field">
              <span>Min. para liberar</span>
              <input
                className="ar-route-release-input"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={routeReleaseAmount ?? ""}
                onChange={(event) => onRouteReleaseAmountChange(row.id, event.target.value)}
                placeholder={row.overdueBalance > 0 ? row.overdueBalance.toFixed(2) : "0.00"}
                disabled={isTodayCollectionClosed}
              />
            </label>
          ) : null}
          <div className="ar-cut-actions">
            {value === "route" && routeReleaseAmount ? (
              <span>
                Libera con {formatCurrency(routeReleaseAmount)}
                {item?.managementType === "cobrar_o_quitar" ? " / quitar" : ""}
              </span>
            ) : null}
            {workflowTab === "route" && value ? <span>{getRouteStatusLabel(value as CollectionStatus)}</span> : null}
            {item?.managementComment ? <span>{item.managementComment}</span> : null}
          </div>
        </div>
      </div>
    );
  }

  const showContactTimeSupport = workflowTab === "management" && statusRecord?.status === "pending";
  const contactMeta = contactTimeMeta(statusRecord?.contactTime, now);

  return (
    <tr className="ar-card-row">
      <td colSpan={4} className="ar-card-cell">
        <article className={`ar-receivable-card ${isRouteHighlighted ? "ar-receivable-card--route" : ""}`}>
          <div className="ar-card-finance">
            <div className="ar-client-money-main">
              <div className="ar-client-summary-grid">
                <div className="ar-card-actions ar-card-actions--compact">
                  <div className="ar-unit-stack">
                    <strong className="ar-unit-id">{row.unitId}</strong>
                    {!isRouteWorkflow && groupedWhatsAppUnits.length > 0 ? (
                      <span
                        className="ar-whatsapp-group-badge"
                        title={`Mensaje conjunto: ${[row.unitId, ...groupedWhatsAppUnits].join(", ")}`}
                      >
                        +{groupedWhatsAppUnits.length} unidad{groupedWhatsAppUnits.length === 1 ? "" : "es"}
                      </span>
                    ) : null}
                  </div>
                  {!isRouteWorkflow ? (
                    <>
                      {showStatementSuggestion && requiresStatementSuggestion ? (
                        <button
                          type="button"
                          className="button ghost small ar-whatsapp-phone-edit ar-whatsapp-image-button"
                          onClick={() => void handleCopyBalanceImage()}
                          disabled={isTodayCollectionClosed || isCopyingBalanceImage}
                          title={balanceImageTitle}
                          aria-label={balanceImageTitle}
                        >
                          <BalanceImageIcon />
                        </button>
                      ) : null}
                      {showStatementSuggestion ? (
                        <button
                          type="button"
                          className={`history-send-button ${whatsAppIsResolved ? "history-send-button--sent" : "history-send-button--pending"}`}
                          onClick={handleConfirmWhatsAppSent}
                          disabled={isTodayCollectionClosed || whatsAppIsResolved}
                          title={deliveryStatusTitle}
                          aria-label={deliveryStatusTitle}
                        >
                          <span aria-hidden="true">{whatsAppIsResolved ? "OK" : "..."}</span>
                          {whatsAppIsResolved ? "Enviado" : "Sugerido"}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  <span className={clientOperationalStatusTone(operationalStatus)}>
                    {clientOperationalStatusLabel(operationalStatus)}
                  </span>
                </div>
                <div className="ar-client-summary-main">
                  <span className={`debt-meta ar-rent-line ${row.rentAmount > 0 ? "amount-debt" : "amount-good"}`}>
                    {isRouteWorkflow ? `Total a gestionar: ${formatCurrency(totalDue)}` : row.hasActiveClient ? `Letra: ${formatCurrency(row.rentAmount)}` : "Sin renta activa"}
                  </span>
                  <span className="debt-meta ar-truncate-line ar-client-person" title={row.name}>{row.name}</span>
                  <div className="ar-payment-state-row">
                    <span className={`ar-last-payment-date ${lastPaymentIsToday ? "ar-last-payment-date--today" : ""}`}>
                      {lastPaymentLabel(row.lastPaymentDate, now)}
                    </span>
                    <span className={stateToneClass(row.state)}>{STATE_LABEL[row.state]}</span>
                  </div>
                  {isRouteWorkflow ? (
                    <div className="ar-card-key-grid ar-card-key-grid--route">
                      <span className="ar-metric-chip ar-metric-chip--debt"><small>Renta vencida</small>{formatCurrency(row.overdueBalance)}</span>
                      <span className="ar-metric-chip ar-metric-chip--debt"><small>Otros cargos</small>{formatCurrency(row.totalOtherCharges)}</span>
                      <span className="ar-metric-chip ar-metric-chip--late"><small>Atraso</small>{row.daysLate > 0 ? `${row.daysLate} dias` : "Sin atraso"}</span>
                    </div>
                  ) : (
                    <div className="ar-card-key-grid">
                      <span className={`ar-metric-chip ar-metric-chip--plan ar-metric-chip--plan-${row.hasActiveClient ? row.plan : "none"}`}><small>Plan</small>{planDetailLabel(row)}</span>
                      <span className="ar-metric-chip ar-metric-chip--date"><small>Proximo</small>{dateKeyLabel(row.nextDueDate)}</span>
                      <span className="ar-metric-chip ar-metric-chip--late"><small>Atraso</small>{row.daysLate > 0 ? `${row.daysLate} dias` : "Sin atraso"}</span>
                      <span className="ar-metric-chip ar-metric-chip--debt"><small>Renta vencida</small>{formatCurrency(row.overdueBalance)}</span>
                      <span className="ar-metric-chip ar-metric-chip--debt"><small>Otros cargos</small>{formatCurrency(row.totalOtherCharges)}</span>
                      <span className="ar-metric-chip ar-metric-chip--debt"><small>Total general</small>{formatCurrency(totalDue)}</span>
                    </div>
                  )}
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
              {showContactTimeSupport ? (
                <div className={`ar-contact-time-note ar-contact-time-note--${contactMeta.tone}`}>
                  <span>{contactMeta.label}</span>
                  <label title={statusRecord?.contactTime ? `Editar hora ${statusRecord.contactTime}` : "Agregar hora de contacto"}>
                    <input
                      className="ar-contact-time-input"
                      type="text"
                      list={`contact-time-options-${row.id}`}
                      value={contactTimeDraft}
                      onChange={(event) => handleContactTimeDraftChange(event.target.value)}
                      onBlur={handleContactTimeDraftBlur}
                      disabled={isTodayCollectionClosed}
                      placeholder="8:30 AM"
                      maxLength={8}
                      aria-label={`Hora de contacto de ${row.unitId}`}
                    />
                    <datalist id={`contact-time-options-${row.id}`}>
                      {CONTACT_TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>{time}</option>
                      ))}
                    </datalist>
                  </label>
                </div>
              ) : null}
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
  previous.workflowTab === next.workflowTab &&
  previous.collectionCutItems === next.collectionCutItems &&
  previous.visibleCutKey === next.visibleCutKey &&
  previous.whatsAppMessage === next.whatsAppMessage &&
  previous.onCollectionCutStatusChange === next.onCollectionCutStatusChange &&
  previous.onCollectionCutCommentChange === next.onCollectionCutCommentChange &&
  previous.onRouteReleaseAmountChange === next.onRouteReleaseAmountChange &&
  previous.onWhatsAppMessageSent === next.onWhatsAppMessageSent &&
  previous.onSupportNoteChange === next.onSupportNoteChange &&
  previous.onContactTimeChange === next.onContactTimeChange
));
