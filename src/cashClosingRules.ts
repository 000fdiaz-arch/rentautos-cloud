import { getBusinessDateKey, isBeforeFirstChargeDate, isChargeDay, parseDateKey, resolveInstallmentIssuance, toDateKey } from "./billing";
import type { Client } from "./types";

export type PendingCashClosingChargeResult = {
  clients: Client[];
  chargedClients: number;
  chargedTotal: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isPendingCashClosingCharge(client: Client, date: Date): boolean {
  if (client.archivedAt || client.status !== "activo" || client.activeProvisionalRental) return false;
  if (!Number.isFinite(client.rentAmount) || client.rentAmount <= 0) return false;
  if (isBeforeFirstChargeDate(client, date) || !isChargeDay(client, date)) return false;
  if (resolveInstallmentIssuance(client).issued >= Math.max(0, Math.floor(client.installmentsAgreed))) return false;
  const lastCharge = client.lastChargeDate ? parseDateKey(client.lastChargeDate) : null;
  return !lastCharge || lastCharge < date;
}

export function getCashClosingDateError(dateKey: string, now = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !parseDateKey(dateKey)) {
    return "Selecciona una fecha válida para cerrar caja.";
  }
  const today = getBusinessDateKey(now);
  if (dateKey > today) {
    return `No se puede cerrar caja por adelantado. Hoy en Panamá es ${today}; la fecha ${dateKey} todavía no ha llegado.`;
  }
  if (dateKey === today) {
    return `No se puede cerrar la caja del día en curso (${today}). Podrás cerrarla a partir del día siguiente.`;
  }
  return null;
}

export function getLastClosableDateKey(now = new Date()): string {
  const today = parseDateKey(getBusinessDateKey(now));
  if (!today) return "";
  const previousDate = new Date(today);
  previousDate.setDate(previousDate.getDate() - 1);
  return toDateKey(previousDate);
}

export function getCashClosingPendingChargesError(clients: Client[], dateKey: string): string | null {
  const date = parseDateKey(dateKey);
  if (!date) return null;
  const pending = clients.filter((client) => isPendingCashClosingCharge(client, date));
  if (pending.length === 0) return null;
  const units = pending.slice(0, 8).map((client) => client.unitId).join(", ");
  return `No se puede cerrar ${dateKey}: faltan cargos de ese día en ${pending.length} unidad(es): ${units}${pending.length > 8 ? ", …" : ""}. Revisa esos cargos antes de avanzar al día siguiente.`;
}

export function applyPendingCashClosingCharges(clients: Client[], dateKey: string): PendingCashClosingChargeResult {
  const date = parseDateKey(dateKey);
  if (!date) return { clients, chargedClients: 0, chargedTotal: 0 };

  let chargedClients = 0;
  let chargedTotal = 0;
  const nextClients = clients.map((client) => {
    if (!isPendingCashClosingCharge(client, date)) return client;
    const issuance = resolveInstallmentIssuance(client);
    const currentAdvance = roundMoney(client.advanceBalance ?? 0);
    const consumedAdvance = roundMoney(Math.min(currentAdvance, client.rentAmount));
    const uncoveredRent = roundMoney(Math.max(0, client.rentAmount - consumedAdvance));
    chargedClients += 1;
    chargedTotal = roundMoney(chargedTotal + uncoveredRent);
    const isFirstSundayCharge = client.frequency === "daily" && date.getDay() === 0 && !!client.chargeFirstSunday && !client.firstSundayChargedAt;
    return {
      ...client,
      balance: roundMoney(client.balance + uncoveredRent),
      advanceBalance: roundMoney(Math.max(0, currentAdvance - consumedAdvance)),
      installmentsIssued: issuance.issued + 1,
      installmentsIssuedEstimateNeedsReview: issuance.needsReview,
      firstSundayChargedAt: isFirstSundayCharge ? dateKey : client.firstSundayChargedAt,
      lastChargeDate: dateKey
    };
  });

  return { clients: nextClients, chargedClients, chargedTotal };
}
