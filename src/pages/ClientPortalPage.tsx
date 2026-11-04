import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { findNextChargeDay, isChargeDay, startOfDay, toDateKey } from "../billing";
import {
  createClientPortalTestAccount,
  loadClientPortalSnapshot,
  loginClientPortal,
  logoutClientPortal,
  isLocalClientPortalMode,
  submitClientPortalPayment,
  type ClientPortalClient,
  type ClientPortalNotice,
  type ClientPortalPayment,
  type ClientPortalSnapshot
} from "../cloud/clientPortalCloudData";
import PaymentReceipt, { buildPaymentReceiptImageBlob } from "../components/PaymentReceipt";
import { formatCurrency, formatDate } from "../format";
import {
  analyzeReceiptAmount,
  type PortalPaymentChannel,
  type ReceiptAuthorizedDestination,
  type ReceiptAmountConfidence,
  type ReceiptDestinationStatus
} from "../clientPortalReceiptOcr";
import { isSupabaseConfigured } from "../lib/supabase";
import { prepareSellerLeadDocument } from "../sellerLeadDocument";
import { loadBankRules } from "../storage/operationalStorage";
import type { Client, Payment, PaymentMethod } from "../types";
import "./clientPortal.css";

const SESSION_KEY = "rentautos.client-portal.session.v1";

type PortalView = "home" | "payments" | "profile";
type TimelineFilter = "all" | "charge" | "payment";

type PortalTimelineEvent = {
  id: string;
  type: "charge" | "payment";
  date: string;
  title: string;
  detail: string;
  amount: number;
  balanceAfter?: number;
  payment?: ClientPortalPayment;
};

function readSessionToken(): string {
  try { return sessionStorage.getItem(SESSION_KEY) ?? ""; } catch { return ""; }
}

function writeSessionToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // The current tab can still use the in-memory token.
  }
}

function formatPortalDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : formatDate(date);
}

function noticeLabel(notice: ClientPortalNotice): string {
  if (notice.status === "confirmed") return "Pago confirmado";
  if (notice.status === "rejected") return "Necesitamos revisarlo";
  return "En revisión";
}

function frequencyLabel(value: string): string {
  if (value === "daily") return "Diario";
  if (value === "biweekly") return "Quincenal";
  if (value === "monthly") return "Mensual";
  return "Semanal";
}

function paymentChannelLabel(value: PortalPaymentChannel): string {
  return value === "ach_xpress" ? "ACH Xpress" : "Transferencia regular";
}

function overdueInstallmentCount(balance: number, rentAmount: number): number {
  if (!Number.isFinite(balance) || !Number.isFinite(rentAmount) || balance <= 0 || rentAmount <= 0) return 0;
  return Math.ceil((balance - Number.EPSILON) / rentAmount);
}

function addPortalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildPortalDebtTimeline(client: ClientPortalClient, payments: ClientPortalPayment[], referenceDate = new Date()): PortalTimelineEvent[] {
  const events: PortalTimelineEvent[] = payments.map((payment) => {
    const balanceAfter = payment.receipt?.balanceAfter;
    return {
      id: `payment-${payment.id}`,
      type: "payment" as const,
      date: payment.createdAt || `${payment.dateApplied}T12:00:00`,
      title: "Recibimos tu pago",
      detail: `${payment.paymentMethod} · Recibo ${payment.receiptNumber || "—"}`,
      amount: -Math.abs(payment.amountReceived),
      balanceAfter: typeof balanceAfter === "number" && Number.isFinite(balanceAfter) ? balanceAfter : undefined,
      payment
    };
  });

  const pendingCount = overdueInstallmentCount(client.balance, client.rentAmount);
  if (pendingCount > 0 && client.rentAmount > 0) {
    const billingClient = portalBillingClient(client);
    const pendingDates: Date[] = [];
    let cursor = startOfDay(referenceDate);
    for (let scanned = 0; scanned < 36600 && pendingDates.length < pendingCount; scanned += 1) {
      if (isChargeDay(billingClient, cursor)) pendingDates.push(new Date(cursor));
      cursor = addPortalDays(cursor, -1);
    }
    pendingDates.reverse();
    const partialAmount = Math.max(0, Math.round((client.balance - client.rentAmount * Math.max(0, pendingCount - 1) + Number.EPSILON) * 100) / 100);
    const visiblePendingDates = pendingDates.slice(-24);
    const includesOldestPendingDate = visiblePendingDates.length === pendingDates.length;
    visiblePendingDates.forEach((date, index) => {
      const amount = includesOldestPendingDate && index === 0 ? Math.min(client.rentAmount, partialAmount || client.rentAmount) : client.rentAmount;
      const partial = amount < client.rentAmount;
      events.push({
        id: `charge-${toDateKey(date)}`,
        type: "charge",
        date: `${toDateKey(date)}T12:00:00`,
        title: "Tienes una cuota pendiente",
        detail: partial
          ? `La cuota era de ${formatCurrency(client.rentAmount)}. Todavía faltan ${formatCurrency(amount)}.`
          : `Falta pagar esta cuota de ${formatCurrency(client.rentAmount)}.`,
        amount
      });
    });
  }

  return events
    .sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id))
    .slice(0, 40);
}

function paymentChannelFromMethod(value: string): PortalPaymentChannel | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("xpress") || normalized.includes("express")) return "ach_xpress";
  if (normalized.includes("transfer") || normalized.includes("deposit") || normalized.includes("ach")) return "regular_transfer";
  return null;
}

function resolveNoticePaymentChannel(notice: ClientPortalNotice, payments: ClientPortalPayment[]): PortalPaymentChannel | null {
  if (notice.paymentChannel) return notice.paymentChannel;
  const noticeDay = notice.submittedAt.slice(0, 10);
  const match = payments.find((payment) => payment.clientId === notice.clientId
    && Math.abs(payment.amountReceived - notice.amount) < 0.01
    && payment.dateApplied.slice(0, 10) === noticeDay
    && paymentChannelFromMethod(payment.paymentMethod));
  return match ? paymentChannelFromMethod(match.paymentMethod) : null;
}

function normalizePaymentMethod(value: string): PaymentMethod {
  const methods: PaymentMethod[] = ["Efectivo", "ACH Express", "Deposito Bancario", "Transferencia Bancaria", "Tarjeta", "YAPPY LM", "Referido", "Descuento"];
  return methods.includes(value as PaymentMethod) ? value as PaymentMethod : "Transferencia Bancaria";
}

function portalReceipt(payment: ClientPortalPayment, client: ClientPortalClient): Payment {
  const source = payment.receipt;
  const money = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const frequency = source?.frequency === "daily" || source?.frequency === "weekly" || source?.frequency === "biweekly" || source?.frequency === "monthly"
    ? source.frequency
    : client.frequency;
  const fallback: Payment = {
    id: payment.id,
    receiptNumber: payment.receiptNumber,
    clientId: client.id,
    clientName: client.name,
    clientUnit: client.unitId,
    clientCedula: client.cedulaMasked,
    dateApplied: payment.dateApplied,
    paymentMethod: normalizePaymentMethod(payment.paymentMethod),
    amountReceived: payment.amountReceived,
    appliedToRent: payment.amountReceived,
    centavosAhorro: 0,
    installmentsDeducted: 0,
    balanceBefore: client.balance + payment.amountReceived,
    balanceAfter: client.balance,
    savingsBefore: 0,
    savingsAfter: 0,
    installmentsPaidAfter: client.installmentsPaid,
    installmentsRemainingAfter: client.installmentsRemaining,
    rentAmount: client.rentAmount,
    frequency: client.frequency,
    weeklyChargeDay: client.weeklyChargeDay,
    monthlyChargeDay: client.monthlyChargeDay,
    chargeFirstSunday: client.chargeFirstSunday,
    firstSundayChargedAt: client.firstSundayChargedAt,
    createdAt: payment.createdAt
  };
  return {
    ...fallback,
    ...source,
    id: source?.id || payment.id,
    receiptNumber: source?.receiptNumber || payment.receiptNumber,
    clientId: source?.clientId || client.id,
    clientName: source?.clientName || client.name,
    clientUnit: source?.clientUnit || client.unitId,
    clientCedula: source?.clientCedula || client.cedulaMasked,
    dateApplied: source?.dateApplied || payment.dateApplied,
    paymentMethod: normalizePaymentMethod(source?.paymentMethod || payment.paymentMethod),
    amountReceived: money(source?.amountReceived, payment.amountReceived),
    appliedToRent: money(source?.appliedToRent, payment.amountReceived),
    centavosAhorro: money(source?.centavosAhorro, 0),
    installmentsDeducted: money(source?.installmentsDeducted, 0),
    balanceBefore: money(source?.balanceBefore, client.balance + payment.amountReceived),
    balanceAfter: money(source?.balanceAfter, client.balance),
    savingsBefore: money(source?.savingsBefore, 0),
    savingsAfter: money(source?.savingsAfter, 0),
    installmentsPaidAfter: money(source?.installmentsPaidAfter, client.installmentsPaid),
    installmentsRemainingAfter: money(source?.installmentsRemainingAfter, client.installmentsRemaining),
    rentAmount: money(source?.rentAmount, client.rentAmount),
    frequency,
    createdAt: source?.createdAt || payment.createdAt
  };
}

function portalBillingClient(client: ClientPortalSnapshot["client"]): Client {
  return {
    id: client.id,
    unitId: client.unitId,
    name: client.name,
    rentAmount: client.rentAmount,
    frequency: client.frequency,
    weeklyChargeDay: client.weeklyChargeDay,
    monthlyChargeDay: client.monthlyChargeDay,
    chargeFirstSunday: client.chargeFirstSunday,
    firstSundayChargedAt: client.firstSundayChargedAt,
    firstChargeDate: client.firstChargeDate,
    lastChargeDate: client.lastChargeDate,
    installmentsAgreed: client.installmentsAgreed,
    installmentsIssued: client.installmentsIssued,
    installmentsRemaining: client.installmentsRemaining,
    installmentsPaid: client.installmentsPaid,
    balance: client.balance,
    advanceBalance: client.advanceBalance,
    otherCharges: client.otherCharges,
    createdAt: "",
    status: client.status === "archivado" ? "archivado" : "activo",
    savings: 0
  };
}

export default function ClientPortalPage() {
  const [sessionToken, setSessionToken] = useState(readSessionToken);
  const [snapshot, setSnapshot] = useState<ClientPortalSnapshot | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [loadingSession, setLoadingSession] = useState(Boolean(sessionToken));
  const [loginForm, setLoginForm] = useState({ cedula: "", pin: "" });
  const [showPin, setShowPin] = useState(false);
  const [localSetupOpen, setLocalSetupOpen] = useState(false);
  const [localSetupForm, setLocalSetupForm] = useState({ name: "", unitId: "" });
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [view, setView] = useState<PortalView>("home");
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [evidenceName, setEvidenceName] = useState("");
  const [evidenceDataUrl, setEvidenceDataUrl] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const [analyzingReceipt, setAnalyzingReceipt] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [amountConfidence, setAmountConfidence] = useState<ReceiptAmountConfidence | null>(null);
  const [paymentChannel, setPaymentChannel] = useState<PortalPaymentChannel | null>(null);
  const [paymentChannelConfidence, setPaymentChannelConfidence] = useState<ReceiptAmountConfidence | null>(null);
  const [destinationStatus, setDestinationStatus] = useState<ReceiptDestinationStatus | null>(null);
  const [destinationAccountLast4, setDestinationAccountLast4] = useState<string | null>(null);
  const [destinationRecipient, setDestinationRecipient] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [receiptPreview, setReceiptPreview] = useState<Payment | null>(null);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState("");
  const [receiptError, setReceiptError] = useState("");

  useEffect(() => {
    if (!sessionToken) {
      setLoadingSession(false);
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    setLoadingSession(true);
    void loadClientPortalSnapshot(sessionToken).then((data) => {
      if (!cancelled) {
        setSnapshot(data);
        setSelectedClientId((current) => data.units.some((unit) => unit.client.id === current)
          ? current
          : data.units[0]?.client.id ?? data.client.id);
      }
    }).catch(() => {
      if (cancelled) return;
      writeSessionToken("");
      setSessionToken("");
      setSnapshot(null);
      setSelectedClientId("");
      setLoginError("Tu sesión venció. Ingresa nuevamente.");
    }).finally(() => { if (!cancelled) setLoadingSession(false); });
    return () => { cancelled = true; };
  }, [sessionToken]);

  const selectedUnit = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.units.find((unit) => unit.client.id === selectedClientId)
      ?? snapshot.units[0]
      ?? { client: snapshot.client, vehicle: snapshot.vehicle };
  }, [selectedClientId, snapshot]);

  const selectedGroup = selectedUnit?.client.unitId.trim().toUpperCase().charAt(0) ?? "";
  const authorizedDestinations = useMemo<ReceiptAuthorizedDestination[]>(() => {
    if (!selectedGroup) return [];
    return loadBankRules()
      .filter((rule) => rule.active && rule.groupCode.trim().toUpperCase() === selectedGroup)
      .map((rule) => ({ accountNumber: rule.accountNumber, accountName: rule.accountName }));
  }, [selectedGroup]);

  const nextCharge = useMemo(() => {
    if (!selectedUnit) return null;
    return findNextChargeDay(portalBillingClient(selectedUnit.client), new Date());
  }, [selectedUnit]);

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (loggingIn) return;
    if (!loginForm.cedula.trim() || !/^\d{6}$/.test(loginForm.pin)) {
      setLoginError("Completa tu cédula y PIN de 6 dígitos.");
      return;
    }
    setLoggingIn(true);
    setLoginError("");
    try {
      const session = await loginClientPortal(loginForm.cedula, loginForm.pin);
      writeSessionToken(session.token);
      setSessionToken(session.token);
      setLoginForm({ cedula: "", pin: "" });
    } catch (cause) {
      setLoginError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleCreateLocalTestAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (loggingIn) return;
    if (!loginForm.cedula.trim() || !/^\d{6}$/.test(loginForm.pin) || !localSetupForm.name.trim() || !localSetupForm.unitId.trim()) {
      setLoginError("Completa la cédula, el PIN, el nombre y la unidad de prueba.");
      return;
    }
    setLoggingIn(true);
    setLoginError("");
    try {
      const session = await createClientPortalTestAccount({
        cedula: loginForm.cedula,
        pin: loginForm.pin,
        name: localSetupForm.name,
        unitId: localSetupForm.unitId
      });
      writeSessionToken(session.token);
      setSessionToken(session.token);
      setLocalSetupOpen(false);
    } catch (cause) {
      setLoginError(cause instanceof Error ? cause.message : "No se pudo crear la copia local.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout(): Promise<void> {
    const token = sessionToken;
    writeSessionToken("");
    setSessionToken("");
    setSnapshot(null);
    setSelectedClientId("");
    setView("home");
    if (token) await logoutClientPortal(token).catch(() => undefined);
  }

  function openPayment(): void {
    if (!selectedUnit) return;
    setAmount("");
    setEvidenceName("");
    setEvidenceDataUrl("");
    setAmountConfidence(null);
    setPaymentChannel(null);
    setPaymentChannelConfidence(null);
    setDestinationStatus(null);
    setDestinationAccountLast4(null);
    setDestinationRecipient(null);
    setEditingAmount(false);
    setAnalysisProgress(0);
    setPaymentError("");
    setPaymentOpen(true);
  }

  async function handleEvidence(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    setEvidenceName("");
    setEvidenceDataUrl("");
    setAmount("");
    setAmountConfidence(null);
    setPaymentChannel(null);
    setPaymentChannelConfidence(null);
    setDestinationStatus(null);
    setDestinationAccountLast4(null);
    setDestinationRecipient(null);
    setEditingAmount(false);
    setAnalysisProgress(0);
    setPaymentError("");
    if (!file) return;
    setReadingFile(true);
    try {
      const prepared = await prepareSellerLeadDocument(file);
      setEvidenceName(prepared.name);
      setEvidenceDataUrl(prepared.dataUrl);
      setReadingFile(false);
      setAnalyzingReceipt(true);
      const detected = await analyzeReceiptAmount(
        prepared.dataUrl,
        selectedUnit?.client.rentAmount ?? 0,
        setAnalysisProgress,
        authorizedDestinations
      );
      setAmountConfidence(detected.confidence);
      setPaymentChannel(detected.paymentChannel);
      setPaymentChannelConfidence(detected.paymentChannelConfidence);
      setDestinationStatus(detected.destinationStatus);
      setDestinationAccountLast4(detected.destinationAccountLast4);
      setDestinationRecipient(detected.destinationRecipient);
      if (detected.destinationStatus === "mismatch") {
        setPaymentError(`La cuenta del comprobante no corresponde a la unidad ${selectedUnit?.client.unitId ?? "seleccionada"}. Este pago no se puede enviar.`);
      }
      if (detected.amount !== null) {
        setAmount(detected.amount.toFixed(2));
        setEditingAmount(detected.confidence === "low");
      } else {
        setEditingAmount(true);
        setPaymentError("No pudimos identificar el monto. Intenta con una foto más clara o escríbelo para continuar.");
      }
    } catch (cause) {
      event.target.value = "";
      setEditingAmount(true);
      setPaymentError(cause instanceof Error ? cause.message : "No se pudo analizar el comprobante.");
    } finally {
      setReadingFile(false);
      setAnalyzingReceipt(false);
    }
  }

  async function handleSubmitPayment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (destinationStatus === "mismatch") {
      setPaymentError(`Este comprobante muestra una cuenta equivocada para el grupo ${selectedGroup}. No podemos aceptar este pago.`);
      return;
    }
    if (!sessionToken || !selectedUnit || !Number.isFinite(numericAmount) || numericAmount <= 0 || !evidenceName || !evidenceDataUrl || !paymentChannel) {
      setPaymentError(!paymentChannel ? "Confirma si fue ACH Xpress o transferencia regular." : "Adjunta un comprobante donde pueda leerse el monto pagado.");
      return;
    }
    setSubmittingPayment(true);
    setPaymentError("");
    try {
      const next = await submitClientPortalPayment({
        sessionToken,
        clientId: selectedUnit.client.id,
        amount: Math.round(numericAmount * 100) / 100,
        paymentChannel,
        evidenceName,
        evidenceDataUrl
      });
      setSnapshot(next);
      setPaymentOpen(false);
      setSuccessMessage("Comprobante enviado. Te avisaremos cuando se confirme.");
      window.setTimeout(() => setSuccessMessage(""), 4200);
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "No se pudo enviar el comprobante.");
    } finally {
      setSubmittingPayment(false);
    }
  }

  function openReceipt(payment: ClientPortalPayment): void {
    setReceiptError("");
    setReceiptPreview(portalReceipt(payment, client));
  }

  async function downloadReceipt(payment: ClientPortalPayment): Promise<void> {
    if (downloadingReceiptId) return;
    setDownloadingReceiptId(payment.id);
    setReceiptError("");
    try {
      const { fileName, blob } = await buildPaymentReceiptImageBlob(portalReceipt(payment, client), { format: "history" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setReceiptError("No se pudo preparar el recibo. Intenta nuevamente.");
    } finally {
      setDownloadingReceiptId("");
    }
  }

  if (!isSupabaseConfigured) {
    return <main className="cp-state-page"><section><strong>Portal no configurado</strong><p>Faltan las variables de conexión de Supabase.</p></section></main>;
  }

  if (loadingSession) {
    return <main className="cp-state-page"><section><div className="cp-spinner" /><strong>Cargando tu cuenta…</strong></section></main>;
  }

  if (!sessionToken || !snapshot) {
    return (
      <main className="cp-login-page">
        <section className="cp-login-panel">
          <div className="cp-brand"><span>R</span><div>Rentautos<small>MI CUENTA</small></div></div>
          <div className="cp-login-copy"><small>PORTAL DEL CLIENTE</small><h1>Bienvenido</h1><p>Consulta tu cuenta y notifica tus pagos con los datos de tu contrato.</p></div>
          <form className="cp-login-form" onSubmit={(event) => void handleLogin(event)}>
            <label>Número de cédula<input autoComplete="username" value={loginForm.cedula} onChange={(event) => { setLoginError(""); setLoginForm((current) => ({ ...current, cedula: event.target.value })); }} placeholder="Ej. 8-921-1234" /></label>
            <label>PIN de 6 dígitos<span className="cp-pin-field"><input type={showPin ? "text" : "password"} inputMode="numeric" maxLength={6} autoComplete="current-password" value={loginForm.pin} onChange={(event) => { setLoginError(""); setLoginForm((current) => ({ ...current, pin: event.target.value.replace(/\D/g, "") })); }} placeholder="••••••" /><button type="button" onClick={() => setShowPin((current) => !current)}>{showPin ? "OCULTAR" : "VER"}</button></span></label>
            {loginError && <p className="cp-error" role="alert">{loginError}</p>}
            <button className="cp-primary" type="submit" disabled={loggingIn}>{loggingIn ? "Verificando…" : "Entrar a mi cuenta"}</button>
          </form>
          {isLocalClientPortalMode() && <p className="cp-local-hint"><strong>Prueba local</strong> Si todavía no configuraste un PIN desde Clientes → Editar → Portal, usa temporalmente <b>123456</b>.</p>}
          {isLocalClientPortalMode() && (
            <div className="cp-local-setup">
              <button type="button" onClick={() => setLocalSetupOpen((current) => !current)}>{localSetupOpen ? "Cancelar copia local" : "Crear copia local de prueba"}</button>
              {localSetupOpen && (
                <form onSubmit={(event) => void handleCreateLocalTestAccount(event)}>
                  <p>Usará la cédula y el PIN escritos arriba. Estos datos quedarán solamente en este navegador.</p>
                  <label>Nombre del cliente<input value={localSetupForm.name} onChange={(event) => setLocalSetupForm((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre completo" /></label>
                  <label>Unidad<input value={localSetupForm.unitId} onChange={(event) => setLocalSetupForm((current) => ({ ...current, unitId: event.target.value.toUpperCase() }))} placeholder="Ej. D54" /></label>
                  <button type="submit" disabled={loggingIn}>{loggingIn ? "Preparando…" : "Crear y entrar"}</button>
                </form>
              )}
            </div>
          )}
          <p className="cp-secure">🔒 Tus datos se protegen de forma segura</p>
        </section>
        <section className="cp-login-visual" aria-hidden="true"><div><small>TODO EN UN SOLO LUGAR</small><h2>Tu cuenta,<br />siempre clara.</h2><p>Revisa tu próximo pago, consulta tus recibos y envía comprobantes desde cualquier dispositivo.</p><ul><li><strong>＋</strong>Notifica pagos</li><li><strong>▧</strong>Consulta recibos</li><li><strong>⌾</strong>Acceso privado</li></ul></div></section>
      </main>
    );
  }

  const client = selectedUnit?.client ?? snapshot.client;
  const vehicle = selectedUnit?.vehicle ?? snapshot.vehicle;
  const selectedPayments = snapshot.payments.filter((payment) => payment.clientId === client.id);
  const selectedNotices = snapshot.notices.filter((notice) => notice.clientId === client.id);
  const latestNotice = selectedNotices[0];
  const latestNoticeChannel = latestNotice ? resolveNoticePaymentChannel(latestNotice, selectedPayments) : null;
  const overdueInstallments = overdueInstallmentCount(client.balance, client.rentAmount);
  const timelineEvents = buildPortalDebtTimeline(client, selectedPayments);
  const pageTitle = view === "payments" ? "Mis pagos" : view === "profile" ? "Mi perfil" : `Hola, ${client.name.split(/\s+/)[0] || "cliente"}`;

  return (
    <main className="cp-dashboard">
      <aside className="cp-sidebar">
        <div className="cp-brand"><span>R</span><div>Rentautos<small>MI CUENTA</small></div></div>
        <nav>{(["home", "payments", "profile"] as PortalView[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item === "home" ? "⌂ Inicio" : item === "payments" ? "▤ Mis pagos" : "○ Mi perfil"}</button>)}</nav>
        <button className="cp-help" type="button">¿Necesitas ayuda?<small>Contactar a Rentautos →</small></button>
      </aside>
      <section className="cp-content">
        <header><div><small>{new Date().toLocaleDateString("es-PA", { weekday: "long", day: "numeric", month: "long" })}</small><h1>{pageTitle}</h1></div>{snapshot.units.length > 1 && <label className="cp-unit-switch">Unidad<select value={client.id} onChange={(event) => setSelectedClientId(event.target.value)}>{snapshot.units.map((unit) => <option key={unit.client.id} value={unit.client.id}>{unit.client.unitId}{unit.vehicle.plate ? ` · ${unit.vehicle.plate}` : ""}</option>)}</select></label>}<button className="cp-avatar" onClick={() => setView("profile")}>{client.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</button></header>

        {view === "home" && <>
          <div className="cp-overview">
            <article className="cp-balance"><small>Saldo pendiente</small><strong>{formatCurrency(client.balance)}</strong><p>{client.balance > 0 ? "Tienes un saldo por cubrir" : nextCharge ? `Próximo cobro: ${formatDate(nextCharge)}` : "Tu cuenta está al día"}</p><div className="cp-balance-stats"><span><small>Cuotas pagadas</small><b>{client.installmentsPaid}</b></span><span className={overdueInstallments > 0 ? "is-overdue" : ""}><small>{overdueInstallments > 0 ? "⚠ Cuotas atrasadas" : "Cuotas atrasadas"}</small><b>{overdueInstallments}</b>{overdueInstallments > 0 && <em>Pagar pronto</em>}</span></div><button onClick={openPayment}>＋ Notificar pago</button></article>
            <article className="cp-unit"><small>{snapshot.units.length > 1 ? `MIS UNIDADES · ${snapshot.units.length}` : "MI UNIDAD"}</small><div><h2>Unidad {client.unitId}</h2><span>{client.status.toUpperCase()}</span></div><dl><dt>Vehículo</dt><dd>{vehicle.brandModel || "Sin detalle"}</dd><dt>Placa</dt><dd>{vehicle.plate || "—"}</dd><dt>Plan</dt><dd>{frequencyLabel(client.frequency)} · {formatCurrency(client.rentAmount)}</dd><dt>Próximo cobro</dt><dd>{nextCharge ? formatDate(nextCharge) : "Por definir"}</dd></dl></article>
          </div>
          {latestNotice && <section className={`cp-notice cp-notice--${latestNotice.status}`}><div><small>PAGO NOTIFICADO</small><strong>{formatCurrency(latestNotice.amount)} · {noticeLabel(latestNotice)}</strong><p>{latestNoticeChannel ? paymentChannelLabel(latestNoticeChannel) : "Método por revisar"} · {latestNotice.evidenceName}</p>{latestNotice.rejectionReason && <p>{latestNotice.rejectionReason}</p>}</div><span>{latestNotice.status === "confirmed" ? "✓" : latestNotice.status === "rejected" ? "!" : "◷"}</span></section>}
          <DebtTimeline events={timelineEvents} currentBalance={client.balance} overdueInstallments={overdueInstallments} filter={timelineFilter} onFilter={setTimelineFilter} onViewReceipt={openReceipt} compact />
          <section className="cp-section"><div className="cp-section-head"><h2>Pagos recientes · Unidad {client.unitId}</h2><button onClick={() => setView("payments")}>Ver todos</button></div><PaymentList payments={selectedPayments.slice(0, 3)} onView={openReceipt} onDownload={(payment) => void downloadReceipt(payment)} downloadingReceiptId={downloadingReceiptId} /></section>
        </>}

        {view === "payments" && <section className="cp-section cp-section--top"><div className="cp-section-head"><div><h2>Historial · Unidad {client.unitId}</h2><p>Pagos confirmados y recibos emitidos por Rentautos.</p></div><button className="cp-primary cp-primary--small" onClick={openPayment}>Notificar pago</button></div>{receiptError && <p className="cp-error" role="alert">{receiptError}</p>}<DebtTimeline events={timelineEvents} currentBalance={client.balance} overdueInstallments={overdueInstallments} filter={timelineFilter} onFilter={setTimelineFilter} onViewReceipt={openReceipt} /><h2 className="cp-subheading">Recibos emitidos</h2><PaymentList payments={selectedPayments} onView={openReceipt} onDownload={(payment) => void downloadReceipt(payment)} downloadingReceiptId={downloadingReceiptId} />{selectedNotices.length > 0 && <><h2 className="cp-subheading">Comprobantes enviados</h2><div className="cp-notice-list">{selectedNotices.map((notice) => { const channel = resolveNoticePaymentChannel(notice, selectedPayments); return <article key={notice.id}><div><strong>{formatCurrency(notice.amount)}</strong><span>{channel ? paymentChannelLabel(channel) : "Método por revisar"} · {new Date(notice.submittedAt).toLocaleString("es-PA")}</span></div><span className={`cp-status cp-status--${notice.status}`}>{noticeLabel(notice)}</span></article>; })}</div></>}</section>}

        {view === "profile" && <section className="cp-profile"><div className="cp-profile-head"><span className="cp-avatar">{client.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><h2>{client.name}</h2><p>Cliente {client.status}</p></div></div><dl><dt>Cédula</dt><dd>{client.cedulaMasked}</dd><dt>Unidades</dt><dd>{snapshot.units.map((unit) => unit.client.unitId).join(", ")}</dd><dt>Unidad seleccionada</dt><dd>{client.unitId}</dd><dt>Frecuencia</dt><dd>{frequencyLabel(client.frequency)}</dd><dt>Cuotas pagadas</dt><dd>{client.installmentsPaid}</dd><dt>Cuotas atrasadas</dt><dd className={overdueInstallments > 0 ? "cp-profile-overdue" : ""}>{overdueInstallments > 0 ? `⚠ ${overdueInstallments}` : overdueInstallments}</dd><dt>Cuotas restantes</dt><dd>{client.installmentsRemaining}</dd></dl><button className="cp-logout" onClick={() => void handleLogout()}>Salir de mi cuenta</button></section>}
      </section>

      <nav className="cp-mobile-nav">{(["home", "payments", "profile"] as PortalView[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item === "home" ? "⌂" : item === "payments" ? "▤" : "○"}<small>{item === "home" ? "Inicio" : item === "payments" ? "Pagos" : "Perfil"}</small></button>)}</nav>

      {paymentOpen && (
        <div className="cp-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submittingPayment && !analyzingReceipt) setPaymentOpen(false); }}>
          <form className="cp-payment-modal" onSubmit={(event) => void handleSubmitPayment(event)}>
            <button className="cp-modal-close" type="button" onClick={() => setPaymentOpen(false)} disabled={analyzingReceipt} aria-label="Cerrar">×</button>
            <h2>Notificar pago</h2>
            <p>Adjunta el comprobante de la <strong>unidad {client.unitId}</strong>. Revisaremos que el dinero haya llegado a una cuenta válida del <strong>grupo {selectedGroup}</strong>.</p>
            {authorizedDestinations.length > 0 ? (
              <div className="cp-expected-accounts">
                <small>Debes pagar a:</small>
                {authorizedDestinations.map((destination) => (
                  <strong key={destination.accountNumber}>{destination.accountName || `Cuenta del grupo ${selectedGroup}`} · termina en {destination.accountNumber.slice(-4)}</strong>
                ))}
              </div>
            ) : <p className="cp-error">No encontramos una regla bancaria activa para el grupo {selectedGroup}. El comprobante tendrá que revisarse manualmente.</p>}
            <label className={`cp-upload ${evidenceName ? "has-file" : ""}`}>Comprobante<input type="file" accept="image/*,application/pdf,.heic,.heif" onChange={(event) => void handleEvidence(event)} disabled={readingFile || analyzingReceipt || submittingPayment} /><span>{readingFile ? "Preparando archivo…" : evidenceName ? `✓ ${evidenceName}` : "Tomar foto o seleccionar archivo"}</span><small>Imagen o PDF · máximo 4 MB</small></label>
            {analyzingReceipt && <div className="cp-ocr-progress" role="status"><span><b>Analizando comprobante…</b><small>{Math.round(analysisProgress * 100)}%</small></span><progress max="1" value={analysisProgress} /></div>}
            {amount && !editingAmount && !analyzingReceipt && <div className={`cp-detected-amount cp-detected-amount--${amountConfidence ?? "medium"}`}><div><small>Monto detectado</small><strong>{formatCurrency(Number(amount))}</strong><span>{amountConfidence === "high" ? "Lectura confiable" : "Revisa que coincida con el comprobante"}</span></div><button type="button" onClick={() => setEditingAmount(true)}>Corregir</button></div>}
            {editingAmount && !analyzingReceipt && <label>Monto a confirmar<span className="cp-amount-input"><b>$</b><input inputMode="decimal" value={amount} autoFocus onChange={(event) => { setPaymentError(""); setAmount(event.target.value); }} /></span></label>}
            {evidenceName && !analyzingReceipt && paymentChannel && (
              <div className={`cp-detected-channel cp-detected-channel--${paymentChannelConfidence ?? "medium"}`}>
                <div><small>Método detectado</small><strong>{paymentChannelLabel(paymentChannel)}</strong><span>{paymentChannelConfidence === "high" ? "Clasificación confiable" : "Confirma que sea correcto"}</span></div>
                <button type="button" onClick={() => { setPaymentChannel(null); setPaymentChannelConfidence("low"); }}>Cambiar</button>
              </div>
            )}
            {evidenceName && !analyzingReceipt && !paymentChannel && (
              <fieldset className="cp-channel-options">
                <legend>¿Cómo hiciste la transferencia?</legend>
                <p>No pudimos distinguirlo con seguridad. Elige una opción.</p>
                <div>
                  <button type="button" onClick={() => { setPaymentError(""); setPaymentChannel("ach_xpress"); setPaymentChannelConfidence("high"); }}>ACH Xpress<small>Transferencia inmediata</small></button>
                  <button type="button" onClick={() => { setPaymentError(""); setPaymentChannel("regular_transfer"); setPaymentChannelConfidence("high"); }}>Transferencia regular<small>ACH estándar</small></button>
                </div>
              </fieldset>
            )}
            {evidenceName && !analyzingReceipt && destinationStatus && (
              <div className={`cp-destination-check cp-destination-check--${destinationStatus}`} role={destinationStatus === "mismatch" ? "alert" : "status"}>
                <span className="cp-destination-icon">{destinationStatus === "verified" ? "✓" : destinationStatus === "mismatch" ? "!" : "?"}</span>
                <div>
                  <small>Cuenta de destino</small>
                  <strong>{destinationStatus === "verified" ? "Cuenta correcta" : destinationStatus === "mismatch" ? "Cuenta equivocada" : "No pudimos leer la cuenta"}</strong>
                  <p>
                    {destinationStatus === "verified"
                      ? `${destinationRecipient ?? `Cuenta del grupo ${selectedGroup}`}${destinationAccountLast4 ? ` · termina en ${destinationAccountLast4}` : ""}`
                      : destinationStatus === "mismatch"
                        ? `No corresponde al grupo ${selectedGroup}. No envíes este comprobante.${destinationAccountLast4 ? ` La cuenta termina en ${destinationAccountLast4}.` : destinationRecipient ? ` Dice: ${destinationRecipient}.` : ""}`
                        : "Puedes enviarlo, pero quedará pendiente de revisión."}
                  </p>
                </div>
              </div>
            )}
            {paymentError && <p className="cp-error" role="alert">{paymentError}</p>}
            <p className="cp-privacy">🔒 El análisis ocurre en este dispositivo. Tu comprobante no se envía a servicios de lectura externos.</p>
            <button className="cp-primary" disabled={submittingPayment || readingFile || analyzingReceipt || !evidenceName || !amount || !paymentChannel || destinationStatus === "mismatch"}>{destinationStatus === "mismatch" ? "Comprobante no aceptado" : submittingPayment ? "Enviando…" : analyzingReceipt ? "Analizando…" : "Enviar comprobante"}</button>
          </form>
        </div>
      )}
      {receiptPreview && <div className="cp-receipt-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setReceiptPreview(null); }}><div className="cp-receipt-shell"><PaymentReceipt payment={receiptPreview} onClose={() => setReceiptPreview(null)} closeLabel="Cerrar recibo" receiptFormat="history" /></div></div>}
      {successMessage && <div className="cp-toast" role="status">✓ {successMessage}</div>}
    </main>
  );
}

function PaymentList({ payments, onView, onDownload, downloadingReceiptId }: { payments: ClientPortalSnapshot["payments"]; onView: (payment: ClientPortalPayment) => void; onDownload: (payment: ClientPortalPayment) => void; downloadingReceiptId: string }) {
  if (payments.length === 0) return <p className="cp-empty">Todavía no hay pagos confirmados.</p>;
  return <div className="cp-payment-list">{payments.map((payment) => <article key={payment.id}><span className="cp-payment-check">✓</span><div className="cp-payment-info"><strong>{formatPortalDate(payment.dateApplied)}</strong><small>{payment.paymentMethod} · Recibo {payment.receiptNumber || "—"}</small></div><div className="cp-payment-receipt-actions"><b>{formatCurrency(payment.amountReceived)}</b><span><button type="button" onClick={() => onView(payment)}>Ver recibo</button><button type="button" disabled={downloadingReceiptId === payment.id} onClick={() => onDownload(payment)}>{downloadingReceiptId === payment.id ? "Preparando…" : "Descargar"}</button></span></div></article>)}</div>;
}

function DebtTimeline({ events, currentBalance, overdueInstallments, filter, onFilter, onViewReceipt, compact = false }: {
  events: PortalTimelineEvent[];
  currentBalance: number;
  overdueInstallments: number;
  filter: TimelineFilter;
  onFilter: (filter: TimelineFilter) => void;
  onViewReceipt: (payment: ClientPortalPayment) => void;
  compact?: boolean;
}) {
  const filteredEvents = events.filter((event) => filter === "all" || event.type === filter);
  const visibleEvents = filteredEvents.slice(0, compact ? 4 : 20);
  return (
    <section className={`cp-timeline-card${compact ? " cp-timeline-card--compact" : ""}`}>
      <header>
        <div><small>TU SALDO</small><h2>{currentBalance > 0 ? `¿Por qué debes ${formatCurrency(currentBalance)}?` : "Tus pagos están al día"}</h2><p>{currentBalance > 0 ? `Debes ${overdueInstallments} ${overdueInstallments === 1 ? "cuota" : "cuotas"}. Aquí puedes ver tus cobros y pagos.` : "Aquí puedes ver los pagos que has hecho."}</p></div>
        <nav aria-label="Elegir qué mostrar">{(["all", "charge", "payment"] as TimelineFilter[]).map((item) => <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => onFilter(item)}>{item === "all" ? "Ver todo" : item === "charge" ? "Lo que debes" : "Tus pagos"}</button>)}</nav>
      </header>
      {visibleEvents.length === 0 ? <p className="cp-timeline-empty">No hay información para mostrar aquí.</p> : <ol className="cp-timeline">{visibleEvents.map((event) => <li key={event.id} className={`cp-timeline-${event.type}`}><span className="cp-timeline-dot">{event.type === "payment" ? "✓" : "!"}</span><div className="cp-timeline-copy"><time>{new Date(event.date).toLocaleDateString("es-PA", { day: "numeric", month: "short" })}</time><strong>{event.title}</strong><p>{event.detail}</p>{event.balanceAfter !== undefined && <small>Después de pagar, debías: {formatCurrency(event.balanceAfter)}</small>}{event.payment && <button type="button" onClick={() => onViewReceipt(event.payment!)}>Ver recibo</button>}</div><b className={event.amount < 0 ? "is-payment" : "is-charge"}><small>{event.amount < 0 ? "PAGASTE" : "FALTA"}</small>{formatCurrency(Math.abs(event.amount))}</b></li>)}</ol>}
      {compact && filteredEvents.length > visibleEvents.length && <p className="cp-timeline-more">Hay más información en “Mis pagos”.</p>}
    </section>
  );
}
