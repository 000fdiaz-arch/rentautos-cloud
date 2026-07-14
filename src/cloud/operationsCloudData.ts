import type { LeadEvaluation, PaymentPromise } from "../types";
import { dedupeLoad, deleteStaleRows, getCloudClient, PAGE_SIZE, type DataRow, type SingletonDataRow } from "./cloudClient";

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

export async function loadCloudPaymentPromises(userId: string): Promise<PaymentPromise[]> {
  const client = getCloudClient();
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
  const client = getCloudClient();
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

export async function loadCloudLeadEvaluations(userId: string): Promise<LeadEvaluation[]> {
  const client = getCloudClient();
  const allRows: DataRow<LeadEvaluation>[] = [];
  let lastId = "";
  while (true) {
    let query = client
      .from("lead_evaluations_cloud")
      .select("id,data")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as DataRow<LeadEvaluation>[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;
    if (!lastId) break;
  }
  return allRows
    .map((row) => row.data)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveCloudLeadEvaluations(userId: string, evaluations: LeadEvaluation[]): Promise<void> {
  const client = getCloudClient();
  const nextIds = new Set(evaluations.map((item) => item.id));
  const rows = evaluations.map((item) => ({
    user_id: userId,
    id: item.id,
    data: item
  }));

  if (rows.length > 0) {
    const { error } = await client
      .from("lead_evaluations_cloud")
      .upsert(rows, { onConflict: "user_id,id" });
    if (error) throw error;
  }

  await deleteStaleRows("lead_evaluations_cloud", userId, nextIds);
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
  const client = getCloudClient();
  const { data, error } = await client
    .from("street_management_cloud")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeRecord((data as SingletonDataRow | null)?.data);
}

export async function saveCloudStreetManagement(userId: string, value: Record<string, unknown>): Promise<void> {
  const client = getCloudClient();
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
  const client = getCloudClient();
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
  const client = getCloudClient();
  const { data, error } = await client
    .from("collection_closures_cloud")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeRecord((data as SingletonDataRow | null)?.data);
}

export async function saveCloudCollectionClosures(userId: string, value: Record<string, unknown>): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("collection_closures_cloud")
    .upsert({ user_id: userId, data: value }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function loadControlUnits(userId: string): Promise<ControlUnitRow[]> {
  const client = getCloudClient();
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
  const client = getCloudClient();
  const { error } = await client
    .from("fleet_units_cloud")
    .upsert(input, { onConflict: "user_id,unit_id" });
  if (error) throw error;
}
