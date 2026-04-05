import type { ParsedBankRow } from "./types";

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function detectDelimiter(headerLine: string) {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      currentRow.push(currentCell.trim());
      currentCell = "";

      if (currentRow.some((value) => value.length > 0)) {
        rows.push(currentRow);
      }

      currentRow = [];
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
  }

  if (currentRow.some((value) => value.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function parseNumber(rawValue: string) {
  const cleaned = rawValue.replace(/[^\d,.-]/g, "");

  if (!cleaned) {
    return Number.NaN;
  }

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;

  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = /,\d{1,2}$/.test(cleaned)
      ? cleaned.replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (hasDot) {
    normalized = /\.\d{1,2}$/.test(cleaned)
      ? cleaned
      : cleaned.replace(/\./g, "");
  }

  return Number.parseFloat(normalized);
}

function normalizeDate(rawValue: string) {
  const value = rawValue.trim();

  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const separator = value.includes("/") ? "/" : value.includes("-") ? "-" : "";

  if (!separator) {
    return value;
  }

  const parts = value.split(separator).map((item) => item.trim());

  if (parts.length !== 3) {
    return value;
  }

  if (parts[0].length === 4) {
    return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }

  if (parts[2].length === 4) {
    return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }

  return value;
}

export function parseBankCsv(text: string) {
  const sanitized = text.trim();

  if (!sanitized) {
    return [] as ParsedBankRow[];
  }

  const firstLine = sanitized.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rows = parseDelimited(sanitized, delimiter);

  if (rows.length === 0) {
    return [] as ParsedBankRow[];
  }

  const headers = rows[0].map((header) =>
    normalizeText(header).replace(/[\s_-]/g, ""),
  );

  const getIndex = (...keys: string[]) =>
    headers.findIndex((header) => keys.includes(header));

  const dateIndex = getIndex("fecha", "date", "fechaoperacion", "fechamovimiento");
  const referenceIndex = getIndex(
    "referencia",
    "ref",
    "documento",
    "descripcion",
    "detalle",
    "concepto",
  );
  const clientIndex = getIndex(
    "cliente",
    "nombre",
    "pagador",
    "detallecliente",
    "observacion",
  );
  const amountIndex = getIndex("monto", "importe", "valor", "amount");
  const creditIndex = getIndex("credito", "credit", "deposito");
  const debitIndex = getIndex("debito", "debit");

  return rows
    .slice(1)
    .map((row) => {
      const amountFromSingleColumn =
        amountIndex >= 0 ? parseNumber(row[amountIndex] ?? "") : Number.NaN;
      const amountFromPair =
        creditIndex >= 0 || debitIndex >= 0
          ? parseNumber(row[creditIndex] ?? "0") - parseNumber(row[debitIndex] ?? "0")
          : Number.NaN;
      const amount = Number.isFinite(amountFromSingleColumn)
        ? amountFromSingleColumn
        : amountFromPair;

      return {
        date: normalizeDate(dateIndex >= 0 ? row[dateIndex] ?? "" : ""),
        reference: referenceIndex >= 0 ? row[referenceIndex] ?? "" : "",
        clientLabel: clientIndex >= 0 ? row[clientIndex] ?? "" : "",
        amount,
      };
    })
    .filter(
      (row) =>
        Number.isFinite(row.amount) &&
        (row.reference.length > 0 || row.clientLabel.length > 0 || row.date.length > 0),
    );
}

export function normalizeBankSearch(value: string) {
  return normalizeText(value);
}
