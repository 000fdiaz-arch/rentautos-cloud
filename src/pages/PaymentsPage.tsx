import { useEffect, useMemo, useRef, useState } from "react";
import PaymentReceipt, {
  downloadPaymentReceiptImage
} from "../components/PaymentReceipt";
import { formatCurrency, formatDate } from "../format";
import {
  loadPendingBankItems,
  savePendingBankItems
} from "../storage";
import type {
  BankRule,
  Client,
  LateFeeSettings,
  OtherChargesRetentionByClient,
  Payment,
  PendingBankItem
} from "../types";
import { findNextChargeDay, getBusinessDateKey, parseDateKey, startOfDay } from "../billing";
import PaymentsTabs from "./payments/PaymentsTabs";
import NotifiedPaymentsPanel from "./payments/NotifiedPaymentsPanel";
import PendingCardsPanel from "./payments/PendingCardsPanel";
import PaymentHistoryPanel, { type HistoryFocusRequest } from "./payments/PaymentHistoryPanel";
import CashClosingPanel from "./payments/CashClosingPanel";
import PendingBankPanel from "./payments/PendingBankPanel";
import RegisterPaymentPanel from "./payments/RegisterPaymentPanel";
import usePaymentPersistence from "./payments/usePaymentPersistence";
import useCashClosing from "./payments/useCashClosing";
import useNotifiedPayments from "./payments/useNotifiedPayments";
import usePendingCards from "./payments/usePendingCards";
import PendingBankReview from "./payments/PendingBankReview";
import usePendingBankWorkflow from "./payments/usePendingBankWorkflow";
import usePaymentsNavigation from "./payments/usePaymentsNavigation";
import { getPaymentSaveErrorMessage } from "./payments/paymentPersistenceErrors";
import { buildManualPaymentTransaction } from "./payments/manualPaymentWorkflow";
import {
  buildPendingBankPreview,
  buildTakenFolioSet,
  getPendingSimilaritySignals
} from "./payments/pendingBankRules";
import {
  extractFoliosFromReference,
  extractGroupCodeFromUnit,
  normalizeFolioToken
} from "./payments/bankPaymentRules";
import {
  DeletePaymentDialog,
  PaymentPreviewDialog,
  ReopenCashDialog
} from "./payments/PaymentDialogs";
import {
  BANK_PAYMENT_METHODS,
  PAYMENT_METHODS
} from "./payments/paymentConstants";
import type { PaymentForm } from "./payments/paymentTypes";
import {
  DEFAULT_OTHER_CHARGES_RETENTION,
  computeManualPaymentAllocation,
  computeRequiredWholeAmountToReachDate,
  getAdvanceLetterLabel,
  getConfiguredOtherChargesRetentionConfig,
  getInstallmentsTotalInPayment,
  getMonthEndDate,
  restoreOtherChargesAfterDelete,
  roundMoney,
  shouldForceRetentionToOtherCharges,
  toInputMoney
} from "./payments/paymentRules";
type Props = {
  clients: Client[];
  bankRules: BankRule[];
  lateFeeSettings: LateFeeSettings;
  otherChargesRetentionByClient: OtherChargesRetentionByClient;
  onClientsChange: (next: Client[]) => void;
  payments: Payment[];
  onPaymentsChange: (next: Payment[]) => void;
  onPersistClientPayment?: (nextClients: Client[], nextPayments: Payment[]) => Promise<boolean>;
  onDeletePayment?: (nextClients: Client[], nextPayments: Payment[], deletedPaymentId: string) => Promise<boolean>;
  dataOwnerUserId?: string | null;
  isPaymentHistoryLoaded?: boolean;
  onRefreshPayments?: () => Promise<void>;
  onCashClose?: () => void;
  quickCashPrefill?: {
    dateApplied: string;
    clientId: string;
    reference: string;
    amountReceived: string;
    token: number;
  } | null;
  onQuickCashPrefillConsumed?: () => void;
};

export default function PaymentsPage({
  clients,
  bankRules,
  lateFeeSettings,
  otherChargesRetentionByClient,
  onClientsChange,
  payments,
  onPaymentsChange,
  onPersistClientPayment,
  onDeletePayment,
  dataOwnerUserId,
  isPaymentHistoryLoaded = true,
  onRefreshPayments,
  onCashClose,
  quickCashPrefill,
  onQuickCashPrefillConsumed
}: Props) {
  const [form, setForm] = useState<PaymentForm>({
    clientId: "",
    dateApplied: getBusinessDateKey(),
    paymentMethod: "Efectivo",
    reference: "",
    amountReceived: ""
  });
  const [clientSearch, setClientSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmedPayment, setConfirmedPayment] = useState<Payment | null>(null);
  const [historyFocusRequest, setHistoryFocusRequest] = useState<HistoryFocusRequest | null>(null);
  const [historyPreviewPayment, setHistoryPreviewPayment] = useState<Payment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null);
  const {
    cashClosings,
    cashClosingDate,
    setCashClosingDate,
    cashClosingActor,
    setCashClosingActor,
    cashClosingReason,
    setCashClosingReason,
    cashClosingInfo,
    cashClosingError,
    cashClosingAudit,
    chargeRuns,
    lastCloseReport,
    reopenTargetDate,
    setReopenTargetDate,
    reopenReason,
    setReopenReason,
    operationalDateKey,
    isDateClosed,
    handleCloseCashForDate,
    openReopenDialog,
    handleConfirmReopen
  } = useCashClosing({
    clients,
    payments,
    lateFeeSettings,
    onClientsChange,
    onCashClose
  });
  const [pendingBankItems, setPendingBankItems] = useState<PendingBankItem[]>(() => loadPendingBankItems());
  const [pendingImportError, setPendingImportError] = useState("");
  const [manualOverrideForcedOtherCharges, setManualOverrideForcedOtherCharges] = useState(false);
  const [autoAmountInfo, setAutoAmountInfo] = useState("");
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [registerTravelFundInput, setRegisterTravelFundInput] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const autoDownloadedPaymentIdsRef = useRef<Set<string>>(new Set());
  const [pendingQuickCashSubmitToken, setPendingQuickCashSubmitToken] = useState<number | null>(null);

  const {
    isRegisterOpen,
    setIsRegisterOpen,
    isNotifiedOpen,
    setIsNotifiedOpen,
    isCashClosingOpen,
    setIsCashClosingOpen,
    isHistoryOpen,
    setIsHistoryOpen,
    isPendingOpen,
    setIsPendingOpen,
    isCardPendingOpen,
    setIsCardPendingOpen,
    cashSectionRef,
    registerSectionRef,
    notifiedSectionRef,
    pendingSectionRef,
    pendingCardSectionRef,
    historySectionRef,
    activePaymentTab,
    selectPaymentTab
  } = usePaymentsNavigation();

  function replacePendingBankItems(items: PendingBankItem[]): void {
    setPendingBankItems(items);
    savePendingBankItems(items);
  }

  const {
    pendingCardItems,
    replacePendingCardItems,
    editingPendingCardId,
    editingPendingCardForm,
    setEditingPendingCardForm,
    bulkPendingCardFolio,
    setBulkPendingCardFolio,
    cardPendingMessage,
    handleRemovePendingCard,
    handleStartEditPendingCard,
    handleCancelEditPendingCard,
    handleSaveEditPendingCard,
    handleApplyFolioToAllPendingCards,
    handleGeneratePendingCardReceipt
  } = usePendingCards({
    clients,
    payments,
    pendingBankItems,
    operationalDateKey,
    retentionByClient: otherChargesRetentionByClient,
    onPaymentsChange,
    replacePendingBankItems,
    setPendingImportError,
    showReceipt: (payment) => finalizeSuccessfulPayment(payment, { openReceipt: true })
  });



  useEffect(() => {
    if (!quickCashPrefill) return;
    selectPaymentTab("register");
    setForm((prev) => ({
      ...prev,
      dateApplied: quickCashPrefill.dateApplied || getBusinessDateKey(),
      paymentMethod: "Efectivo",
      clientId: quickCashPrefill.clientId || "",
      reference: quickCashPrefill.reference || "",
      amountReceived: quickCashPrefill.amountReceived || ""
    }));
    setClientSearch("");
    setErrors([]);
    setPendingQuickCashSubmitToken(quickCashPrefill.token);
    onQuickCashPrefillConsumed?.();
  }, [quickCashPrefill, onQuickCashPrefillConsumed]);

  function openHistoryAfterPayment(payment: Payment): void {
    setConfirmedPayment(null);
    setHistoryFocusRequest({ clientId: payment.clientId, token: Date.now() });
    selectPaymentTab("history");
  }

  function finalizeSuccessfulPayment(payment: Payment, options?: { openReceipt?: boolean; openHistory?: boolean; skipAutoDownload?: boolean }): void {
    if (options?.openHistory) {
      openHistoryAfterPayment(payment);
    } else if (options?.openReceipt) {
      setConfirmedPayment(payment);
    }
    if (options?.skipAutoDownload) return;
    if (autoDownloadedPaymentIdsRef.current.has(payment.id)) return;
    autoDownloadedPaymentIdsRef.current.add(payment.id);
    void downloadPaymentReceiptImage(payment).catch(() => {
      setErrors((prev) => {
        const msg = "Pago registrado, pero no se pudo descargar el recibo automaticamente. Intenta descargarlo manualmente.";
        return prev.includes(msg) ? prev : [...prev, msg];
      });
    });
  }

  const activeClients = useMemo(
    () => clients.filter((c) => !c.archivedAt && c.status !== "archivado"),
    [clients]
  );

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return activeClients;
    return activeClients.filter((c) =>
      `${c.unitId} ${c.name} ${c.cedula ?? ""}`.toLowerCase().includes(q)
    );
  }, [activeClients, clientSearch]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === form.clientId) ?? null,
    [clients, form.clientId]
  );

  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  const [manualOtherChargesInput, setManualOtherChargesInput] = useState<Record<string, string>>({});

  const preview = useMemo(() => {
    if (!selectedClient) return null;
    const amount = parseFloat(form.amountReceived);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const effectiveDateKey = form.dateApplied || getBusinessDateKey();

    return computeManualPaymentAllocation(
      selectedClient,
      amount,
      manualOtherChargesInput,
      otherChargesRetentionByClient,
      payments,
      effectiveDateKey,
      manualOverrideForcedOtherCharges
    );
  }, [form.amountReceived, form.dateApplied, manualOtherChargesInput, otherChargesRetentionByClient, payments, selectedClient, manualOverrideForcedOtherCharges]);

  const {
    paymentInfo,
    setPaymentInfo,
    persistClientPaymentState,
    reserveReceiptNumber
  } = usePaymentPersistence({
    payments,
    onClientsChange,
    onPaymentsChange,
    onPersistClientPayment,
    dataOwnerUserId
  });

  useEffect(() => {
    if (!pendingQuickCashSubmitToken) return;
    if (!selectedClient) return;
    const amount = parseFloat(form.amountReceived);
    if (!Number.isFinite(amount) || amount <= 0) return;
    void handleConfirmPaymentClick();
    setPendingQuickCashSubmitToken(null);
  }, [pendingQuickCashSubmitToken, selectedClient, form.amountReceived]);


  async function handleConfirmPaymentClick(): Promise<void> {
    if (isConfirmingPayment) return;
    setIsConfirmingPayment(true);
    setPaymentInfo("Guardando pago y reservando recibo...");
    try {
      const saved = await handleConfirmPayment();
      if (!saved) setPaymentInfo("");
    } catch (error) {
      console.error("No se pudo confirmar el pago.", error);
      setErrors([getPaymentSaveErrorMessage(error)]);
      setPaymentInfo("");
    } finally {
      setIsConfirmingPayment(false);
    }
  }

  const isForcedOtherChargesRuleClient = useMemo(
    () => (
      selectedClient
        ? shouldForceRetentionToOtherCharges(selectedClient, otherChargesRetentionByClient, payments, form.dateApplied || getBusinessDateKey())
        : false
    ),
    [form.dateApplied, otherChargesRetentionByClient, payments, selectedClient]
  );
  const isForcedOtherChargesRuleActive = isForcedOtherChargesRuleClient && !manualOverrideForcedOtherCharges;
  const selectedClientRetentionConfig = useMemo(
    () => (
      selectedClient
        ? getConfiguredOtherChargesRetentionConfig(selectedClient, otherChargesRetentionByClient)
        : { amount: DEFAULT_OTHER_CHARGES_RETENTION, cycle: "daily" as const }
    ),
    [otherChargesRetentionByClient, selectedClient]
  );

  const isZeroBalance = selectedClient !== null && selectedClient.balance === 0;
  const isBankPayment = BANK_PAYMENT_METHODS.has(form.paymentMethod);
  const isCardPayment = form.paymentMethod === "Tarjeta";

  const {
    notifiedForm,
    setNotifiedForm,
    notifiedPayments,
    replaceNotifiedPayments,
    editingNotifiedId,
    editingNotifiedForm,
    setEditingNotifiedForm,
    notifiedSortField,
    notifiedSortDirection,
    notifiedUntilNoonOnly,
    setNotifiedUntilNoonOnly,
    notifiedErrors,
    notifiedRowsFiltered,
    notifiedClientMatch,
    editingNotifiedClientMatch,
    handleAddNotifiedPayment,
    handleDeleteNotifiedPayment,
    handleStartEditNotified,
    handleCancelEditNotified,
    handleSaveEditNotified,
    handleSortNotified
  } = useNotifiedPayments(clients, activeClients);

  const {
    pendingClassifyTarget,
    pendingClassifyClientId,
    pendingClassifyError,
    isPendingClassifySaving,
    pendingApplyingFolio,
    pendingOtherChargesInput,
    setPendingOtherChargesInput,
    pendingManualOverrideForcedOtherCharges,
    setPendingManualOverrideForcedOtherCharges,
    pendingTravelFundInputByFolio,
    setPendingTravelFundInputByFolio,
    handleImportBankCSV,
    handleOpenClassify,
    handleDismissPending,
    handleDismissAllPending,
    handlePendingUnitChange,
    handleConfirmClassify,
    handleQuickApply,
    handleApplyAllHighSimilarity,
    handleSavePendingClientTravelFund
  } = usePendingBankWorkflow({
    clients,
    activeClients,
    bankRules,
    payments,
    pendingBankItems,
    pendingCardItems,
    notifiedPayments,
    retentionByClient: otherChargesRetentionByClient,
    operationalDateKey,
    dataOwnerUserId,
    replacePendingBankItems,
    replaceNotifiedPayments,
    persistClientPaymentState,
    reserveReceiptNumber,
    finalizePayment: finalizeSuccessfulPayment,
    setErrors,
    pendingImportError,
    setPendingImportError,
    openPendingPanel: () => setIsPendingOpen(true),
    onClientsChange
  });


  const operationalDate = useMemo(() => {
    const parsed = parseDateKey(operationalDateKey);
    return parsed ? startOfDay(parsed) : startOfDay(new Date());
  }, [operationalDateKey]);

  const monthEndDate = useMemo(() => getMonthEndDate(operationalDate), [operationalDate]);

  const projectedNextChargeDate = useMemo(() => {
    if (!selectedClient || !preview || preview.balanceAfter > 0) return null;
    const projectedClient: Client = {
      ...selectedClient,
      balance: preview.balanceAfter,
      advanceBalance: roundMoney((selectedClient.advanceBalance ?? 0) + preview.advanceApplied),
      savings: roundMoney(selectedClient.savings + preview.centavosAhorro)
    };
    return findNextChargeDay(projectedClient, operationalDate);
  }, [operationalDate, preview, selectedClient]);

  const previewAdvanceLetterLabel = useMemo(() => {
    if (!selectedClient || !preview || preview.advanceApplied <= 0) return null;
    return getAdvanceLetterLabel(selectedClient, preview.advanceApplied);
  }, [preview, selectedClient]);

  const monthEndSuggestion = useMemo(() => {
    if (!selectedClient) return null;
    if (selectedClient.balance > 0) return null;
    if ((selectedClient.otherCharges ?? []).length > 0) return null;
    const result = computeRequiredWholeAmountToReachDate(selectedClient, operationalDate, monthEndDate);
    return {
      requiredWholeAmount: result.requiredWholeAmount,
      targetDate: monthEndDate,
      resultingNextDate: result.resultingNextDate
    };
  }, [monthEndDate, operationalDate, selectedClient]);


  function normalizeToOperationalDate(dateKey: string): string {
    if (!dateKey) return operationalDateKey;
    return dateKey > operationalDateKey ? operationalDateKey : dateKey;
  }

  useEffect(() => {
    setForm((prev) => (prev.dateApplied === operationalDateKey ? prev : { ...prev, dateApplied: operationalDateKey }));
  }, [operationalDateKey]);






  function renderPendingInlineReview(item: PendingBankItem) {
    return (
      <PendingBankReview
        item={item}
        client={clients.find((candidate) => candidate.id === pendingClassifyClientId) ?? null}
        payments={payments}
        retentionByClient={otherChargesRetentionByClient}
        otherChargesInput={pendingOtherChargesInput}
        manualOverride={pendingManualOverrideForcedOtherCharges}
        error={pendingClassifyError}
        isSaving={isPendingClassifySaving}
        onClose={() => handleOpenClassify(item)}
        onConfirm={() => void handleConfirmClassify()}
        onToggleManualOverride={() => setPendingManualOverrideForcedOtherCharges((current) => !current)}
        onOtherChargeChange={(key, value) =>
          setPendingOtherChargesInput((current) => ({ ...current, [key]: value }))
        }
      />
    );
  }
  function handleSelectClient(client: Client): void {
    setForm((f) => ({ ...f, clientId: client.id }));
    setClientSearch("");
    setDropdownOpen(false);
    setManualOtherChargesInput({});
    setManualOverrideForcedOtherCharges(false);
    setAutoAmountInfo("");
    setPaymentInfo("");
    setRegisterTravelFundInput(toInputMoney(roundMoney(Math.max(0, client.travelFundBalance ?? 0))));
  }


  function handleClearClient(): void {
    setForm((f) => ({ ...f, clientId: "" }));
    setClientSearch("");
    setDropdownOpen(false);
    setManualOverrideForcedOtherCharges(false);
    setAutoAmountInfo("");
    setPaymentInfo("");
    setRegisterTravelFundInput("");
  }

  function handleSaveSelectedClientTravelFund(): void {
    if (!selectedClient) return;
    const amount = parseFloat(registerTravelFundInput);
    if (!Number.isFinite(amount) || amount < 0) {
      setErrors(["El fondo de viaje debe ser un numero valido mayor o igual a 0."]);
      return;
    }
    const nextFund = roundMoney(Math.max(0, amount));
    const updatedClients = clients.map((client) =>
      client.id === selectedClient.id ? { ...client, travelFundBalance: nextFund } : client
    );
    onClientsChange(updatedClients);
    setRegisterTravelFundInput(toInputMoney(nextFund));
    setPaymentInfo(`Fondo de viaje actualizado para ${selectedClient.unitId}: ${formatCurrency(nextFund)}.`);
    setErrors([]);
  }


  function handleAutoFillToMonthEnd(): void {
    if (!selectedClient || !monthEndSuggestion) return;
    const amount = monthEndSuggestion.requiredWholeAmount;
    setForm((f) => ({ ...f, amountReceived: toInputMoney(amount) }));
    const resultingLabel = monthEndSuggestion.resultingNextDate ? formatDate(monthEndSuggestion.resultingNextDate) : "sin fecha";
    if (amount <= 0) {
      setAutoAmountInfo(`Ya esta cubierto hasta ${resultingLabel}.`);
      return;
    }
    setAutoAmountInfo(`Monto cargado: ${formatCurrency(amount)}. Quedara al dia hasta ${resultingLabel}.`);
  }

  function validate(): string[] {
    const errs: string[] = [];
    const takenFolios = buildTakenFolioSet(payments, pendingBankItems, pendingCardItems);
    if (!form.clientId) errs.push("Debes seleccionar un cliente.");
    const amount = parseFloat(form.amountReceived);
    if (!Number.isFinite(amount) || amount <= 0) errs.push("El monto recibido debe ser mayor a 0.");
    if (form.paymentMethod === "Tarjeta") {
      const enteredFolios = extractFoliosFromReference(form.reference);
      if (enteredFolios.length > 0) {
        const duplicate = enteredFolios.find((folio) => takenFolios.has(folio));
        if (duplicate) errs.push(`El folio ${duplicate} ya fue utilizado.`);
      }
    }
    if (isBankPayment) {
      const enteredFolios = extractFoliosFromReference(form.reference);
      if (enteredFolios.length === 0) {
        errs.push("Debes indicar el folio/referencia para pagos bancarios.");
      } else {
        const duplicate = enteredFolios.find((folio) => takenFolios.has(folio));
        if (duplicate) errs.push(`El folio ${duplicate} ya fue utilizado.`);
      }
    }
    if (isDateClosed(operationalDateKey)) errs.push(`La caja de ${operationalDateKey} ya esta cerrada.`);
    return errs;
  }


  async function handleConfirmPayment(): Promise<boolean> {
    const validationErrors = validate();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return false;
    }
    if (!selectedClient || !preview) return false;

    setErrors([]);
    setPaymentInfo("");
    const receiptNumber = await reserveReceiptNumber();
    const transaction = buildManualPaymentTransaction({
      clients,
      payments,
      selectedClient,
      form,
      manualOtherChargesInput,
      retentionByClient: otherChargesRetentionByClient,
      operationalDateKey,
      overrideForcedOtherCharges: manualOverrideForcedOtherCharges,
      receiptNumber
    });
    const saved = await persistClientPaymentState(transaction.updatedClients, [...payments, transaction.payment]);
    if (!saved) {
      setErrors(["No se pudo guardar el pago en nube. No se aplicaron cambios."]);
      return false;
    }

    if (transaction.pendingCard) {
      replacePendingCardItems([...pendingCardItems, transaction.pendingCard]);
      setPaymentInfo(
        transaction.cardFolioWasEntered
          ? `Pago en tarjeta aplicado. Pendiente de conciliacion bancaria con folio ${transaction.cardFolio} para ${transaction.pendingCard.expectedSettlementDate}.`
          : `Pago en tarjeta aplicado con folio temporal ${transaction.cardFolio}. Debes corregirlo manana para conciliar con el CSV.`
      );
    }
    finalizeSuccessfulPayment(transaction.payment, { openHistory: true, skipAutoDownload: true });
    setForm({ clientId: "", dateApplied: operationalDateKey, paymentMethod: "Efectivo", reference: "", amountReceived: "" });
    setManualOtherChargesInput({});
    setManualOverrideForcedOtherCharges(false);
    return true;
  }

  async function handleDeletePayment(payment: Payment): Promise<void> {
    if (isDateClosed(payment.dateApplied)) {
      setErrors([`No se puede eliminar el recibo ${payment.receiptNumber}: la caja de ${payment.dateApplied} esta cerrada.`]);
      setDeleteTarget(null);
      return;
    }
    const updatedClients = clients.map((c) => {
      if (c.id !== payment.clientId) return c;
      return {
        ...c,
        balance: roundMoney(c.balance + payment.appliedToRent),
        advanceBalance: roundMoney(Math.max(0, (c.advanceBalance ?? 0) - (payment.advanceApplied ?? 0))),
        savings: roundMoney(Math.max(0, c.savings - payment.centavosAhorro)),
        installmentsRemaining: c.installmentsRemaining + getInstallmentsTotalInPayment(payment),
        installmentsPaid: Math.max(0, c.installmentsPaid - getInstallmentsTotalInPayment(payment)),
        otherCharges: restoreOtherChargesAfterDelete(c.otherCharges, payment.otherChargesApplied)
      };
    });
    const updatedPayments = payments.filter((p) => p.id !== payment.id);
    if (onDeletePayment) {
      const saved = await onDeletePayment(updatedClients, updatedPayments, payment.id);
      if (!saved) {
        setErrors([`No se pudo eliminar el recibo ${payment.receiptNumber} en nube. Actualiza el historial y vuelve a intentar.`]);
        return;
      }
    } else {
      onClientsChange(updatedClients);
      onPaymentsChange(updatedPayments);
    }
    setDeleteTarget(null);
  }




  function handleQuickImportCSV(): void {
    selectPaymentTab("pending");
    void handleImportBankCSV();
  }


  if (confirmedPayment) {
    return (
      <div className="page-inner">
        <header className="hero">
        <h1>Pagos</h1>
          <p>Recibo generado correctamente.</p>
        </header>
        <PaymentReceipt payment={confirmedPayment} onClose={() => setConfirmedPayment(null)} />
      </div>
    );
  }

  return (
    <div className="page-inner">
      <PaymentsTabs
        activeTab={activePaymentTab}
        onSelect={selectPaymentTab}
        onImportCsv={handleQuickImportCSV}
      />

      {/* -- Payment form -- */}
      <CashClosingPanel
        cashSectionRef={cashSectionRef}
        isCashClosingOpen={isCashClosingOpen}
        cashClosingActor={cashClosingActor}
        setCashClosingActor={setCashClosingActor}
        cashClosingDate={cashClosingDate}
        setCashClosingDate={setCashClosingDate}
        cashClosingReason={cashClosingReason}
        setCashClosingReason={setCashClosingReason}
        handleCloseCashForDate={handleCloseCashForDate}
        cashClosingInfo={cashClosingInfo}
        cashClosingError={cashClosingError}
        lastCloseReport={lastCloseReport}
        cashClosings={cashClosings}
        cashClosingAudit={cashClosingAudit}
        chargeRuns={chargeRuns}
        openReopenDialog={openReopenDialog}
      />

      <RegisterPaymentPanel
        registerSectionRef={registerSectionRef}
        isRegisterOpen={isRegisterOpen}
        selectedClient={selectedClient}
        handleClearClient={handleClearClient}
        searchRef={searchRef}
        clientSearch={clientSearch}
        setClientSearch={setClientSearch}
        dropdownOpen={dropdownOpen}
        setDropdownOpen={setDropdownOpen}
        filteredClients={filteredClients}
        handleSelectClient={handleSelectClient}
        registerTravelFundInput={registerTravelFundInput}
        setRegisterTravelFundInput={setRegisterTravelFundInput}
        handleSaveSelectedClientTravelFund={handleSaveSelectedClientTravelFund}
        operationalDateKey={operationalDateKey}
        form={form}
        setForm={setForm}
        isBankPayment={isBankPayment}
        isCardPayment={isCardPayment}
        monthEndSuggestion={monthEndSuggestion}
        handleAutoFillToMonthEnd={handleAutoFillToMonthEnd}
        autoAmountInfo={autoAmountInfo}
        setAutoAmountInfo={setAutoAmountInfo}
        isZeroBalance={isZeroBalance}
        isForcedOtherChargesRuleClient={isForcedOtherChargesRuleClient}
        isForcedOtherChargesRuleActive={isForcedOtherChargesRuleActive}
        selectedClientRetentionConfig={selectedClientRetentionConfig}
        setManualOverrideForcedOtherCharges={setManualOverrideForcedOtherCharges}
        manualOtherChargesInput={manualOtherChargesInput}
        setManualOtherChargesInput={setManualOtherChargesInput}
        preview={preview}
        previewAdvanceLetterLabel={previewAdvanceLetterLabel}
        projectedNextChargeDate={projectedNextChargeDate}
        errors={errors}
        paymentInfo={paymentInfo}
        handleConfirmPaymentClick={handleConfirmPaymentClick}
        isDateClosed={isDateClosed}
        isConfirmingPayment={isConfirmingPayment}
      />

      <NotifiedPaymentsPanel
        notifiedSectionRef={notifiedSectionRef}
        isNotifiedOpen={isNotifiedOpen}
        notifiedForm={notifiedForm}
        setNotifiedForm={setNotifiedForm}
        notifiedClientMatch={notifiedClientMatch}
        notifiedErrors={notifiedErrors}
        handleAddNotifiedPayment={handleAddNotifiedPayment}
        notifiedUntilNoonOnly={notifiedUntilNoonOnly}
        setNotifiedUntilNoonOnly={setNotifiedUntilNoonOnly}
        notifiedRowsFiltered={notifiedRowsFiltered}
        handleSortNotified={handleSortNotified}
        notifiedSortField={notifiedSortField}
        notifiedSortDirection={notifiedSortDirection}
        clients={clients}
        editingNotifiedId={editingNotifiedId}
        editingNotifiedForm={editingNotifiedForm}
        setEditingNotifiedForm={setEditingNotifiedForm}
        editingNotifiedClientMatch={editingNotifiedClientMatch}
        handleSaveEditNotified={handleSaveEditNotified}
        handleCancelEditNotified={handleCancelEditNotified}
        handleStartEditNotified={handleStartEditNotified}
        handleDeleteNotifiedPayment={handleDeleteNotifiedPayment}
      />

      <PendingCardsPanel
        pendingCardSectionRef={pendingCardSectionRef}
        isCardPendingOpen={isCardPendingOpen}
        cardPendingMessage={cardPendingMessage}
        pendingCardItems={pendingCardItems}
        bulkPendingCardFolio={bulkPendingCardFolio}
        setBulkPendingCardFolio={setBulkPendingCardFolio}
        handleApplyFolioToAllPendingCards={handleApplyFolioToAllPendingCards}
        editingPendingCardId={editingPendingCardId}
        editingPendingCardForm={editingPendingCardForm}
        setEditingPendingCardForm={setEditingPendingCardForm}
        handleSaveEditPendingCard={handleSaveEditPendingCard}
        handleCancelEditPendingCard={handleCancelEditPendingCard}
        handleGeneratePendingCardReceipt={handleGeneratePendingCardReceipt}
        handleStartEditPendingCard={handleStartEditPendingCard}
        handleRemovePendingCard={handleRemovePendingCard}
      />

      {/* -- Pending bank items -- */}
      <PendingBankPanel
        pendingSectionRef={pendingSectionRef}
        isPendingOpen={isPendingOpen}
        pendingBankItems={pendingBankItems}
        pendingImportError={pendingImportError}
        clients={clients}
        activeClients={activeClients}
        getSimilaritySignals={(item) => getPendingSimilaritySignals(item, notifiedPayments)}
        getPendingBankPreview={(item, client) => buildPendingBankPreview(item, client, { payments, retentionByClient: otherChargesRetentionByClient, operationalDate })}
        handleApplyAllHighSimilarity={handleApplyAllHighSimilarity}
        handleDismissAllPending={handleDismissAllPending}
        pendingClassifyTarget={pendingClassifyTarget}
        handleOpenClassify={handleOpenClassify}
        handlePendingUnitChange={handlePendingUnitChange}
        pendingTravelFundInputByFolio={pendingTravelFundInputByFolio}
        setPendingTravelFundInputByFolio={setPendingTravelFundInputByFolio}
        handleSavePendingClientTravelFund={handleSavePendingClientTravelFund}
        pendingApplyingFolio={pendingApplyingFolio}
        isPendingClassifySaving={isPendingClassifySaving}
        handleQuickApply={handleQuickApply}
        handleDismissPending={handleDismissPending}
        renderPendingInlineReview={renderPendingInlineReview}
      />
      <PaymentHistoryPanel
        historySectionRef={historySectionRef}
        isHistoryOpen={isHistoryOpen}
        activeClients={activeClients}
        payments={payments}
        onPaymentsChange={onPaymentsChange}
        isPaymentHistoryLoaded={isPaymentHistoryLoaded}
        onRefreshPayments={onRefreshPayments}
        isDateClosed={isDateClosed}
        getGroupCode={extractGroupCodeFromUnit}
        focusRequest={historyFocusRequest}
        onPreviewPayment={setHistoryPreviewPayment}
        onDeletePayment={setDeleteTarget}
      />

      <PaymentPreviewDialog
        payment={historyPreviewPayment}
        onClose={() => setHistoryPreviewPayment(null)}
      />

      <ReopenCashDialog
        date={reopenTargetDate}
        reason={reopenReason}
        setReason={setReopenReason}
        onCancel={() => setReopenTargetDate(null)}
        onConfirm={handleConfirmReopen}
      />

      <DeletePaymentDialog
        payment={deleteTarget}
        isDateClosed={isDateClosed}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(payment) => void handleDeletePayment(payment)}
      />
    </div>
  );
}
