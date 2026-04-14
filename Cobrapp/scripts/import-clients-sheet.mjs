import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import XLSX from "xlsx";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function usageAndExit() {
  console.error(
    [
      "Uso:",
      "  npm run import:clients -- --in <archivo.xlsx|archivo.csv> [--out <respaldo.json>] [--state <respaldo-base.json>] [--merge]",
      "",
      "Ejemplo:",
      "  npm run import:clients -- --in tmp-verify/clientes.xlsx --out tmp-verify/respaldo-clientes.json",
      "  npm run import:clients -- --in tmp-verify/clientes.xlsx --state tmp-verify/respaldo-actual.json --merge"
    ].join("\n")
  );
  process.exit(1);
}

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function decodeHtmlText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\u00C2/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlTableRows(htmlText) {
  const tableMatch = htmlText.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];

  const rows = [];
  const trRegex = /<tr[\s\S]*?<\/tr>/gi;
  const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let tr;
  while ((tr = trRegex.exec(tableMatch[0])) !== null) {
    const cells = [];
    let td;
    while ((td = tdRegex.exec(tr[0])) !== null) {
      cells.push(decodeHtmlText(td[1]));
    }
    if (cells.some((c) => c !== "")) rows.push(cells);
  }
  if (rows.length < 2) return [];

  const header = rows[0];
  return rows.slice(1).map((line) => {
    const obj = {};
    for (let i = 0; i < header.length; i += 1) {
      const key = header[i] || `col_${i + 1}`;
      obj[key] = line[i] ?? "";
    }
    return obj;
  });
}

async function readRowsWithFallback(inputPath) {
  const workbook = XLSX.readFile(inputPath, { cellDates: false, raw: true });
  const firstSheet = workbook.SheetNames[0];
  if (firstSheet) {
    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (rows.length > 0) return rows;
  }

  // Fallback: old Excel HTML export (*.xls + _archivos/sheet001.htm)
  const mainHtml = await fs.readFile(inputPath, "utf8");
  let rows = parseHtmlTableRows(mainHtml);
  if (rows.length > 0) return rows;

  const shLinkMatch = mainHtml.match(/id=["']shLink["'][^>]*href=["']([^"']+)["']/i);
  if (!shLinkMatch) return [];
  const relativeSheetPath = decodeURIComponent(shLinkMatch[1]);
  const sheetPath = path.resolve(path.dirname(inputPath), relativeSheetPath);
  if (!fsSync.existsSync(sheetPath)) return [];
  const sheetHtml = await fs.readFile(sheetPath, "utf8");
  rows = parseHtmlTableRows(sheetHtml);
  return rows;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parseMoney(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const raw = String(value).trim();
  if (!raw || raw === "-") return fallback;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntSafe(value, fallback = 0) {
  const parsed = parseMoney(value, Number.NaN);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeCedula(value) {
  const raw = String(value ?? "").trim();
  return raw && raw !== "-" ? raw : undefined;
}

function parseFrequency(rawFrequency) {
  const normalized = normalizeText(rawFrequency);
  if (!normalized) return { frequency: "monthly", weeklyChargeDay: undefined };

  if (normalized.includes("DIARIO")) {
    return { frequency: "daily", weeklyChargeDay: undefined };
  }
  if (normalized.includes("QUINCENAL")) {
    return { frequency: "biweekly", weeklyChargeDay: undefined };
  }
  if (normalized.includes("SEMANAL")) {
    let weeklyChargeDay = "monday";
    if (normalized.includes("MARTES")) weeklyChargeDay = "tuesday";
    if (normalized.includes("MIERCOLES")) weeklyChargeDay = "wednesday";
    if (normalized.includes("JUEVES")) weeklyChargeDay = "thursday";
    if (normalized.includes("VIERNES")) weeklyChargeDay = "friday";
    if (normalized.includes("SABADO")) weeklyChargeDay = "saturday";
    return { frequency: "weekly", weeklyChargeDay };
  }
  return { frequency: "monthly", weeklyChargeDay: undefined };
}

function parseOtherCharges(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text === "-") return [];

  return text
    .split(/[|;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)(-?\d+(?:[.,]\d+)?)$/);
      if (!match) return null;
      const label = match[1].trim() || "Cargo";
      const amount = parseMoney(match[2], 0);
      if (!Number.isFinite(amount) || amount === 0) return null;
      return { label, amount };
    })
    .filter((item) => item !== null);
}

function mapRow(row, nowIso, lastChargeDate) {
  const unitId = String(row.unitId ?? "").trim();
  const name = String(row.name ?? "").trim();
  if (!unitId || !name) return null;

  const installmentsAgreed = parseIntSafe(row.installmentsAgreed, 0);
  const installmentsRemaining = parseIntSafe(row.installmentsRemaining, 0);
  const installmentsPaid = Math.max(0, installmentsAgreed - installmentsRemaining);
  const { frequency, weeklyChargeDay } = parseFrequency(row.frequency);

  const client = {
    id: crypto.randomUUID(),
    unitId,
    cedula: normalizeCedula(row.cedula),
    name,
    rentAmount: parseMoney(row.rentAmount, 0),
    frequency,
    chargeFirstSunday: false,
    installmentsAgreed,
    installmentsRemaining,
    installmentsPaid,
    otherCharges: parseOtherCharges(row.otherCharges),
    balance: parseMoney(row.balance, 0),
    advanceBalance: 0,
    savings: 0,
    createdAt: nowIso,
    lastChargeDate,
    status: "active"
  };

  if (frequency === "weekly") client.weeklyChargeDay = weeklyChargeDay ?? "monday";
  if (frequency === "monthly") client.monthlyChargeDay = 1;

  return client;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mapHeaders(rawRow) {
  const row = {};
  for (const [key, value] of Object.entries(rawRow)) {
    const h = normalizeHeader(key);
    if (h === "unidad/id" || h === "unidad id") row.unitId = value;
    if (h === "cedula") row.cedula = value;
    if (h === "cliente") row.name = value;
    if (h === "renta (usd)" || h === "renta usd" || h === "renta") row.rentAmount = value;
    if (h === "frecuencia") row.frequency = value;
    if (h === "cuotas pactadas") row.installmentsAgreed = value;
    if (h === "cuotas restantes") row.installmentsRemaining = value;
    if (h === "otros cargos") row.otherCharges = value;
    if (h === "monto a cobrar") row.balance = value;
  }
  return row;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inPath = args.in;
  if (!inPath) usageAndExit();

  const inputPath = path.resolve(inPath);
  const outPath = path.resolve(args.out ?? path.join(process.cwd(), "tmp-verify", "respaldo-clientes.json"));
  const statePath = args.state ? path.resolve(args.state) : null;

  const rawRows = await readRowsWithFallback(inputPath);
  if (!rawRows.length) {
    throw new Error("No hay filas para importar.");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const lastChargeDate = toDateKey(now);

  const byUnitId = new Map();
  for (const raw of rawRows) {
    const mapped = mapHeaders(raw);
    const client = mapRow(mapped, nowIso, lastChargeDate);
    if (!client) continue;
    byUnitId.set(client.unitId.toLowerCase(), client);
  }

  let clients = [...byUnitId.values()];
  let payments = [];

  if (statePath) {
    const baseRaw = await fs.readFile(statePath, "utf8");
    const base = JSON.parse(baseRaw.replace(/^\uFEFF/, ""));
    if (Array.isArray(base?.payments)) {
      payments = base.payments;
    }
    if (args.merge === true && Array.isArray(base?.clients)) {
      const merged = new Map();
      for (const existing of base.clients) {
        if (!existing || typeof existing !== "object") continue;
        const unitId = String(existing.unitId ?? "").trim();
        if (!unitId) continue;
        merged.set(unitId.toLowerCase(), existing);
      }
      for (const incoming of clients) {
        merged.set(incoming.unitId.toLowerCase(), incoming);
      }
      clients = [...merged.values()];
    }
  }

  const backup = { clients, payments };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(backup, null, 2), "utf8");

  console.log(`Importacion lista: ${clients.length} cliente(s).`);
  if (payments.length > 0) {
    console.log(`Pagos preservados desde respaldo base: ${payments.length}.`);
  }
  console.log(`Archivo generado: ${outPath}`);
  console.log("Ahora en Cobrapp usa el boton 'Cargar respaldo' y selecciona ese JSON.");
}

main().catch((error) => {
  console.error("Error al importar clientes:", error?.message ?? error);
  process.exit(1);
});
