import type { Client, Payment } from "../types";
import { dedupeLoad, getCloudClient, hasRowChanged, PAGE_SIZE, withCloudRetry, type DataRow } from "./cloudClient";

const BANK_PAYMENT_METHODS = new Set(["ACH Express", "Deposito Bancario", "Transferencia Bancaria"]);

type PaymentDataRow = DataRow<Payment> & { updated_at?: string | null };
type LatestPaymentByClientRow = {
  client_id?: string | null;
  payment_id?: string | null;
  data?: Payment | null;
};
export type CloudLatestPaymentTarget = {
  clientId: string;
  unitId: string;
  name: string;
  cedula?: string;
};

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

function isCloudStatementTimeout(error: unknown): boolean {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === "string"
    ? record.message
    : "";
  const details = typeof record?.details === "string" ? record.details : "";
  const normalized = `${code} ${message} ${details}`.toLowerCase();
  return code === "57014" || normalized.includes("statement timeout") || normalized.includes("canceling statement");
}

function getPaymentSortTime(row: PaymentDataRow): number {
  const value = row.updated_at ?? row.data?.createdAt ?? "";
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareRecentPaymentRows(left: PaymentDataRow, right: PaymentDataRow): number {
  return getPaymentSortTime(right) - getPaymentSortTime(left);
}

async function runCloudPaymentQuery<T>(
  queryFactory: () => PromiseLike<{ data: T | null; error: unknown }>
): Promise<T> {
  const { data } = await withCloudRetry(async () => {
    const result = await queryFactory();
    if (result.error) throw result.error;
    return result;
  });
  return data as T;
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
    normalized.includes("function public.register_client_payment_delta") ||
    normalized.includes("function register_client_payment_delta") ||
    normalized.includes("function public.register_client_payment_deltas") ||
    normalized.includes("function register_client_payment_deltas") ||
    normalized.includes("function public.next_receipt_numbers") ||
    normalized.includes("function next_receipt_numbers")
  );
}

function isMissingLatestPaymentsTableError(error: unknown): boolean {
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
    code === "42P01" ||
    code === "PGRST205" ||
    normalized.includes("latest_payments_by_client_cloud") ||
    normalized.includes("could not find the table")
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
  let rows: PaymentDataRow[];
  try {
    rows = await runCloudPaymentQuery(() => client
      .from("payments_cloud")
      .select("id,data,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .range(offset, to)) as PaymentDataRow[];
  } catch (error) {
    if (!isCloudStatementTimeout(error)) throw error;
    rows = (await loadCloudPaymentRowsByIdScan(userId))
      .sort(compareRecentPaymentRows)
      .slice(offset, offset + limit);
  }
  return rows.map((row) => row.data);
}

export async function loadCloudPaymentsRecent(userId: string, limit = 300): Promise<Payment[]> {
  const safeLimit = Math.max(1, Math.min(PAGE_SIZE, Math.floor(limit)));
  return dedupeLoad(`payments-recent:${userId}:${safeLimit}`, () => loadCloudPaymentsRecentUncached(userId, safeLimit));
}

async function loadCloudPaymentsRecentUncached(userId: string, safeLimit: number): Promise<Payment[]> {
  const client = getCloudClient();
  let rows: PaymentDataRow[];
  try {
    rows = await runCloudPaymentQuery(() => client
      .from("payments_cloud")
      .select("id,data,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .range(0, safeLimit - 1)) as PaymentDataRow[];
  } catch (error) {
    if (!isCloudStatementTimeout(error)) throw error;
    rows = (await loadCloudPaymentRowsByIdScan(userId))
      .sort(compareRecentPaymentRows)
      .slice(0, safeLimit);
  }
  return rows.map((row) => row.data);
}

function comparePaymentDateDesc(left: Payment, right: Payment): number {
  const byAppliedDate = right.dateApplied.localeCompare(left.dateApplied);
  if (byAppliedDate !== 0) return byAppliedDate;
  return right.createdAt.localeCompare(left.createdAt);
}

function chunkValues<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function normalizePaymentLookupText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizePaymentLookupUnit(value: string | undefined): string {
  return normalizePaymentLookupText(value).replace(/[^a-z0-9]/g, "");
}

function normalizePaymentLookupCedula(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function paymentMatchesTargetIdentity(payment: Payment, target: CloudLatestPaymentTarget): boolean {
  if (payment.clientId === target.clientId) return true;
  if (normalizePaymentLookupUnit(payment.clientUnit) !== normalizePaymentLookupUnit(target.unitId)) return false;
  const targetCedula = normalizePaymentLookupCedula(target.cedula);
  const paymentCedula = normalizePaymentLookupCedula(payment.clientCedula);
  if (targetCedula && paymentCedula && targetCedula === paymentCedula) return true;
  return normalizePaymentLookupText(payment.clientName) === normalizePaymentLookupText(target.name);
}

export async function loadCloudLatestPaymentsForReceivableTargets(userId: string, targets: CloudLatestPaymentTarget[]): Promise<Payment[]> {
  const uniqueTargets = [...new Map(
    targets
      .filter((target) => target.clientId.trim().length > 0)
      .map((target) => [target.clientId, target])
  ).values()];
  if (uniqueTargets.length === 0) return [];

  const client = getCloudClient();
  const latestByClientId = new Map<string, Payment>();
  function mergeRows(rows: DataRow<Payment>[], targets: CloudLatestPaymentTarget[]): void {
    const targetByClientId = new Map(targets.map((target) => [target.clientId, target]));
    for (const row of rows) {
      const payment = row.data;
      if (!payment) continue;
      const directTarget = targetByClientId.get(payment.clientId);
      const target = directTarget && paymentMatchesTargetIdentity(payment, directTarget)
      ? directTarget
      : targets.find((item) => paymentMatchesTargetIdentity(payment, item));
      if (!target) continue;
      const current = latestByClientId.get(target.clientId);
      if (!current || comparePaymentDateDesc(payment, current) < 0) latestByClientId.set(target.clientId, payment);
    }
  }

  async function loadFromLatestPaymentsTable(targets: CloudLatestPaymentTarget[]): Promise<boolean> {
    try {
      for (const chunk of chunkValues(targets, 100)) {
        const clientIds = chunk.map((target) => target.clientId);
        const rows = await runCloudPaymentQuery(() => client
          .from("latest_payments_by_client_cloud")
          .select("client_id,payment_id,data")
          .eq("user_id", userId)
          .in("client_id", clientIds)) as LatestPaymentByClientRow[];
        const targetByClientId = new Map(chunk.map((target) => [target.clientId, target]));
        for (const row of rows) {
          const clientId = row.client_id ?? row.data?.clientId ?? "";
          const target = targetByClientId.get(clientId);
          const payment = row.data ?? null;
          if (!target || !payment || !paymentMatchesTargetIdentity(payment, target)) continue;
          const current = latestByClientId.get(target.clientId);
          if (!current || comparePaymentDateDesc(payment, current) < 0) latestByClientId.set(target.clientId, payment);
        }
      }
      return true;
    } catch (error) {
      if (isMissingLatestPaymentsTableError(error)) return false;
      throw error;
    }
  }

  await loadFromLatestPaymentsTable(uniqueTargets);
  if (latestByClientId.size === uniqueTargets.length) return [...latestByClientId.values()];

  for (const chunk of chunkValues(uniqueTargets, 50)) {
    const missingChunk = chunk.filter((target) => !latestByClientId.has(target.clientId));
    if (missingChunk.length === 0) continue;
    const clientIds = missingChunk.map((target) => target.clientId);
    let lastId = "";
    while (true) {
      let query = client
        .from("payments_cloud")
        .select("id,data")
        .eq("user_id", userId)
        .in("data->>clientId", clientIds)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (lastId) query = query.gt("id", lastId);

      const rows = await runCloudPaymentQuery(() => query) as DataRow<Payment>[];
      mergeRows(rows, missingChunk);
      if (rows.length < PAGE_SIZE) break;
      lastId = rows[rows.length - 1]?.id ?? lastId;
      if (!lastId) break;
    }
  }

  return [...latestByClientId.values()];
}

export async function loadCloudLatestPaymentsForClients(userId: string, clientIds: string[]): Promise<Payment[]> {
  return loadCloudLatestPaymentsForReceivableTargets(
    userId,
    clientIds.map((clientId) => ({ clientId, unitId: "", name: "" }))
  );
}

async function loadCloudPaymentRowsByIdScan(userId: string): Promise<PaymentDataRow[]> {
  const client = getCloudClient();
  const allRows: PaymentDataRow[] = [];
  let lastId = "";
  while (true) {
    let query = client
      .from("payments_cloud")
      .select("id,data,updated_at")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (lastId) query = query.gt("id", lastId);
    const batch = await runCloudPaymentQuery(() => query) as PaymentDataRow[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    lastId = batch[batch.length - 1]?.id ?? lastId;
    if (!lastId) break;
  }
  return allRows;
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
}

type PaymentDeltaGroup = {
  clientId: string;
  previousClient: Client;
  nextClient: Client;
  payments: Payment[];
};

function getNumericPaymentTime(payment: Payment): number {
  const value = new Date(payment.createdAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

function buildPaymentDeltaGroups(
  previousClients: Client[],
  nextClients: Client[],
  previousPayments: Payment[],
  nextPayments: Payment[]
): PaymentDeltaGroup[] {
  const previousPaymentIds = new Set(previousPayments.map((payment) => payment.id));
  const newPayments = nextPayments
    .filter((payment) => !previousPaymentIds.has(payment.id))
    .sort((left, right) => getNumericPaymentTime(left) - getNumericPaymentTime(right));
  if (newPayments.length === 0) return [];

  const previousClientsById = new Map(previousClients.map((client) => [client.id, client]));
  const nextClientsById = new Map(nextClients.map((client) => [client.id, client]));
  const groupsByClient = new Map<string, PaymentDeltaGroup>();

  for (const payment of newPayments) {
    const previousClient = previousClientsById.get(payment.clientId);
    const nextClient = nextClientsById.get(payment.clientId);
    if (!previousClient || !nextClient) {
      throw new Error("No se pudo preparar delta de pago: cliente no encontrado.");
    }

    const existingGroup = groupsByClient.get(payment.clientId);
    if (existingGroup) {
      existingGroup.payments.push(payment);
    } else {
      groupsByClient.set(payment.clientId, {
        clientId: payment.clientId,
        previousClient,
        nextClient,
        payments: [payment]
      });
    }
  }

  return [...groupsByClient.values()];
}

export async function registerCloudPaymentDeltas(
  userId: string,
  previousClients: Client[],
  nextClients: Client[],
  previousPayments: Payment[],
  nextPayments: Payment[]
): Promise<void> {
  const client = getCloudClient();
  const groups = buildPaymentDeltaGroups(previousClients, nextClients, previousPayments, nextPayments);
  if (groups.length === 0) return;

  for (const group of groups) {
    const firstPayment = group.payments[0];
    const expectedBalanceBefore = firstPayment?.balanceBefore ?? group.previousClient.balance;
    const { error } = await withCloudRetry(() =>
      client.rpc("register_client_payment_deltas", {
        p_owner_user_id: userId,
        p_client_id: group.clientId,
        p_expected_balance_before: expectedBalanceBefore,
        p_next_client: group.nextClient,
        p_payments: group.payments
      })
    );
    if (error) throw error;
  }
}

export async function deleteCloudPayment(userId: string, paymentId: string): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("payments_cloud")
    .delete()
    .eq("user_id", userId)
    .eq("id", paymentId);
  if (error) throw error;
}

export async function deleteCloudPayments(userId: string, paymentIds: string[]): Promise<void> {
  if (paymentIds.length === 0) return;
  const client = getCloudClient();
  const { error } = await client
    .from("payments_cloud")
    .delete()
    .eq("user_id", userId)
    .in("id", paymentIds);
  if (error) throw error;
}

export async function syncCloudPaymentsDelta(
  userId: string,
  previousPayments: Payment[],
  nextPayments: Payment[]
): Promise<void> {
  const client = getCloudClient();
  const prevById = new Map(previousPayments.map((item) => [item.id, item]));
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
}
