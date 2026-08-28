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
  mileage: string;
  operational_status: string;
  observation: string;
};

export type FleetPieSlice = {
  key: string;
  label: string;
  count: number;
  percent: number;
  color: string;
  path: string;
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
  mileage: "",
  operational_status: "libre",
  observation: ""
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
    mileage: optionalString(row, ["mileage", "kilometraje", "kilometrage"]),
    operational_status: row.operational_status ?? "libre",
    observation: row.observation ?? ""
  };
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
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
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
