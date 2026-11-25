import type { ReceivableRow } from "../../receivablesV2";
import type { Client, Payment, OtherChargesRetentionByClient, OtherChargesRetentionCheckpoint } from "../../types";
import { computeConfiguredRetentionCalculation } from "../payments/paymentRules";
import { isChargeDay, parseDateKey, toDateKey } from "../../billing";

export function otherChargeAmountDue(client: Client, balance: number, settings: OtherChargesRetentionByClient,
  payments: Payment[], date: string, checkpoint?: OtherChargesRetentionCheckpoint): number {
  const calculation = computeConfiguredRetentionCalculation(client, settings, payments, date, checkpoint);
  let scheduled = calculation.amount;
  if (client.frequency === "weekly" && settings[client.id]?.cycle === "daily") {
    // Daily accumulation is not a daily demand for clients who pay weekly.
    // Collect the accumulated quota on their current rental weekday instead.
    const cutoff = parseDateKey(date);
    if (cutoff) {
      for (let days = 0; days < 7 && !isChargeDay(client, cutoff); days += 1) {
        cutoff.setDate(cutoff.getDate() - 1);
      }
      let dueThrough = toDateKey(cutoff);
      const anchor = client.firstChargeDate;
      // A settled rental period at the start of a changed calendar must not
      // immediately create another quota after the preceding payment.
      if (anchor && calculation.checkpointDateKey && calculation.checkpointDateKey < anchor
        && client.balance <= 0 && dueThrough <= anchor) {
        const beforeAnchor = parseDateKey(anchor);
        if (beforeAnchor) {
          beforeAnchor.setDate(beforeAnchor.getDate() - 1);
          dueThrough = toDateKey(beforeAnchor);
        }
      }
      // Keep the latest checkpoint, including any unpaid part, even when the
      // payment happened after the last scheduled collection day.
      if (calculation.checkpointDateKey && dueThrough < calculation.checkpointDateKey) {
        dueThrough = calculation.checkpointDateKey;
      }
      scheduled = computeConfiguredRetentionCalculation(client, settings, payments, dueThrough, checkpoint).amount;
    }
  }
  return Math.min(Math.max(0, balance), Math.max(0, scheduled));
}

export function requiresCollectionPayment(row: ReceivableRow): boolean {
  return row.totalPending > 0
    || (row.otherChargeAmountDue ?? row.outstandingOtherChargeAmount ?? row.totalOtherCharges) > 0
    || (row.outstandingLateFeeAmount ?? 0) > 0
    || (row.outstandingFineAmount ?? 0) > 0
    || (row.outstandingTicketAmount ?? 0) > 0;
}
