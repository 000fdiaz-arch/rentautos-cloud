// Copies Lead documents from Base64 fields to private Supabase Storage.
// Phase one is non-destructive: source Base64 values are never changed or removed.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadDotEnv, parseArg } from "./migration-common.mjs";

const BUCKET = "lead-documents";
const PAGE_SIZE = 10;
const CONCURRENCY = 5;
const env = loadDotEnv(parseArg("env", ".env"));
const apply = process.argv.includes("--apply");

if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase migration configuration");
}

const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const extensions = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["application/octet-stream", "bin"]
]);

function parseDataUrl(value) {
  if (typeof value !== "string" || !value) return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Unsupported document encoding");
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = extensions.get(mime);
  if (!extension) throw new Error(`Unsupported MIME type: ${mime}`);
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw new Error("Invalid document size");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, mime, extension, sha256 };
}

function storagePath(userId, document) {
  return `${userId}/${document.sha256.slice(0, 2)}/${document.sha256}.${document.extension}`;
}

function isAlreadyExists(error) {
  const status = Number(error?.statusCode ?? error?.status ?? 0);
  const text = `${error?.name ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return status === 409 || text.includes("already exists") || text.includes("duplicate");
}

async function upload(document, path) {
  const result = await client.storage.from(BUCKET).upload(path, document.bytes, {
    contentType: document.mime,
    cacheControl: "31536000",
    upsert: false
  });
  if (result.error && !isAlreadyExists(result.error)) throw result.error;
}

async function verifyObject(document, path) {
  if (stats.verifiedObjects.has(path)) return;
  const { data, error } = await client.storage.from(BUCKET).download(path);
  if (error) throw error;
  const storedBytes = Buffer.from(await data.arrayBuffer());
  const storedHash = createHash("sha256").update(storedBytes).digest("hex");
  if (storedBytes.length !== document.bytes.length || storedHash !== document.sha256) {
    throw new Error("Stored document verification failed");
  }
  stats.verifiedObjects.add(path);
}

const stats = {
  apply,
  scanned: 0,
  sourceDocuments: 0,
  alreadyReferenced: 0,
  copiedReferences: 0,
  uniqueObjects: new Set(),
  verifiedObjects: new Set(),
  sourceBytes: 0,
  failures: 0,
  mimeTypes: new Map()
};

async function mapWithConcurrency(items, worker) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (nextIndex < items.length) {
      const row = items[nextIndex++];
      await worker(row);
    }
  });
  await Promise.all(runners);
}

async function migrateTable({ table, select, sourceColumn, getDataUrl }) {
  let offset = 0;
  const pageSize = apply ? 1 : PAGE_SIZE;
  while (true) {
    let query = client.from(table).select(select).order("id", { ascending: true });
    query = apply
      ? query.is("attachment_path", null).not(sourceColumn, "is", null).limit(pageSize)
      : query.range(offset, offset + pageSize - 1);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.code ?? "read_failed"}`);
    const rows = data ?? [];
    const failuresBeforeBatch = stats.failures;
    await mapWithConcurrency(rows, async row => {
      stats.scanned++;
      const value = getDataUrl(row);
      if (!value) return;
      stats.sourceDocuments++;
      if (row.attachment_path) {
        stats.alreadyReferenced++;
        return;
      }
      try {
        const document = parseDataUrl(value);
        if (!document) return;
        const path = storagePath(row.user_id, document);
        stats.uniqueObjects.add(path);
        stats.sourceBytes += document.bytes.length;
        stats.mimeTypes.set(document.mime, (stats.mimeTypes.get(document.mime) ?? 0) + 1);
        if (!apply) return;
        await upload(document, path);
        await verifyObject(document, path);
        const { error: updateError } = await client.from(table).update({
          attachment_path: path,
          attachment_mime: document.mime,
          attachment_size: document.bytes.length,
          attachment_sha256: document.sha256,
          attachment_migrated_at: new Date().toISOString()
        }).eq("user_id", row.user_id).eq("id", row.id).is("attachment_path", null);
        if (updateError) throw updateError;
        stats.copiedReferences++;
      } catch (error) {
        stats.failures++;
        console.error(JSON.stringify({ table, result: "failed", reason: error?.message ?? "unknown" }));
      }
    });
    if (rows.length < pageSize || stats.failures > failuresBeforeBatch) break;
    if (!apply) offset += pageSize;
    console.log(JSON.stringify({ table, scanned: stats.scanned, copiedReferences: stats.copiedReferences, failures: stats.failures }));
  }
}

console.log(JSON.stringify({
  databaseHost: new URL(env.VITE_SUPABASE_URL).hostname,
  mode: apply ? "apply" : "dry-run",
  destructive: false
}));

await migrateTable({
  table: "lead_evaluations_cloud",
  select: "user_id,id,data,attachment_path",
  sourceColumn: "data->>attachmentDataUrl",
  getDataUrl: row => row.data?.attachmentDataUrl
});
await migrateTable({
  table: "seller_lead_requests",
  select: "user_id,id,attachment_data_url,attachment_path",
  sourceColumn: "attachment_data_url",
  getDataUrl: row => row.attachment_data_url
});

const summary = {
  apply: stats.apply,
  scanned: stats.scanned,
  sourceDocuments: stats.sourceDocuments,
  alreadyReferenced: stats.alreadyReferenced,
  copiedReferences: stats.copiedReferences,
  uniqueObjects: stats.uniqueObjects.size,
  verifiedObjects: stats.verifiedObjects.size,
  sourceBytes: stats.sourceBytes,
  failures: stats.failures,
  mimeTypes: Object.fromEntries([...stats.mimeTypes.entries()].sort())
};
console.log(JSON.stringify(summary));
if (stats.failures > 0) process.exitCode = 1;
