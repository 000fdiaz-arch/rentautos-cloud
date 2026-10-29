import type { ControlUnitRow } from "../../cloudData";
import type { BankRule, ClientStatus } from "../../types";

export type SortField = "unit_id" | "group" | "operational_status" | "brand_model" | "company" | "plate";
export type SortDirection = "asc" | "desc";
export type FleetStatus = ClientStatus | "libre" | "provisional_rental";

export type FleetClientStatusSyncPayload = {
  unitId: string;
  status: FleetStatus;
  archivedClientIds: string[];
  updatedClientIds: string[];
  statusComment?: string;
  archivedAt?: string;
};

export type UnitFormState = {
  unit_id: string;
  company: string;
  brand_model: string;
  plate: string;
  engine_serial: string;
  chassis_serial: string;
  year: string;
  color: string;
  transmission: string;
  key_coded: "" | "yes" | "no";
  mileage: string;
  operational_status: string;
  observation: string;
  catalog_contract_months: string;
  catalog_daily_rate: string;
  catalog_weekly_rate: string;
  catalog_biweekly_rate: string;
  catalog_daily_management_fee: string;
  catalog_weekly_management_fee: string;
  catalog_biweekly_management_fee: string;
};

export type FleetPieSlice = {
  key: string;
  label: string;
  count: number;
  percent: number;
  color: string;
  path: string;
};

export type FleetIdentityDuplicate = {
  field: "plate" | "engine_serial" | "chassis_serial";
  label: string;
  value: string;
  unitId: string;
};

export type FleetCompleteness = {
  completed: number;
  total: number;
  percent: number;
  missing: string[];
  criticalMissing: string[];
};

export const DEFAULT_FORM: UnitFormState = {
  unit_id: "",
  company: "",
  brand_model: "",
  plate: "",
  engine_serial: "",
  chassis_serial: "",
  year: "",
  color: "",
  transmission: "",
  key_coded: "",
  mileage: "",
  operational_status: "libre",
  observation: "",
  catalog_contract_months: "",
  catalog_daily_rate: "",
  catalog_weekly_rate: "",
  catalog_biweekly_rate: "",
  catalog_daily_management_fee: "",
  catalog_weekly_management_fee: "",
  catalog_biweekly_management_fee: ""
};

export const UNIT_GROUP_MAX = 100;

export const FLEET_STATUS_OPTIONS: Array<{ value: FleetStatus; label: string }> = [
  { value: "libre", label: "LIBRE" },
  { value: "activo", label: "Activo" },
  { value: "taller", label: "Taller" },
  { value: "chapisteria", label: "Chapisteria" },
  { value: "custodia", label: "Custodia" },
  { value: "archivado", label: "Archivado" }
];

const PIE_COLORS = [
  "#0f766e",
  "#f59e0b",
  "#2563eb",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#65a30d",
  "#9333ea",
  "#ea580c",
  "#475569"
];

export function toGroup(unitId: string): string {
  const value = unitId.trim().toUpperCase();
  return value.length > 0 ? value[0] : "-";
}

export function normalizeUnitIdInput(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  const group = cleaned[0];
  const digits = cleaned.slice(1).replace(/\D/g, "");
  if (!digits) return group;
  return `${group}${digits}`;
}

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeFleetIdentifier(value: unknown): string {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function getFleetCompleteness(row: ControlUnitRow): FleetCompleteness {
  const fields = [
    { label: "Marca / modelo", complete: Boolean(normalizeText(row.brand_model)), critical: false },
    { label: "Año", complete: Boolean(optionalString(row, ["year", "model_year"])), critical: false },
    { label: "Placa", complete: Boolean(normalizeFleetIdentifier(row.plate)), critical: true },
    { label: "Motor", complete: Boolean(normalizeFleetIdentifier(row.engine_serial)), critical: true },
    { label: "Chasis", complete: Boolean(normalizeFleetIdentifier(row.chassis_serial)), critical: true },
    { label: "Color", complete: Boolean(normalizeText(row.color)), critical: false },
    { label: "Transmisión", complete: Boolean(optionalString(row, ["transmission", "transmission_type"])), critical: false },
    { label: "Llave", complete: row.key_coded === true || row.key_coded === false, critical: false }
  ];
  const missingFields = fields.filter((field) => !field.complete);
  const completed = fields.length - missingFields.length;
  return {
    completed,
    total: fields.length,
    percent: Math.round((completed / fields.length) * 100),
    missing: missingFields.map((field) => field.label),
    criticalMissing: missingFields.filter((field) => field.critical).map((field) => field.label)
  };
}

export function findFleetIdentityDuplicate(
  rows: ControlUnitRow[],
  identity: { plate?: unknown; engine_serial?: unknown; chassis_serial?: unknown },
  excludedFleetId?: string | null
): FleetIdentityDuplicate | null {
  const checks = [
    { field: "plate", label: "placa", value: identity.plate },
    { field: "chassis_serial", label: "serial de chasis", value: identity.chassis_serial },
    { field: "engine_serial", label: "serial de motor", value: identity.engine_serial }
  ] as const;
  const normalizedExcludedFleetId = normalizeText(excludedFleetId);
  for (const check of checks) {
    const token = normalizeFleetIdentifier(check.value);
    if (!token) continue;
    const duplicate = rows.find((row) => {
      if (normalizedExcludedFleetId && normalizeText(row.fleet_id) === normalizedExcludedFleetId) return false;
      return normalizeFleetIdentifier(row[check.field]) === token;
    });
    if (duplicate) {
      return {
        field: check.field,
        label: check.label,
        value: normalizeText(check.value).toUpperCase(),
        unitId: normalizeText(duplicate.unit_id).toUpperCase() || "sin nomenclatura"
      };
    }
  }
  return null;
}

export function normalizeStatus(value: unknown): string {
  const text = normalizeText(value);
  return text.length > 0 ? text.toLowerCase() : "libre";
}

export function optionalString(row: ControlUnitRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

export function optionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

export function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function statusLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "libre") return "LIBRE";
  if (normalized === "activo") return "Activo";
  if (normalized === "taller") return "Taller";
  if (normalized === "chapisteria") return "Chapisteria";
  if (normalized === "custodia") return "Custodia";
  if (normalized === "provisional_rental") return "Auto provisional/alquilado";
  if (normalized === "archivado") return "Archivado";
  return normalized.length > 0 ? value : "Sin estado";
}

export function statusBadgeClass(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "libre") return "control-op-badge control-op-badge--sin-estado";
  if (normalized === "activo") return "control-op-badge control-op-badge--activo";
  if (normalized === "taller") return "control-op-badge control-op-badge--taller";
  if (normalized === "chapisteria") return "control-op-badge control-op-badge--chapisteria";
  if (normalized === "custodia") return "control-op-badge control-op-badge--custodia";
  if (normalized === "provisional_rental") return "control-op-badge control-op-badge--provisional-rental";
  if (normalized === "archivado") return "control-op-badge control-op-badge--archivado";
  return "control-op-badge control-op-badge--sin-estado";
}

export function effectiveStatus(row: ControlUnitRow): string {
  return normalizeStatus(row.operational_status);
}

export function toFleetStatus(value: string): FleetStatus {
  const normalized = normalizeStatus(value);
  if (normalized === "provisional_rental") return "provisional_rental";
  return FLEET_STATUS_OPTIONS.some((option) => option.value === normalized)
    ? normalized as FleetStatus
    : "activo";
}

export function toFormState(row?: ControlUnitRow): UnitFormState {
  if (!row) return { ...DEFAULT_FORM };
  return {
    unit_id: row.unit_id ?? "",
    company: row.company ?? "",
    brand_model: row.brand_model ?? "",
    plate: row.plate ?? "",
    engine_serial: row.engine_serial ?? "",
    chassis_serial: row.chassis_serial ?? "",
    year: optionalString(row, ["year", "model_year"]),
    color: optionalString(row, ["color"]),
    transmission: optionalString(row, ["transmission", "transmission_type"]),
    key_coded: row.key_coded === true ? "yes" : row.key_coded === false ? "no" : "",
    mileage: optionalString(row, ["mileage", "kilometraje", "kilometrage"]),
    operational_status: row.operational_status ?? "libre",
    observation: row.observation ?? "",
    catalog_contract_months: optionalString(row, ["catalog_contract_months"]),
    catalog_daily_rate: optionalString(row, ["catalog_daily_rate"]),
    catalog_weekly_rate: optionalString(row, ["catalog_weekly_rate"]),
    catalog_biweekly_rate: optionalString(row, ["catalog_biweekly_rate"]),
    catalog_daily_management_fee: optionalString(row, ["catalog_daily_management_fee"]),
    catalog_weekly_management_fee: optionalString(row, ["catalog_weekly_management_fee"]),
    catalog_biweekly_management_fee: optionalString(row, ["catalog_biweekly_management_fee"])
  };
}

export function isCatalogEligible(
  row: ControlUnitRow,
  custodySinceByUnit: Map<string, string>,
  now = Date.now()
): boolean {
  if (effectiveStatus(row) === "libre") return true;
  const custodySince = custodySinceByUnit.get(normalizeText(row.unit_id).toUpperCase());
  if (!custodySince) return false;
  const startedAt = Date.parse(custodySince);
  return Number.isFinite(startedAt) && now - startedAt >= 24 * 60 * 60 * 1000;
}

export function getFleetFilterOptions(rows: ControlUnitRow[]) {
  return {
    groups: Array.from(new Set(rows.map((item) => toGroup(item.unit_id ?? "")))).sort(),
    companies: Array.from(new Set(rows.map((item) => normalizeText(item.company)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    models: Array.from(new Set(rows.map((item) => normalizeText(item.brand_model)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    statuses: Array.from(new Set(rows.map((item) => effectiveStatus(item)))).sort((a, b) => a.localeCompare(b))
  };
}

export function getActiveFleetRule(bankRules: BankRule[], group: string): BankRule | undefined {
  const normalizedGroup = normalizeText(group).toUpperCase();
  return bankRules.find((rule) =>
    rule.active &&
    /^[A-Z]$/.test(normalizeText(rule.groupCode).toUpperCase()) &&
    normalizeText(rule.groupCode).toUpperCase() === normalizedGroup
  );
}

export function getActiveFleetGroups(bankRules: BankRule[]): string[] {
  return Array.from(new Set(bankRules
    .filter((rule) => rule.active)
    .map((rule) => normalizeText(rule.groupCode).toUpperCase())
    .filter((group) => /^[A-Z]$/.test(group))))
    .sort();
}

export function getFleetCompanyForGroup(
  rows: ControlUnitRow[],
  bankRules: BankRule[],
  group: string
): string {
  const normalizedGroup = normalizeText(group).toUpperCase();
  const ruleCompany = normalizeText(getActiveFleetRule(bankRules, normalizedGroup)?.accountName);
  if (ruleCompany) return ruleCompany;
  return normalizeText(rows.find((row) => toGroup(row.unit_id ?? "") === normalizedGroup && normalizeText(row.company))?.company);
}

export function getFleetCompanyOptions(rows: ControlUnitRow[], bankRules: BankRule[]): string[] {
  return Array.from(new Set([
    ...bankRules
      .filter((rule) => rule.active)
      .map((rule) => normalizeText(rule.accountName))
      .filter(Boolean),
    ...rows.map((item) => normalizeText(item.company)).filter(Boolean)
  ])).sort((a, b) => a.localeCompare(b));
}

export function filterAndSortFleetRows(args: {
  rows: ControlUnitRow[];
  search: string;
  groupFilter: string;
  companyFilter: string;
  modelFilter: string;
  statusFilter: string;
  sortField: SortField;
  sortDirection: SortDirection;
}): ControlUnitRow[] {
  const { rows, search, groupFilter, companyFilter, modelFilter, statusFilter, sortField, sortDirection } = args;
  const query = search.trim().toLowerCase();
  return rows
    .filter((row) => {
      if (groupFilter !== "all" && toGroup(row.unit_id ?? "") !== groupFilter) return false;
      if (companyFilter !== "all" && normalizeText(row.company) !== companyFilter) return false;
      if (modelFilter !== "all" && normalizeText(row.brand_model) !== modelFilter) return false;
      if (statusFilter !== "all" && effectiveStatus(row) !== statusFilter) return false;
      if (!query) return true;
      const composed = [
        row.unit_id,
        row.company,
        row.brand_model,
        row.plate,
        row.engine_serial,
        row.chassis_serial,
        optionalString(row, ["color"]),
        optionalString(row, ["transmission", "transmission_type"])
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return composed.includes(query);
    })
    .sort((a, b) => {
      const left = sortField === "group" ? toGroup(a.unit_id ?? "") : normalizeText(a[sortField]);
      const right = sortField === "group" ? toGroup(b.unit_id ?? "") : normalizeText(b[sortField]);
      const result = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? result : -result;
    });
}

export function buildFleetPieData(rows: ControlUnitRow[]): { slices: FleetPieSlice[]; total: number } {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = effectiveStatus(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dashboard = Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: key === "libre" ? "LIBRE" : statusLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const total = dashboard.reduce((acc, item) => acc + item.count, 0);
  if (total <= 0) return { slices: [], total };

  const cx = 120;
  const cy = 120;
  const r = 92;
  let startAngle = -Math.PI / 2;
  const slices = dashboard.map((item, index) => {
    const ratio = item.count / total;
    const sweep = ratio * Math.PI * 2;
    const endAngle = startAngle + sweep;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArcFlag = sweep > Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
    const slice = {
      key: item.key,
      label: item.label,
      count: item.count,
      percent: ratio * 100,
      color: PIE_COLORS[index % PIE_COLORS.length],
      path
    };
    startAngle = endAngle;
    return slice;
  });

  return { slices, total };
}

export function describeStatusError(error: unknown): string {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const normalized = [
    error instanceof Error ? error.message : "",
    typeof record?.message === "string" ? record.message : "",
    typeof record?.code === "string" ? record.code : "",
    typeof record?.details === "string" ? record.details : ""
  ].join(" ").toLowerCase();
  if (normalized.includes("57014") || normalized.includes("statement timeout")) {
    return "La base de datos tardo demasiado en responder. El cambio se reintento, pero no pudo confirmarse; intenta nuevamente.";
  }
  if (error instanceof Error && error.message) return error.message;
  if (record) {
    const parts = [
      typeof record.message === "string" ? record.message : "",
      typeof record.code === "string" ? `code=${record.code}` : "",
      typeof record.details === "string" ? record.details : "",
      typeof record.hint === "string" ? `hint=${record.hint}` : ""
    ].filter((part) => part.trim().length > 0);
    if (parts.length > 0) return parts.join(" | ");
  }
  return "Error desconocido";
}
