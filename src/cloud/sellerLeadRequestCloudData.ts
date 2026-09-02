import type { PublicSellerLeadRequest, SellerLeadRequest, SellerLeadRequestStatus } from "../types";
import { createEphemeralSupabaseClient } from "../lib/supabase";
import { getCloudClient } from "./cloudClient";

type SellerLeadRequestRow = {
  id: string;
  user_id: string;
  token: string;
  status: SellerLeadRequestStatus;
  cedula: string | null;
  birth_date: string | null;
  attachment_name: string | null;
  attachment_data_url: string | null;
  correction_note: string | null;
  evaluation_id: string | null;
  expires_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: SellerLeadRequestRow): SellerLeadRequest {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    status: row.status,
    cedula: row.cedula ?? "",
    birthDate: row.birth_date ?? "",
    attachmentName: row.attachment_name ?? undefined,
    attachmentDataUrl: row.attachment_data_url ?? undefined,
    correctionNote: row.correction_note ?? undefined,
    evaluationId: row.evaluation_id ?? undefined,
    expiresAt: row.expires_at,
    submittedAt: row.submitted_at ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const requestColumns = "id,user_id,token,status,cedula,birth_date,attachment_name,attachment_data_url,correction_note,evaluation_id,expires_at,submitted_at,reviewed_at,created_at,updated_at";

export async function loadSellerLeadRequests(userId: string): Promise<SellerLeadRequest[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("seller_lead_requests")
    .select(requestColumns)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as SellerLeadRequestRow[]).map(fromRow);
}

export async function createSellerLeadRequest(userId: string): Promise<SellerLeadRequest> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("seller_lead_requests")
    .insert({ user_id: userId })
    .select(requestColumns)
    .single();
  if (error) throw error;
  return fromRow(data as SellerLeadRequestRow);
}

export async function markSellerLeadRequestIncomplete(requestId: string, correctionNote: string): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("seller_lead_requests")
    .update({ status: "incomplete", correction_note: correctionNote, updated_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) throw error;
}

export async function markSellerLeadRequestReviewed(requestId: string, evaluationId: string): Promise<void> {
  const client = getCloudClient();
  const now = new Date().toISOString();
  const { error } = await client
    .from("seller_lead_requests")
    .update({ status: "reviewed", evaluation_id: evaluationId, correction_note: null, reviewed_at: now, updated_at: now })
    .eq("id", requestId);
  if (error) throw error;
}

function normalizePublicPayload(value: unknown): PublicSellerLeadRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("La solicitud no existe o el enlace no es valido.");
  const raw = value as Record<string, unknown>;
  const status = String(raw.status ?? "") as PublicSellerLeadRequest["status"];
  if (!["waiting_information", "pending_review", "incomplete", "reviewed", "expired", "not_found"].includes(status)) {
    throw new Error("La solicitud no existe o el enlace no es valido.");
  }
  const decision = raw.decision === "aplica" || raw.decision === "aplica_con_abono" || raw.decision === "no_aplica"
    ? raw.decision
    : undefined;
  return {
    status,
    cedula: typeof raw.cedula === "string" ? raw.cedula : "",
    birthDate: typeof raw.birthDate === "string" ? raw.birthDate : "",
    attachmentName: typeof raw.attachmentName === "string" ? raw.attachmentName : undefined,
    correctionNote: typeof raw.correctionNote === "string" ? raw.correctionNote : undefined,
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : "",
    decision,
    extraDeposit: typeof raw.extraDeposit === "number" ? raw.extraDeposit : undefined,
    reviewedAt: typeof raw.reviewedAt === "string" ? raw.reviewedAt : undefined
  };
}

// One stable, public portal identifier per dataset; never expose request tokens here.
export async function getSellerLeadPortalId(userId: string): Promise<string> {
  const { data, error } = await getCloudClient().rpc("get_or_create_seller_lead_portal", { p_user_id: userId });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("No se pudo obtener el enlace público.");
  return data;
}

function publicPortalError(error: { message?: string }): Error {
  if (error.message?.includes("PORTAL_RATE_LIMIT")) return new Error("Se alcanzó el límite de consultas o envíos. Intenta más tarde o comunícate con Rentautos.");
  if (error.message?.includes("PORTAL_UNAVAILABLE")) return new Error("Este enlace no está disponible. Comunícate con Rentautos.");
  return new Error("No se pudo completar la operación. Revisa tu conexión e intenta nuevamente.");
}

export async function lookupPublicSellerLead(portalId: string, cedula: string): Promise<PublicSellerLeadRequest> {
  const client = createEphemeralSupabaseClient();
  if (!client) throw new Error("El servicio de consulta no está configurado.");
  const { data, error } = await client.rpc("lookup_seller_lead", { p_portal_id: portalId, p_cedula: cedula });
  if (error) throw publicPortalError(error);
  return normalizePublicPayload(data);
}

export async function submitSharedSellerLead(portalId: string, input: {
  cedula: string; birthDate: string; attachmentName: string; attachmentDataUrl: string;
}): Promise<PublicSellerLeadRequest> {
  const client = createEphemeralSupabaseClient();
  if (!client) throw new Error("El servicio de consulta no está configurado.");
  const { data, error } = await client.rpc("submit_shared_seller_lead", {
    p_portal_id: portalId, p_cedula: input.cedula, p_birth_date: input.birthDate,
    p_attachment_name: input.attachmentName, p_attachment_data_url: input.attachmentDataUrl
  });
  if (error) throw publicPortalError(error);
  return normalizePublicPayload(data);
}

export async function loadPublicSellerLeadRequest(token: string): Promise<PublicSellerLeadRequest> {
  const client = createEphemeralSupabaseClient();
  if (!client) throw new Error("El servicio de consulta no esta configurado.");
  const { data, error } = await client.rpc("get_seller_lead_request", { p_token: token });
  if (error) throw error;
  return normalizePublicPayload(data);
}

export async function submitPublicSellerLeadRequest(token: string, input: {
  cedula: string;
  birthDate: string;
  attachmentName: string;
  attachmentDataUrl: string;
}): Promise<void> {
  const client = createEphemeralSupabaseClient();
  if (!client) throw new Error("El servicio de consulta no esta configurado.");
  const { error } = await client.rpc("submit_seller_lead_request", {
    p_token: token,
    p_cedula: input.cedula,
    p_birth_date: input.birthDate,
    p_attachment_name: input.attachmentName,
    p_attachment_data_url: input.attachmentDataUrl
  });
  if (error) throw error;
}
