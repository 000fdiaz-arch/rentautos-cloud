import type { Client, ClientStatus } from "../types";
import { chunkIds, dedupeLoad, deleteStaleRows, getCloudClient, hasRowChanged, PAGE_SIZE, withCloudRetry, type DataRow } from "./cloudClient";

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

export async function loadCloudClients(userId: string): Promise<Client[]> {
  return dedupeLoad(`clients:${userId}`, () => loadCloudClientsUncached(userId));
}

async function loadCloudClientsUncached(userId: string): Promise<Client[]> {
  const client = getCloudClient();
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
  const client = getCloudClient();
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
  const client = getCloudClient();
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
  const client = getCloudClient();
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
    const { error } = await withCloudRetry(() =>
      client
        .from("clients_cloud")
        .upsert(upsertRows, { onConflict: "user_id,id" })
    );
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
