import type { LeadDecision } from "./types";

export function sellerCedulaKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function validSellerCedula(value: string): boolean {
  return /^[A-Za-z0-9 -]{4,32}$/.test(value.trim()) && sellerCedulaKey(value).length >= 4;
}

export function sellerDecisionMessage(decision: LeadDecision): string {
  return decision === "no_aplica"
    ? "Por el momento no es posible avanzar con el proceso de esta persona. Gracias por tu comprensión."
    : "¡Listo! Puedes avanzar con el proceso de esta persona.";
}

export const SELLER_PENDING_MESSAGE = "La información de esta persona está en revisión. Consulta nuevamente más adelante.";

export function validSellerBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= "1900-01-01" && value <= new Date().toISOString().slice(0, 10);
}
