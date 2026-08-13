import { memo, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { inlineComputedStylesForCanvas } from "../../canvasExportStyles";
import { formatCurrency, formatDate } from "../../format";
import { PLAN_LABEL, STATE_LABEL, WEEKDAY_LABEL, type ReceivableRow } from "../../receivables";
import type { CollectionStatus, CollectionStatusRecord, FieldManagementType, RouteUrgency } from "./receivablesTypes";
import {
  COLLECTION_CUT_OPTIONS,
  DAILY_COLLECTION_STATUS_OPTIONS,
  ROUTE_ASSIGNMENT_OPTIONS,
  ROUTE_COLLECTION_STATUS_OPTIONS,
  ROUTE_URGENCY_OPTIONS,
  COLLECTION_STATUS_HELP,
  CONTACT_TIME_OPTIONS,
  clientOperationalStatusLabel,
  clientOperationalStatusTone,
  normalizeContactTime,
  normalizeRouteAssignment,
  overdueInstallmentsText,
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
  statementGroupRows?: ReceivableRow[];
  onSelectDetail: (row: ReceivableRow) => void;
  onCollectionCutStatusChange: (cutKey: CollectionCutKey, clientId: string, nextStatus: string) => void;
  onCollectionCutCommentChange: (cutKey: CollectionCutKey, clientId: string, value: string) => void;
  onRouteTagChange: (clientId: string, tagged: boolean) => void;
  onRouteManagementTypeChange: (clientId: string, value: FieldManagementType) => void;
  onRouteManagementCommentChange: (clientId: string, value: string) => void;
  onRouteAssignmentChange: (clientId: string, value: string) => void;
  onRouteUrgencyChange: (clientId: string, value: RouteUrgency) => void;
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

function isStatementChargeDay(row: ReceivableRow, date: Date): boolean {
  const weekDay = date.getDay();
  if (row.plan === "daily") {
    if (weekDay >= 1 && weekDay <= 6) return true;
    return weekDay === 0 && !!row.chargeFirstSunday && row.installmentsPaid <= 7;
  }
  if (row.plan === "weekly") {
    const dayMap: Record<NonNullable<ReceivableRow["weeklyChargeDay"]>, number> = {
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };
    return weekDay === dayMap[row.weeklyChargeDay ?? "monday"];
  }
  if (row.plan === "biweekly") {
    const day = date.getDate();
    if (day === 15) return true;
    if (date.getMonth() === 1) return day === new Date(date.getFullYear(), 2, 0).getDate();
    return day === 30;
  }
  const day = date.getDate();
  const monthlyChargeDay = row.monthlyChargeDay ?? 1;
  const adjustedMonthlyDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return day === Math.min(monthlyChargeDay, adjustedMonthlyDay);
}

function roundStatementMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function statementRentSplit(row: ReceivableRow, now: Date): { overdueRent: number; currentRent: number } {
  const totalPending = roundStatementMoney(Math.max(0, row.totalPending));
  if (totalPending <= 0) return { overdueRent: 0, currentRent: 0 };
  const currentRent = isStatementChargeDay(row, now)
    ? roundStatementMoney(Math.min(Math.max(0, row.rentAmount), totalPending))
    : roundStatementMoney(Math.max(0, totalPending - Math.max(0, row.overdueBalance)));
  return {
    overdueRent: roundStatementMoney(Math.max(0, totalPending - currentRent)),
    currentRent
  };
}

function statementInstallmentsLabel(amount: number, rentAmount: number): string {
  if (rentAmount <= 0 || amount <= 0) return "";
  const installments = amount / rentAmount;
  const wholeInstallments = Math.floor(installments);
  const hasPartialInstallment = amount - wholeInstallments * rentAmount > 0.01;
  if (wholeInstallments <= 0) return hasPartialInstallment ? " (1 cuota parcial)" : "";
  const wholeLabel = `${wholeInstallments} cuota${wholeInstallments === 1 ? "" : "s"}`;
  return ` (${wholeLabel}${hasPartialInstallment ? " + parcial" : ""})`;
}

function statementRoundedInstallmentsLabel(amount: number, rentAmount: number): string {
  if (rentAmount <= 0 || amount <= 0) return "";
  const installments = Math.ceil(amount / rentAmount);
  return ` (${installments} cuota${installments === 1 ? "" : "s"})`;
}

function statementWholeAndPartialRent(amount: number, rentAmount: number): { wholeRent: number; partialRent: number } {
  if (rentAmount <= 0 || amount <= 0) return { wholeRent: roundStatementMoney(Math.max(0, amount)), partialRent: 0 };
  const wholeInstallments = Math.floor(amount / rentAmount);
  const wholeRent = roundStatementMoney(wholeInstallments * rentAmount);
  return {
    wholeRent,
    partialRent: roundStatementMoney(Math.max(0, amount - wholeRent))
  };
}

function StatementBalanceCard({ row, now }: { row: ReceivableRow; now: Date }) {
  const planLabel = planDetailLabel(row);
  const { overdueRent, currentRent } = statementRentSplit(row, now);
  const { wholeRent: fullOverdueRent, partialRent: overduePartialRent } = statementWholeAndPartialRent(overdueRent, row.rentAmount);
  const showOverduePartialRent = overduePartialRent > 0;
  const showOverdueRent = fullOverdueRent > 0;
  const showCurrentRent = currentRent > 0;
  const overdueInstallmentsLabel = statementInstallmentsLabel(fullOverdueRent, row.rentAmount);
  const currentInstallmentsLabel = statementInstallmentsLabel(currentRent, row.rentAmount);
  const totalInstallmentsLabel = statementRoundedInstallmentsLabel(row.totalPending, row.rentAmount);
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
        {showOverduePartialRent ? (
          <div className="statement-detail-row">
            <span>Saldo para bajar una cuota vencida <em>(1 cuota parcial)</em></span>
            <strong>{formatCurrency(overduePartialRent)}</strong>
          </div>
        ) : null}
        {showOverdueRent ? (
          <div className="statement-detail-row">
            <span>Renta vencida{overdueInstallmentsLabel ? <em>{overdueInstallmentsLabel}</em> : null}</span>
            <strong>{formatCurrency(fullOverdueRent)}</strong>
          </div>
        ) : null}
        {showCurrentRent ? (
          <div className="statement-detail-row">
            <span>Saldo corriente{showOverdueRent || showOverduePartialRent ? "" : " (no vencido)"}{currentInstallmentsLabel ? <em>{currentInstallmentsLabel}</em> : null}</span>
            <strong>{formatCurrency(currentRent)}</strong>
          </div>
        ) : null}
        <div className="statement-detail-row statement-detail-row--total">
          <span>Total pendiente{totalInstallmentsLabel ? <em>{totalInstallmentsLabel}</em> : null}</span>
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

function statementShortDate(value: string | null | undefined): string {
  if (!value) return "Sin pagos";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin pagos";
  return date.toLocaleDateString("es-PA", { day: "2-digit", month: "2-digit" });
}

function statementInstallmentsSummary(row: ReceivableRow): string {
  const totalPending = Math.max(0, row.totalPending);
  if (totalPending <= 0) return "Al día";
  if (row.rentAmount <= 0) return "Saldo pendiente";
  const installments = Math.ceil(totalPending / row.rentAmount);
  return `${installments} cuota${installments === 1 ? "" : "s"}`;
}

function ConsolidatedStatementBalanceCard({ rows, now }: { rows: ReceivableRow[]; now: Date }) {
  const primaryRow = rows[0];
  const totalPending = roundStatementMoney(rows.reduce((sum, item) => sum + Math.max(0, item.totalPending), 0));
  return (
    <div className="statement-card">
      <div className="statement-topbar">
        <div className="statement-title">Estado de cuenta</div>
        <div className="statement-date">Al {formatDate(now)}</div>
      </div>

      <div className="statement-consolidated-client">
        <span>Cliente</span>
        <strong>{primaryRow?.name || "Cliente"}</strong>
      </div>

      <div className="statement-total-panel">
        <span>Total pendiente</span>
        <strong>{formatCurrency(totalPending)}</strong>
      </div>

      <div className="statement-consolidated-list">
        {rows.map((item) => {
          const itemPending = roundStatementMoney(Math.max(0, item.totalPending));
          const lastPaymentValue = item.lastPaymentAt ?? (item.lastPaymentDate ? `${item.lastPaymentDate}T12:00:00` : null);
          return (
            <div className="statement-consolidated-unit" key={item.id}>
              <div className="statement-consolidated-unit-main">
                <strong>{item.unitId}</strong>
                <b className={itemPending > 0 ? "" : "is-paid"}>{itemPending > 0 ? formatCurrency(itemPending) : "AL DÍA"}</b>
              </div>
              <div className="statement-consolidated-unit-meta">
                <span>{statementInstallmentsSummary(item)}</span>
                <span>Último pago: {statementShortDate(lastPaymentValue)}</span>
              </div>
            </div>
          );
        })}
        <div className="statement-consolidated-count">
          {rows.length} unidad{rows.length === 1 ? "" : "es"}
        </div>
      </div>

      <div className="statement-note">
        Si ya realizo el pago recientemente, por favor ignore este aviso. Gracias.
      </div>
    </div>
  );
}

async function buildReceivableBalanceCanvas(rows: ReceivableRow[], now: Date): Promise<HTMLCanvasElement> {
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
          <ConsolidatedStatementBalanceCard rows={rows} now={now} />
        </div>
      </div>
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (document.fonts?.ready) await document.fonts.ready;
    const target = host.querySelector(".statement-export-frame") as HTMLDivElement | null;
    if (!target) throw new Error("No se pudo renderizar el estado de cuenta.");
    const html2canvas = (await import("html2canvas")).default;
    const restoreStyles = inlineComputedStylesForCanvas(target);
    try {
      return await html2canvas(target, {
        scale: 1,
        backgroundColor: "#ffffff",
        useCORS: true,
        width: target.scrollWidth,
        height: target.scrollHeight
      });
    } finally {
      restoreStyles();
    }
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

function downloadReceivableBalanceImage(rows: ReceivableRow[], canvas: HTMLCanvasElement): void {
  const primaryRow = rows[0];
  const link = document.createElement("a");
  link.download = `saldo-consolidado-${safeFilenamePart(primaryRow?.name || "cliente")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function copyReceivableBalanceImage(rows: ReceivableRow[], now: Date): Promise<"copied" | "downloaded"> {
  const canvas = await buildReceivableBalanceCanvas(rows, now);
  const blob = await canvasToPngBlob(canvas);
  const clipboard = navigator.clipboard as Clipboard & {
    write?: (items: ClipboardItem[]) => Promise<void>;
  };
  if (typeof clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
    await clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return "copied";
  }
  downloadReceivableBalanceImage(rows, canvas);
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
  statementGroupRows,
  onSelectDetail,
  onCollectionCutStatusChange,
  onCollectionCutCommentChange,
  onRouteTagChange,
  onRouteManagementTypeChange,
  onRouteManagementCommentChange,
  onRouteAssignmentChange,
  onRouteUrgencyChange,
  onRouteReleaseAmountChange,
  onWhatsAppMessageSent,
  onSupportNoteChange,
  onContactTimeChange
}: Props) {
  const [isCopyingBalanceImage, setIsCopyingBalanceImage] = useState(false);
  const statementWasSentRecently = hasTimestampWithinWindow(statusRecord?.whatsAppMessageSentAt, now, STATEMENT_SUGGESTION_WINDOW_MS);
  const isEligibleForWhatsApp = isWhatsAppEligibleUnit(row, operationalStatus);
  const canSendToRoute = isWhatsAppEligibleUnit(row, operationalStatus);
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
  const consolidatedStatementRows = statementGroupRows?.length ? statementGroupRows : [row];
  const balanceImageTitle = isCopyingBalanceImage
    ? "Preparando estado de cuenta..."
    : consolidatedStatementRows.length > 1
      ? `Preparar estado consolidado para compartir (${consolidatedStatementRows.length} unidades)`
      : "Preparar estado de cuenta para compartir";
  const visibleCutOptions = visibleCutKey === "all"
    ? COLLECTION_CUT_OPTIONS
    : COLLECTION_CUT_OPTIONS.filter((option) => option.key === visibleCutKey);
  const totalDue = row.overdueBalance + row.totalOtherCharges;
  const isRouteHighlighted = !!statusRecord?.isRouteTagged;
  const isRouteWorkflow = workflowTab === "route";
  const groupedWhatsAppRows = whatsAppGroupRows?.filter((item) => item.id !== row.id) ?? [];
  const groupedWhatsAppUnits = groupedWhatsAppRows.map((item) => item.unitId).filter(Boolean);
  const [contactTimeDraft, setContactTimeDraft] = useState(statusRecord?.contactTime ?? "");
  const [customRouteEditorOpen, setCustomRouteEditorOpen] = useState(false);
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
  const routeReleaseAmount = statusRecord?.routeReleaseAmount ?? statusRecord?.managementAmount;
  const routeAssignment = statusRecord?.routeAssignment ?? "";
  const routeUrgency = statusRecord?.routeUrgency ?? "normal";
  const routeUrgencyLabel = ROUTE_URGENCY_OPTIONS.find((option) => option.value === routeUrgency)?.label ?? "Normal";
  const isRouteReleaseAmountMissing = typeof routeReleaseAmount !== "number" || routeReleaseAmount <= 0;
  const isRouteAssignmentMissing = !routeAssignment;
  const missingRouteRequirements = [
    isRouteReleaseAmountMissing ? "saldo para liberar" : null,
    isRouteAssignmentMissing ? "ruta asignada" : null
  ].filter((item): item is string => !!item);
  const isRoutePreparationComplete = missingRouteRequirements.length === 0;

  useEffect(() => {
    setContactTimeDraft(statusRecord?.contactTime ?? "");
  }, [statusRecord?.contactTime]);

  useEffect(() => {
    if (!isRouteModalOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsRouteModalOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRouteModalOpen]);

  function handleConfirmWhatsAppSent(): void {
    onWhatsAppMessageSent(row.id, whatsAppMessage);
  }

  async function handleCopyBalanceImage(): Promise<void> {
    if (isCopyingBalanceImage) return;
    setIsCopyingBalanceImage(true);
    try {
      const result = await copyReceivableBalanceImage(consolidatedStatementRows, now);
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
    const isRouteTagged = !!statusRecord?.isRouteTagged;
    const rawValue = isRouteTagged
      ? "pending"
      : item?.collectionStatus ?? (cutKey === "night" ? statusRecord?.status : undefined) ?? defaultCollectionStatus(row, operationalStatus, cutKey);
    const baseStatusOptions = workflowTab === "route" ? ROUTE_COLLECTION_STATUS_OPTIONS : getStatusOptionsForCut(cutKey);
    const statusOptions = baseStatusOptions;
    const value = statusOptions.some((option) => option.value === rawValue) ? rawValue : "";
    const selectedStatusHelp = value ? COLLECTION_STATUS_HELP[value as CollectionStatus] : undefined;
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
            disabled={isTodayCollectionClosed || isRouteTagged}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value} title={option.description}>{option.label}</option>
            ))}
          </select>
          {isRouteTagged || canSendToRoute ? <div className={`ar-route-inline-control ${isRouteTagged ? "is-active" : ""}`}>
            {workflowTab === "management" ? (
              isRouteTagged ? (
                <>
                  <div className="ar-route-primary-actions">
                    <button
                      type="button"
                      className={`button ghost small ar-route-tag-toggle is-active ar-route-tag-toggle--${routeUrgency}`}
                      onClick={() => onRouteTagChange(row.id, false)}
                      disabled={isTodayCollectionClosed}
                      aria-pressed="true"
                      title="Quitar etiqueta En ruta"
                    >
                      En ruta{routeUrgency !== "normal" ? ` · ${routeUrgencyLabel}` : ""} ×
                    </button>
                    <button
                      type="button"
                      className={`button small ar-route-details-button ${isRoutePreparationComplete ? "is-complete" : "needs-action"}`}
                      onClick={() => setIsRouteModalOpen(true)}
                      disabled={isTodayCollectionClosed}
                    >
                      {isRoutePreparationComplete ? "Ver detalles" : "Completar ruta"}
                    </button>
                  </div>
                  <div className="ar-route-compact-summary" aria-label={`Resumen de ruta de ${row.unitId}`}>
                    <span title="Saldo para liberar"><strong>{routeReleaseAmount ? formatCurrency(routeReleaseAmount) : "Monto pendiente"}</strong></span>
                    <span title="Ruta asignada"><strong>{routeAssignment || "Ruta pendiente"}</strong></span>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="button ghost small ar-route-tag-toggle"
                  onClick={() => {
                    onRouteTagChange(row.id, true);
                    setIsRouteModalOpen(true);
                  }}
                  disabled={isTodayCollectionClosed}
                  aria-pressed="false"
                >
                  Enviar a ruta
                </button>
              )
            ) : <span className="ar-route-tab-handoff">Pendiente · En ruta</span>}
          </div> : null}
          {item?.comment ? (
            <span className="hint ar-cut-comment">Comentario: {item.comment}</span>
          ) : null}
          <div className="ar-cut-actions">
            {workflowTab === "route" ? <span>En ruta</span> : null}
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
                    <div className="ar-unit-quick-actions">
                        <button
                          type="button"
                          className={`button small ar-whatsapp-phone-edit ar-whatsapp-image-button ${isCopyingBalanceImage ? "ar-whatsapp-image-button--copying" : ""}`}
                          onClick={() => void handleCopyBalanceImage()}
                          disabled={isTodayCollectionClosed || isCopyingBalanceImage}
                          title={balanceImageTitle}
                          aria-label={balanceImageTitle}
                        >
                          {isCopyingBalanceImage ? (
                            <>
                              <span className="ar-copy-spinner" aria-hidden="true" />
                              <span>Copiando...</span>
                            </>
                          ) : (
                            <>
                              <BalanceImageIcon />
                              <span>Compartir estado</span>
                            </>
                          )}
                        </button>
                        {!isRouteWorkflow && showStatementSuggestion ? (
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
                    </div>
                    <div className="ar-unit-heading">
                      <strong className="ar-unit-id">{row.unitId}</strong>
                      <span className={clientOperationalStatusTone(operationalStatus)}>
                        {clientOperationalStatusLabel(operationalStatus)}
                      </span>
                    </div>
                    {!isRouteWorkflow && groupedWhatsAppUnits.length > 0 ? (
                      <span
                        className="ar-whatsapp-group-badge"
                        title={`Mensaje conjunto: ${[row.unitId, ...groupedWhatsAppUnits].join(", ")}`}
                      >
                        +{groupedWhatsAppUnits.length} unidad{groupedWhatsAppUnits.length === 1 ? "" : "es"}
                      </span>
                    ) : null}
                    <span className="ar-unit-client-name" title={row.name}>{row.name}</span>
                    <div className="ar-unit-collection-meta">
                      <span className={`ar-last-payment-date ${lastPaymentIsToday ? "ar-last-payment-date--today" : ""}`}>
                        {lastPaymentLabel(row.lastPaymentDate, now)}
                      </span>
                      <span className={stateToneClass(row.state)}>{STATE_LABEL[row.state]}</span>
                    </div>
                  </div>
                </div>
                <div className="ar-client-summary-main">
                  {isRouteWorkflow ? (
                    <span className="debt-meta ar-rent-line amount-debt">
                      Total a gestionar: {formatCurrency(totalDue)}
                    </span>
                  ) : null}
                  {isRouteWorkflow ? (
                    <div className="ar-card-key-grid ar-card-key-grid--route">
                      <span className="ar-metric-chip ar-metric-chip--debt">
                        <small>Renta vencida</small>
                        <strong className="ar-overdue-chip-amount">{formatCurrency(row.overdueBalance)}</strong>
                        {overdueInstallmentsText(row.overdueBalance, row.rentAmount) ? (
                          <em className="ar-overdue-chip-installments">{overdueInstallmentsText(row.overdueBalance, row.rentAmount)}</em>
                        ) : null}
                      </span>
                      <span className="ar-metric-chip ar-metric-chip--debt"><small>Otros cargos</small>{formatCurrency(row.totalOtherCharges)}</span>
                      <span className="ar-metric-chip ar-metric-chip--late"><small>Atraso</small>{row.daysLate > 0 ? `${row.daysLate} dias` : "Sin atraso"}</span>
                    </div>
                  ) : (
                    <div className="ar-card-key-grid">
                      <span className={`ar-metric-chip ar-metric-chip--plan ar-metric-chip--plan-${row.hasActiveClient ? row.plan : "none"}`}>
                        <small>Plan</small>
                        <strong className="ar-plan-chip-name">{planDetailLabel(row)}</strong>
                        {row.hasActiveClient && row.rentAmount > 0 ? (
                          <em className="ar-plan-chip-rent">Letra {formatCurrency(row.rentAmount)}</em>
                        ) : null}
                      </span>
                      <span className="ar-metric-chip ar-metric-chip--date"><small>Proximo</small>{dateKeyLabel(row.nextDueDate)}</span>
                      <span className="ar-metric-chip ar-metric-chip--late"><small>Atraso</small>{row.daysLate > 0 ? `${row.daysLate} dias` : "Sin atraso"}</span>
                      <span className="ar-metric-chip ar-metric-chip--debt">
                        <small>Renta vencida</small>
                        <strong className="ar-overdue-chip-amount">{formatCurrency(row.overdueBalance)}</strong>
                        {overdueInstallmentsText(row.overdueBalance, row.rentAmount) ? (
                          <em className="ar-overdue-chip-installments">{overdueInstallmentsText(row.overdueBalance, row.rentAmount)}</em>
                        ) : null}
                      </span>
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
        {isRouteModalOpen && statusRecord?.isRouteTagged && typeof document !== "undefined" ? createPortal(
          <div className="modal-overlay ar-route-modal-overlay" onClick={() => setIsRouteModalOpen(false)}>
            <div
              className="modal ar-route-preparation-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`route-modal-title-${row.id}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-header ar-route-modal-header">
                <div>
                  <span className="ar-route-modal-kicker">Preparación de cobro</span>
                  <h2 id={`route-modal-title-${row.id}`}>{row.unitId} · {row.name}</h2>
                </div>
                <button type="button" className="modal-close" onClick={() => setIsRouteModalOpen(false)} aria-label="Cerrar">×</button>
              </div>
              <div className="ar-route-modal-body">
                <div className={`ar-route-modal-readiness ${isRoutePreparationComplete ? "is-complete" : "needs-action"}`}>
                  <strong>{isRoutePreparationComplete ? "Ruta preparada" : "Falta completar la ruta"}</strong>
                  <span>
                    {isRoutePreparationComplete
                      ? "Ya puede incluirse al publicar la ruta."
                      : `Falta: ${missingRouteRequirements.join(" y ")}.`}
                  </span>
                </div>
                <div className="ar-route-modal-grid">
                  <label className={isRouteReleaseAmountMissing ? "is-required-missing" : undefined}>
                    <span>Libera con {isRouteReleaseAmountMissing ? "· Requerido" : ""}</span>
                    <input
                      className="ar-route-release-input"
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={routeReleaseAmount ?? ""}
                      onChange={(event) => onRouteReleaseAmountChange(row.id, event.target.value)}
                      placeholder={row.overdueBalance > 0 ? row.overdueBalance.toFixed(2) : "0.00"}
                      disabled={isTodayCollectionClosed}
                      aria-label={`Saldo para liberar de ${row.unitId}`}
                    />
                  </label>
                  <label className={isRouteAssignmentMissing ? "is-required-missing" : undefined}>
                    <span>Ruta {isRouteAssignmentMissing ? "· Requerida" : ""}</span>
                    {customRouteEditorOpen || (!!routeAssignment && !ROUTE_ASSIGNMENT_OPTIONS.includes(routeAssignment)) ? (
                      <input
                        type="text"
                        value={routeAssignment}
                        onChange={(event) => onRouteAssignmentChange(row.id, event.target.value)}
                        onBlur={(event) => {
                          const normalized = normalizeRouteAssignment(event.target.value);
                          if (event.target.value !== (normalized ?? "")) onRouteAssignmentChange(row.id, normalized ?? "");
                          if (!normalized) setCustomRouteEditorOpen(false);
                        }}
                        placeholder="Escribe ruta"
                        maxLength={12}
                        disabled={isTodayCollectionClosed}
                      />
                    ) : (
                      <select
                        value={routeAssignment}
                        onChange={(event) => {
                          if (event.target.value === "__custom") {
                            setCustomRouteEditorOpen(true);
                            onRouteAssignmentChange(row.id, "");
                            return;
                          }
                          onRouteAssignmentChange(row.id, event.target.value);
                        }}
                        disabled={isTodayCollectionClosed}
                      >
                        <option value="">Sin ruta</option>
                        {ROUTE_ASSIGNMENT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                        <option value="__custom">Otra</option>
                      </select>
                    )}
                  </label>
                  <label>
                    <span>Tipo de gestión</span>
                    <select
                      value={statusRecord?.managementType ?? "solo_cobrar"}
                      onChange={(event) => onRouteManagementTypeChange(row.id, event.target.value as FieldManagementType)}
                      disabled={isTodayCollectionClosed}
                    >
                      <option value="solo_cobrar">Solo cobrar</option>
                      <option value="cobrar_o_quitar">Cobrar o quitar</option>
                      <option value="desiste">Desiste</option>
                      <option value="quitar">Quitar</option>
                    </select>
                  </label>
                  <label>
                    <span>Urgencia</span>
                    <select
                      value={routeUrgency}
                      onChange={(event) => onRouteUrgencyChange(row.id, event.target.value as RouteUrgency)}
                      disabled={isTodayCollectionClosed}
                    >
                      {ROUTE_URGENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="ar-route-modal-comment">
                    <span>Comentario</span>
                    <textarea
                      value={statusRecord?.managementComment ?? ""}
                      onChange={(event) => onRouteManagementCommentChange(row.id, event.target.value)}
                      placeholder="Comentario para el cobrador..."
                      maxLength={25}
                      rows={3}
                      disabled={isTodayCollectionClosed}
                    />
                  </label>
                </div>
              </div>
              <div className="ar-route-modal-actions">
                <button type="button" className="button ghost" onClick={() => onRouteTagChange(row.id, false)} disabled={isTodayCollectionClosed}>
                  Quitar de ruta
                </button>
                <button type="button" className="button primary" onClick={() => setIsRouteModalOpen(false)}>
                  Listo
                </button>
              </div>
            </div>
          </div>,
          document.body
        ) : null}
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
  previous.whatsAppGroupRows === next.whatsAppGroupRows &&
  previous.statementGroupRows === next.statementGroupRows &&
  previous.onCollectionCutStatusChange === next.onCollectionCutStatusChange &&
  previous.onCollectionCutCommentChange === next.onCollectionCutCommentChange &&
  previous.onRouteTagChange === next.onRouteTagChange &&
  previous.onRouteManagementTypeChange === next.onRouteManagementTypeChange &&
  previous.onRouteManagementCommentChange === next.onRouteManagementCommentChange &&
  previous.onRouteAssignmentChange === next.onRouteAssignmentChange &&
  previous.onRouteUrgencyChange === next.onRouteUrgencyChange &&
  previous.onRouteReleaseAmountChange === next.onRouteReleaseAmountChange &&
  previous.onWhatsAppMessageSent === next.onWhatsAppMessageSent &&
  previous.onSupportNoteChange === next.onSupportNoteChange &&
  previous.onContactTimeChange === next.onContactTimeChange
));
