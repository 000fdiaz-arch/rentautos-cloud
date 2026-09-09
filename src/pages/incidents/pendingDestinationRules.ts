import type { PendingIncidentRecord } from "../../cloudData";

export type PendingDestinationEscalation = {
  level: "new" | "attention" | "urgent" | "supervisor";
  hoursOpen: number;
  title: string;
  message: string;
};

export function pendingDestinationEscalation(item: PendingIncidentRecord, now = new Date()): PendingDestinationEscalation {
  const openedAt = new Date(item.createdAt).getTime();
  const hoursOpen = Number.isFinite(openedAt) ? Math.max(0, Math.floor((now.getTime() - openedAt) / 3_600_000)) : 0;
  const attempts = item.contactAttempts.length;
  if (hoursOpen >= 72 || attempts >= 3) return {
    level: "supervisor", hoursOpen,
    title: "ESCALADO: destino sin definir",
    message: `${hoursOpen >= 72 ? `Lleva ${hoursOpen} horas abierto` : `Ya tiene ${attempts} intentos de contacto`}. Requiere intervención del supervisor hoy.`
  };
  if (hoursOpen >= 48) return {
    level: "urgent", hoursOpen,
    title: "URGENTE: destino sin definir",
    message: `Lleva ${hoursOpen} horas sin decidir si continúa por juicio o seguro.`
  };
  if (hoursOpen >= 24) return {
    level: "attention", hoursOpen,
    title: "Destino sin definir por más de 24 horas",
    message: "Debe realizarse un nuevo intento de contacto y definir el destino cuanto antes."
  };
  return {
    level: "new", hoursOpen,
    title: "Destino sin definir",
    message: "Este caso seguirá visible hasta enviarlo a juicio o seguro."
  };
}

export function todayDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function tomorrowDateKey(now = new Date()): string {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

export function isNextContactWithinOneDay(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const today = todayDateKey(now);
  return value >= today && value <= tomorrowDateKey(now);
}
