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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function safeString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseEvidence(dataUrl: unknown) {
  if (typeof dataUrl !== "string") throw new Error("Comprobante no válido");
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Comprobante no válido");
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = allowedMime.get(mime);
  if (!extension) throw new Error("Comprobante no válido");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) throw new Error("El comprobante debe pesar 4 MB o menos");

  const validSignature = mime === "application/pdf"
    ? bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
    : mime === "image/jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mime === "image/png"
        ? bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
        : bytes.length >= 12
          && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
          && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (!validSignature) throw new Error("El contenido del comprobante no coincide con su formato");
  return { bytes, mime, extension };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function publicError(error: unknown): { message: string; status: number; code?: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("PORTAL_INVALID_CREDENTIALS")) {
    return { message: "No pudimos verificar los datos. Revísalos e intenta nuevamente.", status: 401, code: "INVALID_CREDENTIALS" };
  }
  if (message.includes("PORTAL_SESSION_INVALID")) {
    return { message: "Tu sesión venció. Ingresa nuevamente.", status: 401, code: "SESSION_EXPIRED" };
  }
  if (message.includes("PORTAL_ACCOUNT_UNAVAILABLE")) {
    return { message: "Esta cuenta no está disponible. Comunícate con Rentautos.", status: 403, code: "ACCOUNT_UNAVAILABLE" };
  }
  if (message.includes("PORTAL_DUPLICATE_NOTICE")) {
    return { message: "Este comprobante ya fue enviado.", status: 409, code: "DUPLICATE_NOTICE" };
  }
  if (message.includes("Comprobante") || message.includes("comprobante") || message.includes("Monto")) {
    return { message, status: 400, code: "INVALID_NOTICE" };
  }
  return { message: "No se pudo completar la operación. Intenta nuevamente.", status: 400 };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Servicio no configurado");
    const client = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const payload = await request.json();
    const action = safeString(payload?.action, 32);

    if (action === "login") {
      const { data, error } = await client.rpc("client_portal_login", {
        p_cedula: safeString(payload.cedula, 32),
        p_pin: safeString(payload.pin, 6)
      });
      if (error) throw error;
      if (data?.error === "PORTAL_INVALID_CREDENTIALS") throw new Error("PORTAL_INVALID_CREDENTIALS");
      return json(data);
    }

    const sessionToken = safeString(payload?.sessionToken, 128);
    if (!sessionToken) throw new Error("PORTAL_SESSION_INVALID");

    if (action === "snapshot") {
      const { data, error } = await client.rpc("client_portal_snapshot", { p_session_token: sessionToken });
      if (error) throw error;
      return json(data);
    }

    if (action === "logout") {
      const { error } = await client.rpc("client_portal_logout", { p_session_token: sessionToken });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "submitPayment") {
      const amount = Number(payload.amount);
      const clientId = safeString(payload.clientId, 128);
      const paymentChannel = safeString(payload.paymentChannel, 32);
      if (!clientId) throw new Error("Unidad no válida");
      if (paymentChannel !== "ach_xpress" && paymentChannel !== "regular_transfer") {
        throw new Error("Método de transferencia no válido");
      }
      if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99 || Math.round(amount * 100) !== amount * 100) {
        throw new Error("Monto no válido");
      }
      const evidenceName = safeString(payload.evidenceName, 240);
      const evidence = parseEvidence(payload.evidenceDataUrl);
      const evidenceSha256 = await sha256(evidence.bytes);
      const { data: preparation, error: prepareError } = await client.rpc("prepare_client_payment_notice", {
        p_session_token: sessionToken,
        p_client_id: clientId,
        p_amount: amount,
        p_evidence_name: evidenceName,
        p_evidence_mime: evidence.mime,
        p_evidence_size: evidence.bytes.length,
        p_evidence_sha256: evidenceSha256
      });
      if (prepareError) throw prepareError;
      const path = typeof preparation?.path === "string" ? preparation.path : "";
      const noticeId = typeof preparation?.noticeId === "string" ? preparation.noticeId : "";
      if (!path || !noticeId) throw new Error("No se pudo preparar el comprobante");

      const { error: uploadError } = await client.storage.from("client-payment-evidence").upload(path, evidence.bytes, {
        contentType: evidence.mime,
        cacheControl: "31536000",
        upsert: false
      });
      if (uploadError) throw uploadError;

      const { data, error: finalizeError } = await client.rpc("finalize_client_payment_notice", {
        p_session_token: sessionToken,
        p_client_id: clientId,
        p_notice_id: noticeId,
        p_amount: amount,
        p_evidence_name: evidenceName,
        p_evidence_path: path,
        p_evidence_mime: evidence.mime,
        p_evidence_size: evidence.bytes.length,
        p_evidence_sha256: evidenceSha256,
        p_payment_channel: paymentChannel
      });
      if (finalizeError) {
        await client.storage.from("client-payment-evidence").remove([path]);
        throw finalizeError;
      }
      return json(data);
    }

    return json({ error: "Operación no válida" }, 400);
  } catch (error) {
    const safe = publicError(error);
    return json({ error: safe.message, code: safe.code }, safe.status);
  }
});
