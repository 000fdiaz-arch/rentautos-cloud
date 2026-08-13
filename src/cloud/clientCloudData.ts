import type { Client, ClientStatus } from "../types";
import { withResolvedInstallmentIssuance } from "../billing";
import { dedupeLoad, getCloudClient, hasRowChanged, PAGE_SIZE, withCloudRetry, type DataRow } from "./cloudClient";

function normalizeClientStatus(rawStatus: unknown, archivedAt: unknown): ClientStatus {
  const value = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";
  if (
    value === "activo" ||
    value === "taller" ||
    value === "chapisteria" ||
    value === "custodia" ||
    value === "archivado"
  ) {
    return value;
  }
  if (value === "cliente_enfermo" || value === "en_busqueda") return "activo";
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
  return withResolvedInstallmentIssuance({
    ...client,
    status: normalizedStatus,
    archivedAt: nextArchivedAt
  });
}

export async function loadCloudClients(userId: string): Promise<Client[]> {
  return dedupeLoad(`clients:${userId}`, () => loadCloudClientsUncached(userId));
}

export async function loadCloudClient(userId: string, clientId: string): Promise<Client | null> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("clients_cloud")
    .select("id,data")
    .eq("user_id", userId)
    .eq("id", clientId)
    .maybeSingle<DataRow<Client>>();
  if (error) throw error;
  return data?.data ? normalizeCloudClient(data.data) : null;
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
}

export async function syncCloudClientsDelta(
  userId: string,
  previousClients: Client[],
  nextClients: Client[]
): Promise<void> {
  const client = getCloudClient();
  const prevById = new Map(previousClients.map((item) => [item.id, item]));
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
}
