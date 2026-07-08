import { supabase } from "./lib/supabase";
import type { Client, ClientStatus, Payment, PaymentPromise } from "./types";

type DataRow<T> = {
  id: string;
  data: T;
};
type SingletonDataRow = {
  data?: unknown;
};

const PAGE_SIZE = 1000;
const inflightLoads = new Map<string, Promise<unknown>>();
export type ControlUnitRow = {
  user_id: string;
  unit_id: string;
  company: string | null;
  brand_model: string | null;
  engine_serial: string | null;
  chassis_serial: string | null;
  plate: string | null;
  cupo: string | null;
  observation: string | null;
  is_exception: boolean | null;
  exception_note: string | null;
  client_id: string | null;
  client_name: string | null;
  client_cedula: string | null;
  operational_status: string | null;
  financial_balance: number | string | null;
  financial_status: "moroso" | "al_dia" | "sin_cliente" | string;
  last_payment_date: string | null;
  year?: number | string | null;
  model_year?: number | string | null;
  color?: string | null;
  transmission?: string | null;
  transmission_type?: string | null;
  mileage?: number | string | null;
  kilometrage?: number | string | null;
  kilometraje?: number | string | null;
  [key: string]: unknown;
};

function getClient() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

function normalizeClientStatus(rawStatus: unknown, archivedAt: unknown): ClientStatus {
  const value = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";
  if (
    value === "activo" ||
    value === "cliente_enfermo" ||
    value === "taller" ||
    value === "chapisteria" ||
    value === "custodia" ||
    value === "en_busqueda" ||
    value === "archivado"
  ) {
    return value;
  }
  if (value === "active") return "activo";
  if (value === "inactive") return "archivado";
  if (typeof archivedAt === "string" && archivedAt.trim().length > 0) return "archivado";
  return "activo";
}

export function normalizeCloudClient(client: Client): Client {
  const normalizedStatus = normalizeClientStatus(
    (client as unknown as { status?: unknown }).status,
    (client as unknown as { archivedAt?: unknown }).archivedAt
  );
  const nextArchivedAt =
    normalizedStatus === "archivado"
      ? ((client.archivedAt && client.archivedAt.trim().length > 0)
          ? client.archivedAt
          : new Date().toISOString())
      : undefined;
  return {
    ...client,
    status: normalizedStatus,
    archivedAt: nextArchivedAt
  };
}

function chunkIds(ids: string[], size = 150): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

function dedupeLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inflightLoads.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const next = loader().finally(() => {
    if (inflightLoads.get(key) === next) inflightLoads.delete(key);
  });
  inflightLoads.set(key, next);
  return next;
}

function hasRowChanged<T>(previous: T | undefined, next: T): boolean {
  if (!previous) return true;
  if (previous === next) return false;
  return JSON.stringify(previous) !== JSON.stringify(next);
}

async function deleteStaleRows(
  table: "clients_cloud" | "payments_cloud" | "payment_promises_cloud",
  userId: string,
  nextIds: Set<string>
): Promise<void> {
  const client = getClient();
  const allIds: string[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from(table)
      .select("id")
      .eq("user_id", userId)
      .range(from, to);
    if (error) throw error;
    const batch = (data ?? [])
      .map((row) => String((row as { id?: unknown }).id ?? ""))
      .filter((id) => id.length > 0);
    allIds.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const staleIds = allIds.filter((id) => id.length > 0 && !nextIds.has(id));

  if (staleIds.length === 0) return;

  for (const idsChunk of chunkIds(staleIds)) {
    const { error: deleteError } = await client
      .from(table)
      .delete()
      .eq("user_id", userId)
      .in("id", idsChunk);

    if (deleteError) throw deleteError;
  }
}

export async function loadCloudClients(userId: string): Promise<Client[]> {
  return dedupeLoad(`clients:${userId}`, () => loadCloudClientsUncached(userId));
}

async function loadCloudClientsUncached(userId: string): Promise<Client[]> {
  const client = getClient();
  const allRows: DataRow<Client>[] = [];
  let lastId = "";
  while (true) {
    let query = client
      .from("clients_cloud")
      .select("id,data")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as DataRow<Client>[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;
    if (!lastId) break;
  }
  return allRows.map((row) => normalizeCloudClient(row.data));
}

export async function loadCloudClientsPage(
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<Client[]> {
  const client = getClient();
  const limit = Math.max(1, Math.min(PAGE_SIZE, Math.floor(options?.limit ?? 200)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const to = offset + limit - 1;
  const { data, error } = await client
    .from("clients_cloud")
    .select("id,data")
    .eq("user_id", userId)
    .order("id", { ascending: true })
    .range(offset, to);
  if (error) throw error;
  const rows = (data ?? []) as DataRow<Client>[];
  return rows.map((row) => normalizeCloudClient(row.data));
}

export async function saveCloudClients(userId: string, clients: Client[]): Promise<void> {
  const client = getClient();
  const nextIds = new Set(clients.map((item) => item.id));
  const rows = clients.map((item) => ({
    user_id: userId,
    id: item.id,
    data: item
  }));

  if (rows.length > 0) {
    const { error } = await client
      .from("clients_cloud")
      .upsert(rows, { onConflict: "user_id,id" });

    if (error) throw error;
  }

  await deleteStaleRows("clients_cloud", userId, nextIds);
}

export async function syncCloudClientsDelta(
  userId: string,
  previousClients: Client[],
  nextClients: Client[]
): Promise<void> {
  const client = getClient();
  const prevById = new Map(previousClients.map((item) => [item.id, item]));
  const nextById = new Map(nextClients.map((item) => [item.id, item]));

  const upsertRows = nextClients
    .filter((item) => {
      const prev = prevById.get(item.id);
      return hasRowChanged(prev, item);
    })
    .map((item) => ({
      user_id: userId,
      id: item.id,
      data: item
    }));

  if (upsertRows.length > 0) {
    const { error } = await client
      .from("clients_cloud")
      .upsert(upsertRows, { onConflict: "user_id,id" });
    if (error) throw error;
  }

  const removedIds = previousClients
    .map((item) => item.id)
    .filter((id) => !nextById.has(id));

  if (removedIds.length > 0) {
    for (const idsChunk of chunkIds(removedIds)) {
      const { error } = await client
        .from("clients_cloud")
        .delete()
        .eq("user_id", userId)
        .in("id", idsChunk);
      if (error) throw error;
    }
  }
}

export async function loadCloudPayments(userId: string): Promise<Payment[]> {
  return dedupeLoad(`payments:${userId}`, () => loadCloudPaymentsUncached(userId));
}

async function loadCloudPaymentsUncached(userId: string): Promise<Payment[]> {
  const client = getClient();
  const allRows: DataRow<Payment>[] = [];
  let lastId = "";
  while (true) {
    let query = client
      .from("payments_cloud")
      .select("id,data")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as DataRow<Payment>[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;
    if (!lastId) break;
  }
  return allRows.map((row) => row.data);
}

export async function loadCloudPaymentsPage(
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<Payment[]> {
  const client = getClient();
  const limit = Math.max(1, Math.min(PAGE_SIZE, Math.floor(options?.limit ?? 200)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const to = offset + limit - 1;
  const { data, error } = await client
    .from("payments_cloud")
    .select("id,data")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .range(offset, to);
  if (error) throw error;
  const rows = (data ?? []) as DataRow<Payment>[];
  return rows.map((row) => row.data);
}

export async function loadCloudPaymentsRecent(userId: string, limit = 300): Promise<Payment[]> {
  const safeLimit = Math.max(1, Math.min(PAGE_SIZE, Math.floor(limit)));
  return dedupeLoad(`payments-recent:${userId}:${safeLimit}`, () => loadCloudPaymentsRecentUncached(userId, safeLimit));
}

async function loadCloudPaymentsRecentUncached(userId: string, safeLimit: number): Promise<Payment[]> {
  const client = getClient();
  const { data, error } = await client
    .from("payments_cloud")
    .select("id,data")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .range(0, safeLimit - 1);
  if (error) throw error;
  const rows = (data ?? []) as DataRow<Payment>[];
  return rows.map((row) => row.data);
}

function parseReceiptSequence(receiptNumber: unknown): number | null {
  if (typeof receiptNumber !== "string") return null;
  const match = receiptNumber.trim().toUpperCase().match(/^REC-([0-9]+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function formatReceiptSequence(seq: number): string {
  return `REC-${String(seq).padStart(4, "0")}`;
}

async function loadCloudMaxReceiptSequence(userId: string): Promise<number> {
  const client = getClient();
  let maxSeq = 0;
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from("payments_cloud")
      .select("data")
      .eq("user_id", userId)
      .range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ data?: Payment }>;
    for (const row of rows) {
      const seq = parseReceiptSequence(row.data?.receiptNumber);
      if (seq !== null && seq > maxSeq) maxSeq = seq;
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return maxSeq;
}

export async function reserveCloudReceiptNumber(userId: string): Promise<string> {
  const client = getClient();
  const [rpcResult, maxExistingSeq] = await Promise.all([
    client.rpc("next_receipt_number", {
      p_owner_user_id: userId
    }),
    loadCloudMaxReceiptSequence(userId)
  ]);
  const { data, error } = rpcResult;
  if (error) throw error;
  if (typeof data !== "string" || data.trim().length === 0) {
    throw new Error("Supabase no devolvio numero de recibo.");
  }
  const reservedSeq = parseReceiptSequence(data);
  if (reservedSeq !== null && reservedSeq <= maxExistingSeq) {
    return formatReceiptSequence(maxExistingSeq + 1);
  }
  return data.trim().toUpperCase();
}

export async function saveCloudPayments(userId: string, payments: Payment[]): Promise<void> {
  const client = getClient();
  const nextIds = new Set(payments.map((item) => item.id));
  const rows = payments.map((item) => ({
    user_id: userId,
    id: item.id,
    data: item
  }));

  if (rows.length > 0) {
    const { error } = await client
      .from("payments_cloud")
      .upsert(rows, { onConflict: "user_id,id" });

    if (error) throw error;
  }

  await deleteStaleRows("payments_cloud", userId, nextIds);
}

export async function syncCloudPaymentsDelta(
  userId: string,
  previousPayments: Payment[],
  nextPayments: Payment[]
): Promise<void> {
  const client = getClient();
  const prevById = new Map(previousPayments.map((item) => [item.id, item]));
  const nextById = new Map(nextPayments.map((item) => [item.id, item]));

  const upsertRows = nextPayments
    .filter((item) => {
      const prev = prevById.get(item.id);
      return hasRowChanged(prev, item);
    })
    .map((item) => ({
      user_id: userId,
      id: item.id,
      data: item
    }));

  if (upsertRows.length > 0) {
    const { error } = await client
      .from("payments_cloud")
      .upsert(upsertRows, { onConflict: "user_id,id" });
    if (error) throw error;
  }

  const removedIds = previousPayments
    .map((item) => item.id)
    .filter((id) => !nextById.has(id));

  if (removedIds.length > 0) {
    for (const idsChunk of chunkIds(removedIds)) {
      const { error } = await client
        .from("payments_cloud")
        .delete()
        .eq("user_id", userId)
        .in("id", idsChunk);
      if (error) throw error;
    }
  }
}

export async function loadCloudPaymentPromises(userId: string): Promise<PaymentPromise[]> {
  const client = getClient();
  const allRows: DataRow<PaymentPromise>[] = [];
  let lastId = "";
  while (true) {
    let query = client
      .from("payment_promises_cloud")
      .select("id,data")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as DataRow<PaymentPromise>[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;
    if (!lastId) break;
  }
  return allRows.map((row) => row.data);
}

export async function saveCloudPaymentPromises(userId: string, promises: PaymentPromise[]): Promise<void> {
  const client = getClient();
  const nextIds = new Set(promises.map((item) => item.id));
  const rows = promises.map((item) => ({
    user_id: userId,
    id: item.id,
    data: item
  }));

  if (rows.length > 0) {
    const { error } = await client
      .from("payment_promises_cloud")
      .upsert(rows, { onConflict: "user_id,id" });

    if (error) throw error;
  }

  await deleteStaleRows("payment_promises_cloud", userId, nextIds);
}

function normalizeRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function normalizeCloudValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeCloudValue(item));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
    next[key] = normalizeCloudValue(record[key]);
  }
  return next;
}

export async function loadCloudStreetManagement(userId: string): Promise<Record<string, unknown>> {
  return dedupeLoad(`street-management:${userId}`, () => loadCloudStreetManagementUncached(userId));
}

async function loadCloudStreetManagementUncached(userId: string): Promise<Record<string, unknown>> {
  const client = getClient();
  const { data, error } = await client
    .from("street_management_cloud")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeRecord((data as SingletonDataRow | null)?.data);
}

export async function saveCloudStreetManagement(userId: string, value: Record<string, unknown>): Promise<void> {
  const client = getClient();
  const normalized = normalizeCloudValue(value) as Record<string, unknown>;
  const { error } = await client
    .from("street_management_cloud")
    .upsert({ user_id: userId, data: normalized }, { onConflict: "user_id" });
  if (error) throw error;
}

function toIsoTimestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowTimestamp(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const row = value as Record<string, unknown>;
  return Math.max(toIsoTimestamp(row.updatedAt), toIsoTimestamp(row.managementUpdatedAt));
}

export async function syncCloudStreetManagementDelta(
  userId: string,
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>
): Promise<void> {
  const client = getClient();
  const prev = normalizeRecord(previousValue);
  const next = normalizeRecord(nextValue);
  const changedPatch: Record<string, unknown> = {};
  let hasPatch = false;

  for (const [clientId, nextRow] of Object.entries(next)) {
    const prevRow = prev[clientId];
    const nextTs = rowTimestamp(nextRow);
    const prevTs = rowTimestamp(prevRow);
    if (!prevRow || nextTs >= prevTs) {
      if (JSON.stringify(prevRow) !== JSON.stringify(nextRow)) {
        changedPatch[clientId] = nextRow;
        hasPatch = true;
      }
    }
  }

  for (const clientId of Object.keys(prev)) {
    if (!(clientId in next)) {
      changedPatch[clientId] = null;
      hasPatch = true;
    }
  }

  if (!hasPatch) return;

  const { data, error: selectError } = await client
    .from("street_management_cloud")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (selectError) throw selectError;
  const currentData = normalizeRecord((data as { data?: unknown } | null)?.data);
  const merged: Record<string, unknown> = { ...currentData };

  for (const [clientId, patchValue] of Object.entries(changedPatch)) {
    if (patchValue === null) {
      delete merged[clientId];
      continue;
    }
    const currentRow = merged[clientId];
    const patchTs = rowTimestamp(patchValue);
    const currentTs = rowTimestamp(currentRow);
    if (!currentRow || patchTs >= currentTs) {
      merged[clientId] = patchValue;
    }
  }

  const normalized = normalizeCloudValue(merged) as Record<string, unknown>;
  const { error } = await client
    .from("street_management_cloud")
    .upsert({ user_id: userId, data: normalized }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function loadCloudCollectionClosures(userId: string): Promise<Record<string, unknown>> {
  return dedupeLoad(`collection-closures:${userId}`, () => loadCloudCollectionClosuresUncached(userId));
}

async function loadCloudCollectionClosuresUncached(userId: string): Promise<Record<string, unknown>> {
  const client = getClient();
  const { data, error } = await client
    .from("collection_closures_cloud")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeRecord((data as SingletonDataRow | null)?.data);
}

export async function saveCloudCollectionClosures(userId: string, value: Record<string, unknown>): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from("collection_closures_cloud")
    .upsert({ user_id: userId, data: value }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function loadControlUnits(userId: string): Promise<ControlUnitRow[]> {
  const client = getClient();
  const allRows: ControlUnitRow[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from("vw_control_unidades")
      .select("*")
      .eq("user_id", userId)
      .order("unit_id", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const batch = (data ?? []) as ControlUnitRow[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

export type ControlUnitUpsertInput = {
  user_id: string;
  unit_id: string;
  company?: string | null;
  brand_model?: string | null;
  engine_serial?: string | null;
  chassis_serial?: string | null;
  plate?: string | null;
  cupo?: string | null;
  observation?: string | null;
  operational_status?: string | null;
  year?: number | string | null;
  model_year?: number | string | null;
  color?: string | null;
  transmission?: string | null;
  transmission_type?: string | null;
  mileage?: number | string | null;
  kilometrage?: number | string | null;
  kilometraje?: number | string | null;
  [key: string]: unknown;
};

export async function saveControlUnit(input: ControlUnitUpsertInput): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from("fleet_units_cloud")
    .upsert(input, { onConflict: "user_id,unit_id" });
  if (error) throw error;
}
