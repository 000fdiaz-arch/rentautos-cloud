import { useEffect, useMemo, useState } from "react";
import { loadControlUnits, saveControlUnit, setControlUnitStatus, type ControlUnitRow, type ControlUnitUpsertInput } from "../cloudData";
import type { Client, ClientStatus } from "../types";

type Props = {
  dataOwnerUserId?: string | null;
  readOnly?: boolean;
  clients?: Client[];
  onFleetClientStatusSync?: (payload: FleetClientStatusSyncPayload) => void;
};

type SortField = "unit_id" | "group" | "operational_status" | "brand_model" | "company" | "plate";
type SortDirection = "asc" | "desc";
type FleetStatus = ClientStatus | "libre";

type FleetClientStatusSyncPayload = {
  unitId: string;
  status: FleetStatus;
  archivedClientIds: string[];
  updatedClientIds: string[];
  statusComment?: string;
  archivedAt?: string;
};

type UnitFormState = {
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

const DEFAULT_FORM: UnitFormState = {
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

const UNIT_GROUP_MAX: Record<"A" | "B" | "C" | "D" | "T", number> = {
  A: 101,
  B: 100,
  C: 100,
  D: 100,
  T: 37
};

const FLEET_STATUS_OPTIONS: Array<{ value: FleetStatus; label: string }> = [
  { value: "libre", label: "LIBRE" },
  { value: "activo", label: "Activo" },
  { value: "cliente_enfermo", label: "Cliente enfermo" },
  { value: "taller", label: "Taller" },
  { value: "chapisteria", label: "Chapisteria" },
  { value: "custodia", label: "Custodia" },
  { value: "en_busqueda", label: "En busqueda" },
  { value: "archivado", label: "Archivado" }
];

function toGroup(unitId: string): string {
  const value = unitId.trim().toUpperCase();
  return value.length > 0 ? value[0] : "-";
}

function normalizeUnitIdInput(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  const group = cleaned[0];
  const digits = cleaned.slice(1).replace(/\D/g, "");
  if (!digits) return group;
  return `${group}${digits}`;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value: unknown): string {
  const text = normalizeText(value);
  return text.length > 0 ? text.toLowerCase() : "libre";
}

function optionalString(row: ControlUnitRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function optionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "libre") return "LIBRE";
  if (normalized === "activo") return "Activo";
  if (normalized === "cliente_enfermo") return "Cliente enfermo";
  if (normalized === "taller") return "Taller";
  if (normalized === "chapisteria") return "Chapisteria";
  if (normalized === "custodia") return "Custodia";
  if (normalized === "en_busqueda") return "En busqueda";
  if (normalized === "archivado") return "Archivado";
  return normalized.length > 0 ? value : "Sin estado";
}

function statusBadgeClass(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "libre") return "control-op-badge control-op-badge--sin-estado";
  if (normalized === "activo") return "control-op-badge control-op-badge--activo";
  if (normalized === "cliente_enfermo") return "control-op-badge control-op-badge--enfermo";
  if (normalized === "taller") return "control-op-badge control-op-badge--taller";
  if (normalized === "chapisteria") return "control-op-badge control-op-badge--chapisteria";
  if (normalized === "custodia") return "control-op-badge control-op-badge--custodia";
  if (normalized === "en_busqueda") return "control-op-badge control-op-badge--busqueda";
  if (normalized === "archivado") return "control-op-badge control-op-badge--archivado";
  return "control-op-badge control-op-badge--sin-estado";
}

function toFormState(row?: ControlUnitRow): UnitFormState {
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

export default function ControlUnitsPage({
  dataOwnerUserId,
  readOnly = false,
  clients = [],
  onFleetClientStatusSync
}: Props) {
  const [rows, setRows] = useState<ControlUnitRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [statusSaving, setStatusSaving] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("unit_id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [editTarget, setEditTarget] = useState<ControlUnitRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<ControlUnitRow | null>(null);
  const [statusDraft, setStatusDraft] = useState<FleetStatus>("activo");
  const [form, setForm] = useState<UnitFormState>({ ...DEFAULT_FORM });

  useEffect(() => {
    if (!dataOwnerUserId) {
      setRows([]);
      setLoading(false);
      setLoadError("No se encontro owner de datos para cargar autos.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void (async () => {
      try {
        const data = await loadControlUnits(dataOwnerUserId);
        if (cancelled) return;
        setRows(data);
      } catch (error) {
        if (cancelled) return;
        console.error("No se pudo cargar autos.", error);
        setLoadError("No se pudo cargar el tablero de autos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId]);

  const groups = useMemo(() => Array.from(new Set(rows.map((item) => toGroup(item.unit_id ?? "")))).sort(), [rows]);
  const companies = useMemo(() => Array.from(new Set(rows.map((item) => normalizeText(item.company)).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [rows]);
  const models = useMemo(() => Array.from(new Set(rows.map((item) => normalizeText(item.brand_model)).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [rows]);
  function effectiveStatus(row: ControlUnitRow): string {
    return normalizeStatus(row.operational_status);
  }
  function toFleetStatus(value: string): FleetStatus {
    const normalized = normalizeStatus(value);
    return FLEET_STATUS_OPTIONS.some((option) => option.value === normalized)
      ? normalized as FleetStatus
      : "activo";
  }
  function activeClientForUnit(unitId: string): Client | null {
    const unit = normalizeText(unitId).toUpperCase();
    if (!unit) return null;
    return clients.find((client) =>
      normalizeText(client.unitId).toUpperCase() === unit &&
      normalizeStatus(client.status) !== "archivado"
    ) ?? null;
  }
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((item) => effectiveStatus(item)))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filteredRows = useMemo(() => {
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
  }, [rows, search, groupFilter, companyFilter, modelFilter, statusFilter, sortField, sortDirection]);

  function toggleSort(nextField: SortField): void {
    if (sortField === nextField) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(nextField);
    setSortDirection("asc");
  }

  const hasActiveFilters = search.trim().length > 0 ||
    groupFilter !== "all" ||
    companyFilter !== "all" ||
    modelFilter !== "all" ||
    statusFilter !== "all";

  function clearFilters(): void {
    setSearch("");
    setGroupFilter("all");
    setCompanyFilter("all");
    setModelFilter("all");
    setStatusFilter("all");
  }

  async function persistUnit(state: UnitFormState, previousUnitId?: string): Promise<void> {
    if (!dataOwnerUserId) {
      setSaveError("No hay owner de datos para guardar autos en Supabase.");
      return;
    }
    const unitId = normalizeUnitIdInput(state.unit_id);
    if (!unitId) {
      setSaveError("La unidad es obligatoria.");
      return;
    }
    if (!/^[ABCDT][0-9]{1,3}$/.test(unitId)) {
      setSaveError("Formato de unidad invalido. Usa grupos A/B/C/D/T y formato como A1, B12, C101 o T37.");
      return;
    }
    const group = unitId[0] as "A" | "B" | "C" | "D" | "T";
    const numericPart = Number(unitId.slice(1));
    const maxAllowed = UNIT_GROUP_MAX[group];
    if (!Number.isFinite(numericPart) || numericPart < 1 || numericPart > maxAllowed) {
      setSaveError(`Unidad fuera de rango para grupo ${group}. Rango permitido: ${group}1 a ${group}${maxAllowed}.`);
      return;
    }
    const year = optionalInteger(state.year);
    if (state.year.trim() && year === null) {
      setSaveError("Ano debe ser un numero entero.");
      return;
    }
    const mileage = optionalNumber(state.mileage);
    if (state.mileage.trim() && mileage === null) {
      setSaveError("Kilometraje debe ser un numero valido.");
      return;
    }
    setSaving(true);
    setSaveError("");
    const payload: ControlUnitUpsertInput = {
      user_id: dataOwnerUserId,
      unit_id: unitId,
      company: state.company.trim() || null,
      brand_model: state.brand_model.trim() || null,
      plate: state.plate.trim().toUpperCase() || null,
      engine_serial: state.engine_serial.trim() || null,
      chassis_serial: state.chassis_serial.trim() || null,
      observation: state.observation.trim() || null,
      operational_status: state.operational_status.trim() || "libre",
      model_year: year,
      color: state.color.trim() || null,
      transmission_type: state.transmission.trim() || null,
      mileage
    };
    try {
      await saveControlUnit(payload);
      setRows((current) => {
        const next = [...current];
        const key = previousUnitId ?? unitId;
        const index = next.findIndex((item) => item.unit_id === key);
        const merged: ControlUnitRow = {
          ...(index >= 0 ? next[index] : ({} as ControlUnitRow)),
          ...payload,
          unit_id: unitId
        } as ControlUnitRow;
        if (index >= 0) next[index] = merged;
        else next.unshift(merged);
        return next;
      });
      setCreateOpen(false);
      setEditTarget(null);
      setForm({ ...DEFAULT_FORM });
    } catch (error) {
      console.error("No se pudo guardar auto.", error);
      let message = "Error desconocido";
      if (error instanceof Error && error.message) {
        message = error.message;
      } else if (error && typeof error === "object") {
        const row = error as Record<string, unknown>;
        const parts = [
          typeof row.message === "string" ? row.message : "",
          typeof row.code === "string" ? `code=${row.code}` : "",
          typeof row.details === "string" ? row.details : "",
          typeof row.hint === "string" ? `hint=${row.hint}` : ""
        ].filter((value) => value.trim().length > 0);
        if (parts.length > 0) message = parts.join(" | ");
      } else if (typeof error === "string" && error.trim().length > 0) {
        message = error;
      }
      setSaveError(`No se pudo guardar en Supabase (fleet_units_cloud). Detalle: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  function openStatusDialog(row: ControlUnitRow): void {
    if (readOnly) return;
    setStatusTarget(row);
    setStatusDraft(toFleetStatus(effectiveStatus(row)));
    setStatusError("");
  }

  function describeStatusError(error: unknown): string {
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

  async function confirmStatusChange(): Promise<void> {
    if (!statusTarget) return;
    if (!dataOwnerUserId) {
      setStatusError("No hay owner de datos para cambiar estado en Supabase.");
      return;
    }

    const unitId = normalizeUnitIdInput(statusTarget.unit_id ?? "");
    if (!unitId) {
      setStatusError("La unidad no es valida.");
      return;
    }

    setStatusSaving(true);
    setStatusError("");
    const archivedAt = new Date().toISOString();
    const statusComment = statusDraft === "libre" || statusDraft === "archivado"
      ? `Archivado automaticamente al cambiar la unidad ${unitId} a ${statusLabel(statusDraft)} desde Autos.`
      : statusDraft === "activo"
        ? undefined
        : `Estado actualizado automaticamente desde Autos para unidad ${unitId}.`;

    try {
      const result = await setControlUnitStatus(dataOwnerUserId, unitId, statusDraft);
      const archivedClientIds = Array.isArray(result.archived_client_ids) ? result.archived_client_ids : [];
      const updatedClientIds = Array.isArray(result.updated_client_ids) ? result.updated_client_ids : [];
      setRows((current) => current.map((row) => {
        if (normalizeText(row.unit_id).toUpperCase() !== unitId) return row;
        const clearClient = statusDraft === "libre" || statusDraft === "archivado";
        return {
          ...row,
          operational_status: statusDraft,
          client_id: clearClient ? null : row.client_id,
          client_name: clearClient ? null : row.client_name,
          client_cedula: clearClient ? null : row.client_cedula
        };
      }));
      onFleetClientStatusSync?.({
        unitId,
        status: statusDraft,
        archivedClientIds,
        updatedClientIds,
        statusComment,
        archivedAt
      });
      setStatusTarget(null);
    } catch (error) {
      console.error("No se pudo cambiar estado de auto.", error);
      setStatusError(`No se pudo cambiar el estado en Supabase. Detalle: ${describeStatusError(error)}`);
    } finally {
      setStatusSaving(false);
    }
  }

  function renderStatusControl(row: ControlUnitRow) {
    const status = effectiveStatus(row);
    if (readOnly || !dataOwnerUserId) {
      return <span className={statusBadgeClass(status)}>{statusLabel(status)}</span>;
    }
    return (
      <button
        type="button"
        className={statusBadgeClass(status)}
        onClick={() => openStatusDialog(row)}
        title="Cambiar estado de la unidad"
      >
        {statusLabel(status)}
      </button>
    );
  }

  const kpiTotal = rows.length;
  const statusDashboard = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = effectiveStatus(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({
        key,
        label: key === "libre" ? "LIBRE" : statusLabel(key),
        count
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [rows]);

  const pieData = useMemo(() => {
    const total = statusDashboard.reduce((acc, item) => acc + item.count, 0);
    if (total <= 0) return { slices: [] as Array<{ key: string; label: string; count: number; percent: number; color: string; path: string }>, total };
    const cx = 120;
    const cy = 120;
    const r = 92;
    let startAngle = -Math.PI / 2;

    const slices = statusDashboard.map((item, index) => {
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
  }, [statusDashboard]);
  const statusTargetUnit = statusTarget ? normalizeText(statusTarget.unit_id).toUpperCase() : "";
  const statusTargetClient = statusTarget ? activeClientForUnit(statusTarget.unit_id) : null;
  const statusTargetClientName = statusTargetClient?.name || normalizeText(statusTarget?.client_name);
  const statusWillArchiveClient = Boolean(
    (statusTargetClient || statusTargetClientName) &&
    (statusDraft === "libre" || statusDraft === "archivado")
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Autos</h2>
        {!readOnly && dataOwnerUserId && (
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setForm({ ...DEFAULT_FORM });
              setSaveError("");
              setCreateOpen(true);
            }}
          >
            Nuevo auto
          </button>
        )}
      </div>

      <p className="hint">Dashboard de flota con enfoque solo vehicular.</p>

      <div className="summary-grid fleet-summary-grid">
        <article className="summary-card">
          <span>Total flota</span>
          <strong>{kpiTotal}</strong>
          <p className="hint" style={{ marginTop: 6 }}>
            Click en una porcion para filtrar por estado.
          </p>
          <div className="fleet-dashboard-layout">
            <div className="fleet-chart-wrap">
              <svg className="fleet-chart" viewBox="0 0 240 240" role="img" aria-label="Distribucion de estados de flota">
                {pieData.slices.map((slice) => {
                  const active = statusFilter === slice.key;
                  return (
                    <path
                      key={slice.key}
                      d={slice.path}
                      fill={slice.color}
                      stroke={active ? "#0f172a" : "#ffffff"}
                      strokeWidth={active ? 3 : 1.5}
                      style={{ cursor: "pointer", opacity: statusFilter === "all" || active ? 1 : 0.45 }}
                      onClick={() => setStatusFilter((current) => (current === slice.key ? "all" : slice.key))}
                    />
                  );
                })}
                <circle cx="120" cy="120" r="46" fill="#ffffff" />
                <text x="120" y="113" textAnchor="middle" fontSize="12" fill="#64748b">Estados</text>
                <text x="120" y="132" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0f172a">{pieData.total}</text>
              </svg>
            </div>
            <div className="fleet-status-list">
              <button
                type="button"
                className={`button ghost small fleet-status-filter ${statusFilter === "all" ? "cash-tab-active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                Ver todos
              </button>
              {pieData.slices.map((slice) => (
                <button
                  key={slice.key}
                  type="button"
                  className={`button ghost small fleet-status-filter ${statusFilter === slice.key ? "cash-tab-active" : ""}`}
                  onClick={() => setStatusFilter((current) => (current === slice.key ? "all" : slice.key))}
                >
                  <span className="fleet-status-filter-label">
                    <span className="fleet-color-dot" style={{ background: slice.color }} />
                    {slice.label}
                  </span>
                  <strong>{slice.count} ({slice.percent.toFixed(1)}%)</strong>
                </button>
              ))}
            </div>
          </div>
        </article>
      </div>

      <div className="filters-bar fleet-filters-bar">
        <input
          type="text"
          value={search}
          placeholder="Buscar por unidad, placa, serial, modelo..."
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
          <option value="all">Grupo (todos)</option>
          {groups.map((group) => <option key={group} value={group}>{group}</option>)}
        </select>
        <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}>
          <option value="all">Modelo (todos)</option>
          {models.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
        <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
          <option value="all">Empresa (todas)</option>
          {companies.map((company) => <option key={company} value={company}>{company}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Estado (todos)</option>
          {statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
      </div>

      <div className="fleet-mobile-toolbar">
        <span>{filteredRows.length} de {kpiTotal} autos</span>
        {hasActiveFilters && (
          <button type="button" className="button ghost small" onClick={clearFilters}>
            Limpiar filtros
          </button>
        )}
      </div>

      {loadError && <p className="hint error-text">{loadError}</p>}
      {saveError && <p className="hint error-text">{saveError}</p>}

      {loading ? (
        <p className="hint">Cargando flota...</p>
      ) : (
        <>
          <div className="table-scroll fleet-table-scroll">
            <table className="ar-table">
              <thead>
                <tr>
                  <th><button type="button" className="sort-button" onClick={() => toggleSort("unit_id")}>Unidad</button></th>
                  <th><button type="button" className="sort-button" onClick={() => toggleSort("group")}>Grupo</button></th>
                  <th><button type="button" className="sort-button" onClick={() => toggleSort("operational_status")}>Estado</button></th>
                  <th><button type="button" className="sort-button" onClick={() => toggleSort("brand_model")}>Marca / Modelo</button></th>
                  <th>Ano</th>
                  <th><button type="button" className="sort-button" onClick={() => toggleSort("company")}>Empresa</button></th>
                  <th><button type="button" className="sort-button" onClick={() => toggleSort("plate")}>Placa</button></th>
                  <th>Motor</th>
                  <th>Chasis</th>
                  <th>Color</th>
                  <th>Transmision</th>
                  <th>Kilometraje</th>
                  <th>Observacion</th>
                  {!readOnly && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={readOnly ? 13 : 14}><span className="hint">No hay unidades para los filtros seleccionados.</span></td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const year = optionalString(row, ["year", "model_year"]);
                    const color = optionalString(row, ["color"]);
                    const transmission = optionalString(row, ["transmission", "transmission_type"]);
                    const mileage = optionalString(row, ["mileage", "kilometraje", "kilometrage"]);
                    return (
                      <tr key={`${row.user_id}-${row.unit_id}`}>
                        <td><strong>{row.unit_id}</strong></td>
                        <td>{toGroup(row.unit_id ?? "")}</td>
                        <td>{renderStatusControl(row)}</td>
                        <td>{row.brand_model ?? "-"}</td>
                        <td>{year || "-"}</td>
                        <td>{row.company ?? "-"}</td>
                        <td>{row.plate ?? "-"}</td>
                        <td>{row.engine_serial ?? "-"}</td>
                        <td>{row.chassis_serial ?? "-"}</td>
                        <td>{color || "-"}</td>
                        <td>{transmission || "-"}</td>
                        <td>{mileage || "-"}</td>
                        <td className="ar-truncate-line" title={row.observation ?? ""}>{row.observation ?? "-"}</td>
                        {!readOnly && (
                          <td>
                            <button
                              type="button"
                              className="button ghost small"
                              onClick={() => {
                                setForm(toFormState(row));
                                setSaveError("");
                                setEditTarget(row);
                              }}
                            >
                              Editar
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="fleet-mobile-list">
            {filteredRows.length === 0 ? (
              <p className="empty">No hay unidades para los filtros seleccionados.</p>
            ) : (
              filteredRows.map((row) => {
                const year = optionalString(row, ["year", "model_year"]);
                const color = optionalString(row, ["color"]);
                const transmission = optionalString(row, ["transmission", "transmission_type"]);
                const mileage = optionalString(row, ["mileage", "kilometraje", "kilometrage"]);
                return (
                  <article className="fleet-mobile-card" key={`mobile-${row.user_id}-${row.unit_id}`}>
                    <div className="fleet-mobile-card-head">
                      <div>
                        <span className="fleet-mobile-kicker">Unidad</span>
                        <strong>{row.unit_id}</strong>
                      </div>
                      {renderStatusControl(row)}
                    </div>
                    <div className="fleet-mobile-main">
                      <span>{row.brand_model ?? "Sin marca/modelo"}</span>
                      <span>{row.plate ? `Placa ${row.plate}` : "Sin placa"}</span>
                    </div>
                    <dl className="fleet-mobile-details">
                      <div><dt>Empresa</dt><dd>{row.company ?? "-"}</dd></div>
                      <div><dt>Ano</dt><dd>{year || "-"}</dd></div>
                      <div><dt>Color</dt><dd>{color || "-"}</dd></div>
                      <div><dt>Km</dt><dd>{mileage || "-"}</dd></div>
                    </dl>
                    <details className="fleet-mobile-tech">
                      <summary>Ficha tecnica</summary>
                      <dl className="fleet-mobile-details">
                        <div><dt>Motor</dt><dd>{row.engine_serial ?? "-"}</dd></div>
                        <div><dt>Chasis</dt><dd>{row.chassis_serial ?? "-"}</dd></div>
                        <div><dt>Transmision</dt><dd>{transmission || "-"}</dd></div>
                      </dl>
                      {row.observation && <p className="fleet-mobile-note">{row.observation}</p>}
                    </details>
                    {!readOnly && (
                      <button
                        type="button"
                        className="button ghost small fleet-mobile-edit"
                        onClick={() => {
                          setForm(toFormState(row));
                          setSaveError("");
                          setEditTarget(row);
                        }}
                      >
                        Editar
                      </button>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </>
      )}

      {statusTarget && !readOnly && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Cambiar estado {statusTargetUnit}</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  if (statusSaving) return;
                  setStatusTarget(null);
                  setStatusError("");
                }}
              >
                X
              </button>
            </div>
            <div className="modal-body">
              <label>Estado
                <select
                  value={statusDraft}
                  onChange={(event) => setStatusDraft(event.target.value as FleetStatus)}
                  disabled={statusSaving}
                >
                  {FLEET_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              {statusWillArchiveClient && (
                <div className="error-banner" style={{ marginTop: 12 }}>
                  La unidad quedara {statusLabel(statusDraft)} y {statusTargetClientName || "el cliente enlazado"} pasara a Clientes archivados conservando la unidad {statusTargetUnit}.
                </div>
              )}

              {statusError && <p className="hint error-text">{statusError}</p>}

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="button ghost"
                  disabled={statusSaving}
                  onClick={() => {
                    setStatusTarget(null);
                    setStatusError("");
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={statusSaving}
                  onClick={() => void confirmStatusChange()}
                >
                  {statusSaving ? "Guardando..." : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(createOpen || editTarget) && !readOnly && dataOwnerUserId && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 980 }}>
            <div className="modal-header">
              <h2>{editTarget ? `Editar auto ${editTarget.unit_id}` : "Nuevo auto"}</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  setCreateOpen(false);
                  setEditTarget(null);
                  setSaveError("");
                }}
              >
                X
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <label>Unidad
                  <input
                    value={form.unit_id}
                    onChange={(event) => setForm((s) => ({ ...s, unit_id: normalizeUnitIdInput(event.target.value) }))}
                    placeholder="Ejemplo: A1"
                  />
                </label>
                <label>Marca / Modelo
                  <input value={form.brand_model} onChange={(event) => setForm((s) => ({ ...s, brand_model: event.target.value }))} />
                </label>
                <label>Ano
                  <input value={form.year} onChange={(event) => setForm((s) => ({ ...s, year: event.target.value }))} />
                </label>
                <label>Empresa
                  <input
                    list="fleet-company-options"
                    value={form.company}
                    onChange={(event) => setForm((s) => ({ ...s, company: event.target.value }))}
                    placeholder="Selecciona o escribe empresa"
                  />
                </label>
                <label>Placa
                  <input value={form.plate} onChange={(event) => setForm((s) => ({ ...s, plate: event.target.value }))} />
                </label>
                <label>Serial Motor
                  <input value={form.engine_serial} onChange={(event) => setForm((s) => ({ ...s, engine_serial: event.target.value }))} />
                </label>
                <label>Serial Chasis
                  <input value={form.chassis_serial} onChange={(event) => setForm((s) => ({ ...s, chassis_serial: event.target.value }))} />
                </label>
                <label>Color
                  <input value={form.color} onChange={(event) => setForm((s) => ({ ...s, color: event.target.value }))} />
                </label>
                <label>Transmision
                  <input value={form.transmission} onChange={(event) => setForm((s) => ({ ...s, transmission: event.target.value }))} />
                </label>
                <label>Kilometraje
                  <input value={form.mileage} onChange={(event) => setForm((s) => ({ ...s, mileage: event.target.value }))} />
                </label>
                <label>Estado operativo
                  <select value={form.operational_status} onChange={(event) => setForm((s) => ({ ...s, operational_status: event.target.value }))}>
                    <option value="libre">LIBRE</option>
                    <option value="activo">Activo</option>
                    <option value="cliente_enfermo">Cliente enfermo</option>
                    <option value="taller">Taller</option>
                    <option value="chapisteria">Chapisteria</option>
                    <option value="custodia">Custodia</option>
                    <option value="en_busqueda">En busqueda</option>
                    <option value="archivado">Archivado</option>
                  </select>
                </label>
                <label style={{ gridColumn: "1 / -1" }}>Observaciones
                  <input value={form.observation} onChange={(event) => setForm((s) => ({ ...s, observation: event.target.value }))} />
                </label>
              </div>
              <datalist id="fleet-company-options">
                {companies.map((company) => (
                  <option key={company} value={company} />
                ))}
              </datalist>

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="button ghost" onClick={() => { setCreateOpen(false); setEditTarget(null); }}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={saving}
                  onClick={() => void persistUnit(form, editTarget?.unit_id)}
                >
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
