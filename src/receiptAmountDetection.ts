export type ReceiptAmountConfidence = "high" | "medium" | "low";
export type PortalPaymentChannel = "ach_xpress" | "regular_transfer";
export type ReceiptDestinationStatus = "verified" | "mismatch" | "manual_review";

export type ReceiptAmountResult = {
  amount: number | null;
  confidence: ReceiptAmountConfidence;
};

export type ReceiptPaymentChannelResult = {
  paymentChannel: PortalPaymentChannel | null;
  confidence: ReceiptAmountConfidence;
};

export type ReceiptDestinationResult = {
  status: ReceiptDestinationStatus;
  accountLast4: string | null;
  recipient: string | null;
};

export type ReceiptAuthorizedDestination = {
  accountNumber: string;
  accountName?: string | null;
};

type Candidate = {
  amount: number;
  score: number;
  line: string;
};

const POSITIVE_WORDS = /\b(monto|pagado|pago|importe|transferid[oa]|enviad[oa]|transacci[oó]n|valor)\b/i;
const STRONG_WORDS = /\b(transferiste|enviaste|monto pagado|monto enviado|monto transferido|importe transferido|pago realizado)\b/i;
const NEGATIVE_WORDS = /\b(saldo|disponible|comisi[oó]n|cargo|ahorro|cuenta|referencia|tel[eé]fono)\b/i;
const BANK_CHARGE_WORDS = /\b(total a pagar|total debitado|total cobrado|comisi[oó]n|itbms|impuesto|fee)\b/i;
const AMOUNT_PATTERN = /(?:B\s*\/\.?|USD|US\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d{1,6}[.,]\d{2})/gi;

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  if (decimalIndex < 0) return null;
  const whole = cleaned.slice(0, decimalIndex).replace(/[.,]/g, "");
  const decimals = cleaned.slice(decimalIndex + 1).replace(/\D/g, "");
  if (!/^\d+$/.test(whole) || decimals.length !== 2) return null;
  const amount = Number(`${whole}.${decimals}`);
  return Number.isFinite(amount) && amount > 0 && amount <= 50_000 ? amount : null;
}

export function detectReceiptAmountFromText(text: string, expectedAmount = 0): ReceiptAmountResult {
  const candidates: Candidate[] = [];
  const lines = text.split(/\r?\n/).map((sourceLine) => sourceLine.replace(/\s+/g, " ").trim());
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const semanticContext = `${lines[lineIndex - 1] ?? ""} ${line}`.trim();
    for (const match of line.matchAll(AMOUNT_PATTERN)) {
      const amount = parseAmount(match[1]);
      if (amount === null) continue;
      let score = 1;
      const fullMatch = match[0];
      if (/(?:B\s*\/\.?|USD|US\$|\$)/i.test(fullMatch)) score += 5;
      if (POSITIVE_WORDS.test(semanticContext)) score += 6;
      if (STRONG_WORDS.test(semanticContext)) score += 12;
      if (NEGATIVE_WORDS.test(line)) score -= 5;
      if (BANK_CHARGE_WORDS.test(line)) score -= 14;
      if (expectedAmount > 0) {
        const distance = Math.abs(amount - expectedAmount);
        if (distance <= Math.max(1, expectedAmount * 0.08)) score += 5;
        else if (amount >= expectedAmount * 0.75 && amount <= expectedAmount * 1.5) score += 2;
      }
      candidates.push({ amount, score, line });
    }
  }
  if (candidates.length === 0) return { amount: null, confidence: "low" };

  const frequency = new Map<string, number>();
  for (const candidate of candidates) {
    const key = candidate.amount.toFixed(2);
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    candidate.score += Math.min(4, (frequency.get(candidate.amount.toFixed(2)) ?? 1) - 1);
  }
  candidates.sort((left, right) => right.score - left.score || right.amount - left.amount || left.line.localeCompare(right.line));
  const best = candidates[0];
  return {
    amount: best.amount,
    confidence: best.score >= 11 ? "high" : best.score >= 6 ? "medium" : "low"
  };
}

export function detectReceiptPaymentChannel(text: string): ReceiptPaymentChannelResult {
  const normalized = text.replace(/\s+/g, " ").toLowerCase();
  if (/\bach\s*(?:xpress|express)\b|\bxpress\b/.test(normalized)) {
    return { paymentChannel: "ach_xpress", confidence: "high" };
  }
  if (
    /comisi[oó]n\s*[:\-]?\s*\$?\s*0[.,]50/.test(normalized) &&
    /itbms\s*[:\-]?\s*\$?\s*0[.,]04/.test(normalized) &&
    /total a pagar/.test(normalized)
  ) {
    return { paymentChannel: "ach_xpress", confidence: "high" };
  }
  if (/\bach\s+regular\b|\btransferencia\s+(?:regular|bancaria|local)\b/.test(normalized)) {
    return { paymentChannel: "regular_transfer", confidence: "high" };
  }
  if (/\btransferiste\b|\btransferencia\b|\btransferido\b/.test(normalized)) {
    return { paymentChannel: null, confidence: "low" };
  }
  return { paymentChannel: null, confidence: "low" };
}

function normalizeReceiptText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function detectReceiptDestination(
  text: string,
  authorizedDestinations: ReceiptAuthorizedDestination[] = []
): ReceiptDestinationResult {
  const normalized = normalizeReceiptText(text);
  const destinations = authorizedDestinations
    .map((destination) => ({
      accountNumber: destination.accountNumber.replace(/\D/g, ""),
      accountName: destination.accountName?.trim() || null
    }))
    .filter((destination) => destination.accountNumber.length >= 6);
  if (destinations.length === 0) return { status: "manual_review", accountLast4: null, recipient: null };

  const lines = normalized.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const destinationStart = lines.findIndex((line) => /^(hacia|para|beneficiario|destinatario)\b/.test(line));
  if (destinationStart < 0) return { status: "manual_review", accountLast4: null, recipient: null };

  const destinationLines = lines.slice(destinationStart, destinationStart + 6);
  const destinationText = destinationLines.join(" ");
  const destinationDigits = destinationText.replace(/\D/g, "");
  for (const destination of destinations) {
    const normalizedName = destination.accountName ? normalizeReceiptText(destination.accountName) : "";
    if (destinationDigits.includes(destination.accountNumber) || (normalizedName && destinationText.includes(normalizedName))) {
      return {
        status: "verified",
        accountLast4: destination.accountNumber.slice(-4),
        recipient: destination.accountName
      };
    }
  }

  const accountLine = destinationLines.find((line) => /\b(corriente|ahorros?|cuenta)\b/.test(line) && /\d/.test(line));
  if (accountLine) {
    const accountDigits = accountLine.replace(/\D/g, "");
    if (accountDigits.length >= 6) {
      return { status: "mismatch", accountLast4: accountDigits.slice(-4), recipient: null };
    }
  }

  const candidate = destinationLines.slice(1).find((line) =>
    /[a-z]{3}/.test(line) && !/\b(banco|bank|banistmo|corriente|ahorros?|cuenta|fecha|descripcion|confirmacion)\b/.test(line)
  );
  if (candidate) {
    return { status: "mismatch", accountLast4: null, recipient: candidate.replace(/\b\w/g, (letter) => letter.toUpperCase()) };
  }

  return { status: "manual_review", accountLast4: null, recipient: null };
}
