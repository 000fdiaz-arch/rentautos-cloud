import type { Client, LateFeeSettings, OtherChargesRetentionByClient, Payment, PendingCardItem } from "../../types";
import { extractFoliosFromReference } from "./bankPaymentRules";
import type { PaymentForm } from "./paymentTypes";
import {
  applyPaymentToProvisionalRental,
  getCollectibleProvisionalRental,
  replaceCollectibleRental,
  nextProvisionalRentalChargeDate
} from "../../provisionalRentals";
import {
  buildTemporaryCardFolio,
  applyFinePayments,
  applyTicketPayments,
  computeFinesDueAfter,
  computeManualPaymentAllocation,
  computeOtherChargesDueAfter,
  computeTicketsDueAfter,
  getNextDateKey,
  resolveFirstSundayChargedAtForManualPayment,
  roundMoney,
  splitWholeAndCents
} from "./paymentRules";

type BuildManualPaymentParams = {
  clients: Client[];
  payments: Payment[];
  selectedClient: Client;
  form: PaymentForm;
  manualOtherChargesInput: Record<string, string>;
  retentionByClient: OtherChargesRetentionByClient;
  lateFeeSettings?: LateFeeSettings;
  operationalDateKey: string;
  overrideForcedOtherCharges: boolean;
  receiptNumber: string;
  currentActor: string;
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
  lateFeeSettings,
  operationalDateKey,
  overrideForcedOtherCharges,
  receiptNumber,
  currentActor
}: BuildManualPaymentParams): ManualPaymentTransaction {
  const amountReceived = roundMoney(Number(form.amountReceived));
  const collectibleRental = getCollectibleProvisionalRental(selectedClient);
  if (collectibleRental) {
    const { wholePart, centsPart } = splitWholeAndCents(amountReceived);
    const rentalAllocation = applyPaymentToProvisionalRental(collectibleRental, wholePart, operationalDateKey);
    const isCard = form.paymentMethod === "Tarjeta";
    const enteredFolios = isCard ? extractFoliosFromReference(form.reference) : [];
    const cardFolio = isCard ? enteredFolios[0] ?? buildTemporaryCardFolio(operationalDateKey) : undefined;
    const reference = isCard
      ? `FOLIO:${cardFolio} | TARJETA-PENDIENTE-CONCILIACION | ${form.reference.trim() || "PENDIENTE-FOLIO"}`
      : form.reference.trim() || undefined;
    const createdAt = new Date().toISOString();
    const isCash = form.paymentMethod === "Efectivo";
    const cashWasDelivered = isCash ? form.cashDeliveryStatus === "delivered" : undefined;
    const savingsBefore = roundMoney(selectedClient.savings);
    const savingsAfter = roundMoney(savingsBefore + centsPart);
    const payment: Payment = {
      id: crypto.randomUUID(),
      receiptNumber,
      receiptDeliveryStatus: "pending",
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      clientUnit: rentalAllocation.rental.unitId,
      clientCedula: selectedClient.cedula,
      paymentContext: "provisional_rental",
      provisionalRentalId: rentalAllocation.rental.id,
      provisionalRentalUnit: rentalAllocation.rental.unitId,
      provisionalRentalBrandModel: rentalAllocation.rental.brandModel,
      provisionalRentalPlate: rentalAllocation.rental.plate,
      provisionalRentalFrequency: rentalAllocation.rental.frequency,
      provisionalRentalAmount: rentalAllocation.rental.rentAmount,
      provisionalRentalBalanceBefore: rentalAllocation.balanceBefore,
      provisionalRentalBalanceAfter: rentalAllocation.balanceAfter,
      provisionalRentalCreditAfter: rentalAllocation.creditAfter,
      provisionalRentalNextChargeDate: nextProvisionalRentalChargeDate(rentalAllocation.rental) ?? undefined,
      provisionalRentalChargesApplied: rentalAllocation.chargeApplications,
      dateApplied: operationalDateKey,
      paymentMethod: form.paymentMethod,
      reference,
      moneyDelivered: cashWasDelivered,
      moneyDeliveryDate: cashWasDelivered ? operationalDateKey : undefined,
      moneyDeliveryUpdatedAt: isCash ? createdAt : undefined,
      moneyDeliveryUpdatedBy: isCash ? currentActor : undefined,
      incomeEdits: isCash ? [{
        id: crypto.randomUUID(),
        createdAt,
        actor: currentActor,
        reason: cashWasDelivered ? "Efectivo entregado al registrar el pago" : "Efectivo pendiente de entrega al registrar el pago",
        nextMoneyDelivered: cashWasDelivered
      }] : undefined,
      amountReceived,
      appliedToRent: rentalAllocation.amountApplied,
      centavosAhorro: centsPart,
      installmentsDeducted: 0,
      installmentsFromDebt: 0,
      installmentsFromAdvance: 0,
      installmentsTotalInPayment: 0,
      balanceBefore: rentalAllocation.balanceBefore,
      balanceAfter: rentalAllocation.balanceAfter,
      savingsBefore,
      savingsAfter,
      installmentsPaidAfter: selectedClient.installmentsPaid,
      installmentsRemainingAfter: selectedClient.installmentsRemaining,
      rentAmount: rentalAllocation.rental.rentAmount,
      frequency: rentalAllocation.rental.frequency,
      createdAt
    };
    const updatedRentalClient = replaceCollectibleRental(selectedClient, rentalAllocation.rental);
    const updatedClients = clients.map((client) => client.id === selectedClient.id
      ? { ...updatedRentalClient, savings: savingsAfter }
      : client
    );
    const pendingCard = isCard && cardFolio ? {
      id: crypto.randomUUID(),
      appliedPaymentId: payment.id,
      folio: cardFolio,
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      clientUnit: rentalAllocation.rental.unitId,
      clientCedula: selectedClient.cedula,
      amountExpected: amountReceived,
      dateRegistered: operationalDateKey,
      expectedSettlementDate: getNextDateKey(operationalDateKey),
      reference: form.reference.trim() || undefined,
      createdAt
    } satisfies PendingCardItem : undefined;
    return { payment, updatedClients, pendingCard, cardFolio, cardFolioWasEntered: enteredFolios.length > 0 };
  }
  const allocation = computeManualPaymentAllocation(
    selectedClient,
    amountReceived,
    manualOtherChargesInput,
    retentionByClient,
    payments,
    operationalDateKey,
    overrideForcedOtherCharges,
    lateFeeSettings
  );
  const isCard = form.paymentMethod === "Tarjeta";
  const enteredFolios = isCard ? extractFoliosFromReference(form.reference) : [];
  const cardFolio = isCard ? enteredFolios[0] ?? buildTemporaryCardFolio(operationalDateKey) : undefined;
  const firstSundayChargedAt = resolveFirstSundayChargedAtForManualPayment(selectedClient, allocation, operationalDateKey);
  const reference = isCard
    ? `FOLIO:${cardFolio} | TARJETA-PENDIENTE-CONCILIACION | ${form.reference.trim() || "PENDIENTE-FOLIO"}`
    : form.reference.trim() || undefined;
  const createdAt = new Date().toISOString();
  const isCash = form.paymentMethod === "Efectivo";
  const cashWasDelivered = isCash ? form.cashDeliveryStatus === "delivered" : undefined;

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
    moneyDelivered: cashWasDelivered,
    moneyDeliveryDate: cashWasDelivered ? operationalDateKey : undefined,
    moneyDeliveryUpdatedAt: isCash ? createdAt : undefined,
    moneyDeliveryUpdatedBy: isCash ? currentActor : undefined,
    incomeEdits: isCash ? [{
      id: crypto.randomUUID(),
      createdAt,
      actor: currentActor,
      reason: cashWasDelivered ? "Efectivo entregado al registrar el pago" : "Efectivo pendiente de entrega al registrar el pago",
      nextMoneyDelivered: cashWasDelivered
    }] : undefined,
    amountReceived,
    appliedToRent: allocation.appliedToRent,
    centavosAhorro: allocation.centavosAhorro,
    advanceApplied: allocation.advanceApplied > 0 ? allocation.advanceApplied : undefined,
    advanceBalanceAfter: allocation.advanceAfter,
    finesApplied: allocation.finesApplied.length > 0 ? allocation.finesApplied : undefined,
    finesDueAfter: computeFinesDueAfter(allocation.projectedClient.fines, allocation.finesApplied),
    ticketsApplied: allocation.ticketsApplied.length > 0 ? allocation.ticketsApplied : undefined,
    ticketsDueAfter: computeTicketsDueAfter(allocation.projectedClient.tickets, allocation.ticketsApplied),
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
    createdAt
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
      fines: applyFinePayments(client.fines, allocation.finesApplied, new Date().toISOString()),
      tickets: applyTicketPayments(client.tickets, allocation.ticketsApplied, new Date().toISOString()),
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
