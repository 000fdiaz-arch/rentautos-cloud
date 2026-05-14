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
  const client = getClient();
  const allRows: DataRow<Client>[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from("clients_cloud")
      .select("id,data")
      .eq("user_id", userId)
      .range(from, to);
    if (error) throw error;
    const batch = (data ?? []) as DataRow<Client>[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows.map((row) => normalizeCloudClient(row.data));
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

export async function loadCloudPayments(userId: string): Promise<Payment[]> {
  const client = getClient();
  const allRows: DataRow<Payment>[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from("payments_cloud")
      .select("id,data")
      .eq("user_id", userId)
      .range(from, to);
    if (error) throw error;
    const batch = (data ?? []) as DataRow<Payment>[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows.map((row) => row.data);
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

export async function loadCloudPaymentPromises(userId: string): Promise<PaymentPromise[]> {
  const client = getClient();
  const allRows: DataRow<PaymentPromise>[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from("payment_promises_cloud")
      .select("id,data")
      .eq("user_id", userId)
      .range(from, to);
    if (error) throw error;
    const batch = (data ?? []) as DataRow<PaymentPromise>[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
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

export async function loadCloudStreetManagement(userId: string): Promise<Record<string, unknown>> {
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
  const { error } = await client
    .from("street_management_cloud")
    .upsert({ user_id: userId, data: value }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function loadCloudCollectionClosures(userId: string): Promise<Record<string, unknown>> {
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
