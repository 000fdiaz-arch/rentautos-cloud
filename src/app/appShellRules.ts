import type { Client, Payment } from "../types";

export type PendingCoreSyncSnapshot = {
  userId: string;
  token: number;
  clients: Client[];
  payments: Payment[];
  paymentsComplete?: boolean;
};

function errorParts(error: unknown) {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
  const message = error instanceof Error ? error.message : typeof record?.message === "string" ? record.message : "";
  const code = typeof record?.code === "string" ? record.code : "";
  const details = typeof record?.details === "string" ? record.details : "";
  const hint = typeof record?.hint === "string" ? record.hint : "";
  return { message, code, details, hint, normalized: `${code} ${message} ${details} ${hint}`.toLowerCase() };
}

export function buildCloudErrorMessage(
  baseMessage: string,
  error: unknown,
  options?: { includeRawFallback?: boolean }
): string {
  const parts = errorParts(error);
  if (parts.normalized.includes("payments_cloud_user_receipt_number_uq") || parts.normalized.includes("receiptnumber")) {
    return `${baseMessage} El numero de recibo ya existe en Supabase; ejecuta la migracion 15-receipt-sequence-resync.sql y vuelve a intentar.`;
  }
  if (["payments_cloud_user_folio_uq", "pending_bank_items_cloud_user_folio_uq", "pending_card_items_cloud_user_folio_uq"].some((value) => parts.normalized.includes(value))) {
    return `${baseMessage} El folio ya existe en Supabase.`;
  }
  if (parts.normalized.includes("row-level security") || parts.normalized.includes("permission denied") || parts.normalized.includes("42501")) {
    return `${baseMessage} Permisos insuficientes (RLS/owner).`;
  }
  if (parts.normalized.includes("network") || parts.normalized.includes("fetch") || parts.normalized.includes("timeout")) {
    return `${baseMessage} Problema de conexion/red.`;
  }
  if (parts.normalized.includes("jwt") || parts.normalized.includes("token") || parts.normalized.includes("not authenticated") || parts.normalized.includes("401")) {
    return `${baseMessage} Sesion expirada o no autenticada.`;
  }
  const raw = [parts.code, parts.message, parts.details, parts.hint].filter(Boolean).join(" | ");
  return options?.includeRawFallback && raw ? `${baseMessage} Motivo: ${raw.slice(0, 220)}` : baseMessage;
}

export function getCloudSaveErrorMessage(error: unknown): string {
  const { normalized } = errorParts(error);
  if (normalized.includes("payments_cloud_user_receipt_number_uq") || normalized.includes("receiptnumber")) {
    return "No se pudo sincronizar: el numero de recibo ya existe en la base de datos.";
  }
  if (["payments_cloud_user_folio_uq", "pending_bank_items_cloud_user_folio_uq", "pending_card_items_cloud_user_folio_uq"].some((value) => normalized.includes(value))) {
    return "No se pudo sincronizar: el folio ya existe en la base de datos.";
  }
  if (normalized.includes("duplicate")) return "No se pudo sincronizar: hay un valor duplicado en Supabase.";
  if (normalized.includes("row-level security") || normalized.includes("permission denied") || normalized.includes("42501")) {
    return "No se pudo sincronizar por permisos (RLS).";
  }
  if (normalized.includes("network") || normalized.includes("fetch") || normalized.includes("timeout")) {
    return "Sincronizacion pendiente por conexion lenta o inestable. Se reintentara automaticamente.";
  }
  return "Sincronizacion pendiente. Se reintentara automaticamente.";
}

export function serializePendingCoreSync(snapshot: PendingCoreSyncSnapshot): string {
  return JSON.stringify({ ...snapshot, paymentsComplete: snapshot.paymentsComplete === true });
}

export function parsePendingCoreSync(raw: string | null, ownerUserId?: string | null): PendingCoreSyncSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(parsed.clients) || !Array.isArray(parsed.payments)) return null;
    const userId = typeof parsed.userId === "string" ? parsed.userId : "";
    if (!userId || userId !== ownerUserId) return null;
    return {
      userId,
      token: typeof parsed.token === "number" && Number.isFinite(parsed.token) ? parsed.token : Date.now(),
      clients: parsed.clients as Client[],
      payments: parsed.payments as Payment[],
      paymentsComplete: parsed.paymentsComplete === true
    };
  } catch {
    return null;
  }
}

export function parseLocalJson(key: string, fallback: unknown): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function mergeById<T extends { id: string }>(baseRows: T[], incomingRows: T[]): T[] {
  const incomingById = new Map(incomingRows.map((row) => [row.id, row]));
  const baseIds = new Set(baseRows.map((row) => row.id));
  return [
    ...incomingRows.filter((row) => !baseIds.has(row.id)),
    ...baseRows.map((row) => incomingById.get(row.id) ?? row)
  ];
}

export function repairDuplicateActiveUnits(sourceClients: Client[]) {
  const activeByUnit = new Map<string, Client[]>();
  for (const client of sourceClients) {
    const unit = typeof client.unitId === "string" ? client.unitId.trim().toUpperCase() : "";
    if (!unit || client.status === "archivado") continue;
    activeByUnit.set(unit, [...(activeByUnit.get(unit) ?? []), client]);
  }
  const archiveIds = new Set<string>();
  let duplicateUnitCount = 0;
  for (const clients of activeByUnit.values()) {
    if (clients.length <= 1) continue;
    duplicateUnitCount += 1;
    const sorted = [...clients].sort((left, right) =>
      new Date(left.createdAt || left.archivedAt || 0).getTime() - new Date(right.createdAt || right.archivedAt || 0).getTime()
    );
    sorted.slice(0, -1).forEach((client) => archiveIds.add(client.id));
  }
  if (archiveIds.size === 0) return { clients: sourceClients, changed: false, archivedCount: 0, duplicateUnitCount };
  const now = new Date();
  return {
    clients: sourceClients.map((client) => archiveIds.has(client.id) ? {
      ...client,
      unitId: "",
      status: "archivado" as const,
      archivedAt: client.archivedAt ?? now.toISOString(),
      statusComment: `Archivado automaticamente por duplicado de unidad ${typeof client.unitId === "string" ? client.unitId.trim().toUpperCase() : ""} el ${now.toLocaleDateString("es-PA")}`
    } : client),
    changed: true,
    archivedCount: archiveIds.size,
    duplicateUnitCount
  };
}
