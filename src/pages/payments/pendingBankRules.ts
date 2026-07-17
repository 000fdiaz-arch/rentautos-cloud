import { findNextChargeDay, getBusinessDateKey, parseDateKey, toDateKey } from "../../billing";
import type {
  Client,
  LateFeeSettings,
  OtherChargesRetentionByClient,
  Payment,
  PendingBankItem,
  PendingCardItem
} from "../../types";
import {
  extractFoliosFromReference,
  inferBankPaymentMethod,
  isNotifiedCandidateMatch,
  normalizeFolioToken
} from "./bankPaymentRules";
import { FREQUENCY_LABEL } from "./paymentConstants";
import {
  applyFinePayments,
  applyTicketPayments,
  computeCoveredInstallmentsFromAdvance,
  computeEffectiveOtherChargesAllocation,
  computeFinesDueAfter,
  computeOtherChargesDueAfter,
  computeTicketsDueAfter,
  distributeAcrossLateFeeCharges,
  distributeAcrossFines,
  distributeAcrossTickets,
  resolveFirstSundayChargedAtForManualPayment,
  roundMoney
} from "./paymentRules";
import type { NotifiedPayment, PendingBankPreview } from "./paymentTypes";

export type SimilaritySignals = {
  nombre: boolean;
  centavos: boolean;
  notificado: boolean;
  score: number;
};

export function getPendingSimilaritySignals(
  item: PendingBankItem,
  notifiedPayments: NotifiedPayment[]
): SimilaritySignals {
  const nombre = !!item.suggestedClientId;
  const centavos = item.centsPart > 0;
  const notificado = !!item.suggestedClientId && notifiedPayments.some((notified) =>
    isNotifiedCandidateMatch(notified, item.suggestedClientId!, item.amountReceived, item.dateApplied)
  );
  const score = (nombre ? 1 : 0) + (centavos ? 1 : 0) + (notificado ? 1 : 0);
  return { nombre, centavos, notificado, score };
}

type PreviewOptions = {
  payments: Payment[];
  retentionByClient: OtherChargesRetentionByClient;
  operationalDate: Date;
  lateFeeSettings?: LateFeeSettings;
};

export function buildPendingBankPreview(
  item: PendingBankItem,
  client: Client | null,
  { payments, retentionByClient, operationalDate, lateFeeSettings }: PreviewOptions
): PendingBankPreview | null {
  if (!client) return null;
  const balanceBefore = roundMoney(Math.max(0, client.balance));
  const wholePart = roundMoney(Math.max(0, item.capitalPart));
  const lateFeesApplied = distributeAcrossLateFeeCharges(client, wholePart, lateFeeSettings);
  const totalLateFees = roundMoney(lateFeesApplied.reduce((sum, charge) => sum + charge.amount, 0));
  const wholeAfterLateFees = roundMoney(Math.max(0, wholePart - totalLateFees));
  const clientAfterLateFees: Client = {
    ...client,
    otherCharges: computeOtherChargesDueAfter(client.otherCharges, lateFeesApplied) ?? []
  };
  const finesApplied = distributeAcrossFines(clientAfterLateFees, wholeAfterLateFees);
  const totalFines = roundMoney(finesApplied.reduce((sum, fine) => sum + fine.amount, 0));
  const wholeAfterFines = roundMoney(Math.max(0, wholeAfterLateFees - totalFines));
  const ticketsApplied = distributeAcrossTickets(clientAfterLateFees, wholeAfterFines);
  const totalTickets = roundMoney(ticketsApplied.reduce((sum, ticket) => sum + ticket.amount, 0));
  const wholeAfterPriorityCharges = roundMoney(Math.max(0, wholeAfterFines - totalTickets));
  const { totalOtherCharges, forcedRuleApplied } = computeEffectiveOtherChargesAllocation(
    clientAfterLateFees,
    {},
    wholeAfterPriorityCharges,
    retentionByClient,
    payments,
    item.dateApplied
  );
  const totalChargesBeforeRent = roundMoney(totalLateFees + totalFines + totalTickets + totalOtherCharges);
  const capitalForRent = roundMoney(Math.max(0, wholePart - totalChargesBeforeRent));
  const appliedToRent = roundMoney(Math.min(capitalForRent, balanceBefore));
  const advanceBefore = roundMoney(Math.max(0, client.advanceBalance ?? 0));
  const advanceApplied = roundMoney(Math.max(0, capitalForRent - appliedToRent));
  const advanceAfter = roundMoney(advanceBefore + advanceApplied);
  const balanceAfter = roundMoney(Math.max(0, balanceBefore - appliedToRent));
  const rentAmount = roundMoney(Math.max(0, client.rentAmount));
  const pendingBefore = rentAmount > 0 ? Math.ceil(balanceBefore / rentAmount) : 0;
  const pendingAfter = rentAmount > 0 && balanceAfter > 0 ? Math.ceil(balanceAfter / rentAmount) : 0;
  const installmentsDeducted = Math.max(0, pendingBefore - pendingAfter);
  const installmentsCoveredByAdvance = computeCoveredInstallmentsFromAdvance(advanceBefore, advanceAfter, rentAmount);
  const installmentsImpact = installmentsDeducted + installmentsCoveredByAdvance;
  const installmentsRemainingAfter = Math.max(0, (client.installmentsRemaining ?? 0) - installmentsImpact);
  let upToDateUntil: string | null = null;

  if (balanceAfter <= 0) {
    const referenceDate = parseDateKey(item.dateApplied) ?? operationalDate;
    const projectedClient: Client = {
      ...client,
      balance: balanceAfter,
      advanceBalance: advanceAfter
    };
    const nextChargeDate = findNextChargeDay(projectedClient, referenceDate);
    if (nextChargeDate) {
      const coveredUntilDate = new Date(nextChargeDate);
      coveredUntilDate.setDate(coveredUntilDate.getDate() - 1);
      upToDateUntil = toDateKey(coveredUntilDate);
    }
  }

  return {
    rentAmount,
    frequencyLabel: FREQUENCY_LABEL[client.frequency] ?? client.frequency,
    installmentsAgreed: Math.max(0, client.installmentsAgreed ?? 0),
    installmentsRemainingAfter,
    installmentsDeducted,
    totalLateFees,
    totalOtherCharges: roundMoney(totalLateFees + totalOtherCharges),
    totalFines,
    totalTickets,
    forcedOtherChargesRuleApplied: forcedRuleApplied,
    balanceAfter,
    installmentsCoveredByAdvance,
    upToDateUntil
  };
}

type ApplicationOptions = {
  payments: Payment[];
  retentionByClient: OtherChargesRetentionByClient;
  receiptNumber: string;
  referenceTag: "AUTO-ALTA-SIMILITUD" | "CLASIFICADO-MANUAL";
  manualOtherChargesInput?: Record<string, string>;
  allowManualOverrideForForcedRule?: boolean;
  lateFeeSettings?: LateFeeSettings;
};

export function buildPendingPaymentApplication(
  item: PendingBankItem,
  client: Client,
  {
    payments,
    retentionByClient,
    receiptNumber,
    referenceTag,
    manualOtherChargesInput = {},
    allowManualOverrideForForcedRule = false,
    lateFeeSettings
  }: ApplicationOptions
): { updatedClient: Client; payment: Payment } {
  const balanceBefore = roundMoney(client.balance);
  const savingsBefore = roundMoney(client.savings);
  const advanceBefore = roundMoney(client.advanceBalance ?? 0);
  const wholePart = roundMoney(item.capitalPart);
  const centsPart = roundMoney(item.centsPart);
  const lateFeesApplied = distributeAcrossLateFeeCharges(client, wholePart, lateFeeSettings);
  const totalLateFees = roundMoney(lateFeesApplied.reduce((sum, charge) => sum + charge.amount, 0));
  const wholeAfterLateFees = roundMoney(Math.max(0, wholePart - totalLateFees));
  const clientAfterLateFees: Client = {
    ...client,
    otherCharges: computeOtherChargesDueAfter(client.otherCharges, lateFeesApplied) ?? []
  };
  const finesApplied = distributeAcrossFines(clientAfterLateFees, wholeAfterLateFees);
  const totalFines = roundMoney(finesApplied.reduce((sum, fine) => sum + fine.amount, 0));
  const wholeAfterFines = roundMoney(Math.max(0, wholeAfterLateFees - totalFines));
  const ticketsApplied = distributeAcrossTickets(clientAfterLateFees, wholeAfterFines);
  const totalTickets = roundMoney(ticketsApplied.reduce((sum, ticket) => sum + ticket.amount, 0));
  const wholeAfterPriorityCharges = roundMoney(Math.max(0, wholeAfterFines - totalTickets));
  const remainingOtherChargesAllocation = computeEffectiveOtherChargesAllocation(
    clientAfterLateFees,
    manualOtherChargesInput,
    wholeAfterPriorityCharges,
    retentionByClient,
    payments,
    item.dateApplied,
    allowManualOverrideForForcedRule
  );
  const otherChargesApplied = [...lateFeesApplied, ...remainingOtherChargesAllocation.otherChargesApplied];
  const totalOtherCharges = roundMoney(totalLateFees + remainingOtherChargesAllocation.totalOtherCharges);
  const capitalForRent = roundMoney(Math.max(0, wholeAfterPriorityCharges - remainingOtherChargesAllocation.totalOtherCharges));
  const appliedToRent = roundMoney(Math.min(capitalForRent, Math.max(0, balanceBefore)));
  const advanceApplied = roundMoney(Math.max(0, capitalForRent - appliedToRent));
  const centavosAhorro = centsPart;
  const balanceAfter = roundMoney(Math.max(0, balanceBefore - appliedToRent));
  const savingsAfter = roundMoney(savingsBefore + centavosAhorro);
  const advanceAfter = roundMoney(advanceBefore + advanceApplied);
  const rentAmount = client.rentAmount;
  const pendingBefore = rentAmount > 0 ? Math.ceil(balanceBefore / rentAmount) : 0;
  const pendingAfter = rentAmount > 0 && balanceAfter > 0 ? Math.ceil(balanceAfter / rentAmount) : 0;
  const installmentsDeducted = Math.max(0, pendingBefore - pendingAfter);
  const installmentsCoveredByAdvance = computeCoveredInstallmentsFromAdvance(advanceBefore, advanceAfter, rentAmount);
  const installmentsImpact = installmentsDeducted + installmentsCoveredByAdvance;
  const installmentsPaidAfter = Math.max(0, client.installmentsPaid) + installmentsImpact;
  const installmentsRemainingAfter = Math.max(0, (client.installmentsRemaining || 0) - installmentsImpact);
  const paymentDateKey = item.dateApplied || getBusinessDateKey();
  const firstSundayChargedAt = resolveFirstSundayChargedAtForManualPayment(
    client,
    { projectedClient: client, installmentsTotalInPayment: installmentsImpact },
    paymentDateKey
  );
  const otherChargesDueAfter = computeOtherChargesDueAfter(client.otherCharges, otherChargesApplied) ?? [];

  const payment: Payment = {
    id: crypto.randomUUID(),
    receiptNumber,
    receiptDeliveryStatus: "pending",
    clientId: client.id,
    clientName: client.name,
    clientUnit: client.unitId,
    clientCedula: client.cedula,
    dateApplied: paymentDateKey,
    paymentMethod: inferBankPaymentMethod(item.transactionCode, item.description),
    reference: `FOLIO:${item.folio} | REF:${item.referenceId || "N/A"} | ${referenceTag} | ${item.description}`,
    amountReceived: item.amountReceived,
    appliedToRent,
    centavosAhorro,
    advanceApplied: advanceApplied > 0 ? advanceApplied : undefined,
    advanceBalanceAfter: advanceAfter,
    finesApplied: finesApplied.length > 0 ? finesApplied : undefined,
    finesDueAfter: computeFinesDueAfter(client.fines, finesApplied),
    ticketsApplied: ticketsApplied.length > 0 ? ticketsApplied : undefined,
    ticketsDueAfter: computeTicketsDueAfter(client.tickets, ticketsApplied),
    otherChargesApplied: otherChargesApplied.length > 0 ? otherChargesApplied : undefined,
    otherChargesDueAfter: otherChargesDueAfter.length > 0 ? otherChargesDueAfter : undefined,
    installmentsDeducted,
    installmentsFromDebt: installmentsDeducted,
    installmentsFromAdvance: installmentsCoveredByAdvance,
    installmentsTotalInPayment: installmentsImpact,
    balanceBefore,
    balanceAfter,
    savingsBefore,
    savingsAfter,
    installmentsPaidAfter,
    installmentsRemainingAfter,
    rentAmount: client.rentAmount,
    frequency: client.frequency,
    weeklyChargeDay: client.weeklyChargeDay,
    monthlyChargeDay: client.monthlyChargeDay,
    chargeFirstSunday: client.chargeFirstSunday,
    firstSundayChargedAt,
    travelFundAvailableSnapshot: roundMoney(Math.max(0, client.travelFundBalance ?? 0)),
    createdAt: new Date().toISOString()
  };

  const updatedClient: Client = {
    ...client,
    balance: balanceAfter,
    advanceBalance: advanceAfter,
    savings: savingsAfter,
    installmentsPaid: installmentsPaidAfter,
    installmentsRemaining: installmentsRemainingAfter,
    fines: applyFinePayments(client.fines, finesApplied, new Date().toISOString()),
    tickets: applyTicketPayments(client.tickets, ticketsApplied, new Date().toISOString()),
    otherCharges: otherChargesDueAfter,
    firstSundayChargedAt
  };

  return { updatedClient, payment };
}

export function buildTakenFolioSet(
  paymentRows: Payment[],
  pendingBankRows: PendingBankItem[],
  pendingCardRows: PendingCardItem[],
  options?: {
    excludePendingBankFolios?: Set<string>;
    excludePendingCardIds?: Set<string>;
  }
): Set<string> {
  const set = new Set<string>();
  const excludePendingBankFolios = options?.excludePendingBankFolios ?? new Set<string>();
  const excludePendingCardIds = options?.excludePendingCardIds ?? new Set<string>();

  for (const payment of paymentRows) {
    for (const folio of extractFoliosFromReference(payment.reference ?? "")) {
      if (folio) set.add(folio);
    }
  }
  for (const item of pendingBankRows) {
    const folio = normalizeFolioToken(item.folio);
    if (excludePendingBankFolios.has(folio)) continue;
    if (folio) set.add(folio);
  }
  for (const item of pendingCardRows) {
    if (excludePendingCardIds.has(item.id)) continue;
    const folio = normalizeFolioToken(item.folio);
    if (folio) set.add(folio);
  }
  return set;
}
