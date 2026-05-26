const LS_KEYS = [
  "cobrapp.module1.clients.v1",
  "cobrapp.module2.payments.v1",
  "cobrapp.payments.seq.v1",
  "cobrapp.module2.pending_bank.v1",
  "cobrapp.module2.pending_card.v1",
  "cobrapp.settings.bank_rules.v1",
  "cobrapp.module2.manual_assignment_audit.v1",
  "cobrapp.settings.late_fee_settings.v1",
  "cobrapp.module2.late_fee_ledger.v1",
  "cobrapp.settings.other_charges_retention.v1",
  "cobrapp.module2.notified.v1",
  "cobrapp.module2.cash_closings.v1",
  "cobrapp.module2.cash_closing_audit.v1",
  "cobrapp.module2.charge_runs.v1",
  "cobrapp.clients.status_filter.v1"
] as const;

type LSKey = (typeof LS_KEYS)[number];

type BackupShapeA = {
  data?: Record<string, unknown>;
};

type BackupShapeB = {
  clients?: unknown[];
  payments?: unknown[];
  seq?: number | string;
  pendingBankItems?: unknown[];
  pendingCardItems?: unknown[];
  bankRules?: unknown[];
  manualAssignmentAudit?: unknown[];
  lateFeeSettings?: Record<string, unknown>;
  lateFeeLedger?: unknown[];
  otherChargesRetentionByClient?: Record<string, unknown>;
  notifiedPayments?: unknown[];
  cashClosings?: unknown[];
  cashClosingAudit?: unknown[];
  chargeRuns?: unknown[];
  statusFilter?: string | null;
};

export type BackupImportReport = {
  fileName: string;
  compatible: boolean;
  issues: string[];
  warnings: string[];
  summary: Record<string, number | string>;
  normalizedData: Partial<Record<LSKey, unknown>>;
};

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function analyzeBackupFileContent(fileName: string, content: string): BackupImportReport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const normalizedData: Partial<Record<LSKey, unknown>> = {};
  const summary: Record<string, number | string> = {};
  let parsed: unknown = null;

  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      fileName,
      compatible: false,
      issues: ["El archivo no es un JSON valido."],
      warnings: [],
      summary: {},
      normalizedData: {}
    };
  }

  const root = toObject(parsed);
  const shapeA = toObject((root as BackupShapeA).data);
  const shapeB = root as BackupShapeB;

  const hasShapeA = Object.keys(shapeA).length > 0;
  const hasShapeB = Array.isArray(shapeB.clients) || Array.isArray(shapeB.payments) || "seq" in shapeB;
  if (!hasShapeA && !hasShapeB) {
    issues.push("No se detecta formato de respaldo conocido (ni 'data', ni campos raiz de Cobrapp).");
  }

  const keyMapFromShapeB: Partial<Record<LSKey, unknown>> = {
    "cobrapp.module1.clients.v1": toArray(shapeB.clients),
    "cobrapp.module2.payments.v1": toArray(shapeB.payments),
    "cobrapp.payments.seq.v1": shapeB.seq ?? 0,
    "cobrapp.module2.pending_bank.v1": toArray(shapeB.pendingBankItems),
    "cobrapp.module2.pending_card.v1": toArray(shapeB.pendingCardItems),
    "cobrapp.settings.bank_rules.v1": toArray(shapeB.bankRules),
    "cobrapp.module2.manual_assignment_audit.v1": toArray(shapeB.manualAssignmentAudit),
    "cobrapp.settings.late_fee_settings.v1": toObject(shapeB.lateFeeSettings),
    "cobrapp.module2.late_fee_ledger.v1": toArray(shapeB.lateFeeLedger),
    "cobrapp.settings.other_charges_retention.v1": toObject(shapeB.otherChargesRetentionByClient),
    "cobrapp.module2.notified.v1": toArray(shapeB.notifiedPayments),
    "cobrapp.module2.cash_closings.v1": toArray(shapeB.cashClosings),
    "cobrapp.module2.cash_closing_audit.v1": toArray(shapeB.cashClosingAudit),
    "cobrapp.module2.charge_runs.v1": toArray(shapeB.chargeRuns),
    "cobrapp.clients.status_filter.v1": shapeB.statusFilter ?? ""
  };

  for (const key of LS_KEYS) {
    const fromA = shapeA[key];
    const value = hasShapeA ? fromA : keyMapFromShapeB[key];
    if (value === undefined) {
      warnings.push(`No se encontro clave ${key}; se importara como vacio/default.`);
      continue;
    }
    normalizedData[key] = value;
  }

  const clients = toArray(normalizedData["cobrapp.module1.clients.v1"]);
  const payments = toArray(normalizedData["cobrapp.module2.payments.v1"]);
  summary.clients = clients.length;
  summary.payments = payments.length;
  summary.seq = Number(normalizedData["cobrapp.payments.seq.v1"] ?? 0) || 0;

  if (clients.length === 0) issues.push("No hay clientes en el respaldo.");
  if (payments.length === 0) warnings.push("No hay pagos en el respaldo.");

  return {
    fileName,
    compatible: issues.length === 0,
    issues,
    warnings,
    summary,
    normalizedData
  };
}
