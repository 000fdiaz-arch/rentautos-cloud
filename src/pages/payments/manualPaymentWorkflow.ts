import type { Client, OtherChargesRetentionByClient, Payment, PendingCardItem } from "../../types";
import { extractFoliosFromReference } from "./bankPaymentRules";
import type { PaymentForm } from "./paymentTypes";
import {
  buildTemporaryCardFolio,
  computeManualPaymentAllocation,
  computeOtherChargesDueAfter,
  getNextDateKey,
  resolveFirstSundayChargedAtForManualPayment,
  roundMoney
} from "./paymentRules";

type BuildManualPaymentParams = {
  clients: Client[];
  payments: Payment[];
  selectedClient: Client;
  form: PaymentForm;
  manualOtherChargesInput: Record<string, string>;
  retentionByClient: OtherChargesRetentionByClient;
  operationalDateKey: string;
  overrideForcedOtherCharges: boolean;
  receiptNumber: string;
};

export type ManualPaymentTransaction = {
  payment: Payment;
  updatedClients: Client[];
  pendingCard?: PendingCardItem;
  cardFolio?: string;
  cardFolioWasEntered: boolean;
};

export function buildManualPaymentTransaction({
  clients,
  payments,
  selectedClient,
  form,
  manualOtherChargesInput,
  retentionByClient,
  operationalDateKey,
  overrideForcedOtherCharges,
  receiptNumber
}: BuildManualPaymentParams): ManualPaymentTransaction {
  const amountReceived = roundMoney(Number(form.amountReceived));
  const allocation = computeManualPaymentAllocation(
    selectedClient,
    amountReceived,
    manualOtherChargesInput,
    retentionByClient,
    payments,
    operationalDateKey,
    overrideForcedOtherCharges
  );
  const isCard = form.paymentMethod === "Tarjeta";
  const enteredFolios = isCard ? extractFoliosFromReference(form.reference) : [];
  const cardFolio = isCard ? enteredFolios[0] ?? buildTemporaryCardFolio(operationalDateKey) : undefined;
  const firstSundayChargedAt = resolveFirstSundayChargedAtForManualPayment(selectedClient, allocation, operationalDateKey);
  const reference = isCard
    ? `FOLIO:${cardFolio} | TARJETA-PENDIENTE-CONCILIACION | ${form.reference.trim() || "PENDIENTE-FOLIO"}`
    : form.reference.trim() || undefined;

  const payment: Payment = {
    id: crypto.randomUUID(),
    receiptNumber,
    receiptDeliveryStatus: "pending",
    clientId: selectedClient.id,
    clientName: selectedClient.name,
    clientUnit: selectedClient.unitId,
    clientCedula: selectedClient.cedula,
    dateApplied: operationalDateKey,
    paymentMethod: form.paymentMethod,
    reference,
    amountReceived,
    appliedToRent: allocation.appliedToRent,
    centavosAhorro: allocation.centavosAhorro,
    advanceApplied: allocation.advanceApplied > 0 ? allocation.advanceApplied : undefined,
    advanceBalanceAfter: allocation.advanceAfter,
    otherChargesApplied: allocation.otherChargesApplied.length > 0 ? allocation.otherChargesApplied : undefined,
    otherChargesDueAfter: computeOtherChargesDueAfter(allocation.projectedClient.otherCharges, allocation.otherChargesApplied),
    installmentsDeducted: allocation.installmentsDeducted,
    installmentsFromDebt: allocation.installmentsDeducted,
    installmentsFromAdvance: allocation.installmentsCoveredByAdvance,
    installmentsTotalInPayment: allocation.installmentsTotalInPayment,
    balanceBefore: allocation.balanceBefore,
    balanceAfter: allocation.balanceAfter,
    savingsBefore: allocation.projectedClient.savings,
    savingsAfter: roundMoney(allocation.projectedClient.savings + allocation.centavosAhorro),
    installmentsPaidAfter: allocation.projectedClient.installmentsPaid + allocation.installmentsTotalInPayment,
    installmentsRemainingAfter: Math.max(0, allocation.projectedClient.installmentsRemaining - allocation.installmentsTotalInPayment),
    rentAmount: allocation.projectedClient.rentAmount,
    frequency: allocation.projectedClient.frequency,
    weeklyChargeDay: allocation.projectedClient.weeklyChargeDay,
    monthlyChargeDay: allocation.projectedClient.monthlyChargeDay,
    chargeFirstSunday: allocation.projectedClient.chargeFirstSunday,
    firstSundayChargedAt,
    travelFundAvailableSnapshot: roundMoney(Math.max(0, allocation.projectedClient.travelFundBalance ?? 0)),
    createdAt: new Date().toISOString()
  };

  const updatedClients = clients.map((client) => {
    if (client.id !== selectedClient.id) return client;
    return {
      ...client,
      balance: allocation.balanceAfter,
      advanceBalance: allocation.advanceAfter,
      savings: roundMoney(client.savings + allocation.centavosAhorro),
      installmentsRemaining: Math.max(0, client.installmentsRemaining - allocation.installmentsTotalInPayment),
      installmentsPaid: client.installmentsPaid + allocation.installmentsTotalInPayment,
      otherCharges: computeOtherChargesDueAfter(client.otherCharges, allocation.otherChargesApplied) ?? [],
      lastChargeDate: allocation.projectedClient.lastChargeDate,
      firstSundayChargedAt
    };
  });

  const pendingCard = isCard && cardFolio ? {
    id: crypto.randomUUID(),
    appliedPaymentId: payment.id,
    folio: cardFolio,
    clientId: selectedClient.id,
    clientName: selectedClient.name,
    clientUnit: selectedClient.unitId,
    clientCedula: selectedClient.cedula,
    amountExpected: amountReceived,
    dateRegistered: operationalDateKey,
    expectedSettlementDate: getNextDateKey(operationalDateKey),
    reference: form.reference.trim() || undefined,
    createdAt: new Date().toISOString()
  } satisfies PendingCardItem : undefined;

  return { payment, updatedClients, pendingCard, cardFolio, cardFolioWasEntered: enteredFolios.length > 0 };
}
