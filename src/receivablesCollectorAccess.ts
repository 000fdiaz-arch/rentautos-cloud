export type ReceivablesCollectorKey = "collector-1" | "collector-2";

export type ReceivablesCollectorPinHash = {
  salt: string;
  hash: string;
  length: number;
};

export type ReceivablesCollectorPinHashes = Record<ReceivablesCollectorKey, ReceivablesCollectorPinHash>;

export type ReceivablesCollectorSession = {
  dateKey: string;
  collector: ReceivablesCollectorKey;
};

export const RECEIVABLES_COLLECTOR_PIN_LENGTH = 4;

export const RECEIVABLES_COLLECTORS: Record<ReceivablesCollectorKey, { label: string; groups: string[]; portfolio: "portfolio-1" | "portfolio-2" }> = {
  "collector-1": { label: "Cobrador 1", groups: ["A", "C", "E"], portfolio: "portfolio-1" },
  "collector-2": { label: "Cobrador 2", groups: ["B", "D", "T"], portfolio: "portfolio-2" }
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function hashReceivablesCollectorPin(pin: string, saltBase64?: string): Promise<ReceivablesCollectorPinHash> {
  const normalizedPin = pin.replace(/\D/g, "");
  const salt = saltBase64 ? base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const pinBytes = new TextEncoder().encode(normalizedPin);
  const payload = new Uint8Array(salt.length + pinBytes.length);
  payload.set(salt, 0);
  payload.set(pinBytes, salt.length);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return {
    salt: bytesToBase64(salt),
    hash: bytesToBase64(new Uint8Array(digest)),
    length: normalizedPin.length
  };
}

export async function verifyReceivablesCollectorPin(pin: string, saved: ReceivablesCollectorPinHash): Promise<boolean> {
  if (pin.replace(/\D/g, "").length !== saved.length) return false;
  const candidate = await hashReceivablesCollectorPin(pin, saved.salt);
  return candidate.hash === saved.hash;
}

export function receivablesCollectorForUnit(unitId: string): ReceivablesCollectorKey | null {
  const group = unitId.trim().charAt(0).toUpperCase();
  if (RECEIVABLES_COLLECTORS["collector-1"].groups.includes(group)) return "collector-1";
  if (RECEIVABLES_COLLECTORS["collector-2"].groups.includes(group)) return "collector-2";
  return null;
}

export function receivablesCollectorSessionStorageKey(dataOwnerUserId?: string | null): string {
  return `rentautos.receivables.collector-session.v1:${dataOwnerUserId ?? "local"}`;
}

export function loadReceivablesCollectorSession(dataOwnerUserId: string | null | undefined, dateKey: string): ReceivablesCollectorSession | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(receivablesCollectorSessionStorageKey(dataOwnerUserId)) ?? "null") as Partial<ReceivablesCollectorSession> | null;
    if (parsed?.dateKey !== dateKey) return null;
    if (parsed.collector !== "collector-1" && parsed.collector !== "collector-2") return null;
    return { dateKey, collector: parsed.collector };
  } catch {
    return null;
  }
}

export function saveReceivablesCollectorSession(dataOwnerUserId: string | null | undefined, session: ReceivablesCollectorSession): void {
  window.localStorage.setItem(receivablesCollectorSessionStorageKey(dataOwnerUserId), JSON.stringify(session));
}

export function clearReceivablesCollectorSession(dataOwnerUserId?: string | null): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(receivablesCollectorSessionStorageKey(dataOwnerUserId));
}
