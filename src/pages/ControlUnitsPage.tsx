import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadFleetUnitEvents,
  previewFleetUnitLifecycle,
  renameControlUnit,
  restoreControlUnit,
  retireControlUnit,
  saveControlUnit,
  setControlUnitStatus,
  type ControlUnitRow,
  type ControlUnitUpsertInput,
  type FleetLifecycleImpact,
  type FleetUnitEvent
} from "../cloudData";
import type { BankRule, Client } from "../types";
import { FleetDashboard } from "./controlUnits/FleetDashboard";
import { FleetFilters } from "./controlUnits/FleetFilters";
import { FleetMobileList } from "./controlUnits/FleetMobileList";
import { FleetMobileToolbar } from "./controlUnits/FleetMobileToolbar";
import { FleetUnitHistoryModal, RenameFleetUnitModal, RestoreFleetUnitModal, RetireFleetUnitModal } from "./controlUnits/FleetLifecycleModals";
import { RetiredFleetList } from "./controlUnits/RetiredFleetList";
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
  getActiveFleetGroups,
  getActiveFleetRule,
  getFleetCompanyForGroup,
  getFleetCompanyOptions,
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
  bankRules?: BankRule[];
  onFleetClientStatusSync?: (payload: FleetClientStatusSyncPayload) => void;
};

export default function ControlUnitsPage({
  dataOwnerUserId,
  readOnly = false,
  clients = [],
  bankRules = [],
  onFleetClientStatusSync
}: Props) {
  const { rows, setRows, retiredRows, loading, loadError, reloadRows, reloadAllRows } = useControlUnitsRows(dataOwnerUserId);
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
  const [viewTab, setViewTab] = useState<"active" | "retired">("active");
  const [retiredSearch, setRetiredSearch] = useState<string>("");
  const [renameTarget, setRenameTarget] = useState<ControlUnitRow | null>(null);
  const [retireTarget, setRetireTarget] = useState<ControlUnitRow | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ControlUnitRow | null>(null);
  const [nextUnitId, setNextUnitId] = useState<string>("");
  const [lifecycleReason, setLifecycleReason] = useState<string>("");
  const [lifecycleNote, setLifecycleNote] = useState<string>("");
  const [lifecycleImpact, setLifecycleImpact] = useState<FleetLifecycleImpact | null>(null);
  const [lifecycleSaving, setLifecycleSaving] = useState<boolean>(false);
  const [lifecycleError, setLifecycleError] = useState<string>("");
  const [lifecycleMessage, setLifecycleMessage] = useState<string>("");
  const [historyTarget, setHistoryTarget] = useState<ControlUnitRow | null>(null);
  const [historyEvents, setHistoryEvents] = useState<FleetUnitEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string>("");

  const displayRows = useMemo(() => rows.map((row) => {
    const unitId = normalizeText(row.unit_id).toUpperCase();
    const rentalClient = clients.find((client) => client.activeProvisionalRental?.unitId.trim().toUpperCase() === unitId);
    return rentalClient ? {
      ...row,
      operational_status: "provisional_rental",
      client_id: rentalClient.id,
      client_name: rentalClient.name,
      client_cedula: rentalClient.cedula ?? null
    } : row;
  }), [clients, rows]);

  const { groups, companies, models, statuses } = useMemo(() => getFleetFilterOptions(displayRows), [displayRows]);
  const companyOptions = useMemo(() => getFleetCompanyOptions(displayRows, bankRules), [bankRules, displayRows]);
  const activeFleetGroups = useMemo(() => getActiveFleetGroups(bankRules), [bankRules]);
  const filteredRows = useMemo(() => filterAndSortFleetRows({
    rows: displayRows,
    search,
    groupFilter,
    companyFilter,
    modelFilter,
    statusFilter,
    sortField,
    sortDirection
  }), [displayRows, search, groupFilter, companyFilter, modelFilter, statusFilter, sortField, sortDirection]);
  const pieData = useMemo(() => buildFleetPieData(displayRows), [displayRows]);
  const kpiTotal = displayRows.length;
  const hasActiveFilters = search.trim().length > 0 ||
    groupFilter !== "all" ||
    companyFilter !== "all" ||
    modelFilter !== "all" ||
    statusFilter !== "all";
  const filteredRetiredRows = useMemo(() => {
    const query = retiredSearch.trim().toLocaleLowerCase("es");
    if (!query) return retiredRows;
    return retiredRows.filter((row) => [
      row.unit_id,
      row.brand_model,
      row.plate,
      row.chassis_serial,
      row.retired_client_name,
      row.retired_reason,
      row.retired_note
    ].some((value) => String(value ?? "").toLocaleLowerCase("es").includes(query)));
  }, [retiredRows, retiredSearch]);

  const activeClientForUnit = useCallback((unitId: string): Client | null => {
    const unit = normalizeText(unitId).toUpperCase();
    if (!unit) return null;
    return clients.find((client) =>
      (normalizeText(client.unitId).toUpperCase() === unit || client.activeProvisionalRental?.unitId.trim().toUpperCase() === unit) &&
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

  const changeUnitId = useCallback((rawUnitId: string): void => {
    const unitId = normalizeUnitIdInput(rawUnitId);
    const nextGroup = unitId.slice(0, 1);
    const mappedCompany = getFleetCompanyForGroup(displayRows, bankRules, nextGroup);
    setForm((current) => ({
      ...current,
      unit_id: unitId,
      company: current.unit_id.slice(0, 1) === nextGroup ? current.company : mappedCompany
    }));
    setSaveError("");
  }, [bankRules, displayRows]);

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
    if (!/^[A-Z][0-9]{1,3}$/.test(unitId)) {
      setSaveError("Formato de unidad invalido. Usa la letra configurada en Regla bancaria y un numero, por ejemplo E1.");
      return;
    }
    const group = unitId[0];
    if (!activeFleetGroups.includes(group)) {
      setSaveError(`El grupo ${group} no tiene una regla bancaria activa. Configuralo antes de guardar el auto.`);
      return;
    }
    const numericPart = Number(unitId.slice(1));
    const maxAllowed = UNIT_GROUP_MAX;
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
      company: normalizeText(getActiveFleetRule(bankRules, group)?.accountName) || state.company.trim() || null,
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

  const resetLifecycleDialog = useCallback((): void => {
    setRenameTarget(null);
    setRetireTarget(null);
    setRestoreTarget(null);
    setNextUnitId("");
    setLifecycleReason("");
    setLifecycleNote("");
    setLifecycleImpact(null);
    setLifecycleError("");
  }, []);

  const openRenameDialog = useCallback((row: ControlUnitRow): void => {
    setRenameTarget(row);
    setRetireTarget(null);
    setRestoreTarget(null);
    setNextUnitId("");
    setLifecycleReason("");
    setLifecycleNote("");
    setLifecycleImpact(null);
    setLifecycleError("");
    setLifecycleMessage("");
  }, []);

  const openRetireDialog = useCallback((row: ControlUnitRow): void => {
    setRetireTarget(row);
    setRenameTarget(null);
    setRestoreTarget(null);
    setLifecycleReason("");
    setLifecycleNote("");
    setLifecycleImpact(null);
    setLifecycleError("");
    setLifecycleMessage("");
    if (!dataOwnerUserId || !row.fleet_id) return;
    void previewFleetUnitLifecycle({ userId: dataOwnerUserId, fleetId: row.fleet_id })
      .then(setLifecycleImpact)
      .catch((error) => setLifecycleError(describeStatusError(error)));
  }, [dataOwnerUserId]);

  const openRestoreDialog = useCallback((row: ControlUnitRow): void => {
    setRestoreTarget(row);
    setRenameTarget(null);
    setRetireTarget(null);
    setNextUnitId(row.unit_id);
    setLifecycleReason("");
    setLifecycleNote("");
    setLifecycleImpact(null);
    setLifecycleError("");
    setLifecycleMessage("");
  }, []);

  useEffect(() => {
    if (!renameTarget || !dataOwnerUserId || !renameTarget.fleet_id) return;
    const normalized = normalizeUnitIdInput(nextUnitId);
    if (!/^[A-Z][0-9]{1,3}$/.test(normalized)) {
      setLifecycleImpact(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void previewFleetUnitLifecycle({
        userId: dataOwnerUserId,
        fleetId: renameTarget.fleet_id,
        nextUnitId: normalized
      }).then((impact) => {
        if (!cancelled) setLifecycleImpact(impact);
      }).catch((error) => {
        if (!cancelled) setLifecycleError(describeStatusError(error));
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dataOwnerUserId, nextUnitId, renameTarget]);

  async function confirmRename(): Promise<void> {
    if (!renameTarget || !dataOwnerUserId) return;
    setLifecycleSaving(true);
    setLifecycleError("");
    try {
      const result = await renameControlUnit({
        userId: dataOwnerUserId,
        fleetId: renameTarget.fleet_id,
        nextUnitId: normalizeUnitIdInput(nextUnitId),
        reason: lifecycleReason.trim(),
        note: lifecycleNote.trim() || undefined
      });
      await reloadAllRows();
      resetLifecycleDialog();
      setLifecycleMessage(`${result.previousUnitId} ahora es ${result.nextUnitId}. Se aplicó la regla bancaria del grupo ${result.nextUnitId[0]}.`);
    } catch (error) {
      setLifecycleError(describeStatusError(error));
    } finally {
      setLifecycleSaving(false);
    }
  }

  async function confirmRetire(): Promise<void> {
    if (!retireTarget || !dataOwnerUserId) return;
    setLifecycleSaving(true);
    setLifecycleError("");
    try {
      const retiredUnitId = retireTarget.unit_id;
      await retireControlUnit({
        userId: dataOwnerUserId,
        fleetId: retireTarget.fleet_id,
        reason: lifecycleReason,
        note: lifecycleNote.trim() || undefined
      });
      await reloadAllRows();
      resetLifecycleDialog();
      setViewTab("retired");
      setLifecycleMessage(`${retiredUnitId} fue dado de baja y su nomenclatura quedó libre.`);
    } catch (error) {
      setLifecycleError(describeStatusError(error));
    } finally {
      setLifecycleSaving(false);
    }
  }

  async function confirmRestore(): Promise<void> {
    if (!restoreTarget || !dataOwnerUserId) return;
    setLifecycleSaving(true);
    setLifecycleError("");
    try {
      const unitId = normalizeUnitIdInput(nextUnitId);
      await restoreControlUnit({
        userId: dataOwnerUserId,
        fleetId: restoreTarget.fleet_id,
        unitId,
        reason: lifecycleReason.trim()
      });
      await reloadAllRows();
      resetLifecycleDialog();
      setViewTab("active");
      setLifecycleMessage(`El auto fue reactivado como ${unitId}.`);
    } catch (error) {
      setLifecycleError(describeStatusError(error));
    } finally {
      setLifecycleSaving(false);
    }
  }

  const openHistoryDialog = useCallback((row: ControlUnitRow): void => {
    setHistoryTarget(row);
    setHistoryEvents([]);
    setHistoryError("");
    if (!dataOwnerUserId || !row.fleet_id) return;
    setHistoryLoading(true);
    void loadFleetUnitEvents(dataOwnerUserId, row.fleet_id)
      .then(setHistoryEvents)
      .catch((error) => setHistoryError(describeStatusError(error)))
      .finally(() => setHistoryLoading(false));
  }, [dataOwnerUserId]);

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
        {!readOnly && dataOwnerUserId && viewTab === "active" && (
          <button type="button" className="button primary" onClick={openCreateDialog}>
            Nuevo auto
          </button>
        )}
      </div>

      <p className="hint">Dashboard de flota con enfoque solo vehicular.</p>

      <div className="cash-view-tabs" style={{ margin: "12px 0" }} role="tablist" aria-label="Estado de autos">
        <button type="button" className={`button ghost small ${viewTab === "active" ? "cash-tab-active" : ""}`} onClick={() => setViewTab("active")}>Flota activa ({rows.length})</button>
        <button type="button" className={`button ghost small ${viewTab === "retired" ? "cash-tab-active" : ""}`} onClick={() => setViewTab("retired")}>Autos dados de baja ({retiredRows.length})</button>
      </div>

      {viewTab === "active" ? (
        <>
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
        </>
      ) : (
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <label>Buscar en autos dados de baja
            <input value={retiredSearch} onChange={(event) => setRetiredSearch(event.target.value)} placeholder="Nomenclatura, placa, chasis, cliente o motivo" />
          </label>
        </div>
      )}

      {loadError && <p className="hint error-text">{loadError}</p>}
      {saveError && <p className="hint error-text">{saveError}</p>}
      {lifecycleMessage && <p className="hint" role="status">{lifecycleMessage}</p>}

      {loading ? (
        <p className="hint">Cargando flota...</p>
      ) : viewTab === "active" ? (
        <>
          <FleetTable
            rows={filteredRows}
            readOnly={readOnly}
            canEditStatus={Boolean(dataOwnerUserId)}
            onToggleSort={toggleSort}
            onEditUnit={openEditDialog}
            onRenameUnit={openRenameDialog}
            onRetireUnit={openRetireDialog}
            onShowHistory={openHistoryDialog}
            onOpenStatusDialog={openStatusDialog}
          />
          <FleetMobileList
            rows={filteredRows}
            readOnly={readOnly}
            canEditStatus={Boolean(dataOwnerUserId)}
            onEditUnit={openEditDialog}
            onRenameUnit={openRenameDialog}
            onRetireUnit={openRetireDialog}
            onShowHistory={openHistoryDialog}
            onOpenStatusDialog={openStatusDialog}
          />
        </>
      ) : (
        <RetiredFleetList rows={filteredRetiredRows} readOnly={readOnly} onRestore={openRestoreDialog} onHistory={openHistoryDialog} />
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

      {renameTarget && !readOnly && (
        <RenameFleetUnitModal
          target={renameTarget}
          nextUnitId={nextUnitId}
          reason={lifecycleReason}
          note={lifecycleNote}
          impact={lifecycleImpact}
          saving={lifecycleSaving}
          error={lifecycleError}
          onNextUnitIdChange={(value) => { setNextUnitId(normalizeUnitIdInput(value)); setLifecycleImpact(null); setLifecycleError(""); }}
          onReasonChange={setLifecycleReason}
          onNoteChange={setLifecycleNote}
          onCancel={resetLifecycleDialog}
          onConfirm={() => void confirmRename()}
        />
      )}

      {retireTarget && !readOnly && (
        <RetireFleetUnitModal
          target={retireTarget}
          reason={lifecycleReason}
          note={lifecycleNote}
          impact={lifecycleImpact}
          saving={lifecycleSaving}
          error={lifecycleError}
          onReasonChange={setLifecycleReason}
          onNoteChange={setLifecycleNote}
          onCancel={resetLifecycleDialog}
          onConfirm={() => void confirmRetire()}
        />
      )}

      {restoreTarget && !readOnly && (
        <RestoreFleetUnitModal
          target={restoreTarget}
          unitId={nextUnitId}
          reason={lifecycleReason}
          saving={lifecycleSaving}
          error={lifecycleError}
          onUnitIdChange={(value) => setNextUnitId(normalizeUnitIdInput(value))}
          onReasonChange={setLifecycleReason}
          onCancel={resetLifecycleDialog}
          onConfirm={() => void confirmRestore()}
        />
      )}

      {historyTarget && (
        <FleetUnitHistoryModal
          target={historyTarget}
          events={historyEvents}
          loading={historyLoading}
          error={historyError}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {(createOpen || editTarget) && !readOnly && dataOwnerUserId && (
        <UnitFormModal
          form={form}
          editTarget={editTarget}
          companies={companyOptions}
          saving={saving}
          error={saveError}
          onFormChange={setForm}
          onUnitIdChange={changeUnitId}
          onCancel={closeUnitDialog}
          onSave={() => void persistUnit(form, editTarget?.unit_id)}
        />
      )}
    </section>
  );
}
