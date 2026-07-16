import { useEffect, useState } from "react";
import { formatCurrency } from "../../format";
import { reserveCloudReceiptNumbers } from "../../cloudData";
import {
  loadManualBankAssignmentAudit,
  loadManualBankAssignmentAuditFromIndexedDb,
  saveManualBankAssignmentAudit
} from "../../storage";
import type {
  BankRule,
  Client,
  LateFeeSettings,
  ManualBankAssignmentAudit,
  OtherChargesRetentionByClient,
  Payment,
  PendingBankItem,
  PendingCardItem
} from "../../types";
import type { NotifiedPayment } from "./paymentTypes";
import { importBankCsv } from "./bankCsvImport";
import { extractFoliosFromReference, normalizeFolioToken, removeOneMatchingNotified } from "./bankPaymentRules";
import { buildPendingPaymentApplication, buildTakenFolioSet, getPendingSimilaritySignals } from "./pendingBankRules";
import { getPaymentSaveErrorMessage } from "./paymentPersistenceErrors";
import { roundMoney } from "./paymentRules";

type Options = {
  clients: Client[];
  activeClients: Client[];
  bankRules: BankRule[];
  payments: Payment[];
  pendingBankItems: PendingBankItem[];
  pendingCardItems: PendingCardItem[];
  notifiedPayments: NotifiedPayment[];
  retentionByClient: OtherChargesRetentionByClient;
  lateFeeSettings?: LateFeeSettings;
  operationalDateKey: string;
  dataOwnerUserId?: string | null;
  replacePendingBankItems: (items: PendingBankItem[]) => void;
  replaceNotifiedPayments: (items: NotifiedPayment[]) => void;
  persistClientPaymentState: (clients: Client[], payments: Payment[]) => Promise<boolean>;
  reserveReceiptNumber: () => Promise<string>;
  finalizePayment: (payment: Payment) => void;
  setErrors: (errors: string[]) => void;
  pendingImportError: string;
  setPendingImportError: (message: string) => void;
  openPendingPanel: () => void;
  onClientsChange: (clients: Client[]) => void;
};

export default function usePendingBankWorkflow(options: Options) {
  const {
    clients,
    activeClients,
    bankRules,
    payments,
    pendingBankItems,
    pendingCardItems,
    notifiedPayments,
    retentionByClient,
    lateFeeSettings,
    operationalDateKey,
    dataOwnerUserId,
    replacePendingBankItems,
    replaceNotifiedPayments,
    persistClientPaymentState,
    reserveReceiptNumber,
    finalizePayment,
    setErrors,
    setPendingImportError,
    openPendingPanel,
    onClientsChange
  } = options;
  const [pendingClassifyTarget, setPendingClassifyTarget] = useState<PendingBankItem | null>(null);
  const [pendingClassifyClientId, setPendingClassifyClientId] = useState("");
  const [pendingClassifyError, setPendingClassifyError] = useState("");
  const [isPendingClassifySaving, setIsPendingClassifySaving] = useState(false);
  const [pendingApplyingFolio, setPendingApplyingFolio] = useState<string | null>(null);
  const [pendingOtherChargesInput, setPendingOtherChargesInput] = useState<Record<string, string>>({});
  const [pendingManualOverrideForcedOtherCharges, setPendingManualOverrideForcedOtherCharges] = useState(false);
  const [manualAssignmentAudit, setManualAssignmentAudit] = useState<ManualBankAssignmentAudit[]>(() => loadManualBankAssignmentAudit());
  const [pendingTravelFundInputByFolio, setPendingTravelFundInputByFolio] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void loadManualBankAssignmentAuditFromIndexedDb()
      .then((items) => {
        if (!cancelled && items.length > 0) setManualAssignmentAudit(items);
      })
      .catch((error) => console.error("No se pudo cargar auditoria manual desde IndexedDB.", error));
    return () => {
      cancelled = true;
    };
  }, []);

  async function processBankCSV(text: string): Promise<void> {
    const result = await importBankCsv(text, {
      clients: activeClients,
      bankRules,
      payments,
      pendingItems: pendingBankItems,
      notifiedPayments,
      operationalDateKey,
      dataOwnerUserId
    });
    if (result.error) {
      setPendingImportError(result.error);
      return;
    }
    if (result.items.length > 0) {
      replacePendingBankItems([...pendingBankItems, ...result.items]);
      openPendingPanel();
    }
    setPendingImportError(result.message);
  }

  async function handleImportBankCSV(): Promise<void> {
    setPendingImportError("");
    try {
      const picker = window as unknown as Window & {
        showOpenFilePicker: (options: object) => Promise<FileSystemFileHandle[]>;
      };
      const [fileHandle] = await picker.showOpenFilePicker({
        types: [{
          description: "Movimientos del banco (CSV)",
          accept: { "text/csv": [".csv"], "text/plain": [".csv", ".txt"] }
        }],
        multiple: false
      });
      await processBankCSV(await (await fileHandle.getFile()).text());
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      setPendingImportError("Error al leer el archivo CSV. Verifica que sea el archivo de movimientos del banco.");
    }
  }

  function handleOpenClassify(item: PendingBankItem): void {
    if (pendingClassifyTarget?.folio === item.folio) {
      setPendingClassifyTarget(null);
      setPendingClassifyError("");
      setPendingManualOverrideForcedOtherCharges(false);
      return;
    }
    setPendingClassifyError("");
    setIsPendingClassifySaving(false);
    setPendingClassifyTarget(item);
    setPendingManualOverrideForcedOtherCharges(false);
    setPendingClassifyClientId(item.suggestedClientId ?? "");
    setPendingOtherChargesInput({});
  }

  function handleDismissPending(folio: string): void {
    replacePendingBankItems(pendingBankItems.filter((item) => item.folio !== folio));
  }

  function handleDismissAllPending(): void {
    if (pendingBankItems.length === 0) return;
    if (!window.confirm(`Vas a ignorar ${pendingBankItems.length} pendiente(s) del banco. Esta accion no se puede deshacer.`)) return;
    replacePendingBankItems([]);
    setPendingClassifyTarget(null);
    setPendingImportError(`Se ignoraron ${pendingBankItems.length} pendiente(s) del banco.`);
  }

  function handlePendingUnitChange(item: PendingBankItem, nextClientId: string): void {
    const previous = item.suggestedClientId ? clients.find((client) => client.id === item.suggestedClientId) ?? null : null;
    const selected = clients.find((client) => client.id === nextClientId) ?? null;
    replacePendingBankItems(pendingBankItems.map((row) => row.folio === item.folio
      ? {
          ...row,
          suggestedClientId: selected?.id,
          suggestedClientName: selected?.name
        }
      : row
    ));
    if (previous?.id === selected?.id) return;
    const event: ManualBankAssignmentAudit = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      folio: item.folio,
      accountNumber: item.accountNumber,
      mappedGroup: item.mappedGroup,
      previousClientId: previous?.id,
      previousClientUnit: previous?.unitId,
      previousClientName: previous?.name,
      nextClientId: selected?.id,
      nextClientUnit: selected?.unitId,
      nextClientName: selected?.name,
      reason: "Asignacion manual desde pendientes"
    };
    const nextAudit = [event, ...manualAssignmentAudit].slice(0, 2000);
    setManualAssignmentAudit(nextAudit);
    saveManualBankAssignmentAudit(nextAudit);
  }

  async function applyPendingItem(item: PendingBankItem, client: Client, reservedReceipt?: string) {
    const receiptNumber = reservedReceipt ?? await reserveReceiptNumber();
    return buildPendingPaymentApplication(item, client, {
      payments,
      retentionByClient,
      lateFeeSettings,
      receiptNumber,
      referenceTag: "AUTO-ALTA-SIMILITUD"
    });
  }

  async function handleConfirmClassify(): Promise<void> {
    if (isPendingClassifySaving) return;
    if (!pendingClassifyTarget || !pendingClassifyClientId) {
      setPendingClassifyError("Selecciona un cliente antes de confirmar el pago.");
      return;
    }
    setPendingClassifyError("");
    setErrors([]);
    setIsPendingClassifySaving(true);
    try {
      const client = clients.find((candidate) => candidate.id === pendingClassifyClientId);
      if (!client) {
        setPendingClassifyError("El cliente seleccionado ya no está disponible. Selecciónalo nuevamente.");
        return;
      }
      const folio = normalizeFolioToken(pendingClassifyTarget.folio);
      const takenFolios = buildTakenFolioSet(payments, pendingBankItems, pendingCardItems, {
        excludePendingBankFolios: new Set([folio])
      });
      if (takenFolios.has(folio)) {
        setPendingClassifyError(`No se puede registrar el folio ${folio}: ya fue utilizado.`);
        return;
      }
      const receiptNumber = await reserveReceiptNumber();
      const { updatedClient, payment } = buildPendingPaymentApplication(pendingClassifyTarget, client, {
        payments,
        retentionByClient,
        lateFeeSettings,
        receiptNumber,
        referenceTag: "CLASIFICADO-MANUAL",
        manualOtherChargesInput: pendingOtherChargesInput,
        allowManualOverrideForForcedRule: pendingManualOverrideForcedOtherCharges
      });
      const updatedClients = clients.map((candidate) => candidate.id === updatedClient.id ? updatedClient : candidate);
      if (!await persistClientPaymentState(updatedClients, [...payments, payment])) {
        setPendingClassifyError("No se pudo guardar el pago. No se aplicaron cambios.");
        return;
      }
      replaceNotifiedPayments(removeOneMatchingNotified(
        notifiedPayments,
        client.id,
        pendingClassifyTarget.amountReceived,
        pendingClassifyTarget.dateApplied
      ));
      replacePendingBankItems(pendingBankItems.filter((item) => item.folio !== pendingClassifyTarget.folio));
      setPendingClassifyTarget(null);
      setPendingManualOverrideForcedOtherCharges(false);
      finalizePayment(payment);
      setPendingImportError(`Pago ${pendingClassifyTarget.folio} aplicado a ${client.unitId} - ${client.name}.`);
    } catch (error) {
      console.error("No se pudo confirmar el pago bancario clasificado.", error);
      setPendingClassifyError(getPaymentSaveErrorMessage(error));
    } finally {
      setIsPendingClassifySaving(false);
    }
  }

  async function handleQuickApply(item: PendingBankItem): Promise<void> {
    if (!item.suggestedClientId || pendingApplyingFolio) return;
    setPendingApplyingFolio(item.folio);
    try {
      const client = clients.find((candidate) => candidate.id === item.suggestedClientId);
      if (!client) return;
      const folio = normalizeFolioToken(item.folio);
      if (buildTakenFolioSet(payments, pendingBankItems, pendingCardItems, {
        excludePendingBankFolios: new Set([folio])
      }).has(folio)) {
        setErrors([`No se puede registrar el folio ${folio}: ya fue utilizado.`]);
        return;
      }
      const { updatedClient, payment } = await applyPendingItem(item, client);
      const updatedClients = clients.map((candidate) => candidate.id === updatedClient.id ? updatedClient : candidate);
      if (!await persistClientPaymentState(updatedClients, [...payments, payment])) {
        setErrors(["No se pudo guardar el pago en nube. No se aplicaron cambios."]);
        return;
      }
      finalizePayment(payment);
      replaceNotifiedPayments(removeOneMatchingNotified(notifiedPayments, client.id, item.amountReceived, item.dateApplied));
      replacePendingBankItems(pendingBankItems.filter((candidate) => candidate.folio !== item.folio));
      setPendingImportError(`Pago ${item.folio} aplicado a ${client.unitId} - ${client.name}.`);
    } finally {
      setPendingApplyingFolio(null);
    }
  }

  async function handleApplyAllHighSimilarity(): Promise<void> {
    const candidates = pendingBankItems.filter((item) =>
      getPendingSimilaritySignals(item, notifiedPayments).score >= 2 &&
      clients.some((client) => client.id === item.suggestedClientId)
    );
    if (candidates.length === 0) return;
    const updatedClients = new Map(clients.map((client) => [client.id, { ...client }]));
    const newPayments: Payment[] = [];
    const receipts = dataOwnerUserId ? await reserveCloudReceiptNumbers(dataOwnerUserId, candidates.length) : [];
    const candidateFolios = new Set(candidates.map((item) => normalizeFolioToken(item.folio)).filter(Boolean));
    const usedFolios = buildTakenFolioSet(payments, pendingBankItems, pendingCardItems, {
      excludePendingBankFolios: candidateFolios
    });
    let skipped = 0;
    for (const [index, item] of candidates.entries()) {
      const folio = normalizeFolioToken(item.folio);
      if (usedFolios.has(folio)) {
        skipped += 1;
        continue;
      }
      const client = updatedClients.get(item.suggestedClientId ?? "");
      if (!client) continue;
      const result = await applyPendingItem(item, client, receipts[index]);
      updatedClients.set(result.updatedClient.id, result.updatedClient);
      newPayments.push(result.payment);
      usedFolios.add(folio);
    }
    if (newPayments.length === 0) {
      if (skipped > 0) setErrors([`No se aplicaron pagos en lote: ${skipped} folio(s) ya existian.`]);
      return;
    }
    if (skipped > 0) setErrors([`Se omitieron ${skipped} pago(s) en lote porque su folio ya existia.`]);
    const appliedFolios = new Set(newPayments.flatMap((payment) => extractFoliosFromReference(payment.reference ?? "")));
    if (!await persistClientPaymentState([...updatedClients.values()], [...payments, ...newPayments])) {
      setErrors(["No se pudo guardar pagos en nube. No se aplicaron cambios."]);
      return;
    }
    newPayments.forEach(finalizePayment);
    let remainingNotified = [...notifiedPayments];
    for (const item of candidates) {
      if (!item.suggestedClientId || !appliedFolios.has(normalizeFolioToken(item.folio))) continue;
      remainingNotified = removeOneMatchingNotified(
        remainingNotified,
        item.suggestedClientId,
        item.amountReceived,
        item.dateApplied
      );
    }
    replaceNotifiedPayments(remainingNotified);
    replacePendingBankItems(pendingBankItems.filter((item) => !appliedFolios.has(normalizeFolioToken(item.folio))));
  }

  function handleSavePendingClientTravelFund(client: Client, folio: string): void {
    const amount = Number.parseFloat(pendingTravelFundInputByFolio[folio] ?? "");
    if (!Number.isFinite(amount) || amount < 0) {
      setPendingImportError("El fondo de viaje debe ser un numero valido mayor o igual a 0.");
      return;
    }
    const nextFund = roundMoney(Math.max(0, amount));
    onClientsChange(clients.map((row) => row.id === client.id ? { ...row, travelFundBalance: nextFund } : row));
    setPendingImportError(`Fondo de viaje actualizado para ${client.unitId}: ${formatCurrency(nextFund)}.`);
  }

  return {
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
  };
}
