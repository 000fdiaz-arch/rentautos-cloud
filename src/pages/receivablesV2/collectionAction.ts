import type { ReceivableRow } from "../../receivablesV2";
import { requiresCollectionPayment } from "./collectionAmountDue";

export function collectionAction(row: ReceivableRow, today: string, tenureDays?: number | null) {
  if (row.overdueBalance > 0) return "call";
  if (requiresCollectionPayment(row)) return tenureDays != null && tenureDays >= 0 && tenureDays < 90 ? "new_client_followup" : "reminder_today";
  const tomorrow = new Date(today + "T12:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (row.plan !== "daily" && row.nextDueDate === tomorrow.toISOString().slice(0, 10)) return "reminder_tomorrow";
  return "gps";
}
