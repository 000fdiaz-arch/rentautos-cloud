import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getBusinessDateKey, parseDateKey, toDateKey } from "../../billing";
import { copyHistoryPaymentReceiptImage, downloadPaymentsReceiptsZip } from "../../components/PaymentReceipt";
import { formatCurrency, formatDate } from "../../format";
import type { Client, Payment } from "../../types";
import { EMPTY_HISTORY_COLUMN_FILTERS } from "./paymentConstants";
import { PAYMENT_HISTORY_LIMIT } from "./paymentHistory";
import { getInstallmentsTotalInPayment } from "./paymentRules";
import type {
  HistoryColumnFilters,
  HistoryCopyFeedback,
  HistoryDeliveryFilter,
  HistorySortField,
  SortDirection
} from "./paymentTypes";

const MISDATED_RECEIPT_REPAIR_START = 18185;

function parseReceiptSequence(receiptNumber: string): number | null {
  const match = receiptNumber.trim().toUpperCase().match(/^REC-([0-9]+)$/);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isFinite(sequence) ? sequence : null;
}

export type HistoryFocusRequest = {
  clientId: string;
  token: number;
};

type Props = {
  historySectionRef: RefObject<HTMLElement>;
  isHistoryOpen: boolean;
  activeClients: Client[];
  payments: Payment[];
  onPaymentsChange: (next: Payment[]) => void;
  isPaymentHistoryLoaded: boolean;
  onRefreshPayments?: () => Promise<void>;
  isDateClosed: (dateKey: string) => boolean;
  getGroupCode: (unitId: string) => string;
  focusRequest: HistoryFocusRequest | null;
  onPreviewPayment: (payment: Payment) => void;
  onDeletePayment: (payment: Payment) => void;
};

function getTodayDateKey(): string {
  return getBusinessDateKey();
}

function getPreviousDateKey(dateKey: string): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  parsed.setDate(parsed.getDate() - 1);
  return toDateKey(parsed);
}

export default function PaymentHistoryPanel({
  historySectionRef,
  isHistoryOpen,
  activeClients,
  payments,
  onPaymentsChange,
  isPaymentHistoryLoaded,
  onRefreshPayments,
  isDateClosed,
  getGroupCode,
  focusRequest,
  onPreviewPayment,
  onDeletePayment
}: Props) {
  const [historyClientId, setHistoryClientId] = useState<string>("all");
  const [historyGroupFilter, setHistoryGroupFilter] = useState<string>("all");
  const [historyDeliveryFilter, setHistoryDeliveryFilter] = useState<HistoryDeliveryFilter>("all");
  const [historyDateFrom, setHistoryDateFrom] = useState<string>("");
  const [historyDateTo, setHistoryDateTo] = useState<string>("");
  const [historyColumnFilters, setHistoryColumnFilters] = useState<HistoryColumnFilters>({ ...EMPTY_HISTORY_COLUMN_FILTERS });
  const [historySortField, setHistorySortField] = useState<HistorySortField>("date");
  const [historySortDirection, setHistorySortDirection] = useState<SortDirection>("desc");
  const [historyVisibleLimit, setHistoryVisibleLimit] = useState(PAYMENT_HISTORY_LIMIT);
  const [historySelectedPaymentIds, setHistorySelectedPaymentIds] = useState<string[]>([]);
  const [isHistoryBulkDownloading, setIsHistoryBulkDownloading] = useState(false);
  const [historyBulkDownloadError, setHistoryBulkDownloadError] = useState("");
  const [historyCopiedPaymentIds, setHistoryCopiedPaymentIds] = useState<Set<string>>(() => new Set());
  const [historyCopyingPaymentId, setHistoryCopyingPaymentId] = useState<string | null>(null);
  const [historyCopyFeedback, setHistoryCopyFeedback] = useState<HistoryCopyFeedback | null>(null);
  const [isHistoryRefreshing, setIsHistoryRefreshing] = useState(false);
  const [dateRepairFeedback, setDateRepairFeedback] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [historyRefreshFeedback, setHistoryRefreshFeedback] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const historyTopScrollRef = useRef<HTMLDivElement>(null);
  const historyTopInnerRef = useRef<HTMLDivElement>(null);
  const historyBottomScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!historyCopyFeedback || historyCopyFeedback.tone === "info") return;
    const timeoutId = window.setTimeout(() => setHistoryCopyFeedback(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [historyCopyFeedback]);

  useEffect(() => {
    if (!historyRefreshFeedback) return;
    const timeoutId = window.setTimeout(() => setHistoryRefreshFeedback(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [historyRefreshFeedback]);

  useEffect(() => {
    if (!focusRequest) return;
    setHistoryClientId(focusRequest.clientId);
    setHistoryGroupFilter("all");
    setHistoryDeliveryFilter("all");
    setHistoryDateFrom("");
    setHistoryDateTo("");
    setHistoryColumnFilters({ ...EMPTY_HISTORY_COLUMN_FILTERS });
    setHistorySortField("date");
    setHistorySortDirection("desc");
    setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
    setHistorySelectedPaymentIds([]);
  }, [focusRequest]);

  useEffect(() => {
    if (!isHistoryOpen || isPaymentHistoryLoaded || !onRefreshPayments) return;
    void handleRefreshHistory();
  }, [isHistoryOpen, isPaymentHistoryLoaded, onRefreshPayments]);

function handleSortHistory(field: HistorySortField): void {
  if (historySortField === field) {
    setHistorySortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
    return;
  }
  setHistorySortField(field);
  setHistorySortDirection("desc");
}

function renderHistorySortIcon(field: HistorySortField): string {
  if (historySortField !== field) return "";
  return historySortDirection === "desc" ? "v" : "^";
}

function updateHistoryColumnFilter(field: keyof HistoryColumnFilters, value: string): void {
  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
  setHistoryColumnFilters((prev) => ({ ...prev, [field]: value }));
}

function clearHistoryColumnFilters(): void {
  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
  setHistoryColumnFilters({ ...EMPTY_HISTORY_COLUMN_FILTERS });
}

function clearHistoryFilters(): void {
  setHistoryClientId("all");
  setHistoryGroupFilter("all");
  setHistoryDeliveryFilter("all");
  setHistoryDateFrom("");
  setHistoryDateTo("");
  clearHistoryColumnFilters();
  setHistorySelectedPaymentIds([]);
}

function filterHistoryToday(): void {
  const today = getTodayDateKey();
  setHistoryDateFrom(today);
  setHistoryDateTo(today);
  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
}

const historyAvailableGroups = useMemo(() => {
  return [...new Set(
    payments
      .map((p) => getGroupCode(p.clientUnit))
      .filter((group) => group.length > 0)
  )].sort((a, b) => a.localeCompare(b));
}, [payments]);

const historyDateRangeError = useMemo(() => {
  if (historyDateFrom && historyDateTo && historyDateFrom > historyDateTo) {
    return "La fecha desde no puede ser mayor que la fecha hasta.";
  }
  return "";
}, [historyDateFrom, historyDateTo]);

const hasHistoryColumnFilters = useMemo(
  () => Object.values(historyColumnFilters).some((value) => value.trim().length > 0),
  [historyColumnFilters]
);

const hasHistoryFilters = useMemo(
  () =>
    historyClientId !== "all" ||
    historyGroupFilter !== "all" ||
    historyDeliveryFilter !== "all" ||
    Boolean(historyDateFrom) ||
    Boolean(historyDateTo) ||
    hasHistoryColumnFilters,
  [historyClientId, historyGroupFilter, historyDeliveryFilter, historyDateFrom, historyDateTo, hasHistoryColumnFilters]
);

const filteredHistoryRows = useMemo(() => {
  if (historyDateRangeError) return [];

  const byClient = historyClientId === "all"
    ? payments
    : payments.filter((p) => p.clientId === historyClientId);
  const byGroup = historyGroupFilter === "all"
    ? byClient
    : byClient.filter((p) => getGroupCode(p.clientUnit) === historyGroupFilter);
  const byDeliveryStatus = byGroup.filter((p) => {
    if (historyDeliveryFilter === "all") return true;
    const status = p.receiptDeliveryStatus === "pending" ? "pending" : "sent";
    return status === historyDeliveryFilter;
  });
  const filteredByDate = byDeliveryStatus.filter((p) => {
    if (historyDateFrom && p.dateApplied < historyDateFrom) return false;
    if (historyDateTo && p.dateApplied > historyDateTo) return false;
    return true;
  });
  const normalize = (value: string): string => value.trim().toLowerCase();
  const includesFilter = (target: string, filterValue: string): boolean => {
    const query = normalize(filterValue);
    if (!query) return true;
    return normalize(target).includes(query);
  };
  const filtered = filteredByDate.filter((p) => {
    const installments = getInstallmentsTotalInPayment(p);
    const amountLabel = `${p.amountReceived.toFixed(2)} ${formatCurrency(p.amountReceived)}`;
    const appliedLabel = `${p.appliedToRent.toFixed(2)} ${formatCurrency(p.appliedToRent)}`;
    const savingsLabel = `${p.centavosAhorro.toFixed(2)} ${formatCurrency(p.centavosAhorro)}`;
    const installmentsLabel = installments > 0 ? `-${installments}` : "-";
    return (
      includesFilter(p.receiptNumber, historyColumnFilters.receipt) &&
      includesFilter(p.dateApplied, historyColumnFilters.date) &&
      includesFilter(p.clientUnit, historyColumnFilters.unit) &&
      includesFilter(p.clientName, historyColumnFilters.client) &&
      includesFilter(amountLabel, historyColumnFilters.amount) &&
      includesFilter(appliedLabel, historyColumnFilters.applied) &&
      includesFilter(savingsLabel, historyColumnFilters.savings) &&
      includesFilter(installmentsLabel, historyColumnFilters.installments) &&
      includesFilter(p.paymentMethod, historyColumnFilters.method)
    );
  });
  const dir = historySortDirection === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    let comparison = 0;
    if (historySortField === "receipt") comparison = a.receiptNumber.localeCompare(b.receiptNumber);
    if (historySortField === "date") comparison = a.dateApplied.localeCompare(b.dateApplied);
    if (historySortField === "unit") comparison = a.clientUnit.localeCompare(b.clientUnit);
    if (historySortField === "client") comparison = a.clientName.localeCompare(b.clientName);
    if (historySortField === "amount") comparison = a.amountReceived - b.amountReceived;
    if (historySortField === "applied") comparison = a.appliedToRent - b.appliedToRent;
    if (historySortField === "savings") comparison = a.centavosAhorro - b.centavosAhorro;
    if (historySortField === "installments") comparison = getInstallmentsTotalInPayment(a) - getInstallmentsTotalInPayment(b);
    if (historySortField === "method") comparison = a.paymentMethod.localeCompare(b.paymentMethod);
    if (comparison !== 0) return comparison * dir;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return sorted;
}, [payments, historyClientId, historyGroupFilter, historyDeliveryFilter, historyDateFrom, historyDateTo, historySortDirection, historySortField, historyDateRangeError, historyColumnFilters]);

const historyRows = useMemo(
  () => filteredHistoryRows.slice(0, historyVisibleLimit),
  [filteredHistoryRows, historyVisibleLimit]
);
const hasMoreHistoryRows = historyRows.length < filteredHistoryRows.length;
const businessTodayKey = getTodayDateKey();
const previousBusinessDateKey = getPreviousDateKey(businessTodayKey);
const misdatedTodayPayments = useMemo(
  () => payments.filter((payment) => (
    payment.dateApplied === previousBusinessDateKey &&
    (parseReceiptSequence(payment.receiptNumber) ?? 0) >= MISDATED_RECEIPT_REPAIR_START
  )),
  [payments, previousBusinessDateKey]
);

useEffect(() => {
  if (!isHistoryOpen) return;
  const top = historyTopScrollRef.current;
  const bottom = historyBottomScrollRef.current;
  if (!top || !bottom) return;

  let syncing = false;
  const onTopScroll = () => {
    if (syncing) return;
    syncing = true;
    bottom.scrollLeft = top.scrollLeft;
    syncing = false;
  };
  const onBottomScroll = () => {
    if (syncing) return;
    syncing = true;
    top.scrollLeft = bottom.scrollLeft;
    syncing = false;
  };

  top.addEventListener("scroll", onTopScroll, { passive: true });
  bottom.addEventListener("scroll", onBottomScroll, { passive: true });
  return () => {
    top.removeEventListener("scroll", onTopScroll);
    bottom.removeEventListener("scroll", onBottomScroll);
  };
}, [isHistoryOpen, historyRows.length]);

useEffect(() => {
  if (!isHistoryOpen) return;
  const top = historyTopScrollRef.current;
  const topInner = historyTopInnerRef.current;
  const bottom = historyBottomScrollRef.current;
  if (!top || !topInner || !bottom) return;

  const updateTopWidth = () => {
    const table = bottom.querySelector("table");
    const width = table ? table.scrollWidth : bottom.scrollWidth;
    topInner.style.width = `${Math.max(width, bottom.clientWidth)}px`;
    top.scrollLeft = bottom.scrollLeft;
  };

  updateTopWidth();
  window.addEventListener("resize", updateTopWidth);
  return () => {
    window.removeEventListener("resize", updateTopWidth);
  };
}, [isHistoryOpen, historyRows.length]);

const historyRowsById = useMemo(() => {
  return new Map(historyRows.map((row) => [row.id, row]));
}, [historyRows]);
const historySelectedIdSet = useMemo(() => new Set(historySelectedPaymentIds), [historySelectedPaymentIds]);

const historySelectedRows = useMemo(() => {
  return historySelectedPaymentIds
    .map((id) => historyRowsById.get(id))
    .filter((row): row is Payment => Boolean(row));
}, [historySelectedPaymentIds, historyRowsById]);

const isAllHistoryRowsSelected = historyRows.length > 0 && historySelectedRows.length === historyRows.length;

useEffect(() => {
  setHistorySelectedPaymentIds((previous) => previous.filter((id) => historyRowsById.has(id)));
}, [historyRowsById]);

function toggleHistoryRowSelection(paymentId: string): void {
  setHistorySelectedPaymentIds((previous) =>
    previous.includes(paymentId)
      ? previous.filter((id) => id !== paymentId)
      : [...previous, paymentId]
  );
}

function toggleSelectAllHistoryRows(): void {
  if (historyRows.length === 0) {
    setHistorySelectedPaymentIds([]);
    return;
  }
  if (isAllHistoryRowsSelected) {
    setHistorySelectedPaymentIds([]);
    return;
  }
  setHistorySelectedPaymentIds(historyRows.map((row) => row.id));
}

async function handleCopyHistoryReceipt(payment: Payment): Promise<void> {
  if (historyCopyingPaymentId) return;

  const wasAlreadySent = payment.receiptDeliveryStatus !== "pending" || historyCopiedPaymentIds.has(payment.id);
  setHistoryCopyingPaymentId(payment.id);
  setHistoryCopyFeedback({
    paymentId: payment.id,
    tone: "info",
    message: `Preparando ${payment.receiptNumber} para copiar...`
  });

  try {
    await copyHistoryPaymentReceiptImage(payment);
    setHistoryCopiedPaymentIds((previous) => {
      if (previous.has(payment.id)) return previous;
      const next = new Set(previous);
      next.add(payment.id);
      return next;
    });
    if (payment.receiptDeliveryStatus === "pending") {
      onPaymentsChange(
        payments.map((row) =>
          row.id === payment.id
            ? { ...row, receiptDeliveryStatus: "sent" }
            : row
        )
      );
    }
    setHistoryCopyFeedback({
      paymentId: payment.id,
      tone: "success",
      message: wasAlreadySent
        ? `${payment.receiptNumber} se copió nuevamente. El estado se mantiene en "Enviado".`
        : `${payment.receiptNumber} copiado. El estado cambió a "Enviado".`
    });
  } catch {
    setHistoryCopyFeedback({
      paymentId: payment.id,
      tone: "error",
      message: `No se pudo copiar ${payment.receiptNumber}. Permite el acceso al portapapeles e intenta nuevamente.`
    });
  } finally {
    setHistoryCopyingPaymentId(null);
  }
}

async function handleRefreshHistory(): Promise<void> {
  if (isHistoryRefreshing || !onRefreshPayments) return;
  setIsHistoryRefreshing(true);
  setHistoryRefreshFeedback(null);
  try {
    await onRefreshPayments();
    setHistoryRefreshFeedback({
      tone: "success",
      message: "Historial de pagos actualizado."
    });
  } catch {
    setHistoryRefreshFeedback({
      tone: "error",
      message: "No se pudo actualizar el historial. Verifica la conexión e intenta nuevamente."
    });
  } finally {
    setIsHistoryRefreshing(false);
  }
}

async function handleDownloadHistorySelection(): Promise<void> {
  if (historySelectedRows.length === 0 || isHistoryBulkDownloading) return;
  setHistoryBulkDownloadError("");
  setIsHistoryBulkDownloading(true);
  try {
    await downloadPaymentsReceiptsZip(historySelectedRows, { format: "history" });
  } catch {
    setHistoryBulkDownloadError("No se pudo generar el ZIP de recibos. Intenta nuevamente.");
  } finally {
    setIsHistoryBulkDownloading(false);
  }
}

async function handleDownloadFilteredHistory(): Promise<void> {
  if (filteredHistoryRows.length === 0 || isHistoryBulkDownloading) return;
  setHistoryBulkDownloadError("");
  setIsHistoryBulkDownloading(true);
  try {
    await downloadPaymentsReceiptsZip(filteredHistoryRows, { format: "history" });
  } catch {
    setHistoryBulkDownloadError("No se pudo generar el ZIP de recibos. Intenta nuevamente.");
  } finally {
    setIsHistoryBulkDownloading(false);
  }
}

function handleRepairTodayPaymentDates(): void {
  if (misdatedTodayPayments.length === 0) {
    setDateRepairFeedback({
      tone: "error",
      message: "No se encontraron recibos de hoy con fecha de ayer."
    });
    return;
  }
  const ids = new Set(misdatedTodayPayments.map((payment) => payment.id));
  onPaymentsChange(
    payments.map((payment) =>
      ids.has(payment.id)
        ? { ...payment, dateApplied: businessTodayKey }
        : payment
    )
  );
  setDateRepairFeedback({
    tone: "success",
    message: `Se corrigieron ${misdatedTodayPayments.length} recibo(s) de ${previousBusinessDateKey} a ${businessTodayKey}.`
  });
  setHistoryDateFrom(businessTodayKey);
  setHistoryDateTo(businessTodayKey);
  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
}

  return (
    <section id="payment-panel-history" role="tabpanel" aria-labelledby="payment-tab-history" ref={historySectionRef} className="panel" style={{ display: isHistoryOpen ? undefined : "none" }}>
            <div className="panel-head">
              <h2>Historial de pagos</h2>
              <button
                type="button"
                className="button ghost small history-refresh-button"
                onClick={() => void handleRefreshHistory()}
                disabled={isHistoryRefreshing || !onRefreshPayments}
                title="Recargar los pagos desde la fuente de datos"
              >
                <span className={isHistoryRefreshing ? "history-refresh-icon history-refresh-icon--spinning" : "history-refresh-icon"} aria-hidden="true">↻</span>
                {isHistoryRefreshing ? "Actualizando..." : "Actualizar"}
              </button>
            </div>
            {isHistoryOpen && (
            <>
            <div className="panel-head" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
              <select
                value={historyClientId}
                onChange={(e) => {
                  setHistoryClientId(e.target.value);
                  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
                }}
                className="history-filter-select"
              >
                <option value="all">Todos los clientes</option>
                {activeClients.map((c) => (
                  <option key={c.id} value={c.id}>{c.unitId} - {c.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="button ghost small"
                onClick={filterHistoryToday}
              >
                Hoy
              </button>
              <button
                type="button"
                className="button ghost small"
                onClick={() => {
                  setHistoryDeliveryFilter("pending");
                  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
                }}
              >
                Por enviar
              </button>
              <select
                value={historyGroupFilter}
                onChange={(e) => {
                  setHistoryGroupFilter(e.target.value);
                  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
                }}
                className="history-filter-select"
              >
                <option value="all">Todos los grupos</option>
                {historyAvailableGroups.map((group) => (
                  <option key={group} value={group}>Grupo {group}</option>
                ))}
              </select>
              <select
                value={historyDeliveryFilter}
                onChange={(e) => {
                  setHistoryDeliveryFilter(e.target.value as HistoryDeliveryFilter);
                  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
                }}
                className="history-filter-select"
                aria-label="Filtrar por estado de envío"
              >
                <option value="all">Todos los estados</option>
                <option value="pending">Por enviar</option>
                <option value="sent">Enviados</option>
              </select>
              <input
                type="date"
                className="payment-input"
                value={historyDateFrom}
                onChange={(e) => {
                  setHistoryDateFrom(e.target.value);
                  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
                }}
                title="Filtrar desde fecha"
                style={{ width: 180 }}
              />
              <input
                type="date"
                className="payment-input"
                value={historyDateTo}
                onChange={(e) => {
                  setHistoryDateTo(e.target.value);
                  setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
                }}
                title="Filtrar hasta fecha"
                style={{ width: 180 }}
              />
              {(historyDateFrom || historyDateTo) && (
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => {
                    setHistoryDateFrom("");
                    setHistoryDateTo("");
                    setHistoryVisibleLimit(PAYMENT_HISTORY_LIMIT);
                  }}
                >
                  Limpiar fechas
                </button>
              )}
            </div>

            {historyDateRangeError && <p className="hint error-text">{historyDateRangeError}</p>}
            {hasHistoryFilters && (
              <div className="history-filter-actions">
                <button type="button" className="button ghost small" onClick={clearHistoryFilters}>
                  Limpiar filtros
                </button>
              </div>
            )}
            {historyRefreshFeedback && (
              <div
                className={`history-copy-feedback history-copy-feedback--${historyRefreshFeedback.tone}`}
                role={historyRefreshFeedback.tone === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {historyRefreshFeedback.message}
              </div>
            )}
            {misdatedTodayPayments.length > 0 && (
              <div className="history-copy-feedback history-copy-feedback--error" role="alert">
                <strong>Recibos con fecha de ayer detectados:</strong>{" "}
                {misdatedTodayPayments.length} recibo(s) desde REC-{MISDATED_RECEIPT_REPAIR_START} aparecen en {previousBusinessDateKey}.
                <button
                  type="button"
                  className="button primary small"
                  style={{ marginLeft: 10 }}
                  onClick={handleRepairTodayPaymentDates}
                >
                  Corregir a {businessTodayKey}
                </button>
              </div>
            )}
            {dateRepairFeedback && (
              <div
                className={`history-copy-feedback history-copy-feedback--${dateRepairFeedback.tone}`}
                role={dateRepairFeedback.tone === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {dateRepairFeedback.message}
              </div>
            )}
            {historyCopyFeedback && (
              <div
                className={`history-copy-feedback history-copy-feedback--${historyCopyFeedback.tone}`}
                role={historyCopyFeedback.tone === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {historyCopyFeedback.message}
              </div>
            )}

            {historyRows.length === 0 ? (
              <div className="empty history-empty-state">
                <p>
                  {payments.length === 0
                    ? "No hay pagos registrados aun."
                    : "No hay recibos que coincidan con los filtros actuales."}
                </p>
                {payments.length > 0 && hasHistoryFilters && (
                  <>
                    <p className="hint">Cambia el filtro o limpia la busqueda para regresar al historial.</p>
                    <button type="button" className="button ghost small" onClick={clearHistoryFilters}>
                      Limpiar filtros y volver
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
              <div className="history-bulk-bar">
                <div className="history-bulk-summary">
                  {historySelectedRows.length > 0
                    ? `${historySelectedRows.length} seleccionados de ${historyRows.length}`
                    : `${historyRows.length} visibles de ${filteredHistoryRows.length} filtrados`}
                </div>
                <div className="history-bulk-actions">
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={toggleSelectAllHistoryRows}
                    disabled={isHistoryBulkDownloading}
                  >
                    {isAllHistoryRowsSelected ? "Limpiar seleccion" : "Seleccionar todo"}
                  </button>
                  <button
                    type="button"
                    className="button primary small"
                    onClick={handleDownloadHistorySelection}
                    disabled={isHistoryBulkDownloading || historySelectedRows.length === 0}
                    title="Descarga los recibos seleccionados en un ZIP"
                  >
                    {isHistoryBulkDownloading ? "Generando ZIP..." : `Descargar seleccionados (${historySelectedRows.length})`}
                  </button>
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={handleDownloadFilteredHistory}
                    disabled={isHistoryBulkDownloading}
                    title="Descarga todos los recibos del filtro actual en un ZIP"
                  >
                    Descargar filtrados ({filteredHistoryRows.length})
                  </button>
              </div>
              </div>
              {historyBulkDownloadError && <p className="hint error-text">{historyBulkDownloadError}</p>}
              {hasHistoryColumnFilters && (
                <div style={{ marginBottom: 8 }}>
                  <button type="button" className="button ghost small" onClick={clearHistoryColumnFilters}>
                    Limpiar filtros de columnas
                  </button>
                </div>
              )}
              <div className="top-scroll" ref={historyTopScrollRef}>
                <div ref={historyTopInnerRef} className="top-scroll-inner" />
              </div>
              <div className="table-scroll" ref={historyBottomScrollRef}>
                <table>
                  <thead>
                    <tr>
                      <th>Ver</th>
                      <th className="history-send-column">Estado</th>
                      <th>
                        <input
                          type="checkbox"
                          className="history-checkbox"
                          checked={isAllHistoryRowsSelected}
                          onChange={toggleSelectAllHistoryRows}
                          aria-label={isAllHistoryRowsSelected ? "Deseleccionar todos los recibos" : "Seleccionar todos los recibos"}
                        />
                      </th>
                      <th><button type="button" className="sort-button" onClick={() => handleSortHistory("receipt")}>Recibo <span className={`sort-icon ${historySortField === "receipt" ? "active" : ""}`}>{renderHistorySortIcon("receipt")}</span></button></th>
                      <th><button type="button" className="sort-button" onClick={() => handleSortHistory("date")}>Fecha <span className={`sort-icon ${historySortField === "date" ? "active" : ""}`}>{renderHistorySortIcon("date")}</span></button></th>
                      <th><button type="button" className="sort-button" onClick={() => handleSortHistory("unit")}>Unidad <span className={`sort-icon ${historySortField === "unit" ? "active" : ""}`}>{renderHistorySortIcon("unit")}</span></button></th>
                      <th><button type="button" className="sort-button" onClick={() => handleSortHistory("client")}>Cliente <span className={`sort-icon ${historySortField === "client" ? "active" : ""}`}>{renderHistorySortIcon("client")}</span></button></th>
                      <th><button type="button" className="sort-button" onClick={() => handleSortHistory("amount")}>Monto <span className={`sort-icon ${historySortField === "amount" ? "active" : ""}`}>{renderHistorySortIcon("amount")}</span></button></th>
                      <th><button type="button" className="sort-button" onClick={() => handleSortHistory("applied")}>A renta <span className={`sort-icon ${historySortField === "applied" ? "active" : ""}`}>{renderHistorySortIcon("applied")}</span></button></th>
                      <th><button type="button" className="sort-button" onClick={() => handleSortHistory("savings")}>Ahorro <span className={`sort-icon ${historySortField === "savings" ? "active" : ""}`}>{renderHistorySortIcon("savings")}</span></button></th>
                      <th><button type="button" className="sort-button" onClick={() => handleSortHistory("installments")}>Cuotas <span className={`sort-icon ${historySortField === "installments" ? "active" : ""}`}>{renderHistorySortIcon("installments")}</span></button></th>
                      <th><button type="button" className="sort-button" onClick={() => handleSortHistory("method")}>Método <span className={`sort-icon ${historySortField === "method" ? "active" : ""}`}>{renderHistorySortIcon("method")}</span></button></th>
                      <th></th>
                    </tr>
                    <tr>
                      <th></th>
                      <th></th>
                      <th></th>
                      <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.receipt} onChange={(e) => updateHistoryColumnFilter("receipt", e.target.value)} /></th>
                      <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.date} onChange={(e) => updateHistoryColumnFilter("date", e.target.value)} /></th>
                      <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.unit} onChange={(e) => updateHistoryColumnFilter("unit", e.target.value)} /></th>
                      <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.client} onChange={(e) => updateHistoryColumnFilter("client", e.target.value)} /></th>
                      <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.amount} onChange={(e) => updateHistoryColumnFilter("amount", e.target.value)} /></th>
                      <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.applied} onChange={(e) => updateHistoryColumnFilter("applied", e.target.value)} /></th>
                      <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.savings} onChange={(e) => updateHistoryColumnFilter("savings", e.target.value)} /></th>
                      <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.installments} onChange={(e) => updateHistoryColumnFilter("installments", e.target.value)} /></th>
                      <th><input type="text" className="payment-input history-column-filter-input" placeholder="Filtrar" value={historyColumnFilters.method} onChange={(e) => updateHistoryColumnFilter("method", e.target.value)} /></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((p) => {
                      const isSent = p.receiptDeliveryStatus !== "pending" || historyCopiedPaymentIds.has(p.id);
                      const isCopying = historyCopyingPaymentId === p.id;
                      return (
                      <tr key={p.id} className={historySelectedIdSet.has(p.id) ? "history-row--selected" : ""}>
                        <td>
                          <button
                            type="button"
                            className="action-btn action-btn--edit"
                            title="Vista previa del recibo"
                            onClick={() => onPreviewPayment(p)}
                          >Ver</button>
                        </td>
                        <td className="history-send-cell">
                          <button
                            type="button"
                            className={`history-send-button ${isSent ? "history-send-button--sent" : "history-send-button--pending"}`}
                            onClick={() => void handleCopyHistoryReceipt(p)}
                            disabled={historyCopyingPaymentId !== null}
                            aria-label={`${isSent ? "Copiar nuevamente" : "Copiar"} el recibo ${p.receiptNumber}`}
                            aria-describedby={historyCopyFeedback?.paymentId === p.id ? `copy-feedback-${p.id}` : undefined}
                            title={isSent ? "Copiar nuevamente el recibo" : "Copiar el recibo y marcarlo como enviado"}
                          >
                            <span aria-hidden="true">{isSent ? "✓" : "↗"}</span>
                            {isCopying ? "Por enviar" : isSent ? "Enviado" : "Por enviar"}
                          </button>
                          {historyCopyFeedback?.paymentId === p.id && (
                            <span id={`copy-feedback-${p.id}`} className="sr-only">
                              {historyCopyFeedback.message}
                            </span>
                          )}
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            className="history-checkbox"
                            checked={historySelectedIdSet.has(p.id)}
                            onChange={() => toggleHistoryRowSelection(p.id)}
                            aria-label={`Seleccionar recibo ${p.receiptNumber}`}
                          />
                        </td>
                        <td><strong>{p.receiptNumber}</strong></td>
                        <td>{formatDate(new Date(`${p.dateApplied}T12:00:00`))}</td>
                        <td>{p.clientUnit}</td>
                        <td>{p.clientName}</td>
                        <td><span className="amount-good">{formatCurrency(p.amountReceived)}</span></td>
                        <td>{formatCurrency(p.appliedToRent)}</td>
                        <td>{p.centavosAhorro > 0 ? formatCurrency(p.centavosAhorro) : <span className="amount-muted">-</span>}</td>
                        <td>{getInstallmentsTotalInPayment(p) > 0 ? `-${getInstallmentsTotalInPayment(p)}` : <span className="amount-muted">-</span>}</td>
                        <td>{p.paymentMethod}</td>
                        <td>
                          <button
                            type="button"
                            className="action-btn action-btn--delete"
                            title={isDateClosed(p.dateApplied) ? "Caja cerrada: no se puede eliminar" : "Eliminar pago"}
                            disabled={isDateClosed(p.dateApplied)}
                            onClick={() => onDeletePayment(p)}
                          >X</button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {hasMoreHistoryRows && (
                <div className="history-load-more">
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => setHistoryVisibleLimit((current) => current + PAYMENT_HISTORY_LIMIT)}
                  >
                    Cargar {Math.min(PAYMENT_HISTORY_LIMIT, filteredHistoryRows.length - historyRows.length)} recibos más
                  </button>
                </div>
              )}
              </>
            )}
            {historyRows.length > 0 && (
              <p className="hint">
                Mostrando {historyRows.length} de {filteredHistoryRows.length} pagos que coinciden con los filtros.
              </p>
            )}
            </>
            )}
          </section>
  );
}
