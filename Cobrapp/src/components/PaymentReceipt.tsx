import { useState } from "react";
import { createRoot } from "react-dom/client";
import { formatCurrency, formatDate } from "../format";
import { getDebtStartDate, startOfDay } from "../billing";
import type { Payment } from "../types";

type Props = {
  payment: Payment;
  onClose: () => void;
  closeLabel?: string;
};

function formatDateSpanish(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const month = parseInt(parts[1], 10) - 1;
  return `${parseInt(parts[2], 10)} ${months[month] ?? ""} ${parts[0]}`;
}

function sanitizeFileToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function formatFileDateParts(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr.replace(/-/g, "_");
  const [yyyy, mm, dd] = parts;
  return `${dd}_${mm}_${yyyy}`;
}

function buildReceiptFileName(payment: Payment): string {
  const unit = sanitizeFileToken(payment.clientUnit || "UNIDAD");
  const datePart = formatFileDateParts(payment.dateApplied);
  return `${unit}-${datePart}.png`;
}

function buildZipFileName(payments: Payment[]): string {
  if (payments.length === 0) {
    return "recibos-pagos.png.zip";
  }
  const sortedDates = payments.map((payment) => payment.dateApplied).sort((a, b) => a.localeCompare(b));
  const fromDate = formatFileDateParts(sortedDates[0] ?? "");
  const toDate = formatFileDateParts(sortedDates[sortedDates.length - 1] ?? "");
  if (fromDate === toDate) {
    return `recibos-${fromDate}-${payments.length}.png.zip`;
  }
  return `recibos-${fromDate}-a-${toDate}-${payments.length}.png.zip`;
}

function extractFolio(reference: string): string {
  const trimmed = reference.trim();
  if (!trimmed) return "";
  const explicitFolio = trimmed.match(/folio\s*[:#-]?\s*([A-Za-z0-9-]+)/i);
  if (explicitFolio?.[1]) return explicitFolio[1];
  const tokens = trimmed.match(/[A-Za-z0-9-]+/g);
  if (!tokens || tokens.length === 0) return trimmed;
  return tokens[tokens.length - 1] ?? trimmed;
}

async function renderReceiptCanvasFromPayment(payment: Payment): Promise<HTMLCanvasElement> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "760px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  document.body.appendChild(host);

  const root = createRoot(host);

  try {
    root.render(
      <div className="receipt-page">
        <div className="receipt-card">
          <ReceiptCardContent payment={payment} />
        </div>
      </div>
    );

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const target = host.querySelector(".receipt-card") as HTMLDivElement | null;
    if (!target) {
      throw new Error("Receipt preview container was not rendered.");
    }

    const html2canvas = (await import("html2canvas")).default;
    return html2canvas(target, {
      scale: 2,
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

export async function downloadPaymentReceiptImage(payment: Payment): Promise<void> {
  const { fileName, blob } = await buildPaymentReceiptImageBlob(payment);
  const link = document.createElement("a");
  const href = URL.createObjectURL(blob);
  link.download = fileName;
  link.href = href;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export async function buildPaymentReceiptImageBlob(payment: Payment): Promise<{ fileName: string; blob: Blob }> {
  const canvas = await renderReceiptCanvasFromPayment(payment);
  const fileName = buildReceiptFileName(payment);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("No se pudo convertir el recibo a imagen."));
    }, "image/png");
  });
  return { fileName, blob };
}

export async function downloadPaymentsReceiptsZip(payments: Payment[]): Promise<void> {
  if (payments.length === 0) {
    throw new Error("No hay pagos seleccionados.");
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const namesCount = new Map<string, number>();

  for (const payment of payments) {
    const { fileName, blob } = await buildPaymentReceiptImageBlob(payment);
    const currentCount = namesCount.get(fileName) ?? 0;
    namesCount.set(fileName, currentCount + 1);

    const finalName =
      currentCount === 0
        ? fileName
        : fileName.replace(/\.png$/i, `-${currentCount + 1}.png`);

    zip.file(finalName, blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const downloadName = buildZipFileName(payments);
  const link = document.createElement("a");
  const href = URL.createObjectURL(zipBlob);
  link.download = downloadName;
  link.href = href;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function ReceiptCardContent({ payment }: { payment: Payment }) {
  const weeklyDayLabel =
    payment.weeklyChargeDay === "monday"
      ? "Lunes"
      : payment.weeklyChargeDay === "tuesday"
      ? "Martes"
      : payment.weeklyChargeDay === "wednesday"
      ? "Miercoles"
      : payment.weeklyChargeDay === "thursday"
      ? "Jueves"
      : payment.weeklyChargeDay === "friday"
      ? "Viernes"
      : payment.weeklyChargeDay === "saturday"
      ? "Sabado"
      : "";

  const frequencyLabel =
    payment.frequency === "daily"
      ? "Diario"
      : payment.frequency === "weekly"
      ? `Semanal${weeklyDayLabel ? ` (${weeklyDayLabel})` : ""}`
      : payment.frequency === "biweekly"
      ? "Quincenal"
      : "Mensual";
  // Cuotas vencidas reales despues del pago
  const overdueAfter = payment.rentAmount > 0
    ? Math.max(0, Math.ceil(payment.balanceAfter / payment.rentAmount))
    : 0;

  // "Debe desde" con la misma logica de Modulo 1
  const paymentDate = startOfDay(new Date(payment.dateApplied + "T12:00:00"));
  const minimalClient = {
    balance: payment.balanceAfter,
    rentAmount: payment.rentAmount,
    frequency: payment.frequency,
    weeklyChargeDay: payment.weeklyChargeDay,
    monthlyChargeDay: payment.monthlyChargeDay,
    // campos requeridos por la firma pero no usados en el calculo
    id: "", unitId: "", name: "", installmentsAgreed: 0,
    installmentsRemaining: 0, installmentsPaid: 0,
    otherCharges: [], advanceBalance: 0, savings: 0, createdAt: ""
  } as Parameters<typeof getDebtStartDate>[0];

  const debtStartDate = getDebtStartDate(minimalClient, paymentDate);
  const otherChargesApplied = payment.otherChargesApplied ?? [];
  const otherChargesDueAfter = payment.otherChargesDueAfter ?? [];
  const otherChargesDueTotal = otherChargesDueAfter.reduce((sum, charge) => sum + charge.amount, 0);
  const advanceApplied = Math.max(0, payment.advanceApplied ?? 0);
  const moroseBalanceToday = Math.max(0, payment.balanceAfter);
  const totalPending = Math.max(0, moroseBalanceToday + otherChargesDueTotal);
  const hasPending = totalPending > 0;
  const hasMoroseBalance = moroseBalanceToday > 0;
  const debtSinceLabel = debtStartDate ? formatDate(debtStartDate) : null;
  const folio = payment.reference ? extractFolio(payment.reference) : "";

  return (
    <>
      <div className="receipt-header">
        <div className="receipt-header-top">
          <div className="receipt-date receipt-date--left">{formatDateSpanish(payment.dateApplied)}</div>
          <div className="receipt-number receipt-number--right">{payment.receiptNumber}</div>
        </div>
        <div className="receipt-brand-sub receipt-brand-sub--title">COMPROBANTE DE PAGO</div>
        <div className="receipt-header-info-row">
          <div className="receipt-header-meta">
            <div className="receipt-brand-sub">Unidad: {payment.clientUnit}</div>
            <div className="receipt-brand-sub">Plan: {frequencyLabel}</div>
            <div className="receipt-brand-sub">Renta: {formatCurrency(payment.rentAmount)}</div>
            <div className="receipt-brand-sub">Cuotas pagadas: {payment.installmentsPaidAfter}</div>
            {hasPending && debtSinceLabel && (
              <div className="receipt-brand-sub receipt-header-debt-since">Debe desde: {debtSinceLabel}</div>
            )}
          </div>
          <div className={`receipt-overdue-banner receipt-overdue-banner--inline ${hasPending ? "" : "receipt-overdue-banner--ok"}`}>
            <span className="receipt-overdue-icon">{hasPending ? "!" : <strong>OK</strong>}</span>
            <div>
              <div className="receipt-overdue-title">{hasPending ? "TIENES SALDO PENDIENTE" : "ESTAS AL DIA"}</div>
              <div className="receipt-overdue-sub">
                {hasPending ? (
                  <>
                    {overdueAfter > 0 && (
                      <> Cuotas atrasadas: {formatCurrency(moroseBalanceToday)} ({overdueAfter} {overdueAfter === 1 ? "cuota" : "cuotas"}).</>
                    )}
                    {otherChargesDueTotal > 0 && (
                      <> Otros cargos: {formatCurrency(otherChargesDueTotal)}.</>
                    )}
                  </>
                ) : "No tienes saldo pendiente."}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="receipt-section">
        <div className="receipt-simple-title">DATOS DEL PAGO</div>
        <div className="receipt-row">
          <span>Cliente</span>
          <span><strong>{payment.clientName.toUpperCase()}</strong></span>
        </div>
        <div className="receipt-row">
          <span>Metodo</span>
          <span>{payment.paymentMethod}</span>
        </div>
        {folio && (
          <div className="receipt-row">
            <span>Folio</span>
            <span className="receipt-reference">{folio}</span>
          </div>
        )}
      </div>

      <div className="receipt-section">
        <div className="receipt-simple-title">PAGOS APLICADOS</div>
        <div className="receipt-subrow">
          <span>Pagaste hoy</span>
          <span>{formatCurrency(payment.amountReceived)}</span>
        </div>
        <div className="receipt-subrow">
          <span>{advanceApplied > 0 ? "Aplicado a renta (incluye pago adelantado)" : "Aplicado a renta"}</span>
          <span>{formatCurrency(payment.appliedToRent + advanceApplied)}</span>
        </div>
        {otherChargesApplied.map((charge) => (
          <div key={`paid-${charge.label}`} className="receipt-subrow">
            <span>Aplicado a {charge.label.toUpperCase()}</span>
            <span>{formatCurrency(charge.amount)}</span>
          </div>
        ))}
      </div>

      <div className="receipt-section">
        <div className="receipt-simple-title">SALDOS PENDIENTES A PAGAR</div>
        {hasMoroseBalance && (
          <div className="receipt-subrow">
            <span>Saldo moroso en renta</span>
            <span className="receipt-value-debt">{formatCurrency(moroseBalanceToday)}</span>
          </div>
        )}
        {otherChargesDueAfter.map((charge) => (
          <div key={`due-${charge.label}`} className="receipt-subrow receipt-subrow--debt">
            <span>Saldo de {charge.label.toUpperCase()}</span>
            <span>{formatCurrency(charge.amount)}</span>
          </div>
        ))}
        {!hasMoroseBalance && otherChargesDueAfter.length === 0 && (
          <div className="receipt-subrow">
            <span>Estado</span>
            <span className="receipt-value-good">AL DIA</span>
          </div>
        )}
      </div>

      <div className="receipt-reminders-box">
        <div className="receipt-reminders-title">Recordatorios</div>
        <ul className="receipt-reminders-list" aria-label="Recordatorios importantes">
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Al pagar, agrega los <strong className="receipt-reminder-highlight">centavos de tu unidad</strong>.
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              En el banco, escribe tu <strong className="receipt-reminder-highlight">numero de unidad</strong> en el comentario.
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Para transferencias, usa solo <strong className="receipt-reminder-highlight">ACH EXPRESS</strong>.
            </span>
          </li>
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              Manten <strong className="receipt-reminder-highlight">saldo positivo</strong> en Panapass y <strong className="receipt-reminder-highlight">paga a tiempo</strong> para evitar multas y recargos.
            </span>
          </li>
        </ul>
      </div>

      <div className="receipt-footer">
        Emitido por Administracion
      </div>
      <div className="receipt-installments-corner">
        <strong>{payment.installmentsRemainingAfter}</strong>
      </div>
    </>
  );
}

export default function PaymentReceipt({ payment, onClose, closeLabel = "Registrar otro pago" }: Props) {
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownload(): Promise<void> {
    setIsDownloading(true);
    try {
      await downloadPaymentReceiptImage(payment);
    } catch {
      // silently fail - user still sees the receipt on screen
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="receipt-page">
      <div className="receipt-actions-bar">
        <button type="button" className="button primary" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? "Generando imagen..." : "Descargar imagen"}
        </button>
        <button type="button" className="button ghost" onClick={onClose}>
          {closeLabel}
        </button>
      </div>

      <div className="receipt-card">
        <ReceiptCardContent payment={payment} />
      </div>
    </div>
  );
}
