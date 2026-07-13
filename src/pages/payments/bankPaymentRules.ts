import { parseDateKey, toDateKey } from "../../billing";
import type { BankRule, Client, Payment, PaymentMethod, PendingCardItem } from "../../types";
import {
  BANK_PAYMENT_METHODS,
  NOTIFIED_AMOUNT_TOLERANCE,
  NOTIFIED_DAYS_WINDOW
} from "./paymentConstants";
import { roundMoney } from "./paymentRules";
import type { NotifiedPayment } from "./paymentTypes";

export function repairMojibake(value: string): string {
  if (!/[\u00C3\u00C2\u00E2]/.test(value)) return value;
  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}

export function normalizeBankText(value: string): string {
  return repairMojibake(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBankName(value: string): string {
  return normalizeBankText(value).toUpperCase();
}

export function normalizeAccountNumber(value: string): string {
  return normalizeBankText(value).replace(/\D+/g, "");
}

export function normalizeFolioToken(value: string): string {
  return normalizeBankText(value).toUpperCase().replace(/\s+/g, "");
}

export function extractFoliosFromReference(reference: string): string[] {
  const normalized = normalizeBankText(reference);
  if (!normalized) return [];

  const taggedFolios = Array.from(normalized.matchAll(/FOLIO\s*:\s*([^\s|]+)/gi))
    .map((match) => normalizeFolioToken(match[1] ?? ""))
    .filter((folio) => folio.length > 0);
  if (taggedFolios.length > 0) {
    return [...new Set(taggedFolios)];
  }

  const legacyFallback = normalizeFolioToken(
    normalized
      .replace(/^REFERENCIA\s*:\s*/i, "")
      .replace(/^REF\s*:\s*/i, "")
      .replace(/^FOLIO\s*:?/i, "")
  );
  return legacyFallback ? [legacyFallback] : [];
}

export function buildExistingBankFolioSet(rows: Payment[]): Set<string> {
  const set = new Set<string>();
  for (const payment of rows) {
    if (!BANK_PAYMENT_METHODS.has(payment.paymentMethod)) continue;
    for (const folio of extractFoliosFromReference(payment.reference ?? "")) {
      set.add(folio);
    }
  }
  return set;
}

export function buildExistingProcessedFolioSetForCsvImport(rows: Payment[]): Set<string> {
  const set = new Set<string>();
  for (const payment of rows) {
    const reference = payment.reference ?? "";
    const isBankPayment = BANK_PAYMENT_METHODS.has(payment.paymentMethod);
    const isReconciledCardPayment =
      payment.paymentMethod === "Tarjeta" &&
      reference.toUpperCase().includes("TARJETA-CONCILIADA");
    if (!isBankPayment && !isReconciledCardPayment) continue;
    for (const folio of extractFoliosFromReference(reference)) {
      set.add(folio);
    }
  }
  return set;
}

export function buildExistingCardPendingFolioSet(rows: PendingCardItem[]): Set<string> {
  const set = new Set<string>();
  for (const item of rows) {
    const folio = normalizeFolioToken(item.folio);
    if (folio) set.add(folio);
  }
  return set;
}

export function extractGroupCodeFromUnit(unitId: string): string {
  const match = normalizeBankText(unitId).match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : "";
}

export function findMappedGroupByAccount(accountNumber: string, bankRules: BankRule[]): string {
  const normalizedAccount = normalizeAccountNumber(accountNumber);
  if (!normalizedAccount) return "";
  const activeRule = bankRules.find(
    (rule) => rule.active && normalizeAccountNumber(rule.accountNumber) === normalizedAccount
  );
  return activeRule ? normalizeBankText(activeRule.groupCode).toUpperCase() : "";
}

export function parseBankDescription(description: string): { referenceId: string; extractedName: string } {
  const clean = normalizeBankText(description);
  const byBancoGeneral = clean.match(/BANCO GENERAL-(\d+)/i) ?? clean.match(/ST\. GEORGES BANK-(\d+)/i);
  let referenceId = byBancoGeneral?.[1] ?? "";
  if (!referenceId) {
    const byHyphen = clean.match(/-(\d{4,})(?:-|$)/);
    referenceId = byHyphen?.[1] ?? "";
  }
  const segments = clean.split("-").map((s) => normalizeBankText(s)).filter(Boolean);
  const extractedNameRaw = segments.length > 0 ? segments[segments.length - 1] : "";
  const extractedName = extractedNameRaw.replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return { referenceId, extractedName };
}

export function inferBankPaymentMethod(transactionCode: string | undefined, description: string): PaymentMethod {
  const code = normalizeBankText(transactionCode ?? "");
  const text = normalizeBankName(description);

  // Primary mapping by bank transaction code (validated from real CSV history)
  if (code === "253-215") return "ACH Express";
  if (code === "252" || code === "253-921") return "Deposito Bancario";
  if (code === "253-104" || code === "2627" || code === "253-934") return "Transferencia Bancaria";

  // Fallback mapping by description
  if (/\bXPRESS\b|\bX?PRESS\b|ACH\s*XP/.test(text)) return "ACH Express";
  if (/\bDEPOSITO\b|\bDEPOS\b|\bCNB\b|DEPOSITO COMERCIOS/.test(text)) return "Deposito Bancario";
  return "Transferencia Bancaria";
}

export function findClientByNamePrefix(name: string, candidateClients: Client[]): Client | null {
  if (!name || name.length < 4) return null;
  const prefix = normalizeBankName(name);
  const matches = candidateClients.filter((c) => normalizeBankName(c.name).startsWith(prefix));
  return matches.length === 1 ? matches[0] : null;
}

export function parseCsvRow(line: string): string[] {
  const row: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  row.push(current);
  return row;
}

export function coerceCsvColumns(line: string, expectedColumns: number): string[] | null {
  const cols = parseCsvRow(line);
  if (cols.length === expectedColumns) return cols;
  if (cols.length < expectedColumns) return null;
  const tailColumnsCount = 13; // Debito..Moneda
  if (expectedColumns !== 18 || cols.length < 5 + tailColumnsCount) return null;
  const descriptionStart = 4;
  const descriptionEnd = cols.length - tailColumnsCount - 1;
  if (descriptionEnd < descriptionStart) return null;
  const mergedDescription = cols.slice(descriptionStart, descriptionEnd + 1).join(",");
  const reconstructed = [
    ...cols.slice(0, descriptionStart),
    mergedDescription,
    ...cols.slice(descriptionEnd + 1)
  ];
  return reconstructed.length === expectedColumns ? reconstructed : null;
}

export function parseBankAmount(rawValue: string): number {
  const raw = normalizeBankText(rawValue);
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

  return Number(cleaned);
}

export function isIgnoredBankMovement(transactionCode: string, description: string): boolean {
  const code = normalizeBankText(transactionCode);
  const text = normalizeBankName(description);

  if (code.startsWith("264-")) return true;
  if (code === "52" || code === "253-592") return true;
  if (text.includes("ITBMS")) return true;
  if (text.includes("POLIZA") || text.includes("POLIZA")) return true;
  if (text.includes("PAGO DE CHEQUE")) return true;
  if (text.includes("RETENCION")) return true;
  if (text.includes("COMISION")) return true;
  if (text.includes("PRP PAGO")) return true;

  return false;
}

export function parseNotifiedDateKey(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.valueOf())) return "";
  return toDateKey(d);
}

export function isNotifiedCandidateMatch(candidate: NotifiedPayment, clientId: string, amount: number, dateApplied: string): boolean {
  if (candidate.clientId !== clientId) return false;
  if (Math.abs(roundMoney(candidate.amount) - roundMoney(amount)) > NOTIFIED_AMOUNT_TOLERANCE) return false;

  const bankDate = parseDateKey(dateApplied);
  const notifiedDate = parseDateKey(parseNotifiedDateKey(candidate.createdAt));
  if (!bankDate || !notifiedDate) return true;
  const diffDays = Math.abs(Math.round((bankDate.getTime() - notifiedDate.getTime()) / 86400000));
  return diffDays <= NOTIFIED_DAYS_WINDOW;
}

export function removeOneMatchingNotified(rows: NotifiedPayment[], clientId: string, amount: number, dateApplied: string): NotifiedPayment[] {
  const matchIndex = rows.findIndex((row) => isNotifiedCandidateMatch(row, clientId, amount, dateApplied));
  if (matchIndex === -1) return rows;
  return rows.filter((_, idx) => idx !== matchIndex);
}

export function findClientFromNotified(amount: number, dateApplied: string, candidateClients: Client[], notifiedPayments: NotifiedPayment[]): Client | null {
  const candidateSet = new Set(candidateClients.map((c) => c.id));
  const candidates = notifiedPayments.filter((row) => {
    if (Math.abs(roundMoney(row.amount) - roundMoney(amount)) > NOTIFIED_AMOUNT_TOLERANCE) return false;
    if (!candidateSet.has(row.clientId)) return false;
    const bankDate = parseDateKey(dateApplied);
    const notifiedDate = parseDateKey(parseNotifiedDateKey(row.createdAt));
    if (!bankDate || !notifiedDate) return true;
    const diffDays = Math.abs(Math.round((bankDate.getTime() - notifiedDate.getTime()) / 86400000));
    return diffDays <= NOTIFIED_DAYS_WINDOW;
  });

  const matchedClients = candidates
    .map((row) => candidateClients.find((c) => c.id === row.clientId) ?? null)
    .filter((c): c is Client => c !== null);
  const uniqueById = new Map(matchedClients.map((c) => [c.id, c]));
  if (uniqueById.size !== 1) return null;
  return [...uniqueById.values()][0];
}
