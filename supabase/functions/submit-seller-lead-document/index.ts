import { createClient } from "https://esm.sh/@supabase/supabase-js@2.104.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const allowedMime = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function parseDocument(dataUrl: unknown) {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Documento no válido");
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = allowedMime.get(mime);
  if (!extension) throw new Error("Documento no válido");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) throw new Error("Documento demasiado grande");
  return { bytes, mime, extension };
}

async function hashDocument(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Servicio no configurado");
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const payload = await request.json();
    const mode = payload?.mode;
    if (mode !== "shared" && mode !== "token") throw new Error("Solicitud no válida");
    const cedula = typeof payload.cedula === "string" ? payload.cedula : "";
    const birthDate = typeof payload.birthDate === "string" ? payload.birthDate : "";
    const attachmentName = typeof payload.attachmentName === "string" ? payload.attachmentName.slice(0, 240) : "";
    const document = parseDocument(payload.attachmentDataUrl);
    const sha256 = document ? await hashDocument(document.bytes) : null;

    const prepareName = mode === "shared" ? "prepare_shared_seller_lead_upload" : "prepare_token_seller_lead_upload";
    const prepareArgs = mode === "shared"
      ? { p_portal_id: payload.portalId, p_cedula: cedula, p_birth_date: birthDate, p_attachment_name: attachmentName,
          p_mime: document?.mime ?? null, p_size: document?.bytes.length ?? null, p_sha256: sha256 }
      : { p_token: payload.token, p_cedula: cedula, p_birth_date: birthDate, p_attachment_name: attachmentName,
          p_mime: document?.mime ?? null, p_size: document?.bytes.length ?? null, p_sha256: sha256 };
    const { data: preparation, error: prepareError } = await client.rpc(prepareName, prepareArgs);
    if (prepareError) throw prepareError;
    if (mode === "shared" && preparation?.shouldUpload === false) return json(preparation.result);

    let path: string | null = null;
    if (document && sha256) {
      const ownerId = preparation?.ownerId;
      if (typeof ownerId !== "string") throw new Error("Propietario no válido");
      path = `${ownerId}/${sha256.slice(0, 2)}/${sha256}.${document.extension}`;
      const { error: uploadError } = await client.storage.from("lead-documents").upload(path, document.bytes, {
        contentType: document.mime, cacheControl: "31536000", upsert: false
      });
      const duplicate = uploadError && (Number(uploadError.statusCode) === 409 || uploadError.message.toLowerCase().includes("already exists"));
      if (uploadError && !duplicate) throw uploadError;
    }

    const finalizeName = mode === "shared" ? "finalize_shared_seller_lead_upload" : "finalize_token_seller_lead_upload";
    const finalizeArgs = mode === "shared"
      ? { p_portal_id: payload.portalId, p_cedula: cedula, p_birth_date: birthDate, p_attachment_name: attachmentName,
          p_attachment_path: path, p_mime: document?.mime ?? null, p_size: document?.bytes.length ?? null, p_sha256: sha256 }
      : { p_token: payload.token, p_cedula: cedula, p_birth_date: birthDate, p_attachment_name: attachmentName,
          p_attachment_path: path, p_mime: document?.mime ?? null, p_size: document?.bytes.length ?? null, p_sha256: sha256 };
    const { data: result, error: finalizeError } = await client.rpc(finalizeName, finalizeArgs);
    if (finalizeError) throw finalizeError;
    return json(mode === "shared" ? result : { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar el documento";
    const safeMessage = message.includes("PORTAL_RATE_LIMIT") ? "PORTAL_RATE_LIMIT"
      : message.includes("PORTAL_UNAVAILABLE") ? "PORTAL_UNAVAILABLE"
      : message.includes("venc") ? "La solicitud venció"
      : message.includes("Documento") ? message
      : "No se pudo completar la solicitud";
    return json({ error: safeMessage }, 400);
  }
});
