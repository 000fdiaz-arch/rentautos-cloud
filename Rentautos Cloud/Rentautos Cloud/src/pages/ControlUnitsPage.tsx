import { useEffect, useMemo, useState } from "react";
import { loadControlUnits, saveControlUnit, type ControlUnitRow, type ControlUnitUpsertInput } from "../cloudData";
import type { Client } from "../types";

type Props = {
  dataOwnerUserId?: string | null;
  readOnly?: boolean;
  clients?: Client[];
};

type SortField = "unit_id" | "group" | "operational_status" | "brand_model" | "company" | "plate";
type SortDirection = "asc" | "desc";

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
  operational_status: "activo",
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
  if (digits.length === 1) return `${group}0${digits}`;
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
    operational_status: row.operational_status ?? "activo",
    observation: row.observation ?? ""
  };
}

export default function ControlUnitsPage({ dataOwnerUserId, readOnly = false, clients = [] }: Props) {
  const [rows, setRows] = useState<ControlUnitRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("unit_id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [editTarget, setEditTarget] = useState<ControlUnitRow | null>(null);
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
  const clientStatusByUnit = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients) {
      const unit = normalizeText(client.unitId).toUpperCase();
      if (!unit) continue;
      map.set(unit, normalizeStatus(client.status));
    }
    return map;
  }, [clients]);
  function effectiveStatus(row: ControlUnitRow): string {
    const unit = normalizeText(row.unit_id).toUpperCase();
    const fromClient = unit ? clientStatusByUnit.get(unit) : "";
    if (fromClient && fromClient.length > 0) return fromClient;
    return normalizeStatus(row.operational_status);
  }
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((item) => effectiveStatus(item)))).sort((a, b) => a.localeCompare(b)),
    [rows, clientStatusByUnit]
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
  }, [rows, search, groupFilter, companyFilter, modelFilter, statusFilter, sortField, sortDirection, clientStatusByUnit]);

  function toggleSort(nextField: SortField): void {
    if (sortField === nextField) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(nextField);
    setSortDirection("asc");
  }

  async function persistUnit(state: UnitFormState, previousUnitId?: string): Promise<void> {
    if (!dataOwnerUserId) return;
    const unitId = normalizeUnitIdInput(state.unit_id);
    if (!unitId) {
      setSaveError("La unidad es obligatoria.");
      return;
    }
    if (!/^[ABCDT][0-9]{2,3}$/.test(unitId)) {
      setSaveError("Formato de unidad invalido. Usa grupos A/B/C/D/T y formato como A01, B12, C101 o T99.");
      return;
    }
    const group = unitId[0] as "A" | "B" | "C" | "D" | "T";
    const numericPart = Number(unitId.slice(1));
    const maxAllowed = UNIT_GROUP_MAX[group];
    if (!Number.isFinite(numericPart) || numericPart < 1 || numericPart > maxAllowed) {
      setSaveError(`Unidad fuera de rango para grupo ${group}. Rango permitido: ${group}01 a ${group}${String(maxAllowed).padStart(2, "0")}.`);
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
      observation: state.observation.trim() || null
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
  }, [rows, clientStatusByUnit]);

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

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Autos</h2>
        {!readOnly && (
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

      <div className="summary-grid" style={{ marginTop: 12, gridTemplateColumns: "1fr" }}>
        <article className="summary-card">
          <span>Total flota</span>
          <strong>{kpiTotal}</strong>
          <p className="hint" style={{ marginTop: 6 }}>
            Click en una porcion para filtrar por estado.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, alignItems: "center", marginTop: 10 }}>
            <div style={{ position: "relative", width: 240, height: 240 }}>
              <svg viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Distribucion de estados de flota">
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
            <div style={{ display: "grid", gap: 8 }}>
              <button
                type="button"
                className={`button ghost small ${statusFilter === "all" ? "cash-tab-active" : ""}`}
                style={{ justifySelf: "start" }}
                onClick={() => setStatusFilter("all")}
              >
                Ver todos
              </button>
              {pieData.slices.map((slice) => (
                <button
                  key={slice.key}
                  type="button"
                  className={`button ghost small ${statusFilter === slice.key ? "cash-tab-active" : ""}`}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                  onClick={() => setStatusFilter((current) => (current === slice.key ? "all" : slice.key))}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: slice.color, display: "inline-block" }} />
                    {slice.label}
                  </span>
                  <strong>{slice.count} ({slice.percent.toFixed(1)}%)</strong>
                </button>
              ))}
            </div>
          </div>
        </article>
      </div>

      <div className="filters-bar" style={{ gridTemplateColumns: "1.5fr 0.8fr 1fr 1fr 1fr" }}>
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

      {loadError && <p className="hint error-text">{loadError}</p>}
      {saveError && <p className="hint error-text">{saveError}</p>}

      {loading ? (
        <p className="hint">Cargando flota...</p>
      ) : (
        <div className="table-scroll" style={{ borderTop: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
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
                      <td>
                        <span className={statusBadgeClass(effectiveStatus(row))}>{statusLabel(effectiveStatus(row))}</span>
                      </td>
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
      )}

      {(createOpen || editTarget) && !readOnly && (
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
                    placeholder="Ejemplo: A01"
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
