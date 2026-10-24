import type { PendingBankItem } from "../types";
import { getCloudClient, PAGE_SIZE, type DataRow } from "./cloudClient";

export type InsuranceBankPaymentStatus = "pending" | "linked";

export type InsuranceBankPaymentRecord = {
  id: string;
  bankItem: PendingBankItem;
  status: InsuranceBankPaymentStatus;
  claimId?: string;
  forwardedAt: string;
  forwardedBy?: string;
  forwardedByLabel?: string;
  linkedAt?: string;
  linkedBy?: string;
  updatedAt: string;
};

function normalizeRecord(value: unknown): InsuranceBankPaymentRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<InsuranceBankPaymentRecord>;
  const bankItem = raw.bankItem;
  if (
    typeof raw.id !== "string" || !raw.id.trim()
    || !bankItem || typeof bankItem !== "object"
    || typeof bankItem.folio !== "string"
    || typeof bankItem.amountReceived !== "number"
  ) return null;
  return {
    id: raw.id,
    bankItem,
    status: raw.status === "linked" ? "linked" : "pending",
    claimId: typeof raw.claimId === "string" && raw.claimId.trim() ? raw.claimId : undefined,
    forwardedAt: typeof raw.forwardedAt === "string" ? raw.forwardedAt : bankItem.importedAt,
    forwardedBy: typeof raw.forwardedBy === "string" ? raw.forwardedBy : undefined,
    forwardedByLabel: typeof raw.forwardedByLabel === "string" ? raw.forwardedByLabel : undefined,
    linkedAt: typeof raw.linkedAt === "string" ? raw.linkedAt : undefined,
    linkedBy: typeof raw.linkedBy === "string" ? raw.linkedBy : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : bankItem.importedAt
  };
}

export async function loadInsuranceBankPayments(userId: string): Promise<InsuranceBankPaymentRecord[]> {
  const client = getCloudClient();
  const rows: DataRow<InsuranceBankPaymentRecord>[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from("insurance_bank_payments_cloud")
      .select("id,data")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as DataRow<InsuranceBankPaymentRecord>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows
    .map((row) => normalizeRecord(row.data))
    .filter((record): record is InsuranceBankPaymentRecord => record !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadCloudPendingBankItems(userId: string): Promise<PendingBankItem[]> {
  const client = getCloudClient();
  const rows: DataRow<PendingBankItem>[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from("pending_bank_items_cloud")
      .select("id,data")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as DataRow<PendingBankItem>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows
    .map((row) => row.data)
    .filter((item) => item && typeof item.folio === "string" && typeof item.amountReceived === "number");
}

export async function forwardBankItemsToInsurance(
  userId: string,
  items: PendingBankItem[],
  actorLabel: string
): Promise<InsuranceBankPaymentRecord[]> {
  const client = getCloudClient();
  const { data, error } = await client.rpc("forward_bank_items_to_insurance", {
    p_owner_user_id: userId,
    p_items: items,
    p_actor_label: actorLabel
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : [])
    .map(normalizeRecord)
    .filter((record): record is InsuranceBankPaymentRecord => record !== null);
}

export async function setInsuranceBankPaymentClaim(
  userId: string,
  paymentId: string,
  claimId: string | null
): Promise<InsuranceBankPaymentRecord> {
  const client = getCloudClient();
  const { data, error } = await client.rpc("set_insurance_bank_payment_claim", {
    p_owner_user_id: userId,
    p_payment_id: paymentId,
    p_claim_id: claimId
  });
  if (error) throw error;
  const normalized = normalizeRecord(data);
  if (!normalized) throw new Error("Seguros devolvió un pago bancario inválido.");
  return normalized;
}

export async function returnInsuranceBankPaymentToPayments(
  userId: string,
  paymentId: string
): Promise<PendingBankItem> {
  const client = getCloudClient();
  const { data, error } = await client.rpc("return_insurance_bank_payment_to_payments", {
    p_owner_user_id: userId,
    p_payment_id: paymentId
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || typeof data.folio !== "string" || typeof data.amountReceived !== "number") {
    throw new Error("No se pudo recuperar el movimiento bancario devuelto.");
  }
  return data as PendingBankItem;
}
