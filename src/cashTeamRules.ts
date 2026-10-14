import type { CollectionDelta, CollectionTeam, Payment } from "./types";
import { stableEqual } from "./stableSerialize";

export function hasCollectionTeam(team: unknown): team is CollectionTeam {
  return team === "PTY" || team === "WC";
}

export function hasCollectionDelta(delta: unknown): delta is CollectionDelta {
  return delta === "delta1" || delta === "delta2" || delta === "delta3";
}

export function collectionTeamForDelta(delta: CollectionDelta): CollectionTeam {
  return delta === "delta2" ? "WC" : "PTY";
}

export function collectionDeltaLabel(delta: CollectionDelta): string {
  return delta === "delta1" ? "Delta 1" : delta === "delta2" ? "Delta 2" : "Delta 3";
}

export function collectionDeltaFromPayment(payment: Pick<Payment, "collectionDelta" | "collectionTeam">): CollectionDelta | undefined {
  if (hasCollectionDelta(payment.collectionDelta)) return payment.collectionDelta;
  return payment.collectionTeam === "WC" ? "delta2" : undefined;
}

export function isPendingCashWithoutTeam(payment: Pick<Payment, "paymentMethod" | "moneyDelivered" | "collectionTeam">): boolean {
  return payment.paymentMethod === "Efectivo" && payment.moneyDelivered === false && !hasCollectionTeam(payment.collectionTeam);
}

export const CASH_TEAM_REQUIRED_MESSAGE = "El efectivo pendiente de entrega debe tener responsable. Selecciona Delta 1, Delta 2 o Delta 3.";

// Existing incomplete records remain readable; any new or edited pending record must be corrected.
export function getPendingCashChangeError(previous: Payment[], next: Payment[]): string | null {
  const previousById = new Map(previous.map(payment => [payment.id, payment]));
  const invalid = next.find(payment => isPendingCashWithoutTeam(payment) && !stableEqual(previousById.get(payment.id), payment));
  return invalid ? `Recibo ${invalid.receiptNumber}: ${CASH_TEAM_REQUIRED_MESSAGE}` : null;
}
