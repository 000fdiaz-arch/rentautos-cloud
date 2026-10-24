import type { InsuranceClaimRecord } from "../../cloudData";
import type { InsuranceBankPaymentRecord } from "../../cloud/insuranceBankPaymentCloudData";

export type InsurancePaymentMatchConfidence = "high" | "medium" | "low";

export type InsurancePaymentClaimSuggestion = {
  claim: InsuranceClaimRecord;
  score: number;
  confidence: InsurancePaymentMatchConfidence;
  reasons: string[];
};

export type InsurancePaymentMatchContext = {
  companyByUnit?: ReadonlyMap<string, string>;
  companyByGroup?: ReadonlyMap<string, string>;
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function compact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function unitGroup(value: string): string {
  return compact(value).match(/^([A-Z]+)/)?.[1] ?? "";
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter(Boolean));
}

function extractBankClaimNumber(value: string): string {
  const normalized = normalizeText(value);
  const match = normalized.match(/\b(?:RECLAMO|SINIESTRO)\s+(?:(?:NO|NRO|NUMERO)\s+)?([A-Z0-9]{2,})\b/);
  return match ? compact(match[1]) : "";
}

function isMeaningfulClaimNumber(value: string): boolean {
  return value.length >= 2 && !/^0+$/.test(value);
}

function parseMoney(value: string): number | null {
  const normalized = value.replace(/[^0-9.,-]/g, "").trim();
  if (!normalized) return null;
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  const decimalMark = lastComma > lastDot ? "," : ".";
  const thousandsMark = decimalMark === "," ? "." : ",";
  const parsed = Number(normalized.split(thousandsMark).join("").replace(decimalMark, "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasMeaningfulClaimAmount(value: string): boolean {
  const amount = parseMoney(value);
  return amount !== null && amount > 0;
}

function confidenceFor(score: number): InsurancePaymentMatchConfidence {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function isDatePlausible(paymentDate: string, incidentDate: string): boolean {
  const payment = Date.parse(`${paymentDate}T12:00:00`);
  const incident = Date.parse(`${incidentDate}T12:00:00`);
  if (!Number.isFinite(payment) || !Number.isFinite(incident) || payment < incident) return false;
  return payment - incident <= 366 * 24 * 60 * 60 * 1000;
}

export function buildInsurancePaymentClaimSuggestions(
  payment: InsuranceBankPaymentRecord,
  claims: InsuranceClaimRecord[],
  context: InsurancePaymentMatchContext = {}
): InsurancePaymentClaimSuggestion[] {
  const bankItem = payment.bankItem;
  const bankText = [
    bankItem.description,
    bankItem.referenceId,
    bankItem.extractedName,
    bankItem.transactionCode ?? ""
  ].filter(Boolean).join(" ");
  const bankNormalized = normalizeText(bankText);
  const bankCompact = compact(bankText);
  const bankTokens = tokenSet(bankText);
  const bankClaimNumber = extractBankClaimNumber(bankText);
  const paymentGroup = compact(bankItem.mappedGroup ?? "");
  const paymentCompany = paymentGroup ? context.companyByGroup?.get(paymentGroup) ?? "" : "";

  return claims
    .filter((claim) => isMeaningfulClaimNumber(compact(claim.claimNumber)) && hasMeaningfulClaimAmount(claim.amount))
    .map((claim): InsurancePaymentClaimSuggestion => {
      let score = 0;
      const reasons: string[] = [];
      const claimGroup = unitGroup(claim.unit);
      const sameGroup = paymentGroup.length > 0 && claimGroup === paymentGroup;
      const differentKnownGroup = paymentGroup.length > 0 && claimGroup.length > 0 && claimGroup !== paymentGroup;
      const claimCompany = context.companyByUnit?.get(compact(claim.unit)) ?? "";

      if (sameGroup) {
        score += 45;
        const company = paymentCompany || claimCompany;
        reasons.push(company
          ? `Misma empresa: ${company} (Grupo ${paymentGroup})`
          : `Mismo grupo bancario: Grupo ${paymentGroup}`);
      }
      const claimNumber = compact(claim.claimNumber);
      const exactClaimNumber = isMeaningfulClaimNumber(claimNumber)
        && bankClaimNumber.length > 0
        && claimNumber === bankClaimNumber;
      const embeddedClaimNumber = isMeaningfulClaimNumber(claimNumber)
        && claimNumber.length >= 4
        && bankClaimNumber.length === 0
        && bankCompact.includes(claimNumber);
      if (exactClaimNumber || embeddedClaimNumber) {
        score += 55;
        reasons.push(`Mismo número de reclamo: ${claim.claimNumber}`);
      }

      const claimAmount = parseMoney(claim.amount);
      if (claimAmount !== null && Math.abs(claimAmount - bankItem.amountReceived) < 0.01) {
        score += 30;
        reasons.push("Mismo monto reclamado");
      }

      const insurer = normalizeText(claim.insurer);
      const insurerTokens = insurer.split(/\s+/).filter((token) => token.length >= 4);
      if (insurer && (bankNormalized.includes(insurer) || insurerTokens.some((token) => bankTokens.has(token)))) {
        score += 15;
        reasons.push(`Coincide la aseguradora: ${claim.insurer}`);
      }

      const unit = compact(claim.unit);
      if (unit && (bankTokens.has(unit) || bankCompact.includes(`UNIDAD${unit}`) || bankCompact.includes(`AUTO${unit}`))) {
        score += 12;
        reasons.push(`Coincide la unidad ${claim.unit}`);
      }

      const plate = compact(claim.plate);
      if (plate && bankCompact.includes(plate)) {
        score += 10;
        reasons.push(`Coincide la placa ${claim.plate}`);
      }

      const driverTokens = normalizeText(claim.driver).split(/\s+/).filter((token) => token.length >= 4);
      if (driverTokens.length > 0 && driverTokens.every((token) => bankTokens.has(token))) {
        score += 8;
        reasons.push("Coincide el nombre del conductor");
      }

      if (isDatePlausible(bankItem.dateApplied, claim.incidentDate)) score += 3;

      if (differentKnownGroup) score = -1000;
      return { claim, score, confidence: confidenceFor(score), reasons };
    })
    .filter((suggestion) => suggestion.score > 0)
    .sort((left, right) => right.score - left.score || right.claim.updatedAt.localeCompare(left.claim.updatedAt))
    .slice(0, 3);
}
