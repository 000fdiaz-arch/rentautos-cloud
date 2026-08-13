import {
  CASH_CLOSING_AUDIT_KEY,
  CASH_CLOSINGS_KEY,
  CHARGE_RUNS_KEY,
  COLLECTION_CLOSURES_KEY,
  COLLECTION_STATUS_KEY,
  NOTIFIED_PAYMENTS_KEY
} from "./paymentConstants";
import type {
  CashClosing,
  CashClosingAuditEvent,
  ChargeRun,
  CollectionClosuresByDate,
  CollectionStatusRecord,
  NotifiedPayment
} from "./paymentTypes";

export function parseCollectionStatusesFromStorage(rawValue?: string | null): Record<string, CollectionStatusRecord> {
  try {
    const raw = rawValue ?? localStorage.getItem(COLLECTION_STATUS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, CollectionStatusRecord> = {};
    for (const [clientId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const status = row.status;
      if (
        status !== "pending" &&
        status !== "contacted" &&
        status !== "covered" &&
        status !== "route" &&
        status !== "no_answer" &&
        status !== "reminder" &&
        status !== "call_later" &&
        status !== "paid" &&
        status !== "route_collection" &&
        status !== "route_not_sent"
      ) continue;
      const rawAmount = typeof row.managementAmount === "number" ? row.managementAmount : Number(row.managementAmount);
      next[clientId] = {
        status,
        comment: typeof row.comment === "string" ? row.comment.slice(0, 5) : "",
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
        managementType: row.managementType === "solo_cobrar" || row.managementType === "cobrar_o_quitar" ? row.managementType : undefined,
        managementAmount: Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : undefined,
        managementComment: typeof row.managementComment === "string" ? row.managementComment.slice(0, 25) : "",
        managementUpdatedAt: typeof row.managementUpdatedAt === "string" ? row.managementUpdatedAt : undefined,
        whatsAppMessageCopiedAt: typeof row.whatsAppMessageCopiedAt === "string" ? row.whatsAppMessageCopiedAt : undefined,
        whatsAppMessageSentAt: typeof row.whatsAppMessageSentAt === "string" ? row.whatsAppMessageSentAt : undefined,
        whatsAppMessageText: typeof row.whatsAppMessageText === "string" ? row.whatsAppMessageText : undefined,
        paymentPromiseDate: typeof row.paymentPromiseDate === "string" ? row.paymentPromiseDate : undefined,
        paymentPromiseUpdatedAt: typeof row.paymentPromiseUpdatedAt === "string" ? row.paymentPromiseUpdatedAt : undefined
      };
    }
    return next;
  } catch {
    return {};
  }
}

export function loadCollectionClosuresFromStorage(): CollectionClosuresByDate {
  try {
    const raw = localStorage.getItem(COLLECTION_CLOSURES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CollectionClosuresByDate;
  } catch {
    return {};
  }
}


export function parseNotifiedPayments(value: unknown): NotifiedPayment[] {
  if (!Array.isArray(value)) return [];
  return value
      .filter((item): item is NotifiedPayment => {
        if (!item || typeof item !== "object") return false;
        const rec = item as Record<string, unknown>;
        return (
          typeof rec.id === "string" &&
          typeof rec.clientId === "string" &&
          typeof rec.amount === "number" &&
          Number.isFinite(rec.amount) &&
          typeof rec.createdAt === "string"
        );
      })
      .map((item) => ({
        ...item,
        paymentMethod: item.paymentMethod === "bank" ? "bank" : undefined,
        collectionTeam: item.collectionTeam === "PTY" || item.collectionTeam === "WC" ? item.collectionTeam : undefined,
        source: item.source === "route" ? "route" : undefined
      }));
}

export function loadNotifiedPayments(): NotifiedPayment[] {
  const raw = localStorage.getItem(NOTIFIED_PAYMENTS_KEY);
  if (!raw) return [];
  try {
    return parseNotifiedPayments(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveNotifiedPayments(rows: NotifiedPayment[]): void {
  localStorage.setItem(NOTIFIED_PAYMENTS_KEY, JSON.stringify(rows));
}

export function loadCashClosings(): CashClosing[] {
  const raw = localStorage.getItem(CASH_CLOSINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CashClosing => {
      if (!item || typeof item !== "object") return false;
      const rec = item as Record<string, unknown>;
      return typeof rec.date === "string" && typeof rec.closedAt === "string";
    });
  } catch {
    return [];
  }
}

export function saveCashClosings(rows: CashClosing[]): void {
  localStorage.setItem(CASH_CLOSINGS_KEY, JSON.stringify(rows));
}

export function loadCashClosingAudit(): CashClosingAuditEvent[] {
  const raw = localStorage.getItem(CASH_CLOSING_AUDIT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CashClosingAuditEvent => {
      if (!item || typeof item !== "object") return false;
      const rec = item as Record<string, unknown>;
      return (
        typeof rec.id === "string" &&
        typeof rec.date === "string" &&
        (rec.action === "close" || rec.action === "reopen") &&
        typeof rec.actor === "string" &&
        typeof rec.reason === "string" &&
        typeof rec.createdAt === "string"
      );
    });
  } catch {
    return [];
  }
}

export function saveCashClosingAudit(rows: CashClosingAuditEvent[]): void {
  localStorage.setItem(CASH_CLOSING_AUDIT_KEY, JSON.stringify(rows));
}

export function loadChargeRuns(): ChargeRun[] {
  const raw = localStorage.getItem(CHARGE_RUNS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ChargeRun | null => {
        if (!item || typeof item !== "object") return null;
        const rec = item as Record<string, unknown>;
        if (
          typeof rec.id !== "string" ||
          typeof rec.closingDate !== "string" ||
          typeof rec.targetDate !== "string" ||
          typeof rec.chargedClients !== "number" ||
          typeof rec.chargedTotal !== "number" ||
          typeof rec.createdAt !== "string"
        ) return null;
        const expectedClients = typeof rec.expectedClients === "number"
          ? rec.expectedClients
          : rec.chargedClients;
        const anomalyClients = typeof rec.anomalyClients === "number" ? rec.anomalyClients : 0;
        return {
          id: rec.id,
          closingDate: rec.closingDate,
          targetDate: rec.targetDate,
          expectedClients,
          chargedClients: rec.chargedClients,
          anomalyClients,
          chargedTotal: rec.chargedTotal,
          createdAt: rec.createdAt,
          status: rec.status === "pending" || rec.status === "completed" || rec.status === "reverted" ? rec.status : undefined,
          revertedAt: typeof rec.revertedAt === "string" ? rec.revertedAt : undefined,
          revertedReason: typeof rec.revertedReason === "string" ? rec.revertedReason : undefined,
          revertedBy: typeof rec.revertedBy === "string" ? rec.revertedBy : undefined,
          clientSnapshots: Array.isArray(rec.clientSnapshots) ? rec.clientSnapshots as ChargeRun["clientSnapshots"] : undefined,
          lateFeeEntryIds: Array.isArray(rec.lateFeeEntryIds)
            ? rec.lateFeeEntryIds.filter((id): id is string => typeof id === "string")
            : undefined
        } satisfies ChargeRun;
      })
      .filter((item): item is ChargeRun => item !== null);
  } catch {
    return [];
  }
}

export function saveChargeRuns(rows: ChargeRun[]): void {
  localStorage.setItem(CHARGE_RUNS_KEY, JSON.stringify(rows));
}
