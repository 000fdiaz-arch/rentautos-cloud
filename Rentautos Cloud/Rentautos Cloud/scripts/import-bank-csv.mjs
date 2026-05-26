import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import * as XLSX from "xlsx";

const BRIDGE_ACCOUNT = "CUENTA_PUENTE_GLOBAL";
const XLSX_LIB = XLSX.default ?? XLSX;

function printUsage() {
  console.log(
    [
      "Uso:",
      "  npm run import:bank -- --csv <movimientos.csv> --state <estado.json> [--out <estado-actualizado.json>] [--log <log.json>]",
      "",
      "Formato esperado de --state:",
      "  {",
      '    "clients": [...],',
      '    "payments": [...]',
      "  }",
      "",
      "Tambien soporta el backup de Rentautos:",
      "  { version, exportedAt, clients, payments }"
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key.slice(2)] = true;
      continue;
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, "");
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseMoney(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? roundMoney(value) : NaN;
  }

  const raw = normalizeText(value);
  if (!raw) return NaN;

  let cleaned = raw.replace(/[^\d,.-]/g, "");
  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const dotCount = (cleaned.match(/\./g) ?? []).length;

  if (commaCount > 0 && dotCount > 0) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (commaCount > 0 && dotCount === 0) {
    cleaned = cleaned.replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? roundMoney(parsed) : NaN;
}

function toISODate(value) {
  if (typeof value === "number") {
    const parsed = XLSX_LIB.SSF.parse_date_code(value);
    if (!parsed) return "";
    const y = String(parsed.y).padStart(4, "0");
    const m = String(parsed.m).padStart(2, "0");
    const d = String(parsed.d).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const raw = normalizeText(value);
  if (!raw) return "";

  const dmY = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmY) {
    const dd = Number(dmY[1]);
    const mm = Number(dmY[2]);
    let yy = Number(dmY[3]);
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) return "";
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDescription(description) {
  const clean = normalizeText(description);
  if (!clean) return { referenceId: "", clientName: "" };

  const byBancoGeneral = clean.match(/BANCO GENERAL-(\d+)/i);
  let referenceId = byBancoGeneral?.[1] ?? "";

  if (!referenceId) {
    const byHyphenDigits = clean.match(/-(\d{4,})(?:-|$)/);
    referenceId = byHyphenDigits?.[1] ?? "";
  }

  const segments = clean.split("-").map((part) => normalizeText(part)).filter(Boolean);
  const clientName = segments.length > 0 ? segments[segments.length - 1] : "";

  return { referenceId, clientName };
}

function inferBankPaymentMethod(transactionCode, description) {
  const code = normalizeText(transactionCode);
  const text = normalizeName(description);

  // Primary mapping by transaction code
  if (code === "253-215") return "ACH Express";
  if (code === "252" || code === "253-921") return "Deposito Bancario";
  if (code === "253-104" || code === "2627" || code === "253-934") return "Transferencia Bancaria";

  // Fallback mapping by description text
  if (/\bXPRESS\b|\bX?PRESS\b|ACH\s*XP/.test(text)) return "ACH Express";
  if (/\bDEPOSITO\b|\bDEPOS\b|\bCNB\b|DEPOSITO COMERCIOS/.test(text)) return "Deposito Bancario";
  return "Transferencia Bancaria";
}

function toRecordWithNormalizedHeaders(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[normalizeHeader(key)] = value;
  }
  return out;
}

function pickField(row, aliases) {
  for (const alias of aliases) {
    if (alias in row) return row[alias];
  }
  return "";
}

function buildExistingFolioSet(payments) {
  const folios = new Set();
  for (const payment of payments) {
    if (!payment || typeof payment !== "object") continue;
    const ref = typeof payment.reference === "string" ? payment.reference : "";
    const direct = ref.match(/(?:^|\s)FOLIO:([A-Za-z0-9-]+)/i);
    if (direct) folios.add(direct[1]);
  }
  return folios;
}

function getContractCandidates(client) {
  return [client.unitId, client.id, client.cedula]
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function buildClientIndexes(clients) {
  const byContract = new Map();
  const byName = new Map();
  const activeClients = [];

  for (const client of clients) {
    if (!client || typeof client !== "object") continue;
    if (client.archivedAt || client.status === "inactive") continue;

    activeClients.push(client);

    for (const key of getContractCandidates(client)) {
      if (!byContract.has(key)) byContract.set(key, []);
      byContract.get(key).push(client);
    }

    const nameKey = normalizeName(client.name);
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey).push(client);
  }

  return { byContract, byName, activeClients };
}

/**
 * Fuzzy match: find clients whose normalized name STARTS WITH the extracted name.
 * Only returns a match when exactly one client matches (to avoid ambiguity).
 */
function findByNamePrefix(activeClients, extractedName) {
  if (!extractedName) return null;
  const prefix = normalizeName(extractedName);
  if (prefix.length < 4) return null; // too short to be reliable
  const matches = activeClients.filter((c) => normalizeName(c.name).startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

function inferNextReceiptNumber(payments) {
  let maxSeq = 0;
  for (const payment of payments) {
    const rec = normalizeText(payment?.receiptNumber);
    const match = rec.match(/^REC-(\d+)$/i);
    if (!match) continue;
    const seq = Number(match[1]);
    if (Number.isFinite(seq)) maxSeq = Math.max(maxSeq, seq);
  }
  return () => {
    maxSeq += 1;
    return `REC-${String(maxSeq).padStart(4, "0")}`;
  };
}

function computeInstallmentsDeducted(client, appliedToRent, nextBalance) {
  const rentAmount = Number(client.rentAmount);
  if (!Number.isFinite(rentAmount) || rentAmount <= 0) return 0;
  const balanceBefore = Number(client.balance);
  const pendingBefore = balanceBefore > 0 ? Math.ceil(balanceBefore / rentAmount) : 0;
  const pendingAfter = nextBalance > 0 ? Math.ceil(nextBalance / rentAmount) : 0;
  return Math.max(0, pendingBefore - pendingAfter);
}

async function readState(statePath) {
  const raw = await fs.readFile(statePath, "utf8");
  const parsed = JSON.parse(raw);
  const clients = Array.isArray(parsed?.clients) ? parsed.clients : [];
  const payments = Array.isArray(parsed?.payments) ? parsed.payments : [];
  return { raw: parsed, clients, payments };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const csvPath = args.csv;
  const statePath = args.state;
  if (!csvPath || !statePath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const outPath = args.out ?? path.join(process.cwd(), "tmp-verify", "imported-state.json");
  const logPath = args.log ?? path.join(process.cwd(), "tmp-verify", "import-log.json");

  const { raw, clients, payments } = await readState(statePath);
  const workbook = XLSX_LIB.readFile(csvPath, { cellDates: false, raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX_LIB.utils.sheet_to_json(sheet, { defval: "" });
  const normalizedRows = rows.map(toRecordWithNormalizedHeaders);

  const existingFolios = buildExistingFolioSet(payments);
  const seenFoliosInFile = new Set();
  const clientsById = new Map(clients.map((c) => [c.id, { ...c }]));
  const { byContract, byName, activeClients } = buildClientIndexes(clients);
  const nextReceiptNumber = inferNextReceiptNumber(payments);

  const newPayments = [];
  const pendingClassification = [];
  const notFoundNames = new Set();

  let creditsRead = 0;
  let duplicatesSkipped = 0;
  let invalidRows = 0;
  let processedCredits = 0;
  let totalCapitalApplied = 0;
  let totalCentavosSavings = 0;

  for (const row of normalizedRows) {
    const folioRaw = pickField(row, ["folio", "idtransaccion", "id"]);
    const fechaRaw = pickField(row, ["fecha", "fechapago"]);
    const creditoRaw = pickField(row, ["credito", "credito$", "credit"]);
    const descripcionRaw = pickField(row, ["descripcion", "referenciaorigen", "detalle"]);
    const transactionCodeRaw = pickField(row, ["codigodetransaccion", "codigotransaccion"]);

    const folio = normalizeText(folioRaw);
    const credito = parseMoney(creditoRaw);
    if (!Number.isFinite(credito) || credito <= 0) continue;
    creditsRead += 1;

    if (!folio) {
      invalidRows += 1;
      continue;
    }

    if (existingFolios.has(folio) || seenFoliosInFile.has(folio)) {
      duplicatesSkipped += 1;
      continue;
    }

    seenFoliosInFile.add(folio);

    const amount = roundMoney(credito);
    const capitalPart = Math.floor(amount);
    const centsPart = roundMoney(amount - capitalPart);
    const dateApplied = toISODate(fechaRaw) || new Date().toISOString().slice(0, 10);
    const description = normalizeText(descripcionRaw);
    const transactionCode = normalizeText(transactionCodeRaw);
    const { referenceId, clientName } = parseDescription(description);
    const paymentMethod = inferBankPaymentMethod(transactionCode, description);

    let matchedClient = null;
    let matchType = "";

    if (referenceId) {
      const byContractMatch = byContract.get(referenceId) ?? [];
      if (byContractMatch.length === 1) { matchedClient = byContractMatch[0]; matchType = "contrato"; }
    }

    if (!matchedClient && clientName) {
      const byNameMatch = byName.get(normalizeName(clientName)) ?? [];
      if (byNameMatch.length === 1) { matchedClient = byNameMatch[0]; matchType = "nombre-exacto"; }
    }

    // Fallback: prefix match for truncated bank names (e.g. "RICHARD ALEXANDER" -> "RICHARD ALEXANDER GARCIA PINZON")
    if (!matchedClient && clientName) {
      const prefixMatch = findByNamePrefix(activeClients, clientName);
      if (prefixMatch) { matchedClient = prefixMatch; matchType = "nombre-prefijo"; }
    }

    if (!matchedClient) {
      notFoundNames.add(clientName || "(SIN NOMBRE)");
      pendingClassification.push({
        folio,
        dateApplied,
        amountReceived: amount,
        capitalPart,
        centsPart,
        referenceId,
        extractedName: clientName,
        description,
        transactionCode,
        bridgeAccount: BRIDGE_ACCOUNT,
        reason: "No hubo match exacto por contrato ni nombre."
      });
      continue;
    }

    const client = clientsById.get(matchedClient.id);
    if (!client) {
      invalidRows += 1;
      continue;
    }

    const balanceBefore = roundMoney(Number(client.balance) || 0);
    const savingsBefore = roundMoney(Number(client.savings) || 0);
    const appliedToRent = roundMoney(Math.min(capitalPart, Math.max(0, balanceBefore)));
    const extraCapitalToSavings = roundMoney(Math.max(0, capitalPart - appliedToRent));
    const centavosAhorro = roundMoney(centsPart + extraCapitalToSavings);
    const balanceAfter = roundMoney(Math.max(0, balanceBefore - appliedToRent));
    const savingsAfter = roundMoney(savingsBefore + centavosAhorro);
    const installmentsDeducted = computeInstallmentsDeducted(client, appliedToRent, balanceAfter);

    const installmentsPaidAfter = Math.max(0, Number(client.installmentsPaid) || 0) + installmentsDeducted;
    const installmentsRemainingAfter = Math.max(
      0,
      (Number(client.installmentsRemaining) || 0) - installmentsDeducted
    );

    const payment = {
      id: crypto.randomUUID(),
      receiptNumber: nextReceiptNumber(),
      clientId: client.id,
      clientName: client.name,
      clientUnit: client.unitId,
      clientCedula: client.cedula,
      dateApplied,
      paymentMethod,
      reference: `FOLIO:${folio} | REF:${referenceId || "N/A"} | MATCH:${matchType} | ${description}`,
      amountReceived: amount,
      appliedToRent,
      centavosAhorro,
      installmentsDeducted,
      balanceBefore,
      balanceAfter,
      savingsBefore,
      savingsAfter,
      installmentsPaidAfter,
      installmentsRemainingAfter,
      rentAmount: Number(client.rentAmount) || 0,
      frequency: client.frequency,
      weeklyChargeDay: client.weeklyChargeDay,
      monthlyChargeDay: client.monthlyChargeDay,
      createdAt: new Date().toISOString()
    };

    newPayments.push(payment);
    processedCredits += 1;
    totalCapitalApplied = roundMoney(totalCapitalApplied + appliedToRent);
    totalCentavosSavings = roundMoney(totalCentavosSavings + centavosAhorro);

    clientsById.set(client.id, {
      ...client,
      balance: balanceAfter,
      savings: savingsAfter,
      installmentsPaid: installmentsPaidAfter,
      installmentsRemaining: installmentsRemainingAfter
    });
  }

  const updatedClients = clients.map((client) => clientsById.get(client.id) ?? client);
  const updatedPayments = [...payments, ...newPayments];

  const updatedState =
    raw && typeof raw === "object"
      ? { ...raw, clients: updatedClients, payments: updatedPayments }
      : { clients: updatedClients, payments: updatedPayments };

  const bridgeTotal = roundMoney(
    pendingClassification.reduce((acc, row) => acc + Number(row.amountReceived || 0), 0)
  );

  const report = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.resolve(csvPath),
    stateFile: path.resolve(statePath),
    summary: {
      creditsRead,
      processedCredits,
      duplicatesSkipped,
      invalidRows,
      pendingClassificationCount: pendingClassification.length,
      totalCapitalApplied,
      totalCentavosSavings
    },
    bridgeAccount: {
      account: BRIDGE_ACCOUNT,
      totalPendingAmount: bridgeTotal
    },
    notFoundNames: Array.from(notFoundNames).sort(),
    pendingClassification
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(updatedState, null, 2), "utf8");
  await fs.writeFile(logPath, JSON.stringify(report, null, 2), "utf8");

  console.log("Importacion completada.");
  console.log(`- Estado actualizado: ${path.resolve(outPath)}`);
  console.log(`- Log de conciliacion: ${path.resolve(logPath)}`);
  console.log(`- Creditos procesados: ${processedCredits}`);
  console.log(`- Capital aplicado: ${totalCapitalApplied.toFixed(2)}`);
  console.log(`- Centavos/ahorro: ${totalCentavosSavings.toFixed(2)}`);
  console.log(`- Pendientes de clasificacion: ${pendingClassification.length} (Cuenta puente: ${BRIDGE_ACCOUNT})`);
}

main().catch((error) => {
  console.error("Error en importacion bancaria:", error);
  process.exitCode = 1;
});
