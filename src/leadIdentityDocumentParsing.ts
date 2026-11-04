export type LeadIdentityDocumentData = {
  cedula: string;
  birthDate: string;
  fullName: string;
};

function normalizeOcrText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\r/g, "")
    .replace(/(\d{1,2}\s*[/.\-]\s*\d{1,2})\s*\n+\s*((?:19|20)\d{2})/g, "$1/$2")
    .toUpperCase();
}

function normalizeDate(day: string, month: string, year: string): string {
  const fullYear = year.length === 2 ? Number(year) + (Number(year) > 30 ? 1900 : 2000) : Number(year);
  const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) return "";
  return `${String(fullYear).padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function datesInText(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})\b/g)) {
    const value = normalizeDate(match[1], match[2], match[3]);
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

function birthDateFromText(text: string, today = new Date()): string {
  const labelMatch = text.match(/(?:FECHA\s+DE\s+NACIMIENTO|DATE\s+OF\s+BIRTH|NACIMIENTO|BIRTH)[\s\S]{0,90}?(\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4})/);
  const labeledDate = labelMatch ? datesInText(labelMatch[1])[0] ?? "" : "";
  if (labeledDate) return labeledDate;

  const latestBirthYear = today.getUTCFullYear() - 15;
  const earliestBirthYear = today.getUTCFullYear() - 100;
  return datesInText(text)
    .filter((value) => {
      const year = Number(value.slice(0, 4));
      return year >= earliestBirthYear && year <= latestBirthYear;
    })
    .sort()[0] ?? "";
}

function cedulaFromText(text: string): string {
  const candidates = Array.from(text.matchAll(/(?:^|[^0-9])([0-9]{1,2})\s*[-–—]\s*([0-9]{2,4})\s*[-–—]\s*([0-9]{3,6})(?![0-9])/g))
    .map((match) => `${match[1]}-${match[2]}-${match[3]}`);
  return candidates[0] ?? "";
}

function fullNameFromText(text: string): string {
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const labelIndex = lines.findIndex((line) => /\bNAME\b|\bNOMB[A-Z]{1,4}\b/.test(line));
  if (labelIndex < 0) return "";
  const nameLines: string[] = [];
  for (const line of lines.slice(labelIndex + 1, labelIndex + 7)) {
    if (/NACI[A-Z]{3,}DAD|NATIONALITY|FECHA\s+DE\s+NACIMIENTO|DATE\s+OF\s+BIRTH|SANGRE|BLOOD/.test(line)) break;
    if (/^(?:NAME|NOMBRE|NOMBAE)$/.test(line)) continue;
    const cleaned = line
      .replace(/[^A-Z' -]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[ '-]+|[ '-]+$/g, "")
      .trim();
    if (cleaned.length >= 3 && cleaned.length <= 50) nameLines.push(cleaned);
    if (nameLines.length === 3) break;
  }
  const fullName = nameLines.join(" ").replace(/\s+/g, " ").trim();
  return fullName.split(" ").filter(Boolean).length >= 2 ? fullName.slice(0, 120) : "";
}

export function extractLeadIdentityDocumentData(rawText: string, today = new Date()): LeadIdentityDocumentData {
  const text = normalizeOcrText(rawText);
  return {
    cedula: cedulaFromText(text),
    birthDate: birthDateFromText(text, today),
    fullName: fullNameFromText(text)
  };
}
