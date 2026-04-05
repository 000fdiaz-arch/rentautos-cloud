import { demoClients, demoMovements } from "../data";
import type { BankRow, Client, Movement } from "../types";
import { STORAGE_KEY } from "./constants";

export interface StoredState {
  version: 1;
  clients: Client[];
  movements: Movement[];
  bankRows: BankRow[];
}

export function loadStoredState() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawState = window.localStorage.getItem(STORAGE_KEY);

  if (!rawState) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawState) as StoredState;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredState(state: StoredState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createFallbackState(): StoredState {
  return {
    version: 1,
    clients: demoClients,
    movements: demoMovements,
    bankRows: [],
  };
}
