import { supabase } from "./lib/supabase";

export type CashSummary = {
  opening_date: string;
  opening_balance: number;
  income_total: number;
  expense_total: number;
  adjustment_income_total: number;
  adjustment_expense_total: number;
  expected_balance: number;
  counted_balance: number | null;
  difference_balance: number | null;
  status: "open" | "closed";
  closed_at: string | null;
};

export type CashMovementRecord = {
  id: string;
  opening_date: string;
  movement_type: "income" | "expense";
  category: string;
  amount: number;
  description: string | null;
  reference: string | null;
};

export type CashAuditRecord = {
  id: number;
  opening_date: string | null;
  table_name: string;
  action: string;
  created_at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

export type CashCountRecord = {
  id: string;
  opening_date: string;
  denomination_type: "coin" | "bill";
  denomination_value: number;
  qty: number;
};

function ensureSupabase() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

async function resolveOwnerUserId(explicitOwnerUserId?: string | null): Promise<string> {
  if (explicitOwnerUserId && explicitOwnerUserId.length > 0) return explicitOwnerUserId;
  const client = ensureSupabase();
  const { data, error } = await client.rpc("current_data_owner_user_id");
  if (error || !data) throw error ?? new Error("No se pudo resolver owner_user_id para caja.");
  return data as string;
}

export async function openCashDay(date: string, seedOpeningBalance?: number | null, note?: string): Promise<void> {
  const client = ensureSupabase();
  const { error } = await client.rpc("open_cash_day", {
    p_opening_date: date,
    p_seed_opening_balance: seedOpeningBalance ?? null,
    p_note: note ?? null
  });
  if (error) throw error;
}

export async function closeCashDay(date: string, countedBalance: number, note?: string): Promise<void> {
  const client = ensureSupabase();
  const { error } = await client.rpc("close_cash_day", {
    p_opening_date: date,
    p_counted_balance: countedBalance,
    p_close_note: note ?? null
  });
  if (error) throw error;
}

export async function reopenCashDay(date: string, note: string): Promise<void> {
  const client = ensureSupabase();
  const { error } = await client.rpc("reopen_cash_day", {
    p_opening_date: date,
    p_reopen_note: note
  });
  if (error) throw error;
}

export async function loadCashSummary(date: string, ownerUserId?: string | null): Promise<CashSummary | null> {
  const client = ensureSupabase();
  let query = client.from("cash_day_summary_vw").select("*").eq("opening_date", date).limit(1);
  if (ownerUserId) query = query.eq("owner_user_id", ownerUserId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as CashSummary | null) ?? null;
}

export async function loadCashMovements(date: string, ownerUserId?: string | null): Promise<CashMovementRecord[]> {
  const client = ensureSupabase();
  let query = client
    .from("cash_day_movements")
    .select("id, opening_date, movement_type, category, amount, description, reference")
    .eq("opening_date", date)
    .order("created_at", { ascending: true });

  if (ownerUserId) query = query.eq("owner_user_id", ownerUserId);

  const { data, error } = await query;
  if (error) throw error;
  return (data as CashMovementRecord[]) ?? [];
}

export async function replaceCashMovements(
  date: string,
  rows: Array<{
    movement_type: "income" | "expense";
    category: string;
    amount: number;
    description?: string;
    reference?: string;
  }>,
  ownerUserId?: string | null
): Promise<void> {
  const client = ensureSupabase();
  const ownerUserIdResolved = await resolveOwnerUserId(ownerUserId);
  let del = client.from("cash_day_movements").delete().eq("opening_date", date);
  del = del.eq("owner_user_id", ownerUserIdResolved);
  const { error: delError } = await del;
  if (delError) throw delError;

  if (rows.length === 0) return;

  const payload = rows.map((row) => ({
    owner_user_id: ownerUserIdResolved,
    opening_date: date,
    movement_type: row.movement_type,
    category: row.category,
    amount: row.amount,
    description: row.description?.trim() || null,
    reference: row.reference?.trim() || null
  }));

  const { error: insError } = await client.from("cash_day_movements").insert(payload);
  if (insError) throw insError;
}

export async function loadCashSummaryRange(
  dateFrom: string,
  dateTo: string,
  ownerUserId?: string | null
): Promise<CashSummary[]> {
  const client = ensureSupabase();
  let query = client
    .from("cash_day_summary_vw")
    .select("*")
    .gte("opening_date", dateFrom)
    .lte("opening_date", dateTo)
    .order("opening_date", { ascending: false });
  if (ownerUserId) query = query.eq("owner_user_id", ownerUserId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as CashSummary[]) ?? [];
}

export async function loadCashAudit(date: string, ownerUserId?: string | null): Promise<CashAuditRecord[]> {
  const client = ensureSupabase();
  let query = client
    .from("cash_audit_log")
    .select("id, opening_date, table_name, action, created_at, old_data, new_data")
    .eq("opening_date", date)
    .order("created_at", { ascending: false })
    .limit(30);
  if (ownerUserId) query = query.eq("owner_user_id", ownerUserId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as CashAuditRecord[]) ?? [];
}

export async function loadCashCounts(date: string, ownerUserId?: string | null): Promise<CashCountRecord[]> {
  const client = ensureSupabase();
  let query = client
    .from("cash_day_counts")
    .select("id, opening_date, denomination_type, denomination_value, qty")
    .eq("opening_date", date)
    .order("denomination_type", { ascending: true })
    .order("denomination_value", { ascending: true });
  if (ownerUserId) query = query.eq("owner_user_id", ownerUserId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as CashCountRecord[]) ?? [];
}

export async function replaceCashCounts(
  date: string,
  rows: Array<{
    denomination_type: "coin" | "bill";
    denomination_value: number;
    qty: number;
  }>,
  ownerUserId?: string | null
): Promise<void> {
  const client = ensureSupabase();
  const ownerUserIdResolved = await resolveOwnerUserId(ownerUserId);
  let del = client.from("cash_day_counts").delete().eq("opening_date", date);
  del = del.eq("owner_user_id", ownerUserIdResolved);
  const { error: delError } = await del;
  if (delError) throw delError;

  if (rows.length === 0) return;

  const payload = rows
    .filter((row) => row.qty > 0)
    .map((row) => ({
      owner_user_id: ownerUserIdResolved,
      opening_date: date,
      denomination_type: row.denomination_type,
      denomination_value: row.denomination_value,
      qty: row.qty
    }));

  if (payload.length === 0) return;
  const { error: insError } = await client.from("cash_day_counts").insert(payload);
  if (insError) throw insError;
}
