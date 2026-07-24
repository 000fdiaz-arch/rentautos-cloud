import { useCallback, useMemo, useState } from "react";
import { saveControlUnit, setControlUnitStatus, type ControlUnitRow, type ControlUnitUpsertInput } from "../cloudData";
import type { Client } from "../types";
import { FleetDashboard } from "./controlUnits/FleetDashboard";
import { FleetFilters } from "./controlUnits/FleetFilters";
import { FleetMobileList } from "./controlUnits/FleetMobileList";
import { FleetMobileToolbar } from "./controlUnits/FleetMobileToolbar";
import { FleetStatusModal } from "./controlUnits/FleetStatusModal";
import { FleetTable } from "./controlUnits/FleetTable";
import { UnitFormModal } from "./controlUnits/UnitFormModal";
import { useControlUnitsRows } from "./controlUnits/useControlUnitsRows";
import {
  DEFAULT_FORM,
  UNIT_GROUP_MAX,
  buildFleetPieData,
  describeStatusError,
  effectiveStatus,
  filterAndSortFleetRows,
  getFleetFilterOptions,
  normalizeStatus,
  normalizeText,
  normalizeUnitIdInput,
  optionalInteger,
  optionalNumber,
  statusLabel,
  toFleetStatus,
  toFormState,
  type FleetClientStatusSyncPayload,
  type FleetStatus,
  type SortField,
  type SortDirection,
  type UnitFormState
} from "./controlUnits/controlUnitsRules";

type Props = {
  dataOwnerUserId?: string | null;
  readOnly?: boolean;
  clients?: Client[];
  onFleetClientStatusSync?: (payload: FleetClientStatusSyncPayload) => void;
};

export default function ControlUnitsPage({
  dataOwnerUserId,
  readOnly = false,
  clients = [],
  onFleetClientStatusSync
}: Props) {
  const { rows, setRows, loading, loadError, reloadRows } = useControlUnitsRows(dataOwnerUserId);
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

  const { groups, companies, models, statuses } = useMemo(() => getFleetFilterOptions(rows), [rows]);
  const filteredRows = useMemo(() => filterAndSortFleetRows({
    rows,
    search,
    groupFilter,
    companyFilter,
    modelFilter,
    statusFilter,
    sortField,
    sortDirection
  }), [rows, search, groupFilter, companyFilter, modelFilter, statusFilter, sortField, sortDirection]);
  const pieData = useMemo(() => buildFleetPieData(rows), [rows]);
  const kpiTotal = rows.length;
  const hasActiveFilters = search.trim().length > 0 ||
    groupFilter !== "all" ||
    companyFilter !== "all" ||
    modelFilter !== "all" ||
    statusFilter !== "all";

  const activeClientForUnit = useCallback((unitId: string): Client | null => {
    const unit = normalizeText(unitId).toUpperCase();
    if (!unit) return null;
    return clients.find((client) =>
      normalizeText(client.unitId).toUpperCase() === unit &&
      normalizeStatus(client.status) !== "archivado"
    ) ?? null;
  }, [clients]);

  const toggleSort = useCallback((nextField: SortField): void => {
    if (sortField === nextField) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(nextField);
    setSortDirection("asc");
  }, [sortField]);

  const clearFilters = useCallback((): void => {
    setSearch("");
    setGroupFilter("all");
    setCompanyFilter("all");
    setModelFilter("all");
    setStatusFilter("all");
  }, []);

  const openCreateDialog = useCallback((): void => {
    setForm({ ...DEFAULT_FORM });
    setSaveError("");
    setCreateOpen(true);
  }, []);

  const openEditDialog = useCallback((row: ControlUnitRow): void => {
    setForm(toFormState(row));
    setSaveError("");
    setEditTarget(row);
  }, []);

  const closeUnitDialog = useCallback((): void => {
    setCreateOpen(false);
    setEditTarget(null);
    setSaveError("");
  }, []);

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
      setSaveError("Formato de unidad invalido. Usa grupos A/B/C/D/T y formato como A1, B12, C100 o T100.");
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
      setSaveError(`No se pudo guardar en Supabase (fleet_units_cloud). Detalle: ${describeStatusError(error)}`);
    } finally {
      setSaving(false);
    }
  }

  const openStatusDialog = useCallback((row: ControlUnitRow): void => {
    if (readOnly) return;
    setStatusTarget(row);
    setStatusDraft(toFleetStatus(effectiveStatus(row)));
    setStatusError("");
  }, [readOnly]);

  const closeStatusDialog = useCallback((): void => {
    if (statusSaving) return;
    setStatusTarget(null);
    setStatusError("");
  }, [statusSaving]);

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
      await reloadRows();
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
          <button type="button" className="button primary" onClick={openCreateDialog}>
            Nuevo auto
          </button>
        )}
      </div>

      <p className="hint">Dashboard de flota con enfoque solo vehicular.</p>

      <FleetDashboard
        kpiTotal={kpiTotal}
        pieData={pieData}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <FleetFilters
        search={search}
        groupFilter={groupFilter}
        modelFilter={modelFilter}
        companyFilter={companyFilter}
        statusFilter={statusFilter}
        groups={groups}
        models={models}
        companies={companies}
        statuses={statuses}
        onSearchChange={setSearch}
        onGroupFilterChange={setGroupFilter}
        onModelFilterChange={setModelFilter}
        onCompanyFilterChange={setCompanyFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <FleetMobileToolbar
        visibleCount={filteredRows.length}
        totalCount={kpiTotal}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
      />

      {loadError && <p className="hint error-text">{loadError}</p>}
      {saveError && <p className="hint error-text">{saveError}</p>}

      {loading ? (
        <p className="hint">Cargando flota...</p>
      ) : (
        <>
          <FleetTable
            rows={filteredRows}
            readOnly={readOnly}
            canEditStatus={Boolean(dataOwnerUserId)}
            onToggleSort={toggleSort}
            onEditUnit={openEditDialog}
            onOpenStatusDialog={openStatusDialog}
          />
          <FleetMobileList
            rows={filteredRows}
            readOnly={readOnly}
            canEditStatus={Boolean(dataOwnerUserId)}
            onEditUnit={openEditDialog}
            onOpenStatusDialog={openStatusDialog}
          />
        </>
      )}

      {statusTarget && !readOnly && (
        <FleetStatusModal
          unitId={statusTargetUnit}
          draft={statusDraft}
          saving={statusSaving}
          error={statusError}
          willArchiveClient={statusWillArchiveClient}
          clientName={statusTargetClientName}
          onDraftChange={setStatusDraft}
          onCancel={closeStatusDialog}
          onConfirm={() => void confirmStatusChange()}
        />
      )}

      {(createOpen || editTarget) && !readOnly && dataOwnerUserId && (
        <UnitFormModal
          form={form}
          editTarget={editTarget}
          companies={companies}
          saving={saving}
          onFormChange={setForm}
          onCancel={closeUnitDialog}
          onSave={() => void persistUnit(form, editTarget?.unit_id)}
        />
      )}
    </section>
  );
}
