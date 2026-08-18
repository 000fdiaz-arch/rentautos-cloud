import type { BankRule, Client, LateFeeSettings, LeadEvaluation, OtherChargesRetentionByClient, PaymentPromise } from "../types";
import { dedupeLoad, getCloudClient, PAGE_SIZE, withCloudRetry, type DataRow, type SingletonDataRow } from "./cloudClient";
import type {
  CashClosing,
  CashClosingAuditEvent,
  CashCloseClientSnapshot,
  ChargeRun
} from "../pages/payments/paymentTypes";
import { stableEqual } from "../stableSerialize";
import { normalizeCourtName } from "../courtNames";

export async function registerCloudRouteBankNotice(
  userId: string,
  notice: {
    id: string;
    clientId: string;
    amount: number;
    createdAt: string;
    paymentMethod: "bank";
    collectionTeam: "PTY" | "WC";
    source: "route";
  }
): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("notified_payments_cloud")
    .insert({ user_id: userId, id: notice.id, data: notice });
  if (error) throw error;
}

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

export type InsuranceClaimStatus = "Inactivo" | "Activo" | "Finalizado";
export type InsuranceClaimClosureOutcome = "Pagado" | "Declinado";

export class DuplicateInsuranceClaimNumberError extends Error {
  readonly code = "DUPLICATE_INSURANCE_CLAIM_NUMBER";

  constructor(claimNumber: string) {
    super(`El número de reclamo ${claimNumber} ya está registrado. Utiliza un número diferente.`);
    this.name = "DuplicateInsuranceClaimNumberError";
  }
}

export class JudicialOutcomeRequiredForClaimError extends Error {
  readonly code = "JUDICIAL_OUTCOME_REQUIRED_FOR_CLAIM";

  constructor() {
    super("Este siniestro tiene un juicio asociado. El reclamo al seguro solo puede iniciarse después de registrar la absolución y adjuntar la resolución judicial.");
    this.name = "JudicialOutcomeRequiredForClaimError";
  }
}

export type InsuranceClaimEditEvent = {
  editedAt: string;
  justification: string;
};

export type InsuranceClaimFollowUp = {
  id: string;
  comment: string;
  nextStep: string;
  nextActionDate: string;
  createdAt: string;
  completedAt?: string | null;
  completionComment?: string;
};

export type InsuranceSettlementAttachment = {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type InsuranceDamagePhotoAttachment = {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  storageBucket?: "insurance-settlements" | "collision-photos";
};

export type InsuranceClaimRecord = {
  id: string;
  incidentDate: string;
  unit: string;
  driver: string;
  plate: string;
  insurer: string;
  hasClaimNumber: boolean;
  claimNumber: string;
  amount: string;
  vehicleDamage: string;
  status: InsuranceClaimStatus;
  damagePhotoNames: string[];
  damagePhotos: InsuranceDamagePhotoAttachment[];
  fudAttachment?: InsuranceSettlementAttachment | null;
  documentationPending?: boolean;
  documentationPendingSince?: string | null;
  documentationReceivedAt?: string | null;
  settlementDelivered: boolean;
  settlementDeliveredDate: string;
  settlementMarkedAt: string | null;
  settlementAttachment: InsuranceSettlementAttachment | null;
  followUpComment: string;
  followUpCommentUpdatedAt: string | null;
  followUps: InsuranceClaimFollowUp[];
  closureOutcome: InsuranceClaimClosureOutcome | null;
  closureJustification: string;
  finalizedAt: string | null;
  editHistory: InsuranceClaimEditEvent[];
  createdAt: string;
  updatedAt: string;
};

export type CollisionTrialStatus = "PENDIENTE" | "NUEVA FECHA" | "ABSUELTO" | "CULPABLE";
export type CollisionPhotoAttachment = {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  storageBucket?: "insurance-settlements" | "collision-photos";
};

export type CollisionTrialDateEvent = {
  previousDate: string;
  newDate: string;
  reason: string;
  changedAt: string;
};

export type CollisionInsuranceClaim = {
  insuranceClaimId?: string;
  insurer: string;
  claimNumber: string;
  amount: string;
  photos: CollisionPhotoAttachment[];
  updatedAt: string;
};

export type CollisionExpenseInvoice = {
  chargeId: string;
  label: string;
  description?: string;
  amount: number;
  attachment?: CollisionPhotoAttachment | null;
  evaluatedAt?: string;
  creditedToRentAmount?: number;
  creditedToRentAt?: string | null;
  editHistory?: CollisionExpenseInvoiceEditEvent[];
  createdAt: string;
};

export type CollisionExpenseInvoiceEditEvent = {
  editedAt: string;
  justification: string;
  changedFields: string[];
  previousAmount: number;
  newAmount: number;
};

export type CollisionJudicialFollowUp = {
  id: string;
  comment: string;
  nextStep: string;
  nextActionDate: string;
  createdAt: string;
  completedAt?: string | null;
  completionComment?: string;
};

export type CollisionTicketStubEvent = {
  previousValue: string;
  newValue: string;
  changedAt: string;
};

export type CollisionCaseEditEvent = {
  editedAt: string;
  justification: string;
  changedFields: string[];
};

export type CollisionCaseRecord = {
  id: string;
  incidentDate: string;
  unit: string;
  driver: string;
  clientId?: string;
  clientName?: string;
  plate: string;
  trialDate: string;
  vehicleDamage: string;
  ticketStub: string;
  ticketStubHistory?: CollisionTicketStubEvent[];
  editHistory?: CollisionCaseEditEvent[];
  ticketStubPhoto?: CollisionPhotoAttachment | null;
  documentationPending?: boolean;
  documentationPendingSince?: string | null;
  documentationReceivedAt?: string | null;
  placeTime: string;
  court: string;
  collisionAndRun: boolean;
  status: CollisionTrialStatus;
  vehicleInspectionDate?: string | null;
  vehicleInspectedAt?: string | null;
  trialDateHistory: CollisionTrialDateEvent[];
  judicialFollowUps: CollisionJudicialFollowUp[];
  clientWillAttend?: boolean | null;
  legalAssistanceRequested?: boolean | null;
  attendanceConfirmedAt?: string | null;
  incidentPhotos?: CollisionPhotoAttachment[];
  judicialOutcomeEvidence: CollisionPhotoAttachment | null;
  judicialResolutionEvidence?: CollisionPhotoAttachment | null;
  judicialResolutionSearchDate?: string | null;
  insuranceClaim: CollisionInsuranceClaim | null;
  expenseInvoice: CollisionExpenseInvoice | null;
  clientReturnedBeforeClosure?: boolean;
  clientReturnedBeforeClosureAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const INSURANCE_SETTLEMENTS_BUCKET = "insurance-settlements";
const INSURANCE_DAMAGE_PHOTOS_BUCKET = INSURANCE_SETTLEMENTS_BUCKET;
const COLLISION_PHOTOS_BUCKET = "collision-photos";

function normalizeInsuranceClaim(claim: InsuranceClaimRecord): InsuranceClaimRecord {
  const claimNumber = typeof claim.claimNumber === "string" ? claim.claimNumber : "";
  const rawHasClaimNumber = (claim as InsuranceClaimRecord & { hasClaimNumber?: unknown }).hasClaimNumber;
  const hasClaimNumber = typeof rawHasClaimNumber === "boolean"
    ? rawHasClaimNumber
    : Boolean(claimNumber.trim());
  const rawStatus = (claim as unknown as { status?: string }).status;
  const status: InsuranceClaimStatus = !claimNumber.trim()
    ? "Inactivo"
    : rawStatus === "Finalizado" || rawStatus === "Pagado"
      ? "Finalizado"
      : "Activo";
  const rawClosureOutcome = (claim as InsuranceClaimRecord & { closureOutcome?: unknown }).closureOutcome;
  const legacyFollowUpComment = typeof claim.followUpComment === "string" ? claim.followUpComment : "";
  const legacyFollowUpUpdatedAt = typeof claim.followUpCommentUpdatedAt === "string" ? claim.followUpCommentUpdatedAt : null;
  const normalizedFollowUps = Array.isArray(claim.followUps)
    ? claim.followUps.filter((entry): entry is InsuranceClaimFollowUp => Boolean(
        entry && typeof entry === "object"
        && typeof entry.id === "string"
        && typeof entry.comment === "string"
        && typeof entry.nextStep === "string"
        && typeof entry.nextActionDate === "string"
        && typeof entry.createdAt === "string"
      ))
    : [];
  const followUps = normalizedFollowUps.length > 0 || !legacyFollowUpComment.trim()
    ? normalizedFollowUps
    : [{
        id: `legacy-insurance-follow-up-${claim.id}`,
        comment: legacyFollowUpComment,
        nextStep: "",
        nextActionDate: "",
        createdAt: legacyFollowUpUpdatedAt || claim.updatedAt || claim.createdAt
      }];
  const closureOutcome: InsuranceClaimClosureOutcome | null = status !== "Finalizado"
    ? null
    : rawStatus === "Pagado"
      ? "Pagado"
      : rawClosureOutcome === "Pagado" || rawClosureOutcome === "Declinado"
        ? rawClosureOutcome
        : null;
  return {
    ...claim,
    hasClaimNumber,
    claimNumber,
    status,
    damagePhotoNames: Array.isArray(claim.damagePhotoNames) ? claim.damagePhotoNames : [],
    damagePhotos: Array.isArray(claim.damagePhotos)
      ? claim.damagePhotos.filter((photo) => photo && typeof photo.path === "string")
      : [],
    fudAttachment: claim.fudAttachment && typeof claim.fudAttachment.path === "string"
      ? claim.fudAttachment
      : null,
    documentationPending: claim.documentationPending === true,
    documentationPendingSince: typeof claim.documentationPendingSince === "string" ? claim.documentationPendingSince : null,
    documentationReceivedAt: typeof claim.documentationReceivedAt === "string" ? claim.documentationReceivedAt : null,
    settlementDelivered: claim.settlementDelivered === true,
    settlementDeliveredDate: typeof claim.settlementDeliveredDate === "string" ? claim.settlementDeliveredDate : "",
    settlementMarkedAt: typeof claim.settlementMarkedAt === "string" ? claim.settlementMarkedAt : null,
    settlementAttachment: claim.settlementAttachment && typeof claim.settlementAttachment.path === "string"
      ? claim.settlementAttachment
      : null,
    followUpComment: legacyFollowUpComment,
    followUpCommentUpdatedAt: legacyFollowUpUpdatedAt,
    followUps,
    closureOutcome,
    closureJustification: typeof claim.closureJustification === "string" ? claim.closureJustification : "",
    finalizedAt: status === "Finalizado" && typeof claim.finalizedAt === "string" ? claim.finalizedAt : null,
    editHistory: Array.isArray(claim.editHistory) ? claim.editHistory : []
  };
}

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

export async function loadInsuranceInsurers(userId: string): Promise<string[]> {
  const rows = await loadCloudArrayRows<{ name?: unknown }>(userId, "insurance_insurers_cloud");
  return rows
    .map((row) => typeof row.name === "string" ? row.name.trim() : "")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }));
}

export async function saveInsuranceInsurer(userId: string, name: string): Promise<void> {
  const normalized = name.trim().toUpperCase();
  if (!normalized) return;
  const client = getCloudClient();
  const now = new Date().toISOString();
  const { error } = await client
    .from("insurance_insurers_cloud")
    .upsert({
      user_id: userId,
      id: normalized,
      data: { name: normalized },
      updated_at: now
    }, { onConflict: "user_id,id" });
  if (error) throw error;
}

export async function loadInsuranceClaims(userId: string): Promise<InsuranceClaimRecord[]> {
  const rows = await loadCloudArrayRows<InsuranceClaimRecord>(userId, "insurance_claims_cloud");
  return rows
    .map(normalizeInsuranceClaim)
    .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));
}

function normalizeInsuranceClaimNumber(value: string): string {
  return value.trim().toLocaleUpperCase("es").replace(/[\s-]+/g, "");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function saveInsuranceClaim(userId: string, claim: InsuranceClaimRecord): Promise<void> {
  const client = getCloudClient();
  const { data: existingClaim, error: existingClaimError } = await client
    .from("insurance_claims_cloud")
    .select("id")
    .eq("user_id", userId)
    .eq("id", claim.id)
    .maybeSingle();
  if (existingClaimError) throw existingClaimError;
  if (!existingClaim) {
    const normalizeIncidentIdentity = (value: string): string => value.trim().toLocaleUpperCase("es").replace(/[\s-]+/g, "");
    const relatedJudicialCase = (await loadCollisionCases(userId)).find((item) => (
      item.incidentDate === claim.incidentDate
      && normalizeIncidentIdentity(item.unit) === normalizeIncidentIdentity(claim.unit)
      && normalizeIncidentIdentity(item.plate) === normalizeIncidentIdentity(claim.plate)
    ));
    if (relatedJudicialCase && (relatedJudicialCase.status !== "ABSUELTO" || !relatedJudicialCase.judicialResolutionEvidence)) throw new JudicialOutcomeRequiredForClaimError();
  }
  const normalizedClaimNumber = normalizeInsuranceClaimNumber(claim.claimNumber);
  if (normalizedClaimNumber) {
    const { data: existingRows, error: duplicateCheckError } = await client
      .from("insurance_claims_cloud")
      .select("id,data")
      .eq("user_id", userId);
    if (duplicateCheckError) throw duplicateCheckError;
    const duplicate = (existingRows ?? []).find((row) => {
      if (row.id === claim.id || typeof row.data !== "object" || row.data === null) return false;
      const existingNumber = (row.data as { claimNumber?: unknown }).claimNumber;
      return typeof existingNumber === "string" && normalizeInsuranceClaimNumber(existingNumber) === normalizedClaimNumber;
    });
    if (duplicate) throw new DuplicateInsuranceClaimNumberError(claim.claimNumber.trim());
  }
  const { error } = await client
    .from("insurance_claims_cloud")
    .upsert({
      user_id: userId,
      id: claim.id,
      data: claim,
      updated_at: claim.updatedAt
    }, { onConflict: "user_id,id" });
  if (error) {
    if (isUniqueViolation(error)) throw new DuplicateInsuranceClaimNumberError(claim.claimNumber.trim());
    throw error;
  }
}

function safeStorageFileName(fileName: string): string {
  const extension = fileName.includes(".") ? `.${fileName.split(".").pop()?.toLowerCase() ?? ""}` : "";
  const baseName = fileName.slice(0, extension ? -extension.length : undefined)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "finiquito";
  return `${baseName}${extension.replace(/[^a-z0-9.]/g, "")}`;
}

export async function uploadInsuranceSettlement(
  userId: string,
  claimId: string,
  file: File
): Promise<InsuranceSettlementAttachment> {
  const client = getCloudClient();
  const uploadedAt = new Date().toISOString();
  const path = `${userId}/${claimId}/${Date.now()}-${safeStorageFileName(file.name)}`;
  const { error } = await client.storage
    .from(INSURANCE_SETTLEMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return { name: file.name, path, mimeType: file.type, size: file.size, uploadedAt };
}

export async function removeInsuranceSettlement(path: string): Promise<void> {
  if (!path) return;
  const client = getCloudClient();
  const { error } = await client.storage.from(INSURANCE_SETTLEMENTS_BUCKET).remove([path]);
  if (error) throw error;
}

export async function createInsuranceSettlementViewUrl(path: string): Promise<string> {
  const client = getCloudClient();
  const { data, error } = await client.storage
    .from(INSURANCE_SETTLEMENTS_BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

export async function uploadInsuranceDamagePhoto(
  userId: string,
  claimId: string,
  file: File
): Promise<InsuranceDamagePhotoAttachment> {
  const client = getCloudClient();
  const uploadedAt = new Date().toISOString();
  const path = `${userId}/damage-photos/${claimId}/${Date.now()}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`;
  const { error } = await client.storage
    .from(INSURANCE_DAMAGE_PHOTOS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return { name: file.name, path, mimeType: file.type, size: file.size, uploadedAt, storageBucket: INSURANCE_DAMAGE_PHOTOS_BUCKET };
}

export async function removeInsuranceDamagePhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const client = getCloudClient();
  const { error } = await client.storage.from(INSURANCE_DAMAGE_PHOTOS_BUCKET).remove(paths);
  if (error) throw error;
}

export async function createInsuranceDamagePhotoViewUrl(
  path: string,
  storageBucket: "insurance-settlements" | "collision-photos" = INSURANCE_DAMAGE_PHOTOS_BUCKET
): Promise<string> {
  const client = getCloudClient();
  const { data, error } = await client.storage
    .from(storageBucket)
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

function normalizeCollisionCase(item: CollisionCaseRecord): CollisionCaseRecord {
  const legacy = item as CollisionCaseRecord & {
    status?: unknown;
    insurer?: unknown;
    claimNumber?: unknown;
    amount?: unknown;
    photos?: unknown;
    nextFollowUpDate?: unknown;
  };
  const rawStatus = typeof legacy.status === "string" ? legacy.status.trim().toLocaleUpperCase("es") : "";
  const status: CollisionTrialStatus = rawStatus === "GANÓ" || rawStatus === "ABSUELTO"
    ? "ABSUELTO"
    : rawStatus === "PERDIÓ" || rawStatus === "CULPABLE"
      ? "CULPABLE"
      : rawStatus === "NUEVA FECHA"
        ? "NUEVA FECHA"
        : "PENDIENTE";
  const legacyPhotos = Array.isArray(legacy.photos)
    ? legacy.photos.filter((photo): photo is CollisionPhotoAttachment => Boolean(photo && typeof photo === "object" && "path" in photo))
    : [];
  const existingClaim = item.insuranceClaim && typeof item.insuranceClaim === "object" ? item.insuranceClaim : null;
  const legacyClaim = typeof legacy.insurer === "string" || typeof legacy.claimNumber === "string" || typeof legacy.amount === "string" || legacyPhotos.length > 0
    ? {
        insurer: typeof legacy.insurer === "string" ? legacy.insurer : "",
        claimNumber: typeof legacy.claimNumber === "string" ? legacy.claimNumber : "",
        amount: typeof legacy.amount === "string" ? legacy.amount : "",
        photos: legacyPhotos,
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
      }
    : null;
  const legacyResolutionBase = item.updatedAt || item.createdAt;
  const legacyResolutionDate = /^\d{4}-\d{2}-\d{2}/.test(legacyResolutionBase)
    ? (() => {
        const date = new Date(`${legacyResolutionBase.slice(0, 10)}T12:00:00`);
        date.setDate(date.getDate() + 30);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      })()
    : null;
  return {
    ...item,
    status,
    trialDate: typeof item.trialDate === "string"
      ? item.trialDate
      : typeof legacy.nextFollowUpDate === "string" ? legacy.nextFollowUpDate : "",
    ticketStub: typeof item.ticketStub === "string" ? item.ticketStub : "",
    ticketStubHistory: Array.isArray(item.ticketStubHistory)
      ? item.ticketStubHistory.filter((entry): entry is CollisionTicketStubEvent => Boolean(
          entry && typeof entry === "object"
          && typeof entry.previousValue === "string"
          && typeof entry.newValue === "string"
          && typeof entry.changedAt === "string"
        ))
      : [],
    editHistory: Array.isArray(item.editHistory)
      ? item.editHistory.filter((entry): entry is CollisionCaseEditEvent => Boolean(
          entry && typeof entry === "object"
          && typeof entry.editedAt === "string"
          && typeof entry.justification === "string"
          && Array.isArray(entry.changedFields)
        ))
      : [],
    ticketStubPhoto: item.ticketStubPhoto && typeof item.ticketStubPhoto === "object" && typeof item.ticketStubPhoto.path === "string"
      ? item.ticketStubPhoto
      : null,
    documentationPending: item.documentationPending === true,
    documentationPendingSince: typeof item.documentationPendingSince === "string" ? item.documentationPendingSince : null,
    documentationReceivedAt: typeof item.documentationReceivedAt === "string" ? item.documentationReceivedAt : null,
    placeTime: typeof item.placeTime === "string" ? item.placeTime : "",
    court: typeof item.court === "string" ? normalizeCourtName(item.court) : "",
    collisionAndRun: item.collisionAndRun === true,
    vehicleInspectionDate: typeof item.vehicleInspectionDate === "string" ? item.vehicleInspectionDate : null,
    vehicleInspectedAt: typeof item.vehicleInspectedAt === "string" ? item.vehicleInspectedAt : null,
    clientId: typeof item.clientId === "string" ? item.clientId : "",
    clientName: typeof item.clientName === "string" ? item.clientName : "",
    trialDateHistory: Array.isArray(item.trialDateHistory) ? item.trialDateHistory : [],
    judicialFollowUps: Array.isArray(item.judicialFollowUps)
      ? item.judicialFollowUps.filter((entry): entry is CollisionJudicialFollowUp => Boolean(
          entry && typeof entry === "object"
          && typeof entry.id === "string"
          && typeof entry.comment === "string"
          && typeof entry.nextStep === "string"
          && typeof entry.nextActionDate === "string"
          && typeof entry.createdAt === "string"
        ))
      : [],
    clientWillAttend: typeof item.clientWillAttend === "boolean" ? item.clientWillAttend : null,
    legalAssistanceRequested: typeof item.legalAssistanceRequested === "boolean" ? item.legalAssistanceRequested : null,
    attendanceConfirmedAt: typeof item.attendanceConfirmedAt === "string" ? item.attendanceConfirmedAt : null,
    incidentPhotos: Array.isArray(item.incidentPhotos)
      ? item.incidentPhotos.filter((photo): photo is CollisionPhotoAttachment => Boolean(photo && typeof photo === "object" && typeof photo.path === "string"))
      : [],
    judicialOutcomeEvidence: item.judicialOutcomeEvidence && typeof item.judicialOutcomeEvidence === "object" && typeof item.judicialOutcomeEvidence.path === "string"
      ? item.judicialOutcomeEvidence
      : null,
    judicialResolutionEvidence: item.judicialResolutionEvidence && typeof item.judicialResolutionEvidence === "object" && typeof item.judicialResolutionEvidence.path === "string"
      ? item.judicialResolutionEvidence
      : null,
    judicialResolutionSearchDate: typeof item.judicialResolutionSearchDate === "string"
      ? item.judicialResolutionSearchDate
      : status === "ABSUELTO" && !item.judicialResolutionEvidence ? legacyResolutionDate : null,
    insuranceClaim: existingClaim ?? legacyClaim,
    expenseInvoice: item.expenseInvoice && typeof item.expenseInvoice === "object"
      ? {
          ...item.expenseInvoice,
          description: typeof item.expenseInvoice.description === "string" ? item.expenseInvoice.description : item.expenseInvoice.label,
          attachment: item.expenseInvoice.attachment && typeof item.expenseInvoice.attachment.path === "string"
            ? item.expenseInvoice.attachment
            : null,
          evaluatedAt: typeof item.expenseInvoice.evaluatedAt === "string" ? item.expenseInvoice.evaluatedAt : item.expenseInvoice.createdAt?.slice(0, 10) ?? "",
          creditedToRentAmount: typeof item.expenseInvoice.creditedToRentAmount === "number" ? item.expenseInvoice.creditedToRentAmount : 0,
          creditedToRentAt: typeof item.expenseInvoice.creditedToRentAt === "string" ? item.expenseInvoice.creditedToRentAt : null,
          editHistory: Array.isArray(item.expenseInvoice.editHistory)
            ? item.expenseInvoice.editHistory.filter((entry): entry is CollisionExpenseInvoiceEditEvent => Boolean(
                entry && typeof entry === "object"
                && typeof entry.editedAt === "string"
                && typeof entry.justification === "string"
                && Array.isArray(entry.changedFields)
                && typeof entry.previousAmount === "number"
                && typeof entry.newAmount === "number"
              ))
            : []
        }
      : null,
    clientReturnedBeforeClosure: item.clientReturnedBeforeClosure === true,
    clientReturnedBeforeClosureAt: typeof item.clientReturnedBeforeClosureAt === "string" ? item.clientReturnedBeforeClosureAt : null
  };
}

export async function loadCollisionCases(userId: string): Promise<CollisionCaseRecord[]> {
  const rows = await loadCloudArrayRows<CollisionCaseRecord>(userId, "collision_cases_cloud");
  return rows
    .map(normalizeCollisionCase)
    .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));
}

export async function saveCollisionCase(userId: string, item: CollisionCaseRecord): Promise<void> {
  const client = getCloudClient();
  const normalizedItem = { ...item, court: normalizeCourtName(item.court) };
  const { error } = await client
    .from("collision_cases_cloud")
    .upsert({ user_id: userId, id: item.id, data: normalizedItem, updated_at: item.updatedAt }, { onConflict: "user_id,id" });
  if (error) throw error;
}

export async function uploadCollisionPhoto(
  userId: string,
  caseId: string,
  file: File
): Promise<CollisionPhotoAttachment> {
  const client = getCloudClient();
  const uploadedAt = new Date().toISOString();
  const path = `${userId}/${caseId}/${Date.now()}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`;
  const { error } = await client.storage
    .from(COLLISION_PHOTOS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return { name: file.name, path, mimeType: file.type, size: file.size, uploadedAt, storageBucket: COLLISION_PHOTOS_BUCKET };
}

export async function removeCollisionPhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const client = getCloudClient();
  const { error } = await client.storage.from(COLLISION_PHOTOS_BUCKET).remove(paths);
  if (error) throw error;
}

export async function createCollisionPhotoViewUrl(path: string): Promise<string> {
  const client = getCloudClient();
  const { data, error } = await client.storage.from(COLLISION_PHOTOS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
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

type LeadEvaluationSummaryRow = {
  id?: unknown;
  cedula?: unknown;
  birthDate?: unknown;
  age?: unknown;
  attachmentName?: unknown;
  noCases?: unknown;
  hasGpsTamperingReport?: unknown;
  hasLegalCases?: unknown;
  hasViolenceReports?: unknown;
  hasDuiReports?: unknown;
  hasPiracyReports?: unknown;
  collisionReports?: unknown;
  pendingDailyReports?: unknown;
  decision?: unknown;
  extraDeposit?: unknown;
  blockers?: unknown;
  extraDepositReasons?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).filter((item) => item.length > 0) : [];
}

function leadDecisionValue(value: unknown): LeadEvaluation["decision"] {
  return value === "aplica_con_abono" || value === "no_aplica" ? value : "aplica";
}

function leadSummaryFromRow(row: LeadEvaluationSummaryRow): LeadEvaluation {
  const id = stringValue(row.id);
  const now = new Date().toISOString();
  return {
    id,
    cedula: stringValue(row.cedula),
    birthDate: stringValue(row.birthDate),
    age: numberValue(row.age),
    attachmentName: stringValue(row.attachmentName) || undefined,
    noCases: booleanValue(row.noCases),
    hasGpsTamperingReport: booleanValue(row.hasGpsTamperingReport),
    hasLegalCases: booleanValue(row.hasLegalCases),
    hasViolenceReports: booleanValue(row.hasViolenceReports),
    hasDuiReports: booleanValue(row.hasDuiReports),
    hasPiracyReports: booleanValue(row.hasPiracyReports),
    collisionReports: numberValue(row.collisionReports),
    pendingDailyReports: numberValue(row.pendingDailyReports),
    decision: leadDecisionValue(row.decision),
    extraDeposit: numberValue(row.extraDeposit),
    blockers: stringArrayValue(row.blockers),
    extraDepositReasons: stringArrayValue(row.extraDepositReasons),
    createdAt: stringValue(row.createdAt) || now,
    updatedAt: stringValue(row.updatedAt) || now
  };
}

export async function loadCloudLeadEvaluationSummaries(userId: string): Promise<LeadEvaluation[]> {
  const client = getCloudClient();
  const allRows: LeadEvaluationSummaryRow[] = [];
  let lastId = "";
  const select = [
    "id",
    "data->cedula",
    "data->birthDate",
    "data->age",
    "data->attachmentName",
    "data->noCases",
    "data->hasGpsTamperingReport",
    "data->hasLegalCases",
    "data->hasViolenceReports",
    "data->hasDuiReports",
    "data->hasPiracyReports",
    "data->collisionReports",
    "data->pendingDailyReports",
    "data->decision",
    "data->extraDeposit",
    "data->blockers",
    "data->extraDepositReasons",
    "data->createdAt",
    "data->updatedAt"
  ].join(",");
  while (true) {
    let query = client
      .from("lead_evaluations_cloud")
      .select(select)
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as LeadEvaluationSummaryRow[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    lastId = stringValue(batch[batch.length - 1]?.id) || lastId;
    if (!lastId) break;
  }
  return allRows
    .map(leadSummaryFromRow)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadCloudLeadEvaluation(userId: string, evaluationId: string): Promise<LeadEvaluation | null> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("lead_evaluations_cloud")
    .select("data")
    .eq("user_id", userId)
    .eq("id", evaluationId)
    .maybeSingle();
  if (error) throw error;
  const payload = (data as { data?: unknown } | null)?.data;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as LeadEvaluation
    : null;
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
    .from("street_management_items_cloud")
    .select("client_id,data")
    .eq("user_id", userId);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ client_id?: unknown; data?: unknown }>;
  const byClient: Record<string, unknown> = {};
  for (const row of rows) {
    const clientId = typeof row.client_id === "string" ? row.client_id : "";
    if (!clientId) continue;
    byClient[clientId] = normalizeCloudValue(row.data);
  }
  return byClient;
}

export async function saveCloudStreetManagement(userId: string, value: Record<string, unknown>): Promise<void> {
  await replaceCloudStreetManagementItems(userId, value);
}

async function replaceCloudStreetManagementItems(userId: string, value: Record<string, unknown>): Promise<void> {
  const client = getCloudClient();
  const normalized = normalizeCloudValue(value) as Record<string, unknown>;
  const isClearOperation = Object.keys(normalized).length === 1 && Object.prototype.hasOwnProperty.call(normalized, "__clearedAt");
  const rows = Object.entries(normalized).map(([clientId, data]) => ({
    user_id: userId,
    client_id: clientId,
    data,
    updated_at: new Date().toISOString()
  }));
  const { error: deleteError } = await client
    .from("street_management_items_cloud")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw deleteError;
  if (rows.length === 0) return;
  const { error } = await client
    .from("street_management_items_cloud")
    .upsert(rows, { onConflict: "user_id,client_id" });
  if (error) throw error;
  if (isClearOperation) {
    const { count, error: countError } = await client
      .from("street_management_items_cloud")
      .select("client_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("client_id", "__clearedAt");
    if (countError) throw countError;
    if ((count ?? 0) > 0) throw new Error(`La gestion quedo parcialmente limpia (${count} registro(s)).`);
  }
}

function toIsoTimestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowTimestamp(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const row = value as Record<string, unknown>;
  return Math.max(
    toIsoTimestamp(row.updatedAt),
    toIsoTimestamp(row.managementUpdatedAt),
    toIsoTimestamp(row.routeReleaseUpdatedAt),
    toIsoTimestamp(row.supportNoteUpdatedAt),
    toIsoTimestamp(row.contactTimeUpdatedAt),
    toIsoTimestamp(row.routeUrgencyUpdatedAt),
    toIsoTimestamp(row.whatsAppMessageCopiedAt),
    toIsoTimestamp(row.whatsAppMessageSentAt),
    toIsoTimestamp(row.paymentPromiseUpdatedAt)
  );
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mergeStreetManagementRow(currentValue: unknown, patchValue: unknown): unknown {
  const current = recordOrNull(currentValue);
  const patch = recordOrNull(patchValue);
  if (!current || !patch) return patchValue;

  const merged: Record<string, unknown> = { ...current, ...patch };
  const currentWhatsAppTs = Math.max(
    toIsoTimestamp(current.whatsAppMessageCopiedAt),
    toIsoTimestamp(current.whatsAppMessageSentAt)
  );
  const patchWhatsAppTs = Math.max(
    toIsoTimestamp(patch.whatsAppMessageCopiedAt),
    toIsoTimestamp(patch.whatsAppMessageSentAt)
  );

  if (currentWhatsAppTs > patchWhatsAppTs) {
    merged.whatsAppMessageCopiedAt = current.whatsAppMessageCopiedAt;
    merged.whatsAppMessageSentAt = current.whatsAppMessageSentAt;
    merged.whatsAppMessageText = current.whatsAppMessageText;
  }

  if (toIsoTimestamp(current.supportNoteUpdatedAt) > toIsoTimestamp(patch.supportNoteUpdatedAt)) {
    merged.supportNote = current.supportNote;
    merged.supportNoteUpdatedAt = current.supportNoteUpdatedAt;
  }

  if (toIsoTimestamp(current.contactTimeUpdatedAt) > toIsoTimestamp(patch.contactTimeUpdatedAt)) {
    merged.contactTime = current.contactTime;
    merged.contactTimeUpdatedAt = current.contactTimeUpdatedAt;
  }

  return merged;
}

export async function syncCloudStreetManagementDelta(
  userId: string,
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>
): Promise<void> {
  await syncCloudStreetManagementItemsDelta(userId, previousValue, nextValue);
}

async function syncCloudStreetManagementItemsDelta(
  userId: string,
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>
): Promise<void> {
  const client = getCloudClient();
  const prev = normalizeRecord(previousValue);
  const next = normalizeRecord(nextValue);
  const changedPatch: Record<string, unknown | null> = {};

  for (const [clientId, nextRow] of Object.entries(next)) {
    const prevRow = prev[clientId];
    const nextTs = rowTimestamp(nextRow);
    const prevTs = rowTimestamp(prevRow);
    if ((!prevRow || nextTs >= prevTs) && !stableEqual(prevRow, nextRow)) {
      changedPatch[clientId] = nextRow;
    }
  }

  for (const clientId of Object.keys(prev)) {
    if (!(clientId in next)) changedPatch[clientId] = null;
  }

  const changedClientIds = Object.keys(changedPatch);
  if (changedClientIds.length === 0) return;

  if (changedPatch.__clearedAt) {
    const { error: deleteError } = await client
      .from("street_management_items_cloud")
      .delete()
      .eq("user_id", userId)
      .neq("client_id", "__clearedAt");
    if (deleteError) throw deleteError;
  }

  const currentRows = new Map<string, unknown>();
  for (let index = 0; index < changedClientIds.length; index += PAGE_SIZE) {
    const batch = changedClientIds.slice(index, index + PAGE_SIZE);
    const { data, error } = await client
      .from("street_management_items_cloud")
      .select("client_id,data")
      .eq("user_id", userId)
      .in("client_id", batch);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ client_id?: unknown; data?: unknown }>) {
      if (typeof row.client_id === "string") currentRows.set(row.client_id, row.data);
    }
  }

  const upserts: Array<{ user_id: string; client_id: string; data: unknown; updated_at: string }> = [];
  const deletes: string[] = [];
  const clearedAt = rowTimestamp(changedPatch.__clearedAt ?? currentRows.get("__clearedAt"));

  for (const [clientId, patchValue] of Object.entries(changedPatch)) {
    if (patchValue === null) {
      const currentRow = currentRows.get(clientId);
      const prevRow = prev[clientId];
      if (!currentRow || rowTimestamp(currentRow) <= rowTimestamp(prevRow)) deletes.push(clientId);
      continue;
    }
    const currentRow = currentRows.get(clientId);
    const patchTs = rowTimestamp(patchValue);
    const currentTs = rowTimestamp(currentRow);
    if (clientId !== "__clearedAt" && clearedAt > 0 && patchTs <= clearedAt) continue;
    if (!currentRow || patchTs >= currentTs) {
      upserts.push({
        user_id: userId,
        client_id: clientId,
        data: normalizeCloudValue(mergeStreetManagementRow(currentRow, patchValue)),
        updated_at: new Date().toISOString()
      });
    }
  }

  for (let index = 0; index < deletes.length; index += PAGE_SIZE) {
    const batch = deletes.slice(index, index + PAGE_SIZE);
    const { error } = await client
      .from("street_management_items_cloud")
      .delete()
      .eq("user_id", userId)
      .in("client_id", batch);
    if (error) throw error;
  }

  for (let index = 0; index < upserts.length; index += PAGE_SIZE) {
    const batch = upserts.slice(index, index + PAGE_SIZE);
    const { error } = await client
      .from("street_management_items_cloud")
      .upsert(batch, { onConflict: "user_id,client_id" });
    if (error) throw error;
  }
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
  return dedupeLoad(`control-units:${userId}`, () => loadControlUnitsUncached(userId));
}

async function loadControlUnitsUncached(userId: string): Promise<ControlUnitRow[]> {
  const client = getCloudClient();
  const allRows: ControlUnitRow[] = [];
  let from = 0;
  let useFleetTableFallback = false;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const result = await withCloudRetry(() => client
      .from(useFleetTableFallback ? "fleet_units_cloud" : "vw_control_unidades")
      .select("*")
      .eq("user_id", userId)
      .order("unit_id", { ascending: true })
      .range(from, to));
    let data = result.data as ControlUnitRow[] | null;
    let error = result.error;

    if (error) {
      const record = error as { code?: unknown; message?: unknown };
      const code = typeof record.code === "string" ? record.code : "";
      const message = typeof record.message === "string" ? record.message : "";
      if (!useFleetTableFallback && (code === "42P01" || code === "PGRST205" || message.includes("vw_control_unidades"))) {
        useFleetTableFallback = true;
        from = 0;
        allRows.length = 0;
        continue;
      }
      throw error;
    }

    const batch = ((data ?? []) as ControlUnitRow[]).map((row) => ({
      ...row,
      year: row.model_year ?? row.year,
      transmission: row.transmission_type ?? row.transmission,
      kilometrage: row.mileage,
      kilometraje: row.mileage,
      client_id: useFleetTableFallback ? null : row.client_id,
      client_name: useFleetTableFallback ? null : row.client_name,
      client_cedula: useFleetTableFallback ? null : row.client_cedula,
      financial_balance: useFleetTableFallback ? null : row.financial_balance,
      financial_status: useFleetTableFallback ? "sin_cliente" : row.financial_status,
      last_payment_date: useFleetTableFallback ? null : row.last_payment_date
    }));
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

export type ActiveRouteItem = {
  clientId: string;
  unitId: string;
  clientName: string;
  clientCedula?: string;
  whatsAppPhone?: string;
  routeAssignment?: string;
  zone?: string;
  managementType?: "solo_cobrar" | "cobrar_o_quitar" | "desiste" | "quitar";
  urgency?: "normal" | "urgent" | "very_urgent";
  releaseAmount: number;
  pendingAmount: number;
  overdueBalance: number;
  rentAmount: number;
  daysLate: number;
  lastPaymentDate: string | null;
  comment?: string;
  partialDecisionRentAmount?: number;
  partialDecisionAt?: string;
  publishedAt: string;
  routeStartedAt: string;
  removedAt?: string;
  removedReason?: "paid" | "removed" | "inactive" | "manual_management" | "manual_published" | "operator_removed" | "route_editor_removed";
};

function normalizeActiveRouteItem(value: unknown): ActiveRouteItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const clientId = typeof row.clientId === "string" ? row.clientId : "";
  const unitId = typeof row.unitId === "string" ? row.unitId : "";
  const clientName = typeof row.clientName === "string" ? row.clientName : "";
  const releaseAmount = typeof row.releaseAmount === "number" ? row.releaseAmount : Number(row.releaseAmount);
  const pendingAmount = typeof row.pendingAmount === "number" ? row.pendingAmount : Number(row.pendingAmount);
  const overdueBalance = typeof row.overdueBalance === "number" ? row.overdueBalance : Number(row.overdueBalance);
  const rentAmount = typeof row.rentAmount === "number" ? row.rentAmount : Number(row.rentAmount);
  const daysLate = typeof row.daysLate === "number" ? row.daysLate : Number(row.daysLate);
  const publishedAt = typeof row.publishedAt === "string" ? row.publishedAt : "";
  const routeStartedAt = typeof row.routeStartedAt === "string" ? row.routeStartedAt : publishedAt;
  if (!clientId || !unitId || !clientName || !Number.isFinite(releaseAmount) || releaseAmount < 0 || !publishedAt) return null;
  return {
    clientId,
    unitId,
    clientName,
    clientCedula: typeof row.clientCedula === "string" ? row.clientCedula : undefined,
    whatsAppPhone: typeof row.whatsAppPhone === "string" ? row.whatsAppPhone : undefined,
    routeAssignment: typeof row.routeAssignment === "string" ? row.routeAssignment : undefined,
    zone: typeof row.zone === "string" && row.zone.trim().length > 0 ? row.zone.trim() : undefined,
    managementType: row.managementType === "cobrar_o_quitar" || row.managementType === "desiste" || row.managementType === "quitar"
      ? row.managementType
      : "solo_cobrar",
    urgency: row.urgency === "urgent" || row.urgency === "very_urgent" ? row.urgency : "normal",
    releaseAmount,
    pendingAmount: Number.isFinite(pendingAmount) ? pendingAmount : 0,
    overdueBalance: Number.isFinite(overdueBalance) ? overdueBalance : 0,
    rentAmount: Number.isFinite(rentAmount) ? rentAmount : 0,
    daysLate: Number.isFinite(daysLate) ? daysLate : 0,
    lastPaymentDate: typeof row.lastPaymentDate === "string" ? row.lastPaymentDate : null,
    comment: typeof row.comment === "string" ? row.comment : undefined,
    partialDecisionRentAmount: typeof row.partialDecisionRentAmount === "number" && Number.isFinite(row.partialDecisionRentAmount)
      ? row.partialDecisionRentAmount
      : undefined,
    partialDecisionAt: typeof row.partialDecisionAt === "string" ? row.partialDecisionAt : undefined,
    publishedAt,
    routeStartedAt,
    removedAt: typeof row.removedAt === "string" ? row.removedAt : undefined,
    removedReason: row.removedReason === "paid" || row.removedReason === "removed" || row.removedReason === "inactive" || row.removedReason === "manual_management" || row.removedReason === "manual_published" || row.removedReason === "operator_removed" || row.removedReason === "route_editor_removed" ? row.removedReason : undefined
  };
}

export async function loadCloudActiveRouteItems(userId: string): Promise<ActiveRouteItem[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("active_route_items_cloud")
    .select("client_id,data")
    .eq("user_id", userId);
  if (error) throw error;
  return ((data ?? []) as Array<{ client_id?: unknown; data?: unknown }>)
    .map((row) => normalizeActiveRouteItem(row.data))
    .filter((item): item is ActiveRouteItem => item !== null);
}

export async function publishCloudActiveRouteItems(userId: string, items: ActiveRouteItem[]): Promise<void> {
  const client = getCloudClient();
  const rows = items.map((item) => ({
    user_id: userId,
    client_id: item.clientId,
    data: item,
    updated_at: new Date().toISOString()
  }));
  if (rows.length === 0) return;
  const { error } = await client
    .from("active_route_items_cloud")
    .upsert(rows, { onConflict: "user_id,client_id" });
  if (error) throw error;
}

export async function removeCloudActiveRouteItem(
  userId: string,
  clientId: string,
  reason: "paid" | "removed" | "inactive" | "manual_management" | "manual_published"
): Promise<void> {
  const client = getCloudClient();
  const { data, error: loadError } = await client
    .from("active_route_items_cloud")
    .select("data")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .maybeSingle<{ data?: unknown }>();
  if (loadError) throw loadError;
  const current = normalizeActiveRouteItem(data?.data);
  if (!current) return;
  const updated: ActiveRouteItem = {
    ...current,
    removedAt: new Date().toISOString(),
    removedReason: reason
  };
  const { error } = await client
    .from("active_route_items_cloud")
    .upsert({
      user_id: userId,
      client_id: clientId,
      data: updated,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id,client_id" });
  if (error) throw error;
}

export async function saveCloudActiveRouteItem(userId: string, item: ActiveRouteItem): Promise<void> {
  const client = getCloudClient();
  const { error } = await client
    .from("active_route_items_cloud")
    .upsert({
      user_id: userId,
      client_id: item.clientId,
      data: item,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id,client_id" });
  if (error) throw error;
}

export async function saveCloudActiveRouteZone(input: {
  userId: string;
  clientId: string;
  routeAssignment?: string;
  zone?: string;
}): Promise<void> {
  const client = getCloudClient();
  const { error } = await client.rpc("update_active_route_zone", {
    p_user_id: input.userId,
    p_client_id: input.clientId,
    p_route_assignment: input.routeAssignment ?? "",
    p_zone: input.zone ?? ""
  });
  if (error) throw error;
}

export async function saveCloudActiveRouteComment(input: {
  userId: string;
  clientId: string;
  comment?: string;
}): Promise<void> {
  const client = getCloudClient();
  const { error } = await client.rpc("update_active_route_comment", {
    p_user_id: input.userId,
    p_client_id: input.clientId,
    p_comment: input.comment ?? ""
  });
  if (error) throw error;
}

export async function removeCloudActiveRouteItemFromSearch(input: {
  userId: string;
  clientId: string;
}): Promise<void> {
  const client = getCloudClient();
  const { error } = await client.rpc("remove_active_route_item_from_search", {
    p_user_id: input.userId,
    p_client_id: input.clientId
  });
  if (error) throw error;
}

export async function keepCloudActiveRouteItemAfterPartialPayment(input: {
  userId: string;
  clientId: string;
  confirmedRentAmount: number;
}): Promise<void> {
  const client = getCloudClient();
  const { error } = await client.rpc("keep_active_route_item_after_partial_payment", {
    p_user_id: input.userId,
    p_client_id: input.clientId,
    p_confirmed_rent_amount: input.confirmedRentAmount
  });
  if (error) throw error;
}

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
  const { error } = await client.rpc("save_fleet_unit", {
    p_owner_user_id: input.user_id,
    p_unit: toControlUnitCloudPayload(input)
  });
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
      throw new Error("La funcion segura set_fleet_unit_status no esta disponible en Supabase. Ejecuta la migracion de flota y recarga el schema cache antes de cambiar estados.");
    }
    throw error;
  }
  return (data && typeof data === "object" && !Array.isArray(data))
    ? data as ControlUnitStatusResult
    : {};
}

export async function saveProvisionalRentalState(input: {
  userId: string;
  clientId: string;
  clientData: Client;
  unitId: string;
  fleetStatus: "provisional_rental" | "libre";
}): Promise<Client> {
  const client = getCloudClient();
  const { data, error } = await client.rpc("save_provisional_rental_state", {
    p_owner_user_id: input.userId,
    p_client_id: input.clientId,
    p_client_data: input.clientData,
    p_unit_id: input.unitId,
    p_fleet_status: input.fleetStatus
  });
  if (error) throw error;
  return (data && typeof data === "object" && !Array.isArray(data)) ? data as Client : input.clientData;
}
