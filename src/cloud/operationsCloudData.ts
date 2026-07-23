import type { BankRule, LateFeeSettings, LeadEvaluation, OtherChargesRetentionByClient, PaymentPromise } from "../types";
import { dedupeLoad, getCloudClient, PAGE_SIZE, type DataRow, type SingletonDataRow } from "./cloudClient";
import type {
  CashClosing,
  CashClosingAuditEvent,
  CashCloseClientSnapshot,
  ChargeRun
} from "../pages/payments/paymentTypes";
import { stableEqual } from "../stableSerialize";

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
}

export async function loadCloudBankRules(userId: string): Promise<BankRule[]> {
  return loadCloudArrayRows<BankRule>(userId, "bank_rules_cloud");
}

export async function saveCloudBankRules(userId: string, rows: BankRule[]): Promise<void> {
  await replaceCloudArrayRows(userId, "bank_rules_cloud", rows, (row, index) => row.id || `row-${index + 1}`);
}

export async function loadCloudLateFeeSettings(userId: string): Promise<LateFeeSettings | null> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("late_fee_settings_cloud")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const payload = (data as SingletonDataRow | null)?.data;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as LateFeeSettings
    : null;
}

export async function saveCloudLateFeeSettings(userId: string, settings: LateFeeSettings): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("late_fee_settings_cloud")
    .upsert({ user_id: userId, data: settings }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function loadCloudOtherChargesRetention(userId: string): Promise<OtherChargesRetentionByClient | null> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("other_charges_retention_cloud")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const payload = (data as SingletonDataRow | null)?.data;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as OtherChargesRetentionByClient
    : null;
}

export async function saveCloudOtherChargesRetention(
  userId: string,
  settings: OtherChargesRetentionByClient
): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("other_charges_retention_cloud")
    .upsert({ user_id: userId, data: settings }, { onConflict: "user_id" });
  if (error) throw error;
}

async function loadCloudArrayRows<T>(userId: string, table: string): Promise<T[]> {
  const client = getCloudClient();
  const rows: T[] = [];
  let lastId = "";
  while (true) {
    let query = client
      .from(table)
      .select("id,data")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as DataRow<T>[];
    rows.push(...batch.map((row) => row.data));
    if (batch.length < PAGE_SIZE) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;
    if (!lastId) break;
  }
  return rows;
}

async function replaceCloudArrayRows<T>(
  userId: string,
  table: string,
  rows: T[],
  getId: (row: T, index: number) => string
): Promise<void> {
  const client = getCloudClient();
  const payload = rows.map((row, index) => ({
    user_id: userId,
    id: getId(row, index),
    data: row,
    updated_at: new Date().toISOString()
  }));

  if (payload.length > 0) {
    const { error } = await client.from(table).upsert(payload, { onConflict: "user_id,id" });
    if (error) throw error;
  }

  const { data: existingRows, error: selectError } = await client
    .from(table)
    .select("id")
    .eq("user_id", userId);
  if (selectError) throw selectError;

  const keepIds = new Set(payload.map((row) => row.id));
  const staleIds = ((existingRows ?? []) as Array<{ id?: string }>)
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && !keepIds.has(id));
  if (staleIds.length > 0) {
    const { error: deleteError } = await client
      .from(table)
      .delete()
      .eq("user_id", userId)
      .in("id", staleIds);
    if (deleteError) throw deleteError;
  }
}

export async function loadCloudCashClosings(userId: string): Promise<CashClosing[]> {
  return loadCloudArrayRows<CashClosing>(userId, "cash_closings_cloud");
}

export async function saveCloudCashClosings(userId: string, rows: CashClosing[]): Promise<void> {
  await replaceCloudArrayRows(userId, "cash_closings_cloud", rows, (row, index) => row.date || `row-${index + 1}`);
}

export async function loadCloudCashClosingAudit(userId: string): Promise<CashClosingAuditEvent[]> {
  return loadCloudArrayRows<CashClosingAuditEvent>(userId, "cash_closing_audit_cloud");
}

export async function saveCloudCashClosingAudit(userId: string, rows: CashClosingAuditEvent[]): Promise<void> {
  await replaceCloudArrayRows(userId, "cash_closing_audit_cloud", rows, (row, index) => row.id || `row-${index + 1}`);
}

type ModularChargeRunHeaderRow = {
  id: string;
  closing_date: string;
  target_date: string;
  expected_clients: number | string | null;
  charged_clients: number | string | null;
  anomaly_clients: number | string | null;
  charged_total: number | string | null;
  status?: "pending" | "completed" | "reverted" | string | null;
  created_at_text: string;
  reverted_at?: string | null;
  reverted_reason?: string | null;
  reverted_by?: string | null;
};

function isMissingModularChargeRunsSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  return code === "42P01" || code === "PGRST205" || message.includes("charge_run_headers_cloud");
}

function numberFromCloud(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function chargeRunFromHeader(row: ModularChargeRunHeaderRow): ChargeRun {
  return {
    id: row.id,
    closingDate: row.closing_date,
    targetDate: row.target_date,
    expectedClients: numberFromCloud(row.expected_clients),
    chargedClients: numberFromCloud(row.charged_clients),
    anomalyClients: numberFromCloud(row.anomaly_clients),
    chargedTotal: numberFromCloud(row.charged_total),
    createdAt: row.created_at_text,
    status: row.status === "pending" || row.status === "completed" || row.status === "reverted" ? row.status : undefined,
    revertedAt: typeof row.reverted_at === "string" ? row.reverted_at : undefined,
    revertedReason: typeof row.reverted_reason === "string" ? row.reverted_reason : undefined,
    revertedBy: typeof row.reverted_by === "string" ? row.reverted_by : undefined
  };
}

function toChargeRunHeaderPayload(userId: string, run: ChargeRun): Record<string, unknown> {
  return {
    user_id: userId,
    id: run.id,
    closing_date: run.closingDate,
    target_date: run.targetDate,
    expected_clients: run.expectedClients,
    charged_clients: run.chargedClients,
    anomaly_clients: run.anomalyClients,
    charged_total: run.chargedTotal,
    status: run.status ?? null,
    created_at_text: run.createdAt,
    reverted_at: run.revertedAt ?? null,
    reverted_reason: run.revertedReason ?? null,
    reverted_by: run.revertedBy ?? null,
    updated_at: new Date().toISOString()
  };
}

async function loadLegacyCloudChargeRun(userId: string, runId: string): Promise<ChargeRun | null> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("charge_runs_cloud")
    .select("data")
    .eq("user_id", userId)
    .eq("id", runId)
    .maybeSingle();
  if (error) return null;
  const payload = (data as { data?: unknown } | null)?.data;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as ChargeRun
    : null;
}

export async function loadCloudChargeRuns(userId: string): Promise<ChargeRun[]> {
  const client = getCloudClient();
  try {
    const rows: ChargeRun[] = [];
    let lastId = "";
    while (true) {
      let query = client
        .from("charge_run_headers_cloud")
        .select("id,closing_date,target_date,expected_clients,charged_clients,anomaly_clients,charged_total,status,created_at_text,reverted_at,reverted_reason,reverted_by")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (lastId) query = query.gt("id", lastId);
      const { data, error } = await query;
      if (error) throw error;
      const batch = (data ?? []) as ModularChargeRunHeaderRow[];
      rows.push(...batch.map(chargeRunFromHeader));
      if (batch.length < PAGE_SIZE) break;
      lastId = batch[batch.length - 1]?.id ?? lastId;
      if (!lastId) break;
    }
    const legacyRows = await loadCloudArrayRows<ChargeRun>(userId, "charge_runs_cloud").catch(() => []);
    const byId = new Map<string, ChargeRun>();
    for (const run of legacyRows) byId.set(run.id, run);
    for (const run of rows) byId.set(run.id, run);
    return [...byId.values()];
  } catch (error) {
    if (isMissingModularChargeRunsSchema(error)) {
      return loadCloudArrayRows<ChargeRun>(userId, "charge_runs_cloud");
    }
    throw error;
  }
}

export async function loadCloudChargeRunSnapshots(userId: string, runId: string): Promise<CashCloseClientSnapshot[]> {
  const client = getCloudClient();
  try {
    const snapshots: CashCloseClientSnapshot[] = [];
    let lastClientId = "";
    while (true) {
      let query = client
        .from("charge_run_snapshots_cloud")
        .select("client_id,data")
        .eq("user_id", userId)
        .eq("run_id", runId)
        .order("client_id", { ascending: true })
        .limit(PAGE_SIZE);
      if (lastClientId) query = query.gt("client_id", lastClientId);
      const { data, error } = await query;
      if (error) throw error;
      const batch = (data ?? []) as Array<{ client_id?: string; data?: unknown }>;
      snapshots.push(...batch
        .map((row) => row.data)
        .filter((item): item is CashCloseClientSnapshot => Boolean(item) && typeof item === "object" && !Array.isArray(item)));
      if (batch.length < PAGE_SIZE) break;
      lastClientId = batch[batch.length - 1]?.client_id ?? lastClientId;
      if (!lastClientId) break;
    }
    if (snapshots.length > 0) return snapshots;
    return (await loadLegacyCloudChargeRun(userId, runId))?.clientSnapshots ?? [];
  } catch (error) {
    if (!isMissingModularChargeRunsSchema(error)) throw error;
    return (await loadLegacyCloudChargeRun(userId, runId))?.clientSnapshots ?? [];
  }
}

export async function loadCloudChargeRunLateFeeEntryIds(userId: string, runId: string): Promise<string[]> {
  const client = getCloudClient();
  try {
    const entryIds: string[] = [];
    let lastEntryId = "";
    while (true) {
      let query = client
        .from("charge_run_late_fee_entries_cloud")
        .select("entry_id")
        .eq("user_id", userId)
        .eq("run_id", runId)
        .order("entry_id", { ascending: true })
        .limit(PAGE_SIZE);
      if (lastEntryId) query = query.gt("entry_id", lastEntryId);
      const { data, error } = await query;
      if (error) throw error;
      const batch = (data ?? []) as Array<{ entry_id?: string }>;
      entryIds.push(...batch.map((row) => row.entry_id).filter((id): id is string => typeof id === "string"));
      if (batch.length < PAGE_SIZE) break;
      lastEntryId = batch[batch.length - 1]?.entry_id ?? lastEntryId;
      if (!lastEntryId) break;
    }
    if (entryIds.length > 0) return entryIds;
    return (await loadLegacyCloudChargeRun(userId, runId))?.lateFeeEntryIds ?? [];
  } catch (error) {
    if (!isMissingModularChargeRunsSchema(error)) throw error;
    return (await loadLegacyCloudChargeRun(userId, runId))?.lateFeeEntryIds ?? [];
  }
}

export async function loadCloudChargeRunsWithDetails(userId: string): Promise<ChargeRun[]> {
  const runs = await loadCloudChargeRuns(userId);
  return Promise.all(runs.map(async (run) => {
    const [clientSnapshots, lateFeeEntryIds] = await Promise.all([
      loadCloudChargeRunSnapshots(userId, run.id).catch(() => run.clientSnapshots ?? []),
      loadCloudChargeRunLateFeeEntryIds(userId, run.id).catch(() => run.lateFeeEntryIds ?? [])
    ]);
    return {
      ...run,
      clientSnapshots: clientSnapshots.length > 0 ? clientSnapshots : run.clientSnapshots,
      lateFeeEntryIds: lateFeeEntryIds.length > 0 ? lateFeeEntryIds : run.lateFeeEntryIds
    };
  }));
}

export async function saveCloudChargeRuns(userId: string, rows: ChargeRun[]): Promise<void> {
  const client = getCloudClient();
  try {
    const headerRows = rows.map((row) => toChargeRunHeaderPayload(userId, row));

    if (headerRows.length > 0) {
      const { error } = await client
        .from("charge_run_headers_cloud")
        .upsert(headerRows, { onConflict: "user_id,id" });
      if (error) throw error;
    }

    const { data: existingRows, error: selectError } = await client
      .from("charge_run_headers_cloud")
      .select("id")
      .eq("user_id", userId);
    if (selectError) throw selectError;

    const keepIds = new Set(rows.map((row) => row.id));
    const staleIds = ((existingRows ?? []) as Array<{ id?: string }>)
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && !keepIds.has(id));
    if (staleIds.length > 0) {
      const { error: deleteError } = await client
        .from("charge_run_headers_cloud")
        .delete()
        .eq("user_id", userId)
        .in("id", staleIds);
      if (deleteError) throw deleteError;
    }

    for (const run of rows) {
      if (Array.isArray(run.clientSnapshots)) {
        const snapshotRows = run.clientSnapshots.map((snapshot, index) => ({
          user_id: userId,
          run_id: run.id,
          client_id: snapshot.clientId || `row-${index + 1}`,
          data: snapshot,
          updated_at: new Date().toISOString()
        }));
        if (snapshotRows.length > 0) {
          const { error } = await client
            .from("charge_run_snapshots_cloud")
            .upsert(snapshotRows, { onConflict: "user_id,run_id,client_id" });
          if (error) throw error;
        }
        const keepClientIds = new Set(snapshotRows.map((row) => row.client_id));
        const { data: existingSnapshots, error: existingSnapshotsError } = await client
          .from("charge_run_snapshots_cloud")
          .select("client_id")
          .eq("user_id", userId)
          .eq("run_id", run.id);
        if (existingSnapshotsError) throw existingSnapshotsError;
        const staleClientIds = ((existingSnapshots ?? []) as Array<{ client_id?: string }>)
          .map((row) => row.client_id)
          .filter((id): id is string => typeof id === "string" && !keepClientIds.has(id));
        if (staleClientIds.length > 0) {
          const { error } = await client
            .from("charge_run_snapshots_cloud")
            .delete()
            .eq("user_id", userId)
            .eq("run_id", run.id)
            .in("client_id", staleClientIds);
          if (error) throw error;
        }
      }

      if (Array.isArray(run.lateFeeEntryIds)) {
        const entryRows = run.lateFeeEntryIds.map((entryId) => ({
          user_id: userId,
          run_id: run.id,
          entry_id: entryId,
          updated_at: new Date().toISOString()
        }));
        if (entryRows.length > 0) {
          const { error } = await client
            .from("charge_run_late_fee_entries_cloud")
            .upsert(entryRows, { onConflict: "user_id,run_id,entry_id" });
          if (error) throw error;
        }
        const keepEntryIds = new Set(entryRows.map((row) => row.entry_id));
        const { data: existingEntries, error: existingEntriesError } = await client
          .from("charge_run_late_fee_entries_cloud")
          .select("entry_id")
          .eq("user_id", userId)
          .eq("run_id", run.id);
        if (existingEntriesError) throw existingEntriesError;
        const staleEntryIds = ((existingEntries ?? []) as Array<{ entry_id?: string }>)
          .map((row) => row.entry_id)
          .filter((id): id is string => typeof id === "string" && !keepEntryIds.has(id));
        if (staleEntryIds.length > 0) {
          const { error } = await client
            .from("charge_run_late_fee_entries_cloud")
            .delete()
            .eq("user_id", userId)
            .eq("run_id", run.id)
            .in("entry_id", staleEntryIds);
          if (error) throw error;
        }
      }
    }
  } catch (error) {
    if (isMissingModularChargeRunsSchema(error)) {
      await replaceCloudArrayRows(userId, "charge_runs_cloud", rows, (row, index) => row.id || `row-${index + 1}`);
      return;
    }
    throw error;
  }
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
  const rows = evaluations.map((item) => ({
    user_id: userId,
    id: item.id,
    data: item,
    updated_at: item.updatedAt
  }));

  if (rows.length > 0) {
    const { error } = await client
      .from("lead_evaluations_cloud")
      .upsert(rows, { onConflict: "user_id,id" });
    if (error) throw error;
  }
}

export async function saveCloudLeadEvaluation(userId: string, evaluation: LeadEvaluation): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("lead_evaluations_cloud")
    .upsert({
      user_id: userId,
      id: evaluation.id,
      data: evaluation,
      updated_at: evaluation.updatedAt
    }, { onConflict: "user_id,id" });
  if (error) throw error;
}

export async function deleteCloudLeadEvaluation(userId: string, evaluationId: string): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("lead_evaluations_cloud")
    .delete()
    .eq("user_id", userId)
    .eq("id", evaluationId);
  if (error) throw error;
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
      if (!stableEqual(prevRow, nextRow)) {
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

function toControlUnitCloudPayload(input: ControlUnitUpsertInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    user_id: input.user_id,
    unit_id: input.unit_id,
    company: input.company ?? null,
    brand_model: input.brand_model ?? null,
    engine_serial: input.engine_serial ?? null,
    chassis_serial: input.chassis_serial ?? null,
    plate: input.plate ?? null,
    cupo: input.cupo ?? null,
    observation: input.observation ?? null,
    operational_status: input.operational_status ?? null,
    model_year: input.model_year ?? input.year ?? null,
    color: input.color ?? null,
    transmission_type: input.transmission_type ?? input.transmission ?? null,
    mileage: input.mileage ?? input.kilometrage ?? input.kilometraje ?? null
  };
  return payload;
}

export async function saveControlUnit(input: ControlUnitUpsertInput): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("fleet_units_cloud")
    .upsert(toControlUnitCloudPayload(input), { onConflict: "user_id,unit_id" });
  if (error) throw error;
}

export type ControlUnitStatusResult = {
  unit_id?: string;
  status?: string;
  archived_client_ids?: string[];
  updated_client_ids?: string[];
};

function isMissingFleetStatusRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  return record.code === "PGRST202" || message.includes("set_fleet_unit_status");
}

function normalizeFleetStatusForCloud(value: string): string {
  return value.trim().toLowerCase();
}

async function setControlUnitStatusFallback(
  userId: string,
  unitId: string,
  status: string
): Promise<ControlUnitStatusResult> {
  const client = getCloudClient();
  const normalizedUnitId = unitId.trim().toUpperCase();
  const normalizedStatus = normalizeFleetStatusForCloud(status);
  const now = new Date().toISOString();
  const { error } = await client
    .from("fleet_units_cloud")
    .update({ operational_status: normalizedStatus, updated_at: now })
    .eq("user_id", userId)
    .eq("unit_id", normalizedUnitId);
  if (error) throw error;

  const result: ControlUnitStatusResult = {
    unit_id: normalizedUnitId,
    status: normalizedStatus,
    archived_client_ids: [],
    updated_client_ids: []
  };

  try {
    const { data: linkedClients, error: loadError } = await client
      .from("clients_cloud")
      .select("id,data")
      .eq("user_id", userId);
    if (loadError) throw loadError;

    const matchingClients = ((linkedClients ?? []) as Array<{ id: string; data: Record<string, unknown> }>)
      .filter((row) => {
        const clientUnitId = String(row.data?.unitId ?? "").trim().toUpperCase();
        const clientStatus = String(row.data?.status ?? "activo").trim().toLowerCase();
        return clientUnitId === normalizedUnitId && clientStatus !== "archivado";
      });
    if (matchingClients.length === 0) return result;

    const nextRows = matchingClients.map((row) => {
      const nextData = { ...row.data };
      if (normalizedStatus === "libre" || normalizedStatus === "archivado") {
        nextData.status = "archivado";
        nextData.archivedAt = now;
        nextData.statusComment = `Archivado automaticamente al cambiar la unidad ${normalizedUnitId} a ${normalizedStatus.toUpperCase()} desde Autos.`;
        result.archived_client_ids?.push(row.id);
      } else {
        nextData.status = normalizedStatus;
        if (normalizedStatus === "activo") {
          delete nextData.archivedAt;
          delete nextData.statusComment;
        } else {
          nextData.statusComment = `Estado actualizado automaticamente desde Autos para unidad ${normalizedUnitId}.`;
        }
        result.updated_client_ids?.push(row.id);
      }
      return {
        user_id: userId,
        id: row.id,
        data: nextData,
        updated_at: now
      };
    });

    const { error: saveError } = await client
      .from("clients_cloud")
      .upsert(nextRows, { onConflict: "user_id,id" });
    if (saveError) throw saveError;
  } catch (syncError) {
    console.warn("No se pudo sincronizar cliente enlazado desde fallback de Autos.", syncError);
  }

  return result;
}

export async function setControlUnitStatus(
  userId: string,
  unitId: string,
  status: string
): Promise<ControlUnitStatusResult> {
  const client = getCloudClient();
  const { data, error } = await client.rpc("set_fleet_unit_status", {
    p_owner_user_id: userId,
    p_unit_id: unitId,
    p_status: status
  });
  if (error) {
    if (isMissingFleetStatusRpc(error)) {
      return setControlUnitStatusFallback(userId, unitId, status);
    }
    throw error;
  }
  return (data && typeof data === "object" && !Array.isArray(data))
    ? data as ControlUnitStatusResult
    : {};
}
