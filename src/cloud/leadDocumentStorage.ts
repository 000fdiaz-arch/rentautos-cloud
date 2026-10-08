import { getCloudClient } from "./cloudClient";

const LEAD_DOCUMENTS_BUCKET = "lead-documents";
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const extensionByMime = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["application/octet-stream", "bin"]
]);

export type StoredLeadDocument = {
  attachmentPath: string;
  attachmentMime: string;
  attachmentSize: number;
  attachmentSha256: string;
};

export function isLeadDocumentDataUrl(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

function parseLeadDocumentDataUrl(dataUrl: string): { bytes: Uint8Array<ArrayBuffer>; mime: string; extension: string } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("El documento no tiene un formato válido.");
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = extensionByMime.get(mime);
  if (!extension) throw new Error("El tipo de documento no está permitido.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error("El documento supera el tamaño permitido.");
  }
  return { bytes, mime, extension };
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function isAlreadyStored(error: { statusCode?: string | number; status?: number; message?: string } | null): boolean {
  if (!error) return false;
  const status = Number(error.statusCode ?? error.status ?? 0);
  return status === 409 || (error.message ?? "").toLowerCase().includes("already exists");
}

export async function uploadLeadDocumentDataUrl(userId: string, dataUrl: string): Promise<StoredLeadDocument> {
  const parsed = parseLeadDocumentDataUrl(dataUrl);
  const attachmentSha256 = await sha256Hex(parsed.bytes);
  const attachmentPath = `${userId}/${attachmentSha256.slice(0, 2)}/${attachmentSha256}.${parsed.extension}`;
  const { error } = await getCloudClient().storage.from(LEAD_DOCUMENTS_BUCKET).upload(
    attachmentPath,
    new Blob([parsed.bytes], { type: parsed.mime }),
    { contentType: parsed.mime, cacheControl: "31536000", upsert: false }
  );
  if (error && !isAlreadyStored(error)) throw error;
  return {
    attachmentPath,
    attachmentMime: parsed.mime,
    attachmentSize: parsed.bytes.length,
    attachmentSha256
  };
}

export async function createLeadDocumentViewUrl(path: string): Promise<string> {
  const { data, error } = await getCloudClient().storage.from(LEAD_DOCUMENTS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
