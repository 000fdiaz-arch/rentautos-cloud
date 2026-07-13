import type { Payment } from "../types";
import { chunkIds, dedupeLoad, deleteStaleRows, getCloudClient, hasRowChanged, PAGE_SIZE, withCloudRetry, type DataRow } from "./cloudClient";

const BANK_PAYMENT_METHODS = new Set(["ACH Express", "Deposito Bancario", "Transferencia Bancaria"]);

function normalizeCloudFolioToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function extractCloudFoliosFromReference(reference: unknown): string[] {
  if (typeof reference !== "string") return [];
  const normalized = reference
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const taggedFolios = Array.from(normalized.matchAll(/FOLIO\s*:\s*([^\s|]+)/gi))
    .map((match) => normalizeCloudFolioToken(match[1] ?? ""))
    .filter((folio) => folio.length > 0);
  if (taggedFolios.length > 0) return [...new Set(taggedFolios)];

  const legacyFallback = normalizeCloudFolioToken(
    normalized
      .replace(/^REFERENCIA\s*:\s*/i, "")
      .replace(/^REF\s*:\s*/i, "")
      .replace(/^FOLIO\s*:?/i, "")
  );
  return legacyFallback ? [legacyFallback] : [];
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
  const client = getCloudClient();
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

function isMissingRpcFunctionError(error: unknown): boolean {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === "string"
    ? record.message
    : "";
  const details = typeof record?.details === "string" ? record.details : "";
  const normalized = `${code} ${message} ${details}`.toLowerCase();
  return (
    code === "PGRST202" ||
    normalized.includes("could not find the function") ||
    normalized.includes("function public.find_existing_processed_payment_folios") ||
    normalized.includes("function find_existing_processed_payment_folios") ||
    normalized.includes("function public.next_receipt_numbers") ||
    normalized.includes("function next_receipt_numbers")
  );
}
export async function loadCloudPayments(userId: string): Promise<Payment[]> {
  return dedupeLoad(`payments:${userId}`, () => loadCloudPaymentsUncached(userId));
}

async function loadCloudPaymentsUncached(userId: string): Promise<Payment[]> {
  const client = getCloudClient();
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
  const client = getCloudClient();
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
  const client = getCloudClient();
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

export async function loadCloudProcessedPaymentFolios(userId: string, candidateFolios?: Iterable<string>): Promise<Set<string>> {
  const client = getCloudClient();
  const requestedFolios = candidateFolios
    ? [...new Set([...candidateFolios].map(normalizeCloudFolioToken).filter((folio) => folio.length > 0))]
    : [];
  if (requestedFolios.length > 0) {
    try {
      const { data, error } = await client.rpc("find_existing_processed_payment_folios", {
        p_owner_user_id: userId,
        p_folios: requestedFolios
      });
      if (error) throw error;
      return new Set(
        (Array.isArray(data) ? data : [])
          .map((folio) => normalizeCloudFolioToken(String(folio ?? "")))
          .filter((folio) => folio.length > 0)
      );
    } catch (error) {
      if (!isMissingRpcFunctionError(error)) throw error;
      console.warn("Validacion rapida de folios no disponible; usando validacion historica.", error);
    }
  }

  const folios = new Set<string>();
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
    for (const row of batch) {
      const reference = row.data?.reference ?? "";
      const isBankPayment = BANK_PAYMENT_METHODS.has(row.data?.paymentMethod ?? "");
      const isReconciledCardPayment =
        row.data?.paymentMethod === "Tarjeta" &&
        reference.toUpperCase().includes("TARJETA-CONCILIADA");
      if (!isBankPayment && !isReconciledCardPayment) continue;
      for (const folio of extractCloudFoliosFromReference(reference)) {
        folios.add(folio);
      }
    }
    if (batch.length < PAGE_SIZE) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;
    if (!lastId) break;
  }
  return folios;
}

async function reserveLegacyCloudReceiptNumber(userId: string, minimumSeq: number): Promise<string> {
  const client = getCloudClient();
  const { data, error } = await client.rpc("next_receipt_number", {
    p_owner_user_id: userId
  });
  if (error) throw error;
  if (typeof data !== "string" || data.trim().length === 0) {
    throw new Error("Supabase no devolvio numero de recibo.");
  }
  const reservedReceipt = data.trim().toUpperCase();
  const reservedSeq = parseReceiptSequence(reservedReceipt);
  if (reservedSeq === null) return reservedReceipt;
  return formatReceiptSequence(Math.max(reservedSeq, minimumSeq));
}

async function loadReceiptSequenceForReservation(userId: string): Promise<number> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("receipt_sequences_cloud")
    .select("seq")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const seq = Number((data as { seq?: unknown } | null)?.seq ?? 0);
  if (Number.isFinite(seq) && seq > 0) return Math.floor(seq);

  // Bootstrap only. Existing production users should already have this row,
  // so normal payment registration avoids scanning the full payment history.
  return loadCloudMaxReceiptSequence(userId);
}

async function saveReceiptSequence(userId: string, seq: number): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("receipt_sequences_cloud")
    .upsert({
      user_id: userId,
      seq: Math.max(0, Math.floor(seq)),
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function reserveCloudReceiptNumber(userId: string): Promise<string> {
  const [receiptNumber] = await reserveCloudReceiptNumbers(userId, 1);
  if (!receiptNumber) throw new Error("Supabase no devolvio numero de recibo.");
  return receiptNumber;
}

async function reserveCloudReceiptNumbersFromSequence(userId: string, count: number): Promise<string[]> {
  const safeCount = Math.max(1, Math.min(500, Math.floor(count)));
  const currentSeq = await loadReceiptSequenceForReservation(userId);
  const firstSeq = currentSeq + 1;
  const lastSeq = currentSeq + safeCount;
  await saveReceiptSequence(userId, lastSeq);
  const receipts: string[] = [];
  for (let seq = firstSeq; seq <= lastSeq; seq += 1) {
    receipts.push(formatReceiptSequence(seq));
  }
  return receipts;
}

export async function reserveCloudReceiptNumbers(userId: string, count: number): Promise<string[]> {
  const safeCount = Math.max(1, Math.min(500, Math.floor(count)));
  try {
    return await reserveCloudReceiptNumbersFromSequence(userId, safeCount);
  } catch (sequenceError) {
    console.warn("No se pudo reservar recibo desde secuencia rapida; usando RPC legacy.", sequenceError);
  }

  const client = getCloudClient();
  const { data, error } = await withCloudRetry(() =>
    client.rpc("next_receipt_numbers", {
      p_owner_user_id: userId,
      p_count: safeCount
    })
  );
  if (error) {
    if (!isMissingRpcFunctionError(error)) throw error;
    const receipts: string[] = [];
    let minimumSeq = (await loadCloudMaxReceiptSequence(userId)) + 1;
    for (let index = 0; index < safeCount; index += 1) {
      const receipt = await reserveLegacyCloudReceiptNumber(userId, minimumSeq);
      receipts.push(receipt);
      minimumSeq = (parseReceiptSequence(receipt) ?? minimumSeq) + 1;
    }
    return receipts;
  }
  if (!Array.isArray(data)) {
    throw new Error("Supabase no devolvio numeros de recibo.");
  }
  let receipts = data
    .map((value) => String(value ?? "").trim().toUpperCase())
    .filter((value) => value.length > 0);
  if (receipts.length !== safeCount) {
    throw new Error("Supabase devolvio una cantidad incorrecta de recibos.");
  }
  const maxExistingSeq = await loadCloudMaxReceiptSequence(userId);
  let nextSafeSeq = maxExistingSeq + 1;
  receipts = receipts.map((receipt) => {
    const reservedSeq = parseReceiptSequence(receipt);
    if (reservedSeq === null) return receipt;
    const safeSeq = Math.max(reservedSeq, nextSafeSeq);
    nextSafeSeq = safeSeq + 1;
    return formatReceiptSequence(safeSeq);
  });
  return receipts;
}

export async function saveCloudPayments(userId: string, payments: Payment[]): Promise<void> {
  const client = getCloudClient();
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
  const client = getCloudClient();
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
    const { error } = await withCloudRetry(() =>
      client
        .from("payments_cloud")
        .upsert(upsertRows, { onConflict: "user_id,id" })
    );
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
