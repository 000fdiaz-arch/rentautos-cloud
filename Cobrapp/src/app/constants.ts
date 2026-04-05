import type { BankRowState, ClientState, MovementType } from "../types";

export const STORAGE_KEY = "cobrapp-state-v1";

export const movementTypeLabels: Record<MovementType, string> = {
  cargo: "Cargo",
  abono: "Abono",
  ajuste: "Ajuste",
};

export const clientStateLabels: Record<ClientState, string> = {
  "al-dia": "Al dia",
  pendiente: "Pendiente",
  atrasado: "Atrasado",
};

export const bankStateLabels: Record<BankRowState, string> = {
  coincide: "Coincide",
  revisar: "Revisar",
  "sin-asignar": "Sin asignar",
  procesado: "Aplicado",
};

export function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
