import { loadCloudProcessedPaymentFolios } from "../../cloudData";
import type { BankRule, Client, Payment, PendingBankItem } from "../../types";
import type { NotifiedPayment } from "./paymentTypes";
import {
  buildExistingProcessedFolioSetForCsvImport,
  coerceCsvColumns,
  extractGroupCodeFromUnit,
  findClientByNamePrefix,
  findClientFromNotified,
  findMappedGroupByAccount,
  isIgnoredBankMovement,
  normalizeAccountNumber,
  normalizeBankName,
  normalizeBankText,
  normalizeFolioToken,
  parseBankAmount,
  parseBankDescription,
  parseCsvRow
} from "./bankPaymentRules";

type Options = {
  clients: Client[];
  bankRules: BankRule[];
  payments: Payment[];
  pendingItems: PendingBankItem[];
  notifiedPayments: NotifiedPayment[];
  operationalDateKey: string;
  dataOwnerUserId?: string | null;
};

export type BankCsvImportResult = {
  items: PendingBankItem[];
  message: string;
  error?: string;
};

export async function importBankCsv(text: string, options: Options): Promise<BankCsvImportResult> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\uFEFF/g, ""))
    .filter((line) => normalizeBankText(line).length > 0);
  if (lines.length < 2) {
    return { items: [], message: "", error: "El archivo CSV no tiene filas de datos." };
  }

  const headerColumns = parseCsvRow(lines[0]);
  const expectedColumns = headerColumns.length;
  const headers = headerColumns.map((header) =>
    header.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "")
  );
  const accountIndex = headers.findIndex((header) => header === "cuenta");
  const folioIndex = headers.findIndex((header) => header === "folio");
  const creditIndex = headers.findIndex((header) => header.includes("credito") || header === "credit");
  const descriptionIndex = headers.findIndex((header) => header.includes("descripcion") || header.includes("descripci") || header.includes("detalle"));
  const transactionCodeIndex = headers.findIndex((header) => header === "codigodetransaccion" || header === "codigotransaccion");

  if (accountIndex < 0 || folioIndex < 0 || creditIndex < 0) {
    return {
      items: [],
      message: "",
      error: "No se encontraron las columnas esperadas (Cuenta, Folio, Credito). Verifica el archivo."
    };
  }

  const accountsInFile = new Set<string>();
  const foliosInFile = new Set<string>();
  let invalidRows = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const columns = coerceCsvColumns(lines[index], expectedColumns);
    if (!columns) {
      invalidRows += 1;
      continue;
    }
    const amount = parseBankAmount(normalizeBankText(columns[creditIndex] ?? ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const account = normalizeAccountNumber(columns[accountIndex] ?? "");
    const folio = normalizeFolioToken(columns[folioIndex] ?? "");
    if (account) accountsInFile.add(account);
    if (folio) foliosInFile.add(folio);
  }

  const existingPaymentFolios = buildExistingProcessedFolioSetForCsvImport(options.payments);
  if (options.dataOwnerUserId && foliosInFile.size > 0) {
    try {
      const cloudFolios = await loadCloudProcessedPaymentFolios(options.dataOwnerUserId, foliosInFile);
      for (const folio of cloudFolios) existingPaymentFolios.add(folio);
    } catch (error) {
      console.error("No se pudieron validar folios historicos en Supabase.", error);
      return {
        items: [],
        message: "",
        error: "No se pudieron validar folios historicos en Supabase. Intenta de nuevo antes de importar el CSV."
      };
    }
  }

  const missingRuleAccounts = [...accountsInFile]
    .filter((account) => !findMappedGroupByAccount(account, options.bankRules));
  if (missingRuleAccounts.length > 0) {
    return {
      items: [],
      message: "",
      error: `No hay regla bancaria activa para cuenta(s): ${missingRuleAccounts.join(", ")}. Configuralas en Configuraciones > Regla bancaria.`
    };
  }

  const existingPendingFolios = new Set(options.pendingItems.map((item) => normalizeFolioToken(item.folio)));
  const importedAt = new Date().toISOString();
  const items: PendingBankItem[] = [];
  let autoMatched = 0;
  let skipped = 0;
  let ignoredNonClient = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const columns = coerceCsvColumns(lines[index], expectedColumns);
    if (!columns) continue;
    const accountNumber = normalizeAccountNumber(columns[accountIndex] ?? "");
    const mappedGroup = findMappedGroupByAccount(accountNumber, options.bankRules);
    const folio = normalizeFolioToken(columns[folioIndex] ?? "");
    const description = normalizeBankText(columns[descriptionIndex] ?? "");
    const transactionCode = transactionCodeIndex >= 0 ? normalizeBankText(columns[transactionCodeIndex] ?? "") : "";
    const amount = parseBankAmount(normalizeBankText(columns[creditIndex] ?? ""));

    if (!Number.isFinite(amount) || amount <= 0 || !folio || !mappedGroup) continue;
    if (isIgnoredBankMovement(transactionCode, description)) {
      ignoredNonClient += 1;
      continue;
    }
    if (existingPaymentFolios.has(folio) || existingPendingFolios.has(folio)) {
      skipped += 1;
      continue;
    }

    const capitalPart = Math.floor(amount);
    const centsPart = Math.round((amount - capitalPart) * 100) / 100;
    const { referenceId, extractedName } = parseBankDescription(description);
    const candidateClients = options.clients.filter((client) => extractGroupCodeFromUnit(client.activeProvisionalRental?.unitId ?? client.unitId) === mappedGroup);
    let matched: Client | null = null;

    if (referenceId) {
      const matches = candidateClients.filter((client) =>
        normalizeBankText(client.activeProvisionalRental?.unitId ?? client.unitId) === referenceId || normalizeBankText(client.cedula ?? "") === referenceId
      );
      if (matches.length === 1) matched = matches[0];
    }
    if (!matched && extractedName) {
      const matches = candidateClients.filter((client) => normalizeBankName(client.name) === normalizeBankName(extractedName));
      if (matches.length === 1) matched = matches[0];
    }
    if (!matched && extractedName) matched = findClientByNamePrefix(extractedName, candidateClients);
    if (!matched) {
      matched = findClientFromNotified(
        amount,
        options.operationalDateKey,
        candidateClients,
        options.notifiedPayments
      );
    }

    const item: PendingBankItem = {
      folio,
      dateApplied: options.operationalDateKey,
      amountReceived: amount,
      capitalPart,
      centsPart,
      transactionCode: transactionCode || undefined,
      referenceId,
      extractedName,
      description,
      importedAt,
      accountNumber: accountNumber || undefined,
      mappedGroup,
      suggestedClientId: matched?.id,
      suggestedClientName: matched?.name
    };
    items.push(item);
    if (matched) autoMatched += 1;
    existingPendingFolios.add(folio);
  }

  if (items.length === 0 && skipped === 0 && ignoredNonClient === 0) {
    return { items: [], message: "", error: "No se encontraron creditos aplicables en el archivo." };
  }

  const unmatched = items.filter((item) => !item.suggestedClientId).length;
  const groups = [...new Set(items.map((item) => item.mappedGroup).filter(Boolean))];
  const summary: string[] = [];
  if (groups.length > 0) summary.push(`Grupo detectado: ${groups.join(", ")}`);
  if (autoMatched > 0) summary.push(`${autoMatched} identificado(s) listos para aplicar`);
  if (unmatched > 0) summary.push(`${unmatched} sin cliente identificado`);
  if (skipped > 0) summary.push(`${skipped} duplicado(s) omitido(s)`);
  if (ignoredNonClient > 0) summary.push(`${ignoredNonClient} movimiento(s) no cliente ignorado(s)`);
  if (invalidRows > 0) summary.push(`${invalidRows} fila(s) irregulares reparadas/omitidas`);

  return {
    items,
    message: summary.length > 0 ? `${summary.join(" - ")}.` : "Importacion completada."
  };
}
