import { supabase } from "./lib/supabase";
import type { Client, ClientStatus, CollisionRecord, CollisionsSettings, Payment, PaymentPromise } from "./types";
import { logCloudSync } from "./cloudSyncLogger";
import {
  enqueueCloudSyncItem,
  loadCloudSnapshot,
  removeCloudSyncItem,
  saveCloudSnapshot,
  upsertCloudSyncItemStatus,
  listPendingCloudSyncItems
} from "./cloudOffline";

type DataRow<T> = {
  id: string;
  data: T;
};
type SingletonDataRow = {
  data?: unknown;
};

const PAGE_SIZE = 1000;
const WRITE_BATCH_SIZE = 100;
const CLOUD_REQUEST_TIMEOUT_MS = 12_000;
const CLOUD_REQUEST_RETRY_LIMIT = 2;

type CloudOperationContext = {
  operation: string;
  userId: string;
  table?: string;
  payloadSummary?: string;
  requestCount: number;
  startedAt: number;
};

function startCloudOp(
  operation: string,
  userId: string,
  table?: string,
  payloadSummary?: string
): CloudOperationContext {
  return {
    operation,
    userId,
    table,
    payloadSummary,
    requestCount: 0,
    startedAt: performance.now()
  };
}

function markCloudRequest(ctx: CloudOperationContext): void {
  ctx.requestCount += 1;
}

function finishCloudOp(ctx: CloudOperationContext, responseSummary?: string): void {
  logCloudSync("info", {
    operation: ctx.operation,
    table: ctx.table,
    userId: ctx.userId,
    durationMs: performance.now() - ctx.startedAt,
    requestCount: ctx.requestCount,
    payloadSummary: ctx.payloadSummary,
    responseSummary
  });
}

function failCloudOp(ctx: CloudOperationContext, error: unknown): void {
  logCloudSync("error", {
    operation: ctx.operation,
    table: ctx.table,
    userId: ctx.userId,
    durationMs: performance.now() - ctx.startedAt,
    requestCount: ctx.requestCount,
    payloadSummary: ctx.payloadSummary,
    error
  });
}

function formatCloudError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return String(error ?? "");
  const record = error as Record<string, unknown>;
  const parts = [
    record.code,
    record.message,
    record.details,
    record.hint
  ]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0);
  if (parts.length > 0) return parts.join(" | ");
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isPermanentCloudError(error: unknown): boolean {
  const text = formatCloudError(error).toLowerCase();
  return (
    text.includes("23505") ||
    text.includes("duplicate key") ||
    text.includes("unique constraint") ||
    text.includes("payments_cloud_user_folio_uq") ||
    text.includes("row-level security") ||
    text.includes("permission denied") ||
    text.includes("42501") ||
    text.includes("invalid input syntax") ||
    text.includes("violates not-null constraint")
  );
}

function extractFoliosFromReference(reference: string): string[] {
  const normalized = String(reference ?? "").toUpperCase();
  if (!normalized.trim()) return [];

  const taggedFolios = Array.from(normalized.matchAll(/FOLIO\s*:\s*([^\s|]+)/gi))
    .map((match) => String(match[1] ?? "").toUpperCase().replace(/\s+/g, ""))
    .filter((folio) => folio.length > 0);
  if (taggedFolios.length > 0) {
    return [...new Set(taggedFolios)];
  }

  const legacyFallback = normalized
    .replace(/^REFERENCIA\s*:\s*/i, "")
    .replace(/^REF\s*:\s*/i, "")
    .replace(/^FOLIO\s*:?/i, "")
    .replace(/\s+/g, "");
  return legacyFallback ? [legacyFallback] : [];
}

function isRetriableCloudError(error: unknown): boolean {
  const text = (error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error ?? "")).toLowerCase();
  return (
    text.includes("network") ||
    text.includes("fetch") ||
    text.includes("timeout") ||
    text.includes("503") ||
    text.includes("504") ||
    text.includes("429") ||
    text.includes("temporarily unavailable") ||
    text.includes("failed to fetch")
  );
}

async function withTimeout<T>(task: Promise<T>, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: number | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`Cloud request timeout after ${timeoutMs}ms.`)), timeoutMs);
  });
  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

async function runWithRetry<T>(operation: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= CLOUD_REQUEST_RETRY_LIMIT; attempt += 1) {
    try {
      return await withTimeout(task());
    } catch (error) {
      lastError = error;
      if (attempt >= CLOUD_REQUEST_RETRY_LIMIT || !isRetriableCloudError(error)) {
        throw error;
      }
      const delay = 350 * (attempt + 1);
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      logCloudSync("info", {
        operation,
        durationMs: delay,
        requestCount: attempt + 1,
        payloadSummary: `retry=${attempt + 1}`
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Cloud operation failed.");
}

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

function normalizeCloudClient(client: Client): Client {
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

function dedupeRowsById<T extends { id: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (!row.id) continue;
    // Conserva la ultima version por id dentro del mismo lote.
    byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

function assertCollectionRows<T>(rows: T[] | null | undefined, table: string): T[] {
  if (!Array.isArray(rows)) {
    throw new Error(`La coleccion ${table} recibio un payload invalido. Se esperaba un arreglo.`);
  }
  return rows.filter((row): row is T => row !== null && row !== undefined);
}

function normalizeCollectionRowsWithIds<T extends Record<string, unknown>>(
  table: string,
  rows: T[]
): Array<T & { id: string }> {
  return rows.map((row, index) => {
    const id = normalizeCollectionRowId(table, row, index);
    return { ...row, id };
  });
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(row[key])}`).join(",")}}`;
}

function chunkRows<T>(rows: T[], size = WRITE_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

function diffRowsById<T extends { id: string }>(previousRows: T[], nextRows: T[]): {
  changedRows: T[];
  staleIds: string[];
} {
  const previousById = new Map(previousRows.map((row) => [row.id, stableJsonStringify(row)] as const));
  const nextIds = new Set<string>();
  const changedRows: T[] = [];

  for (const row of nextRows) {
    if (!row.id) continue;
    nextIds.add(row.id);
    const nextSerialized = stableJsonStringify(row);
    const prevSerialized = previousById.get(row.id);
    if (prevSerialized !== nextSerialized) {
      changedRows.push(row);
    }
  }

  const staleIds = previousRows
    .map((row) => row.id)
    .filter((id) => String(id ?? "").trim().length > 0 && !nextIds.has(id));

  return { changedRows, staleIds };
}

function normalizeCollectionRowId(table: string, row: Record<string, unknown>, index: number): string {
  const existingId = typeof row.id === "string" ? row.id.trim() : "";
  if (existingId.length > 0) return existingId;

  if (table === "cash_closings_cloud") {
    const date = typeof row.date === "string" ? row.date.trim() : "";
    const closedAt = typeof row.closedAt === "string" ? row.closedAt.trim() : "";
    if (date.length > 0) {
      return `${date}__${closedAt.length > 0 ? closedAt : `row-${index + 1}`}`;
    }
  }

  throw new Error(`La coleccion ${table} requiere un id estable para sincronizarse con Supabase.`);
}

export async function loadCloudCollectionRows<T>(table: string, userId: string): Promise<T[]> {
  const cacheKey = `collection:${table}`;
  try {
    const result = await runWithRetry(`load_${table}`, async () => {
      const client = getClient();
      const rows: DataRow<T>[] = [];
      let from = 0;
      while (true) {
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await client
          .from(table)
          .select("id,data")
          .eq("user_id", userId)
          .range(from, to);
        if (error) throw error;
        const batch = (data ?? []) as DataRow<T>[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return rows
        .map((row) => row?.data)
        .filter((value): value is T => value !== null && value !== undefined);
    });
    await saveCloudSnapshot(userId, cacheKey, result);
    return result;
  } catch (error) {
    const cached = await loadCloudSnapshot<T[]>(userId, cacheKey);
    if (cached) return cached;
    throw error;
  }
}

export async function loadCloudCollectionRowsPage<T>(
  table: string,
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<T[]> {
  const limit = Math.max(1, Math.min(PAGE_SIZE, Math.floor(options?.limit ?? 100)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  try {
    return await runWithRetry(`load_page_${table}`, async () => {
      const client = getClient();
      const to = offset + limit - 1;
      const { data, error } = await client
        .from(table)
        .select("id,data")
        .eq("user_id", userId)
        .range(offset, to);
      if (error) throw error;
      const rows = (data ?? []) as Array<DataRow<T> | null | undefined>;
      return rows
        .map((row) => row?.data)
        .filter((value): value is T => value !== null && value !== undefined);
    });
  } catch {
    const cached = await loadCloudSnapshot<T[]>(userId, `collection:${table}`);
    if (!cached) return [];
    return cached.slice(offset, offset + limit);
  }
}

export async function saveCloudCollectionRows<T extends { id: string }>(
  table: string,
  userId: string,
  rows: T[],
  options?: { fromQueue?: boolean }
): Promise<void> {
  const cacheKey = `collection:${table}`;
  const safeRows = assertCollectionRows(rows, table);
  const normalizedRows = normalizeCollectionRowsWithIds(table, safeRows as Array<T & Record<string, unknown>>);
  const dedupedRows = dedupeRowsById(normalizedRows);

  try {
    await runWithRetry(`save_${table}`, async () => {
      const client = getClient();
      const previousRows = normalizeCollectionRowsWithIds(
        table,
        ((await loadCloudSnapshot<T[]>(userId, cacheKey)) ?? []) as Array<T & Record<string, unknown>>
      );
      const { changedRows, staleIds } = diffRowsById(previousRows, dedupedRows);

      if (changedRows.length > 0) {
        const payloadRows = changedRows.map((item) => ({
          user_id: userId,
          id: item.id,
          data: item
        }));
        for (const batch of chunkRows(payloadRows)) {
          const { error } = await client.from(table).upsert(batch, { onConflict: "user_id,id" });
          if (error) throw error;
        }
      }

      if (previousRows.length > 0 && staleIds.length > 0) {
        for (const idsChunk of chunkRows(staleIds, 150)) {
          const { error } = await client
            .from(table)
            .delete()
            .eq("user_id", userId)
            .in("id", idsChunk);
          if (error) throw error;
        }
      }
    });
    await saveCloudSnapshot(userId, cacheKey, dedupedRows);
    return;
  } catch (error) {
    if (!options?.fromQueue && !isPermanentCloudError(error)) {
      await enqueueCloudSyncItem({
        user_id: userId,
        entity_type: "collection",
        entity_id: table,
        action: "upsert",
        payload: JSON.stringify(dedupedRows)
      });
    }
    throw error;
  }
}

async function updateCachedCollectionRow<T extends { id: string }>(
  userId: string,
  table: string,
  row: T
): Promise<void> {
  const cacheKey = `collection:${table}`;
  const cached = (await loadCloudSnapshot<T[]>(userId, cacheKey)) ?? [];
  const next = new Map<string, T>();
  for (const item of cached) {
    if (item?.id) next.set(item.id, item);
  }
  next.set(row.id, row);
  await saveCloudSnapshot(userId, cacheKey, Array.from(next.values()));
}

export async function upsertCloudCollectionRow<T extends { id: string }>(
  table: string,
  userId: string,
  row: T,
  options?: { fromQueue?: boolean }
): Promise<void> {
  try {
    await runWithRetry(`upsert_row_${table}`, async () => {
      const client = getClient();
      const { error } = await client
        .from(table)
        .upsert({ user_id: userId, id: row.id, data: row, updated_at: new Date().toISOString() }, { onConflict: "user_id,id" });
      if (error) throw error;
    });
    await updateCachedCollectionRow(userId, table, row);
  } catch (error) {
    if (!options?.fromQueue) {
      await enqueueCloudSyncItem({
        user_id: userId,
        entity_type: "collection_row",
        entity_id: `${table}:${row.id}`,
        action: "upsert",
        payload: JSON.stringify(row)
      });
    }
    throw error;
  }
}

export async function loadCloudSingletonData<T = Record<string, unknown>>(table: string, userId: string): Promise<T | null> {
  const cacheKey = `singleton:${table}`;
  try {
    const payload = await runWithRetry(`load_singleton_${table}`, async () => {
      const client = getClient();
      const { data, error } = await client
        .from(table)
        .select("data")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      const row = data as SingletonDataRow | null;
      return row?.data === undefined || row?.data === null ? null : (row.data as T);
    });
    if (payload !== null) await saveCloudSnapshot(userId, cacheKey, payload);
    return payload;
  } catch (error) {
    const cached = await loadCloudSnapshot<T>(userId, cacheKey);
    return cached;
  }
}

export async function saveCloudSingletonData<T>(
  table: string,
  userId: string,
  value: T,
  options?: { fromQueue?: boolean }
): Promise<void> {
  const cacheKey = `singleton:${table}`;
  try {
    await runWithRetry(`save_singleton_${table}`, async () => {
      const cached = await loadCloudSnapshot<T>(userId, cacheKey);
      const currentSerialized = stableJsonStringify(value);
      const cachedSerialized = stableJsonStringify(cached);
      if (cached !== null && cachedSerialized === currentSerialized) return;
      const client = getClient();
      const { error } = await client
        .from(table)
        .upsert({ user_id: userId, data: value }, { onConflict: "user_id" });
      if (error) throw error;
    });
    await saveCloudSnapshot(userId, cacheKey, value);
  } catch (error) {
    if (!options?.fromQueue && !isPermanentCloudError(error)) {
      await enqueueCloudSyncItem({
        user_id: userId,
        entity_type: "singleton",
        entity_id: table,
        action: "replace",
        payload: JSON.stringify(value)
      });
    }
    throw error;
  }
}

async function deleteStaleRows(
  table: "clients_cloud" | "payments_cloud" | "payment_promises_cloud",
  userId: string,
  nextIds: Set<string>,
  ctx?: CloudOperationContext
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
    if (ctx) markCloudRequest(ctx);
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
    if (ctx) markCloudRequest(ctx);

    if (deleteError) throw deleteError;
  }
}

export async function loadCloudClients(userId: string): Promise<Client[]> {
  const rows = await loadCloudCollectionRows<Client>("clients_cloud", userId);
  return rows.map((row) => normalizeCloudClient(row));
}

export async function loadCloudClientsPage(
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<Client[]> {
  const rows = await loadCloudCollectionRowsPage<Client>("clients_cloud", userId, {
    limit: options?.limit ?? 100,
    offset: options?.offset ?? 0
  });
  return rows.map((row) => normalizeCloudClient(row));
}

export async function saveCloudClients(userId: string, clients: Client[]): Promise<void> {
  const ctx = startCloudOp("save_cloud_clients", userId, "clients_cloud", `rows=${clients.length}`);
  try {
    await saveCloudCollectionRows("clients_cloud", userId, clients);
    finishCloudOp(ctx, `upsert_rows=${clients.length}`);
  } catch (error) {
    failCloudOp(ctx, error);
    throw error;
  }
}

export async function syncCloudClientsDelta(
  userId: string,
  previousClients: Client[],
  nextClients: Client[]
): Promise<void> {
  const ctx = startCloudOp("sync_cloud_clients_delta", userId, "clients_cloud", `prev=${previousClients.length},next=${nextClients.length}`);
  try {
    await saveCloudClients(userId, nextClients);
    finishCloudOp(ctx, `upsert_rows=${nextClients.length},removed_ids=${Math.max(0, previousClients.length - nextClients.length)}`);
  } catch (error) {
    failCloudOp(ctx, error);
    throw error;
  }
}

export async function loadCloudPayments(userId: string): Promise<Payment[]> {
  return loadCloudCollectionRows<Payment>("payments_cloud", userId);
}

export async function loadCloudPaymentsPage(
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<Payment[]> {
  return loadCloudCollectionRowsPage<Payment>("payments_cloud", userId, {
    limit: options?.limit ?? 100,
    offset: options?.offset ?? 0
  });
}

export async function loadCloudAppliedPaymentFolioSet(userId: string): Promise<Set<string>> {
  const folios = new Set<string>();
  await runWithRetry("load_cloud_applied_payment_folios", async () => {
    const client = getClient();
    let from = 0;
    while (true) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await client
        .from("payments_cloud")
        .select("data")
        .eq("user_id", userId)
        .range(from, to);
      if (error) throw error;
      const batch = (data ?? []) as Array<{ data?: unknown } | null | undefined>;
      for (const row of batch) {
        const payment = row?.data as Payment | null | undefined;
        const reference = typeof payment?.reference === "string" ? payment.reference : "";
        for (const folio of extractFoliosFromReference(reference)) {
          folios.add(folio);
        }
      }
      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  });
  return folios;
}

export async function saveCloudPayments(userId: string, payments: Payment[]): Promise<void> {
  const ctx = startCloudOp("save_cloud_payments", userId, "payments_cloud", `rows=${payments.length}`);
  try {
    await saveCloudCollectionRows("payments_cloud", userId, payments);
    finishCloudOp(ctx, `upsert_rows=${payments.length}`);
  } catch (error) {
    failCloudOp(ctx, error);
    throw error;
  }
}

export async function syncCloudPaymentsDelta(
  userId: string,
  previousPayments: Payment[],
  nextPayments: Payment[]
): Promise<void> {
  const ctx = startCloudOp("sync_cloud_payments_delta", userId, "payments_cloud", `prev=${previousPayments.length},next=${nextPayments.length}`);
  try {
    await saveCloudPayments(userId, nextPayments);
    finishCloudOp(ctx, `upsert_rows=${nextPayments.length},removed_ids=${Math.max(0, previousPayments.length - nextPayments.length)}`);
  } catch (error) {
    failCloudOp(ctx, error);
    throw error;
  }
}

export async function loadCloudPaymentPromises(userId: string): Promise<PaymentPromise[]> {
  return loadCloudCollectionRows<PaymentPromise>("payment_promises_cloud", userId);
}

export async function saveCloudPaymentPromises(userId: string, promises: PaymentPromise[]): Promise<void> {
  await saveCloudCollectionRows("payment_promises_cloud", userId, promises);
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
  const payload = await loadCloudSingletonData<Record<string, unknown>>("street_management_cloud", userId);
  return normalizeRecord(payload ?? {});
}

export async function saveCloudStreetManagement(userId: string, value: Record<string, unknown>): Promise<void> {
  const normalized = normalizeCloudValue(value) as Record<string, unknown>;
  await saveCloudSingletonData("street_management_cloud", userId, normalized);
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
  const ctx = startCloudOp(
    "sync_cloud_street_management_delta",
    userId,
    "street_management_cloud",
    `prev_keys=${Object.keys(previousValue ?? {}).length},next_keys=${Object.keys(nextValue ?? {}).length}`
  );
  try {
    const merged = mergeStreetManagementByTimestamp(normalizeRecord(previousValue), normalizeRecord(nextValue));
    await saveCloudStreetManagement(userId, merged);
    finishCloudOp(ctx, `patched_keys=${Object.keys(nextValue ?? {}).length}`);
  } catch (error) {
    failCloudOp(ctx, error);
    throw error;
  }
}

export async function loadCloudCollectionClosures(userId: string): Promise<Record<string, unknown>> {
  const payload = await loadCloudSingletonData<Record<string, unknown>>("collection_closures_cloud", userId);
  return normalizeRecord(payload ?? {});
}

export async function saveCloudCollectionClosures(userId: string, value: Record<string, unknown>): Promise<void> {
  await saveCloudSingletonData("collection_closures_cloud", userId, value);
}

export async function loadCloudCollisions(userId: string): Promise<CollisionRecord[]> {
  const payload = await loadCloudSingletonData<CollisionRecord[]>("collisions_cloud", userId);
  return Array.isArray(payload) ? payload : [];
}

export async function saveCloudCollisions(userId: string, value: CollisionRecord[]): Promise<void> {
  const normalized = normalizeCloudValue(value) as CollisionRecord[];
  await saveCloudSingletonData("collisions_cloud", userId, normalized);
}

export async function loadCloudCollisionsSettings(userId: string): Promise<CollisionsSettings | null> {
  return await loadCloudSingletonData<CollisionsSettings>("collisions_settings_cloud", userId);
}

export async function saveCloudCollisionsSettings(userId: string, value: CollisionsSettings): Promise<void> {
  const normalized = normalizeCloudValue(value) as CollisionsSettings;
  await saveCloudSingletonData("collisions_settings_cloud", userId, normalized);
}

export async function flushCloudSyncQueue(userId: string): Promise<number> {
  const pending = await listPendingCloudSyncItems(userId);
  let processed = 0;
  for (const item of pending) {
    try {
      await upsertCloudSyncItemStatus(item.id, { status: "pending" });
      if (item.entity_type === "collection") {
        const parsed = JSON.parse(item.payload) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error(`Payload invalido para ${item.entity_id}. Se esperaba un arreglo.`);
        }
        await saveCloudCollectionRows(item.entity_id, userId, parsed as Array<{ id: string }>, { fromQueue: true });
      } else if (item.entity_type === "singleton") {
        const value = JSON.parse(item.payload) as unknown;
        await saveCloudSingletonData(item.entity_id, userId, value, { fromQueue: true });
      }
      await removeCloudSyncItem(item.id);
      processed += 1;
    } catch (error) {
      const lastError = formatCloudError(error);
      await upsertCloudSyncItemStatus(item.id, {
        status: isPermanentCloudError(error) ? "rejected" : "error",
        retry_count: isPermanentCloudError(error) ? item.retry_count : item.retry_count + 1,
        last_error: lastError
      });
      if (lastError.toLowerCase().includes("payload invalido")) {
        await removeCloudSyncItem(item.id);
      }
    }
  }
  return processed;
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
