import { supabase } from "./lib/supabase";
import type { Client, Payment } from "./types";

type DataRow<T> = {
  id: string;
  data: T;
};

function getClient() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

async function deleteStaleRows(
  table: "clients_cloud" | "payments_cloud",
  userId: string,
  nextIds: Set<string>
): Promise<void> {
  const client = getClient();
  const { data, error } = await client
    .from(table)
    .select("id")
    .eq("user_id", userId);

  if (error) throw error;

  const staleIds = (data ?? [])
    .map((row) => String((row as { id?: unknown }).id ?? ""))
    .filter((id) => id.length > 0 && !nextIds.has(id));

  if (staleIds.length === 0) return;

  const { error: deleteError } = await client
    .from(table)
    .delete()
    .eq("user_id", userId)
    .in("id", staleIds);

  if (deleteError) throw deleteError;
}

export async function loadCloudClients(userId: string): Promise<Client[]> {
  const client = getClient();
  const { data, error } = await client
    .from("clients_cloud")
    .select("id,data")
    .eq("user_id", userId);

  if (error) throw error;
  return ((data ?? []) as DataRow<Client>[]).map((row) => row.data);
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
  const { data, error } = await client
    .from("payments_cloud")
    .select("id,data")
    .eq("user_id", userId);

  if (error) throw error;
  return ((data ?? []) as DataRow<Payment>[]).map((row) => row.data);
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
