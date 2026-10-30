import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadCloudActiveRouteItems,
  loadFleetUnitEvents,
  previewFleetUnitLifecycle,
  renameControlUnit,
  restoreControlUnit,
  retireControlUnit,
  saveControlUnit,
  saveFleetCatalogSettings,
  saveFleetKeyCoded,
  uploadFleetCatalogPhoto,
  removeFleetCatalogPhoto,
  type ActiveRouteItem,
  setControlUnitStatus,
  type ControlUnitRow,
  type ControlUnitUpsertInput,
  type FleetLifecycleImpact,
  type FleetUnitEvent
} from "../cloudData";
import type { BankRule, Client } from "../types";
import { FleetDashboard } from "./controlUnits/FleetDashboard";
import { FleetCatalog } from "./controlUnits/FleetCatalog";
import { FleetFilters } from "./controlUnits/FleetFilters";
import { FleetIncompleteList } from "./controlUnits/FleetIncompleteList";
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
  findFleetIdentityDuplicate,
  filterAndSortFleetRows,
  getActiveFleetGroups,
  getActiveFleetRule,
  getFleetCompanyForGroup,
  getFleetCompanyOptions,
  getFleetFilterOptions,
  getFleetCompleteness,
  isCatalogEligible,
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
import { supabase } from "../lib/supabase";

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
  const [unitEditorMode, setUnitEditorMode] = useState<"full" | "catalog">("full");
  const [statusTarget, setStatusTarget] = useState<ControlUnitRow | null>(null);
  const [statusDraft, setStatusDraft] = useState<FleetStatus>("activo");
  const [form, setForm] = useState<UnitFormState>({ ...DEFAULT_FORM });
  const [fleetView, setFleetView] = useState<"catalog" | "table" | "incomplete" | "retired">("catalog");
  const [catalogSearch, setCatalogSearch] = useState<string>("");
  const [incompleteSearch, setIncompleteSearch] = useState<string>("");
  const [catalogPhotoFile, setCatalogPhotoFile] = useState<File | null>(null);
  const [activeRouteItems, setActiveRouteItems] = useState<ActiveRouteItem[]>([]);
  const [catalogClock, setCatalogClock] = useState<number>(() => Date.now());
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
  const custodySinceByUnit = useMemo(() => new Map(activeRouteItems
    .filter((item) => item.inCustody && !item.removedAt && item.custodySince)
    .map((item) => [normalizeText(item.unitId).toUpperCase(), item.custodySince as string])), [activeRouteItems]);
  const catalogRows = useMemo(() => {
    const query = catalogSearch.trim().toLocaleLowerCase("es");
    return displayRows.filter((row) => isCatalogEligible(row, custodySinceByUnit, catalogClock)).filter((row) => {
      if (!query) return true;
      return [row.unit_id, row.brand_model, row.model_year, row.year, row.transmission_type, row.transmission]
        .some((value) => String(value ?? "").toLocaleLowerCase("es").includes(query));
    });
  }, [catalogClock, catalogSearch, custodySinceByUnit, displayRows]);
  const pieData = useMemo(() => buildFleetPieData(displayRows), [displayRows]);
  const incompleteRows = useMemo(() => {
    const query = incompleteSearch.trim().toLocaleLowerCase("es");
    return displayRows
      .filter((row) => getFleetCompleteness(row).missing.length > 0)
      .filter((row) => !query || [row.unit_id, row.brand_model, row.plate, row.engine_serial, row.chassis_serial]
        .some((value) => String(value ?? "").toLocaleLowerCase("es").includes(query)))
      .sort((left, right) => {
        const difference = getFleetCompleteness(left).completed - getFleetCompleteness(right).completed;
        return difference || String(left.unit_id ?? "").localeCompare(String(right.unit_id ?? ""), "es", { numeric: true });
      });
  }, [displayRows, incompleteSearch]);
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
    setCatalogPhotoFile(null);
    setSaveError("");
    setUnitEditorMode("full");
    setCreateOpen(true);
  }, []);

  const openEditDialog = useCallback((row: ControlUnitRow): void => {
    setForm(toFormState(row));
    setCatalogPhotoFile(null);
    setSaveError("");
    setUnitEditorMode("full");
    setEditTarget(row);
  }, []);

  const openCatalogEditDialog = useCallback((row: ControlUnitRow): void => {
    setForm(toFormState(row));
    setCatalogPhotoFile(null);
    setSaveError("");
    setUnitEditorMode("catalog");
    setEditTarget(row);
  }, []);

  const closeUnitDialog = useCallback((): void => {
    setCreateOpen(false);
    setEditTarget(null);
    setUnitEditorMode("full");
    setCatalogPhotoFile(null);
    setSaveError("");
  }, []);

  useEffect(() => {
    const clock = window.setInterval(() => setCatalogClock(Date.now()), 60_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!dataOwnerUserId) {
      setActiveRouteItems([]);
      return;
    }
    let cancelled = false;
    const reloadCustody = () => {
      void loadCloudActiveRouteItems(dataOwnerUserId).then((items) => {
        if (!cancelled) setActiveRouteItems(items);
      }).catch((error) => {
        if (!cancelled) console.warn("No se pudo cargar custodia para el catalogo.", error);
      });
    };
    reloadCustody();
    if (!supabase) return () => { cancelled = true; };
    const client = supabase;
    const channel = client.channel(`fleet-catalog-custody-${dataOwnerUserId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_route_items_cloud", filter: `user_id=eq.${dataOwnerUserId}` }, reloadCustody)
      .subscribe();
    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [dataOwnerUserId]);

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

  async function persistUnit(state: UnitFormState): Promise<void> {
    if (!dataOwnerUserId) {
      setSaveError("No hay owner de datos para guardar autos en Supabase.");
      return;
    }
    const unitId = normalizeUnitIdInput(state.unit_id);
    if (!unitId) {
      setSaveError("La unidad es obligatoria.");
      return;
    }
    const identityDuplicate = findFleetIdentityDuplicate([...rows, ...retiredRows], state, editTarget?.fleet_id);
    if (identityDuplicate) {
      setSaveError(`No se puede guardar: la ${identityDuplicate.label} ${identityDuplicate.value} ya está registrada en la unidad ${identityDuplicate.unitId}.`);
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
    const keepsExistingLegacyUnit = Boolean(editTarget && normalizeUnitIdInput(editTarget.unit_id) === unitId);
    if (!Number.isFinite(numericPart) || numericPart < 1 || (numericPart > maxAllowed && !keepsExistingLegacyUnit)) {
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
    const dailyRate = optionalNumber(state.catalog_daily_rate);
    const weeklyRate = optionalNumber(state.catalog_weekly_rate);
    const biweeklyRate = optionalNumber(state.catalog_biweekly_rate);
    const contractMonths = optionalInteger(state.catalog_contract_months);
    const dailyManagementFee = optionalNumber(state.catalog_daily_management_fee);
    const weeklyManagementFee = optionalNumber(state.catalog_weekly_management_fee);
    const biweeklyManagementFee = optionalNumber(state.catalog_biweekly_management_fee);
    const keyCoded = state.key_coded === "yes" ? true : state.key_coded === "no" ? false : null;
    if (state.catalog_contract_months.trim() && (contractMonths === null || contractMonths < 1 || contractMonths > 120)) {
      setSaveError("La duración del contrato debe estar entre 1 y 120 meses.");
      return;
    }
    if ((state.catalog_daily_rate.trim() && dailyRate === null) ||
      (state.catalog_weekly_rate.trim() && weeklyRate === null) ||
      (state.catalog_biweekly_rate.trim() && biweeklyRate === null) ||
      (state.catalog_daily_management_fee.trim() && dailyManagementFee === null) ||
      (state.catalog_weekly_management_fee.trim() && weeklyManagementFee === null) ||
      (state.catalog_biweekly_management_fee.trim() && biweeklyManagementFee === null) ||
      [dailyRate, weeklyRate, biweeklyRate, dailyManagementFee, weeklyManagementFee, biweeklyManagementFee].some((value) => value !== null && value < 0)) {
      setSaveError("Los alquileres y cobros de gestión deben tener importes válidos y no negativos.");
      return;
    }
    if (catalogPhotoFile && catalogPhotoFile.size > 8 * 1024 * 1024) {
      setSaveError("La foto principal no puede superar 8 MB.");
      return;
    }
    if (catalogPhotoFile && !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(catalogPhotoFile.type.toLowerCase())) {
      setSaveError("La foto debe estar en formato JPG, PNG, WebP o HEIC.");
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
      panapass_number: state.panapass_number.trim() || null,
      engine_serial: state.engine_serial.trim() || null,
      chassis_serial: state.chassis_serial.trim() || null,
      observation: state.observation.trim() || null,
      operational_status: state.operational_status.trim() || "libre",
      model_year: year,
      color: state.color.trim() || null,
      transmission_type: state.transmission.trim() || null,
      key_coded: keyCoded,
      mileage
    };
    try {
      const saveResult = await saveControlUnit(payload);
      const fleetId = saveResult.fleet_id || editTarget?.fleet_id;
      if (!fleetId) throw new Error("No se pudo identificar el auto guardado para actualizar su ficha de catalogo.");
      await saveFleetKeyCoded({ userId: dataOwnerUserId, fleetId, keyCoded });
      const previousPhotoPath = normalizeText(editTarget?.catalog_photo_path);
      let nextPhotoPath = previousPhotoPath || null;
      let uploadedPhotoPath = "";
      try {
        if (catalogPhotoFile) {
          uploadedPhotoPath = await uploadFleetCatalogPhoto(dataOwnerUserId, fleetId, catalogPhotoFile);
          nextPhotoPath = uploadedPhotoPath;
        }
        await saveFleetCatalogSettings({
          userId: dataOwnerUserId,
          fleetId,
          contractMonths,
          dailyRate,
          weeklyRate,
          biweeklyRate,
          dailyManagementFee,
          weeklyManagementFee,
          biweeklyManagementFee,
          photoPath: nextPhotoPath
        });
      } catch (error) {
        if (uploadedPhotoPath) await removeFleetCatalogPhoto(uploadedPhotoPath).catch(() => undefined);
        throw error;
      }
      if (uploadedPhotoPath && previousPhotoPath && previousPhotoPath !== uploadedPhotoPath) {
        await removeFleetCatalogPhoto(previousPhotoPath).catch((error) => {
          console.warn("La nueva foto se guardo, pero no se pudo eliminar la anterior.", error);
        });
      }
      await reloadRows();
      setCreateOpen(false);
      setEditTarget(null);
      setCatalogPhotoFile(null);
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
      setRows((current) => current.map((row) => (
        normalizeUnitIdInput(row.unit_id ?? "") === unitId
          ? { ...row, operational_status: statusDraft }
          : row
      )));
      onFleetClientStatusSync?.({
        unitId,
        status: statusDraft,
        archivedClientIds,
        updatedClientIds,
        statusComment,
        archivedAt
      });
      setStatusTarget(null);
      void reloadRows().catch((error) => {
        console.error("El estado se guardo, pero no se pudo refrescar Autos inmediatamente.", error);
      });
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
      setFleetView("retired");
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
      setFleetView("catalog");
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
        <div>
          <h2>Autos</h2>
          <p className="hint fleet-catalog-subtitle">Gestiona la flota y publica automáticamente los autos disponibles.</p>
        </div>
        <div className="fleet-catalog-head-actions">
          {dataOwnerUserId && (
            <a className="fleet-public-link" href={`/catalogo/${dataOwnerUserId}`} target="_blank" rel="noreferrer">Catálogo</a>
          )}
          {!readOnly && dataOwnerUserId && fleetView !== "retired" && (
            <button type="button" className="button primary" onClick={openCreateDialog}>
              Nuevo auto
            </button>
          )}
        </div>
      </div>

      <div className="cash-view-tabs fleet-view-tabs" style={{ margin: "12px 0" }} role="tablist" aria-label="Vistas de autos">
        <button type="button" className={`button ghost small ${fleetView === "catalog" ? "cash-tab-active" : ""}`} onClick={() => setFleetView("catalog")}>Catálogo ({catalogRows.length})</button>
        <button type="button" className={`button ghost small ${fleetView === "table" ? "cash-tab-active" : ""}`} onClick={() => setFleetView("table")}>Resumen y tabla ({rows.length})</button>
        <button type="button" className={`button ghost small ${fleetView === "incomplete" ? "cash-tab-active" : ""}`} onClick={() => setFleetView("incomplete")}>Pendientes ({incompleteRows.length})</button>
        <button type="button" className={`button ghost small ${fleetView === "retired" ? "cash-tab-active" : ""}`} onClick={() => setFleetView("retired")}>Dados de baja ({retiredRows.length})</button>
      </div>

      {fleetView === "catalog" && (
        <div className="fleet-catalog-toolbar">
          <div>
            <strong>Autos disponibles</strong>
            <p className="hint">Solo se muestran autos libres. Los autos en custodia entran al catálogo después de 24 horas.</p>
          </div>
          <label className="fleet-catalog-search">
            <input
              aria-label="Buscar en el catálogo"
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              placeholder="Buscar por marca, modelo, año o transmisión…"
            />
          </label>
        </div>
      )}

      {fleetView === "table" && (
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
      )}

      {fleetView === "incomplete" && (
        <div className="fleet-incomplete-toolbar">
          <div>
            <strong>Pendientes de completar</strong>
            <p className="hint">Prioriza primero los autos sin placa, motor o chasis. La preparación del catálogo se controla por separado.</p>
          </div>
          <label>Buscar unidad, modelo, placa, motor o chasis
            <input value={incompleteSearch} onChange={(event) => setIncompleteSearch(event.target.value)} placeholder="Ejemplo: D47" />
          </label>
        </div>
      )}

      {fleetView === "retired" && (
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
      ) : fleetView === "catalog" ? (
        <FleetCatalog rows={catalogRows} readOnly={readOnly} onEdit={openCatalogEditDialog} onHistory={openHistoryDialog} />
      ) : fleetView === "table" ? (
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
      ) : fleetView === "incomplete" ? (
        <FleetIncompleteList rows={incompleteRows} totalFleet={displayRows.length} readOnly={readOnly} onEdit={openEditDialog} />
      ) : fleetView === "retired" ? (
        <RetiredFleetList rows={filteredRetiredRows} readOnly={readOnly} onRestore={openRestoreDialog} onHistory={openHistoryDialog} />
      ) : null}

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
          catalogOnly={unitEditorMode === "catalog"}
          companies={companyOptions}
          groups={activeFleetGroups}
          saving={saving}
          error={saveError}
          photoFile={catalogPhotoFile}
          existingRows={[...rows, ...retiredRows]}
          onFormChange={setForm}
          onUnitIdChange={changeUnitId}
          onPhotoFileChange={setCatalogPhotoFile}
          onCancel={closeUnitDialog}
          onSave={() => void persistUnit(form)}
        />
      )}

    </section>
  );
}
