import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { formatCurrency, formatDate } from "../format";
import { isChargeDay, startOfDay } from "../billing";
import type { Payment } from "../types";

type Props = {
  payment: Payment;
  onClose: () => void;
  closeLabel?: string;
};

function formatDateSpanish(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const weekdays = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return dateStr;
  const date = new Date(`${dateStr}T12:00:00`);
  const weekdayLabel = weekdays[date.getDay()] ?? "";
  return `${weekdayLabel}\n${day} ${months[month] ?? ""} ${year}`.trim();
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function findNextChargeDateForReceipt(client: Parameters<typeof isChargeDay>[0], fromDate: Date): Date | null {
  let cursor = addDays(startOfDay(fromDate), 1);
  for (let i = 0; i < 3660; i += 1) {
    if (isChargeDay(client, cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
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
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "760px";
  host.style.visibility = "hidden";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";
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
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

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

async function renderReceiptCanvasFromElement(target: HTMLElement): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas")).default;
  return html2canvas(target, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    width: target.scrollWidth,
    height: target.scrollHeight
  });
}

export async function downloadPaymentReceiptImage(payment: Payment, renderedCard?: HTMLElement | null): Promise<void> {
  const { fileName, blob } = renderedCard
    ? await (async () => {
      const canvas = await renderReceiptCanvasFromElement(renderedCard);
      const fileName = buildReceiptFileName(payment);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error("No se pudo convertir el recibo a imagen."));
        }, "image/png");
      });
      return { fileName, blob };
    })()
    : await buildPaymentReceiptImageBlob(payment);
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
  const installmentsFromDebt = Math.max(0, payment.installmentsFromDebt ?? payment.installmentsDeducted ?? 0);
  const installmentsFromAdvance = Math.max(
    0,
    payment.installmentsFromAdvance ??
      (payment.rentAmount > 0 ? Math.floor((payment.advanceApplied ?? 0) / payment.rentAmount) : 0)
  );
  const installmentsTotalInPayment = Math.max(
    0,
    payment.installmentsTotalInPayment ?? installmentsFromDebt + installmentsFromAdvance
  );
  const installmentsPaidIncludingAdvance = Math.max(0, payment.installmentsPaidAfter + installmentsFromAdvance);
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
  };
  const otherChargesApplied = payment.otherChargesApplied ?? [];
  const otherChargesDueAfter = payment.otherChargesDueAfter ?? [];
  const otherChargesDueTotal = otherChargesDueAfter.reduce((sum, charge) => sum + charge.amount, 0);
  const advanceApplied = Math.max(0, payment.advanceApplied ?? 0);
  const advanceBalanceAfter = roundMoney(Math.max(0, payment.advanceBalanceAfter ?? advanceApplied));
  const moroseBalanceToday = Math.max(0, payment.balanceAfter);
  const hasMoroseBalance = moroseBalanceToday > 0;
  const normalizedRent = roundMoney(Math.max(0, payment.rentAmount));
  const nextChargeDate = normalizedRent > 0 ? findNextChargeDateForReceipt(minimalClient, paymentDate) : null;
  const advanceAppliedToNextInstallment = normalizedRent > 0 ? roundMoney(Math.min(advanceBalanceAfter, normalizedRent)) : 0;
  const advanceRemainingForNextInstallment = normalizedRent > 0
    ? roundMoney(Math.max(0, normalizedRent - advanceAppliedToNextInstallment))
    : 0;
  const hasAdvancePanel = advanceApplied > 0 && normalizedRent > 0;
  const hasAdvancePendingForNextInstallment = hasAdvancePanel && advanceRemainingForNextInstallment > 0;
  const appliedToCurrentRent = roundMoney(Math.max(0, payment.appliedToRent));
  const hasPartialForOneAccount =
    hasMoroseBalance &&
    normalizedRent > 0 &&
    roundMoney(moroseBalanceToday % normalizedRent) > 0;
  const saldoParaBajarCuenta = hasPartialForOneAccount
    ? roundMoney(moroseBalanceToday % normalizedRent)
    : 0;
  const saldoParaBajarHoy = hasMoroseBalance
    ? (
      hasPartialForOneAccount
        ? saldoParaBajarCuenta
        : roundMoney(Math.min(moroseBalanceToday, normalizedRent > 0 ? normalizedRent : moroseBalanceToday))
    )
    : 0;
  const saldoCorriente =
    hasMoroseBalance
      ? roundMoney(Math.max(0, moroseBalanceToday - saldoParaBajarCuenta))
      : 0;
  const saldoCorrienteCuotas =
    normalizedRent > 0
      ? Math.floor((saldoCorriente + Number.EPSILON) / normalizedRent)
      : 0;
  const saldoCorrienteCuotasLabel =
    saldoCorrienteCuotas > 0
      ? ` (${saldoCorrienteCuotas === 1 ? "1 cta" : `${saldoCorrienteCuotas} ctas`})`
      : "";
  const saldoParaBajarCuentaLabel = hasPartialForOneAccount ? " (1 cuota parcial)" : "";
  const totalPendienteRenta = roundMoney(Math.max(0, moroseBalanceToday));
  const totalPendienteCuotas = normalizedRent > 0 ? Math.ceil((totalPendienteRenta + Number.EPSILON) / normalizedRent) : 0;
  const totalPendienteCuotasLabel =
    totalPendienteCuotas > 0
      ? ` (${totalPendienteCuotas === 1 ? "1 cta" : `${totalPendienteCuotas} ctas`})`
      : "";
  const totalPending = Math.max(0, moroseBalanceToday + otherChargesDueTotal);
  const hasPending = totalPending > 0;
  const travelFundBalance = roundMoney(Math.max(0, payment.travelFundAvailableSnapshot ?? 0));
  const hasTravelFundBalance = travelFundBalance > 0;
  const folio = payment.reference ? extractFolio(payment.reference) : "";
  const isPendingCardSettlement =
    payment.paymentMethod === "Tarjeta" &&
    (payment.reference ?? "").toUpperCase().includes("TARJETA-PENDIENTE-CONCILIACION");

  return (
    <>
      <div className="receipt-header">
        <div className="receipt-brand-sub receipt-brand-sub--title">COMPROBANTE DE PAGO</div>
        <div className="receipt-header-top">
          <div className="receipt-top-left-mini">
            <div className="receipt-summary-compact-line"><strong>{payment.clientUnit}</strong></div>
            <div className="receipt-summary-compact-line">{frequencyLabel}, {formatCurrency(payment.rentAmount)}</div>
            <div className="receipt-summary-compact-line">{installmentsPaidIncludingAdvance} Cuotas Pagadas</div>
          </div>
          {hasPending && (
            <div className="receipt-top-action">
              <span className="receipt-top-action-label">Hoy para bajar 1 cuenta</span>
              <strong>{formatCurrency(saldoParaBajarHoy)}</strong>
              <span className="receipt-top-action-note">No cancela el total.</span>
            </div>
          )}
          <div className="receipt-top-right-meta">
            <div className="receipt-number receipt-number--right">{payment.receiptNumber}</div>
            <div className="receipt-date">{formatDateSpanish(payment.dateApplied)}</div>
          </div>
        </div>
        {isPendingCardSettlement && (
          <div className="receipt-brand-sub" style={{ color: "#a05a00", fontWeight: 700 }}>
            PAGO EN TARJETA PENDIENTE DE CONCILIACION BANCARIA
          </div>
        )}

        <div className="receipt-dual-grid">
          <div className="receipt-section receipt-section--panel">
            <div className="receipt-simple-title">PAGOS APLICADOS</div>
            <div className="receipt-subrow">
              <span>Pagaste hoy</span>
              <span>{formatCurrency(payment.amountReceived)}</span>
            </div>
            <div className="receipt-subrow">
              <span>{advanceApplied > 0 ? "Aplicado a saldo actual" : "Aplicado a renta"}</span>
              <span>{formatCurrency(appliedToCurrentRent)}</span>
            </div>
            {hasAdvancePanel && (
              <div className="receipt-subrow">
                <span>
                  Aplicado a proxima letra
                  {nextChargeDate ? ` (${formatDate(nextChargeDate)})` : ""}
                </span>
                <span>{formatCurrency(advanceApplied)}</span>
              </div>
            )}
            {hasAdvancePendingForNextInstallment && (
              <div className="receipt-subrow receipt-subrow--debt">
                <span>
                  Faltante de esa letra
                  {nextChargeDate ? ` (${formatDate(nextChargeDate)})` : ""}
                </span>
                <span>{formatCurrency(advanceRemainingForNextInstallment)}</span>
              </div>
            )}
            {hasAdvancePanel && (
              <div className="receipt-subrow">
                <span>Aplicado a renta (total)</span>
                <span>{formatCurrency(appliedToCurrentRent + advanceApplied)}</span>
              </div>
            )}
            {otherChargesApplied.map((charge, index) => (
              <div key={`paid-${charge.id ?? charge.label}-${index}`} className="receipt-subrow">
                <span>Aplicado a {charge.label.toUpperCase()}</span>
                <span>{formatCurrency(charge.amount)}</span>
              </div>
            ))}
          </div>

          <div className="receipt-section receipt-section--panel">
            <div className="receipt-simple-title">DATOS DEL CLIENTE</div>
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
        </div>
      </div>

      {hasAdvancePanel && (
        <div className="receipt-advance-panel">
          <div className="receipt-advance-title">PAGO ADELANTADO</div>
          {nextChargeDate && (
            <div className="receipt-advance-row">
              <span>Proxima letra</span>
              <strong>{formatDate(nextChargeDate)}</strong>
            </div>
          )}
          <div className="receipt-advance-row">
            <span>Abonado acumulado a esa letra</span>
            <strong>{formatCurrency(advanceAppliedToNextInstallment)}</strong>
          </div>
          {hasAdvancePendingForNextInstallment ? (
            <div className="receipt-advance-row receipt-advance-row--pending">
              <span>Faltan para completarla</span>
              <strong>{formatCurrency(advanceRemainingForNextInstallment)}</strong>
            </div>
          ) : (
            <div className="receipt-advance-row receipt-advance-row--ok">
              <span>Estado de esa letra</span>
              <strong>PAGADA</strong>
            </div>
          )}
        </div>
      )}

      <div className={`receipt-top-balance-grid ${otherChargesDueAfter.length === 0 ? "receipt-top-balance-grid--single" : ""}`}>
        <div className={`receipt-overdue-banner ${hasPending ? "" : "receipt-overdue-banner--ok"}`}>
          <span className="receipt-overdue-icon">{hasPending ? "!" : <strong>✓</strong>}</span>
          <div className="receipt-overdue-content">
            <div className="receipt-overdue-title">{hasPending ? "PAGO PENDIENTE HOY" : "ESTAS AL DIA"}</div>
            <div className="receipt-overdue-sub">
              {hasPending ? (
                <>
                  <div className="receipt-overdue-grid">
                    {hasPartialForOneAccount && (
                      <div className="receipt-overdue-row">
                        <span>{`Saldo bajar 1 cta${saldoParaBajarCuentaLabel}`}</span>
                        <strong>{formatCurrency(saldoParaBajarCuenta)}</strong>
                      </div>
                    )}
                    <div className="receipt-overdue-row receipt-overdue-row--next">
                      <span>{`Saldo corriente${saldoCorrienteCuotasLabel}`}</span>
                      <strong>{formatCurrency(saldoCorriente)}</strong>
                    </div>
                    <div className="receipt-overdue-row receipt-overdue-row--total">
                      <span>{`Total pendiente de renta${totalPendienteCuotasLabel}`}</span>
                      <strong>{formatCurrency(totalPendienteRenta)}</strong>
                    </div>
                  </div>
                </>
              ) : "No tienes saldo pendiente."}
            </div>
          </div>
        </div>

        {hasPending && otherChargesDueAfter.length > 0 && (
          <div className="receipt-overdue-other-band receipt-overdue-other-band--separate">
            <div className="receipt-overdue-other-title">OTROS CARGOS</div>
            {otherChargesDueAfter.map((charge, index) => (
              <div key={`top-due-${charge.id ?? charge.label}-${index}`} className="receipt-overdue-other-row">
                <span>{charge.label.toUpperCase()}</span>
                <strong>{formatCurrency(charge.amount)}</strong>
              </div>
            ))}
            <div className="receipt-overdue-other-row receipt-overdue-other-row--total">
              <span>Total otros cargos</span>
              <strong>{formatCurrency(otherChargesDueTotal)}</strong>
            </div>
          </div>
        )}
      </div>

      {hasTravelFundBalance && (
        <div className="receipt-savings-box">
          <div className="receipt-savings-value">{`Fondo de viaje: ${formatCurrency(travelFundBalance)}`}</div>
        </div>
      )}

      <div className="receipt-reminders-box">
        <div className="receipt-reminders-title">Recordatorios</div>
        <ul className="receipt-reminders-list" aria-label="Recordatorios importantes">
          <li className="receipt-reminder-item">
            <span className="receipt-reminder-icon" aria-hidden="true">*</span>
            <span>
              <strong className="receipt-reminder-highlight">TODOS SUS PAGOS DEBEN VENIR CON LOS CENTAVOS DE SU UNIDAD.</strong>
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
  const cardRef = useRef<HTMLDivElement | null>(null);

  async function handleDownload(): Promise<void> {
    setIsDownloading(true);
    try {
      await downloadPaymentReceiptImage(payment, cardRef.current);
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

      <div ref={cardRef} className="receipt-card">
        <ReceiptCardContent payment={payment} />
      </div>
    </div>
  );
}
