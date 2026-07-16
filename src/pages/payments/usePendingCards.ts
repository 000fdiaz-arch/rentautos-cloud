import { useEffect, useRef, useState } from "react";
import { savePendingCardItems, loadPendingCardItems } from "../../storage";
import type {
  Client,
  LateFeeSettings,
  OtherChargesRetentionByClient,
  Payment,
  PendingBankItem,
  PendingCardItem
} from "../../types";
import { normalizeFolioToken } from "./bankPaymentRules";
import { buildTakenFolioSet } from "./pendingBankRules";
import type { PendingCardEditForm } from "./paymentTypes";
import {
  computeFinesDueAfter,
  computeManualPaymentAllocation,
  computeOtherChargesDueAfter,
  computeTicketsDueAfter,
  resolveFirstSundayChargedAtForManualPayment,
  roundMoney
} from "./paymentRules";

type Options = {
  clients: Client[];
  payments: Payment[];
  pendingBankItems: PendingBankItem[];
  operationalDateKey: string;
  retentionByClient: OtherChargesRetentionByClient;
  lateFeeSettings?: LateFeeSettings;
  onPaymentsChange: (payments: Payment[]) => void;
  replacePendingBankItems: (items: PendingBankItem[]) => void;
  setPendingImportError: (message: string) => void;
  showReceipt: (payment: Payment) => void;
};

const EMPTY_EDIT_FORM: PendingCardEditForm = { folio: "", reference: "" };

export default function usePendingCards({
  clients,
  payments,
  pendingBankItems,
  operationalDateKey,
  retentionByClient,
  lateFeeSettings,
  onPaymentsChange,
  replacePendingBankItems,
  setPendingImportError,
  showReceipt
}: Options) {
  const [pendingCardItems, setPendingCardItems] = useState<PendingCardItem[]>(() => loadPendingCardItems());
  const [editingPendingCardId, setEditingPendingCardId] = useState<string | null>(null);
  const [editingPendingCardForm, setEditingPendingCardForm] = useState<PendingCardEditForm>(EMPTY_EDIT_FORM);
  const [bulkPendingCardFolio, setBulkPendingCardFolio] = useState("");
  const [cardPendingMessage, setCardPendingMessage] = useState("");
  const reconcilingRef = useRef(false);

  function replacePendingCardItems(items: PendingCardItem[]): void {
    setPendingCardItems(items);
    savePendingCardItems(items);
  }

  useEffect(() => {
    if (reconcilingRef.current || pendingCardItems.length === 0 || pendingBankItems.length === 0) return;

    const pendingByFolio = new Map<string, PendingCardItem[]>();
    for (const item of pendingCardItems) {
      const folio = normalizeFolioToken(item.folio);
      if (!folio) continue;
      pendingByFolio.set(folio, [...(pendingByFolio.get(folio) ?? []), item]);
    }

    const nextPayments = [...payments];
    const usedBankIndexes = new Set<number>();
    const reconciledCardIds = new Set<string>();
    let paymentsUpdated = false;
    let reconciledGroups = 0;
    let reconciledCardCount = 0;

    for (let index = 0; index < pendingBankItems.length; index += 1) {
      const bankItem = pendingBankItems[index];
      const bankFolio = normalizeFolioToken(bankItem.folio);
      if (!bankFolio || usedBankIndexes.has(index)) continue;
      const groupedCards = pendingByFolio.get(bankFolio);
      if (!groupedCards?.length) continue;
      const groupedAmount = roundMoney(groupedCards.reduce((sum, item) => sum + roundMoney(item.amountExpected), 0));
      if (Math.abs(groupedAmount - roundMoney(bankItem.amountReceived)) > 0.02) continue;

      usedBankIndexes.add(index);
      reconciledGroups += 1;
      reconciledCardCount += groupedCards.length;
      for (const cardItem of groupedCards) {
        reconciledCardIds.add(cardItem.id);
        if (!cardItem.appliedPaymentId) continue;
        const paymentIndex = nextPayments.findIndex((payment) => payment.id === cardItem.appliedPaymentId);
        if (paymentIndex < 0) continue;
        const currentPayment = nextPayments[paymentIndex];
        const currentReference = currentPayment.reference?.trim() ?? "";
        if (currentReference.toUpperCase().includes("TARJETA-CONCILIADA")) continue;
        const tag = `TARJETA-CONCILIADA | FOLIO:${bankFolio} | FECHA-BANCO:${bankItem.dateApplied || operationalDateKey}`;
        nextPayments[paymentIndex] = {
          ...currentPayment,
          reference: currentReference ? `${currentReference} | ${tag}` : tag
        };
        paymentsUpdated = true;
      }
    }

    if (reconciledCardIds.size === 0) return;
    reconcilingRef.current = true;
    if (paymentsUpdated) onPaymentsChange(nextPayments);
    replacePendingBankItems(pendingBankItems.filter((_, index) => !usedBankIndexes.has(index)));
    replacePendingCardItems(pendingCardItems.filter((item) => !reconciledCardIds.has(item.id)));
    setPendingImportError(
      `Tarjetas conciliadas automaticamente: ${reconciledCardCount} pago(s) en ${reconciledGroups} lote(s).`
    );
    setTimeout(() => { reconcilingRef.current = false; }, 0);
  }, [operationalDateKey, payments, pendingBankItems, pendingCardItems, onPaymentsChange]);

  function handleRemovePendingCard(id: string): void {
    if (editingPendingCardId === id) {
      setEditingPendingCardId(null);
      setEditingPendingCardForm(EMPTY_EDIT_FORM);
    }
    replacePendingCardItems(pendingCardItems.filter((item) => item.id !== id));
  }

  function handleStartEditPendingCard(item: PendingCardItem): void {
    setEditingPendingCardId(item.id);
    setEditingPendingCardForm({ folio: item.folio, reference: item.reference ?? "" });
    setCardPendingMessage("");
  }

  function handleCancelEditPendingCard(): void {
    setEditingPendingCardId(null);
    setEditingPendingCardForm(EMPTY_EDIT_FORM);
  }

  function handleSaveEditPendingCard(item: PendingCardItem): void {
    const folio = normalizeFolioToken(editingPendingCardForm.folio);
    if (!folio) {
      setCardPendingMessage("Debes indicar un folio valido para poder conciliar el pago de tarjeta.");
      return;
    }
    const takenFolios = buildTakenFolioSet(payments, pendingBankItems, pendingCardItems);
    takenFolios.delete(normalizeFolioToken(item.folio));
    if (takenFolios.has(folio)) {
      setCardPendingMessage(`No se puede usar el folio ${folio}: ya fue utilizado.`);
      return;
    }
    const reference = editingPendingCardForm.reference.trim();
    replacePendingCardItems(pendingCardItems.map((row) => row.id === item.id
      ? { ...row, folio, reference: reference || undefined }
      : row
    ));
    setEditingPendingCardId(null);
    setEditingPendingCardForm(EMPTY_EDIT_FORM);
    setCardPendingMessage(`Pendiente actualizado. Folio listo para conciliar: ${folio}.`);
  }

  function handleApplyFolioToAllPendingCards(): void {
    if (pendingCardItems.length === 0) return;
    const folio = normalizeFolioToken(bulkPendingCardFolio);
    if (!folio) {
      setCardPendingMessage("Debes indicar un folio valido para aplicar en lote.");
      return;
    }
    if (buildTakenFolioSet(payments, pendingBankItems, pendingCardItems).has(folio)) {
      setCardPendingMessage(`No se puede usar el folio ${folio}: ya fue utilizado.`);
      return;
    }
    const nextItems = pendingCardItems.map((item) => ({ ...item, folio }));
    replacePendingCardItems(nextItems);
    setCardPendingMessage(`Folio ${folio} aplicado a ${nextItems.length} pendiente(s) de tarjeta.`);
  }

  function handleGeneratePendingCardReceipt(item: PendingCardItem): void {
    if (item.appliedPaymentId) {
      const existingPayment = payments.find((payment) => payment.id === item.appliedPaymentId);
      if (existingPayment) {
        showReceipt(existingPayment);
        setCardPendingMessage(`Comprobante generado para folio ${item.folio}.`);
        return;
      }
    }
    const client = clients.find((candidate) => candidate.id === item.clientId);
    if (!client) {
      setCardPendingMessage(`No se pudo generar comprobante: cliente no encontrado para folio ${item.folio}.`);
      return;
    }
    const dateApplied = item.dateRegistered || operationalDateKey;
    const allocation = computeManualPaymentAllocation(
      client,
      item.amountExpected,
      {},
      retentionByClient,
      payments,
      dateApplied,
      false,
      lateFeeSettings
    );
    const projectedClient = allocation.projectedClient;
    const payment: Payment = {
      id: crypto.randomUUID(),
      receiptNumber: `T-PEND-${Date.now()}`,
      receiptDeliveryStatus: "pending",
      clientId: client.id,
      clientName: client.name,
      clientUnit: client.unitId,
      clientCedula: client.cedula,
      dateApplied,
      paymentMethod: "Tarjeta",
      reference: `FOLIO:${normalizeFolioToken(item.folio)} | TARJETA-PENDIENTE-CONCILIACION | ${item.reference || "N/A"}`,
      amountReceived: item.amountExpected,
      appliedToRent: allocation.appliedToRent,
      centavosAhorro: allocation.centavosAhorro,
      advanceApplied: allocation.advanceApplied > 0 ? allocation.advanceApplied : undefined,
      advanceBalanceAfter: allocation.advanceAfter,
      finesApplied: allocation.finesApplied.length > 0 ? allocation.finesApplied : undefined,
      finesDueAfter: computeFinesDueAfter(projectedClient.fines, allocation.finesApplied),
      ticketsApplied: allocation.ticketsApplied.length > 0 ? allocation.ticketsApplied : undefined,
      ticketsDueAfter: computeTicketsDueAfter(projectedClient.tickets, allocation.ticketsApplied),
      otherChargesApplied: allocation.otherChargesApplied.length > 0 ? allocation.otherChargesApplied : undefined,
      otherChargesDueAfter: computeOtherChargesDueAfter(projectedClient.otherCharges, allocation.otherChargesApplied),
      installmentsDeducted: allocation.installmentsDeducted,
      installmentsFromDebt: allocation.installmentsDeducted,
      installmentsFromAdvance: allocation.installmentsCoveredByAdvance,
      installmentsTotalInPayment: allocation.installmentsTotalInPayment,
      balanceBefore: allocation.balanceBefore,
      balanceAfter: allocation.balanceAfter,
      savingsBefore: projectedClient.savings,
      savingsAfter: roundMoney(projectedClient.savings + allocation.centavosAhorro),
      installmentsPaidAfter: projectedClient.installmentsPaid + allocation.installmentsTotalInPayment,
      installmentsRemainingAfter: Math.max(0, projectedClient.installmentsRemaining - allocation.installmentsTotalInPayment),
      rentAmount: projectedClient.rentAmount,
      frequency: projectedClient.frequency,
      weeklyChargeDay: projectedClient.weeklyChargeDay,
      monthlyChargeDay: projectedClient.monthlyChargeDay,
      chargeFirstSunday: projectedClient.chargeFirstSunday,
      firstSundayChargedAt: resolveFirstSundayChargedAtForManualPayment(client, allocation, dateApplied),
      travelFundAvailableSnapshot: roundMoney(Math.max(0, projectedClient.travelFundBalance ?? 0)),
      createdAt: new Date().toISOString()
    };
    showReceipt(payment);
    setCardPendingMessage(`Comprobante generado para folio ${item.folio}.`);
  }

  return {
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
  };
}
