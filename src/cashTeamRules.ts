import type { CollectionTeam, Payment } from "./types";
import { stableEqual } from "./stableSerialize";

export function hasCollectionTeam(team: unknown): team is CollectionTeam {
  return team === "PTY" || team === "WC";
}

export function isPendingCashWithoutTeam(payment: Pick<Payment, "paymentMethod" | "moneyDelivered" | "collectionTeam">): boolean {
  return payment.paymentMethod === "Efectivo" && payment.moneyDelivered === false && !hasCollectionTeam(payment.collectionTeam);
}

export const CASH_TEAM_REQUIRED_MESSAGE = "El efectivo pendiente de entrega debe tener equipo. Selecciona PTY o WC.";

// Existing incomplete records remain readable; any new or edited pending record must be corrected.
export function getPendingCashChangeError(previous: Payment[], next: Payment[]): string | null {
  const previousById = new Map(previous.map(payment => [payment.id, payment]));
  const invalid = next.find(payment => isPendingCashWithoutTeam(payment) && !stableEqual(previousById.get(payment.id), payment));
  return invalid ? `Recibo ${invalid.receiptNumber}: ${CASH_TEAM_REQUIRED_MESSAGE}` : null;
}
