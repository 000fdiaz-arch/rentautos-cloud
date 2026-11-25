import type { ReceivableRow } from "../../receivablesV2";
import type { Client, Payment, OtherChargesRetentionByClient, OtherChargesRetentionCheckpoint } from "../../types";
import { computeConfiguredRetentionCalculation } from "../payments/paymentRules";

export function otherChargeAmountDue(client: Client, balance: number, settings: OtherChargesRetentionByClient,
  payments: Payment[], date: string, checkpoint?: OtherChargesRetentionCheckpoint): number {
  const scheduled = computeConfiguredRetentionCalculation(client, settings, payments, date, checkpoint).amount;
  return Math.min(Math.max(0, balance), Math.max(0, scheduled));
}

export function requiresCollectionPayment(row: ReceivableRow): boolean {
  return row.totalPending > 0
    || (row.otherChargeAmountDue ?? row.outstandingOtherChargeAmount ?? row.totalOtherCharges) > 0
    || (row.outstandingLateFeeAmount ?? 0) > 0
    || (row.outstandingFineAmount ?? 0) > 0
    || (row.outstandingTicketAmount ?? 0) > 0;
}
