import { useEffect, useMemo, useState } from "react";
import {
  DuplicateInsuranceClaimNumberError,
  JudicialOutcomeRequiredForClaimError,
  createInsuranceDamagePhotoViewUrl,
  createInsuranceSettlementViewUrl,
  loadInsuranceClaims,
  loadInsuranceInsurers,
  removeInsuranceDamagePhotos,
  removeInsuranceSettlement,
  saveInsuranceClaim,
  saveInsuranceInsurer,
  uploadInsuranceDamagePhoto,
  uploadInsuranceSettlement,
  type InsuranceDamagePhotoAttachment,
  type InsuranceClaimClosureOutcome,
  type InsuranceClaimStatus,
  type InsuranceClaimRecord
} from "../cloudData";
import type { Client } from "../types";
import { useControlUnitsRows } from "./controlUnits/useControlUnitsRows";

type Props = {
  clients: Client[];
  dataOwnerUserId?: string | null;
  readOnly?: boolean;
  embedded?: boolean;
  hideCreateForm?: boolean;
  initialExpandedId?: string;
  initialSearch?: string;
  focusedClaimId?: string;
};

type ClaimForm = {
  incidentDate: string;
  unit: string;
  driver: string;
  plate: string;
  insurer: string;
  hasClaimNumber: "" | "yes" | "no";
  claimNumber: string;
  amount: string;
  vehicleDamage: string;
};

type ActiveTab = "form" | "list";
type ClaimDetailTab = "management" | "follow_up";
type SettlementFilter = "all" | "delivered" | "pending";
type ClaimNumberFilter = "all" | "present" | "missing";

const EMPTY_FORM: ClaimForm = {
  incidentDate: "",
  unit: "",
  driver: "",
  plate: "",
  insurer: "",
  hasClaimNumber: "",
  claimNumber: "",
  amount: "",
  vehicleDamage: ""
};

const MAX_DAMAGE_PHOTOS = 5;
const MAX_SETTLEMENT_FILE_SIZE = 10 * 1024 * 1024;
const USD_FORMATTER = new Intl.NumberFormat("es-PA", { style: "currency", currency: "USD" });

function normalizeUnit(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeInsurer(value: string): string {
  return value.trim().toUpperCase();
}

function parseClaimAmount(value: string): number {
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function InsuranceWorkflowPage({ clients, dataOwnerUserId, readOnly = false, embedded = false, hideCreateForm = false, initialExpandedId = "", initialSearch = "", focusedClaimId = "" }: Props) {
  const { rows: fleetUnits, loading: fleetLoading, loadError: fleetLoadError } = useControlUnitsRows(hideCreateForm ? null : dataOwnerUserId);
  const [form, setForm] = useState<ClaimForm>(EMPTY_FORM);
  const [insurers, setInsurers] = useState<string[]>([]);
  const [claims, setClaims] = useState<InsuranceClaimRecord[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>(hideCreateForm ? "list" : "form");
  const [damagePhotoFiles, setDamagePhotoFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");
  const [loadingCloud, setLoadingCloud] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [statusSavingId, setStatusSavingId] = useState<string>("");
  const [settlementSavingId, setSettlementSavingId] = useState<string>("");
  const [settlementUploadingId, setSettlementUploadingId] = useState<string>("");
  const [damagePhotosUploadingId, setDamagePhotosUploadingId] = useState<string>("");
  const [settlementDates, setSettlementDates] = useState<Record<string, string>>({});
  const [followUpSavingId, setFollowUpSavingId] = useState<string>("");
  const [followUpComments, setFollowUpComments] = useState<Record<string, string>>({});
  const [followUpNextSteps, setFollowUpNextSteps] = useState<Record<string, string>>({});
  const [followUpDates, setFollowUpDates] = useState<Record<string, string>>({});
  const [claimDetailTabs, setClaimDetailTabs] = useState<Record<string, ClaimDetailTab>>({});
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(initialExpandedId || null);
  const [claimSearch, setClaimSearch] = useState<string>(initialSearch);
  const [statusFilter, setStatusFilter] = useState<InsuranceClaimStatus | "all">("all");
  const [insurerFilter, setInsurerFilter] = useState<string>("all");
  const [settlementFilter, setSettlementFilter] = useState<SettlementFilter>("all");
  const [claimNumberFilter, setClaimNumberFilter] = useState<ClaimNumberFilter>("all");
  const [finalizingClaimId, setFinalizingClaimId] = useState<string | null>(null);
  const [closureOutcome, setClosureOutcome] = useState<InsuranceClaimClosureOutcome | "">("");
  const [closureJustification, setClosureJustification] = useState<string>("");
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ClaimForm>(EMPTY_FORM);
  const [editJustification, setEditJustification] = useState<string>("");
  const [editSavingId, setEditSavingId] = useState<string>("");
  const [driverEditedManually, setDriverEditedManually] = useState<boolean>(false);

  const activeClientsByUnit = useMemo(() => {
    return new Map(
      clients
        .filter((client) => client.status !== "archivado")
        .map((client) => [normalizeUnit(client.unitId), client])
    );
  }, [clients]);

  const clientsByUnit = useMemo(() => {
    return new Map(clients.map((client) => [normalizeUnit(client.unitId), client]));
  }, [clients]);

  const fleetUnitsByUnit = useMemo(() => {
    return new Map(fleetUnits.map((unit) => [normalizeUnit(unit.unit_id), unit]));
  }, [fleetUnits]);

  const unitOptions = useMemo(() => {
    const units = new Set<string>();
    fleetUnits.forEach((unit) => {
      const unitId = normalizeUnit(unit.unit_id);
      if (unitId) units.add(unitId);
    });
    clients.forEach((client) => {
      const unitId = normalizeUnit(client.unitId);
      if (unitId && client.status !== "archivado") units.add(unitId);
    });
    return Array.from(units).sort((left, right) => left.localeCompare(right, "es", { numeric: true }));
  }, [clients, fleetUnits]);

  const unitOptionLabels = useMemo(() => {
    return new Map(unitOptions.map((unitId) => {
      const fleetUnit = fleetUnitsByUnit.get(unitId);
      const client = activeClientsByUnit.get(unitId) ?? clientsByUnit.get(unitId);
      const parts = [client?.name ?? fleetUnit?.client_name, fleetUnit?.plate ? `Placa ${fleetUnit.plate}` : ""].filter(Boolean);
      return [unitId, parts.join(" - ")];
    }));
  }, [activeClientsByUnit, clientsByUnit, fleetUnitsByUnit, unitOptions]);

  const filteredClaims = useMemo(() => {
    const search = claimSearch.trim().toLocaleLowerCase("es");
    return claims.filter((claim) => {
      if (focusedClaimId && claim.id !== focusedClaimId) return false;
      if (statusFilter !== "all" && claim.status !== statusFilter) return false;
      if (insurerFilter !== "all" && claim.insurer !== insurerFilter) return false;
      if (settlementFilter === "delivered" && !claim.settlementDelivered) return false;
      if (settlementFilter === "pending" && claim.settlementDelivered) return false;
      if (claimNumberFilter === "present" && !claim.claimNumber.trim()) return false;
      if (claimNumberFilter === "missing" && claim.claimNumber.trim()) return false;
      if (!search) return true;
      return [
        claim.unit,
        claim.driver,
        claim.plate,
        claim.insurer,
        claim.claimNumber,
        claim.vehicleDamage,
        claim.followUpComment,
        ...claim.followUps.flatMap((entry) => [entry.comment, entry.nextStep])
      ].some((value) => value.toLocaleLowerCase("es").includes(search));
    });
  }, [claimNumberFilter, claimSearch, claims, focusedClaimId, insurerFilter, settlementFilter, statusFilter]);

  const claimKpis = useMemo(() => {
    return filteredClaims.reduce((summary, claim) => {
      const amount = parseClaimAmount(claim.amount);
      summary.totalAmount += amount;
      if (claim.status !== "Finalizado") summary.followUpAmount += amount;
      else if (claim.closureOutcome === "Pagado") summary.paidAmount += amount;
      else if (claim.closureOutcome === "Declinado") summary.declinedAmount += amount;
      if (!claim.claimNumber.trim()) summary.withoutClaimNumber += 1;
      return summary;
    }, { totalAmount: 0, followUpAmount: 0, paidAmount: 0, declinedAmount: 0, withoutClaimNumber: 0 });
  }, [filteredClaims]);

  const hasActiveClaimFilters = Boolean(
    claimSearch.trim()
    || statusFilter !== "all"
    || insurerFilter !== "all"
    || settlementFilter !== "all"
    || claimNumberFilter !== "all"
  );

  function clearClaimFilters(): void {
    setClaimSearch("");
    setStatusFilter("all");
    setInsurerFilter("all");
    setSettlementFilter("all");
    setClaimNumberFilter("all");
    setExpandedClaimId(null);
  }

  useEffect(() => {
    if (!dataOwnerUserId) {
      setInsurers([]);
      setClaims([]);
      setLoadingCloud(false);
      setLoadError("No se encontro owner de datos para cargar reclamos.");
      return;
    }

    let cancelled = false;
    setLoadingCloud(true);
    setLoadError("");
    Promise.all([
      loadInsuranceInsurers(dataOwnerUserId),
      loadInsuranceClaims(dataOwnerUserId)
    ])
      .then(([nextInsurers, nextClaims]) => {
        if (cancelled) return;
        setInsurers(nextInsurers);
        setClaims(nextClaims);
        setSettlementDates(Object.fromEntries(nextClaims.map((claim) => [claim.id, claim.settlementDeliveredDate])));
        setFollowUpComments(Object.fromEntries(nextClaims.map((claim) => [claim.id, ""])));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("No se pudieron cargar reclamos a seguros.", error);
        setLoadError("No se pudieron cargar los reclamos desde la nube.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCloud(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dataOwnerUserId]);

  useEffect(() => {
    const unitId = normalizeUnit(form.unit);
    if (!unitId) return;
    const fleetUnit = fleetUnitsByUnit.get(unitId);
    const client = activeClientsByUnit.get(unitId) ?? clientsByUnit.get(unitId);
    const nextDriver = fleetUnit?.client_name ?? client?.name ?? "";
    const nextPlate = fleetUnit?.plate ?? "";
    if ((driverEditedManually || form.driver === nextDriver) && form.plate === nextPlate) return;
    setForm((current) => ({
      ...current,
      driver: driverEditedManually ? current.driver : nextDriver,
      plate: nextPlate
    }));
  }, [activeClientsByUnit, clientsByUnit, driverEditedManually, fleetUnitsByUnit, form.driver, form.plate, form.unit]);

  function patchForm(patch: Partial<ClaimForm>): void {
    setForm((current) => ({ ...current, ...patch }));
  }

  function handleUnitChange(value: string): void {
    const unitId = normalizeUnit(value);
    const fleetUnit = fleetUnitsByUnit.get(unitId);
    const client = activeClientsByUnit.get(unitId) ?? clientsByUnit.get(unitId);
    setDriverEditedManually(false);
    setForm((current) => ({
      ...current,
      unit: unitId,
      driver: fleetUnit?.client_name ?? client?.name ?? "",
      plate: fleetUnit?.plate ?? ""
    }));
  }

  function resetForm(): void {
    setForm(EMPTY_FORM);
    setDamagePhotoFiles([]);
    setDriverEditedManually(false);
  }

  function handleFormDamagePhotosChange(files: FileList | null): void {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.some((file) => !file.type.startsWith("image/"))) {
      setDamagePhotoFiles([]);
      setMessage("Solo se permiten archivos de imagen para las fotos de daños.");
      return;
    }
    if (selectedFiles.some((file) => file.size > MAX_SETTLEMENT_FILE_SIZE)) {
      setDamagePhotoFiles([]);
      setMessage("Cada foto de daños debe pesar 10 MB o menos.");
      return;
    }
    if (selectedFiles.length > MAX_DAMAGE_PHOTOS) {
      setMessage(`Solo se guardarán las primeras ${MAX_DAMAGE_PHOTOS} fotos seleccionadas.`);
    } else {
      setMessage("");
    }
    setDamagePhotoFiles(selectedFiles.slice(0, MAX_DAMAGE_PHOTOS));
  }

  async function addInsurer(value: string): Promise<void> {
    if (!dataOwnerUserId || readOnly) return;
    const insurer = normalizeInsurer(value);
    if (!insurer) return;
    setSaving(true);
    setMessage("");
    try {
      await saveInsuranceInsurer(dataOwnerUserId, insurer);
      setInsurers((current) => Array.from(new Set([...current, insurer]))
        .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" })));
      patchForm({ insurer });
    } catch (error) {
      console.error("No se pudo guardar aseguradora.", error);
      setMessage("No se pudo guardar la aseguradora en la nube.");
    } finally {
      setSaving(false);
    }
  }

  function handleInsurerChange(value: string): void {
    if (value !== "__new__") {
      patchForm({ insurer: value });
      return;
    }
    if (readOnly) return;
    const insurer = window.prompt("Nombre de la nueva aseguradora");
    if (insurer) void addInsurer(insurer);
  }

  async function saveClaim(): Promise<void> {
    if (!dataOwnerUserId) {
      setMessage("No hay owner de datos para guardar reclamos en la nube.");
      return;
    }
    if (readOnly) {
      setMessage("Tu usuario solo puede ver esta pantalla.");
      return;
    }
    if (!form.incidentDate || !form.unit || !form.driver || !form.plate || !form.insurer) {
      setMessage("Completa fecha, unidad, nombre completo, placa y aseguradora antes de guardar.");
      return;
    }
    if (!form.hasClaimNumber) {
      setMessage("Indica si tienes el número de reclamo antes de guardar.");
      return;
    }
    const hasClaimNumber = form.hasClaimNumber === "yes";
    const claimNumber = hasClaimNumber ? form.claimNumber.trim() : "";
    if (hasClaimNumber && !claimNumber) {
      setMessage("Escribe el número de reclamo antes de guardar.");
      return;
    }

    const now = new Date().toISOString();
    const nextClaim: InsuranceClaimRecord = {
      ...form,
      hasClaimNumber,
      claimNumber,
      id: `insurance-claim-${Date.now()}`,
      status: claimNumber ? "Activo" : "Inactivo",
      damagePhotoNames: [],
      damagePhotos: [],
      settlementDelivered: false,
      settlementDeliveredDate: "",
      settlementMarkedAt: null,
      settlementAttachment: null,
      followUpComment: "",
      followUpCommentUpdatedAt: null,
      followUps: [],
      closureOutcome: null,
      closureJustification: "",
      finalizedAt: null,
      editHistory: [],
      createdAt: now,
      updatedAt: now
    };

    setSaving(true);
    setMessage("");
    const uploadedPhotos: InsuranceDamagePhotoAttachment[] = [];
    try {
      for (const file of damagePhotoFiles) {
        uploadedPhotos.push(await uploadInsuranceDamagePhoto(dataOwnerUserId, nextClaim.id, file));
      }
      const claimToSave: InsuranceClaimRecord = {
        ...nextClaim,
        damagePhotos: uploadedPhotos,
        damagePhotoNames: uploadedPhotos.map((photo) => photo.name)
      };
      await saveInsuranceClaim(dataOwnerUserId, claimToSave);
      setClaims((current) => [claimToSave, ...current]);
      resetForm();
      setMessage(`${claimToSave.status === "Activo" ? "Reclamo guardado como activo" : "Reclamo guardado como inactivo: falta el número de reclamo"}${uploadedPhotos.length > 0 ? `, con ${uploadedPhotos.length} foto${uploadedPhotos.length === 1 ? "" : "s"} de daños` : ""}.`);
      setActiveTab("list");
    } catch (error) {
      if (uploadedPhotos.length > 0) {
        try { await removeInsuranceDamagePhotos(uploadedPhotos.map((photo) => photo.path)); } catch { /* Limpieza de mejor esfuerzo. */ }
      }
      console.error("No se pudo guardar reclamo.", error);
      setMessage(error instanceof DuplicateInsuranceClaimNumberError || error instanceof JudicialOutcomeRequiredForClaimError ? error.message : "No se pudo guardar el reclamo ni sus fotos en la nube.");
    } finally {
      setSaving(false);
    }
  }

  async function saveClaimStatus(claim: InsuranceClaimRecord, status: InsuranceClaimStatus): Promise<void> {
    if (!dataOwnerUserId || readOnly || claim.status === status) return;
    const updatedClaim: InsuranceClaimRecord = {
      ...claim,
      status,
      closureOutcome: null,
      closureJustification: "",
      finalizedAt: null,
      updatedAt: new Date().toISOString()
    };
    setStatusSavingId(claim.id);
    setMessage("");
    try {
      await saveInsuranceClaim(dataOwnerUserId, updatedClaim);
      setClaims((current) => current.map((item) => item.id === claim.id ? updatedClaim : item));
      setMessage(`Reclamo marcado como ${status}.`);
    } catch (error) {
      console.error("No se pudo actualizar estado de reclamo.", error);
      setMessage("No se pudo actualizar el estado en la nube.");
    } finally {
      setStatusSavingId("");
    }
  }

  function requestClaimStatusUpdate(claim: InsuranceClaimRecord, status: InsuranceClaimStatus): void {
    if (readOnly || claim.status === status) return;
    if (claim.status === "Finalizado") {
      setMessage("Un reclamo finalizado solo puede reabrirse mediante una edición justificada que retire o corrija sus datos de cierre.");
      return;
    }
    if (!claim.claimNumber.trim()) {
      setMessage("Este reclamo no puede activarse ni finalizarse hasta colocar el número de reclamo mediante Editar reclamo.");
      return;
    }
    if (status === "Inactivo") {
      setMessage("Un reclamo con número debe permanecer Activo o Finalizado.");
      return;
    }
    if (status === "Finalizado") {
      setExpandedClaimId(claim.id);
      setFinalizingClaimId(claim.id);
      setClosureOutcome("");
      setClosureJustification("");
      setMessage("Indica si el reclamo fue pagado o declinado para finalizarlo.");
      return;
    }
    setFinalizingClaimId(null);
    void saveClaimStatus(claim, status);
  }

  async function finalizeClaim(claim: InsuranceClaimRecord): Promise<void> {
    if (!dataOwnerUserId || readOnly) return;
    if (!claim.claimNumber.trim()) {
      setMessage("No se puede finalizar un reclamo sin número de reclamo.");
      return;
    }
    if (!closureOutcome) {
      setMessage("Selecciona si el reclamo fue pagado o declinado.");
      return;
    }
    if (closureOutcome === "Declinado" && !closureJustification.trim()) {
      setMessage("Debes justificar por qué el reclamo fue declinado.");
      return;
    }
    const now = new Date().toISOString();
    const updatedClaim: InsuranceClaimRecord = {
      ...claim,
      status: "Finalizado",
      closureOutcome,
      closureJustification: closureOutcome === "Declinado" ? closureJustification.trim() : "",
      finalizedAt: now,
      updatedAt: now
    };
    setStatusSavingId(claim.id);
    setMessage("");
    try {
      await saveInsuranceClaim(dataOwnerUserId, updatedClaim);
      setClaims((current) => current.map((item) => item.id === claim.id ? updatedClaim : item));
      setFinalizingClaimId(null);
      setClosureOutcome("");
      setClosureJustification("");
      setMessage(`Reclamo finalizado como ${updatedClaim.closureOutcome}.`);
    } catch (error) {
      console.error("No se pudo finalizar el reclamo.", error);
      setMessage("No se pudo finalizar el reclamo en la nube.");
    } finally {
      setStatusSavingId("");
    }
  }

  async function updateSettlementDelivery(claim: InsuranceClaimRecord, delivered: boolean, date: string): Promise<void> {
    if (!dataOwnerUserId || readOnly) return;
    if (delivered && !date) {
      setMessage("Debes colocar la fecha de entrega antes de marcar el finiquito como entregado.");
      return;
    }
    const now = new Date().toISOString();
    const updatedClaim: InsuranceClaimRecord = {
      ...claim,
      settlementDelivered: delivered,
      settlementDeliveredDate: delivered ? date : "",
      settlementMarkedAt: delivered ? now : null,
      updatedAt: now
    };
    setSettlementSavingId(claim.id);
    setMessage("");
    try {
      await saveInsuranceClaim(dataOwnerUserId, updatedClaim);
      setClaims((current) => current.map((item) => item.id === claim.id ? updatedClaim : item));
      setSettlementDates((current) => ({ ...current, [claim.id]: updatedClaim.settlementDeliveredDate }));
      setMessage(delivered ? "Finiquito marcado como entregado." : "Finiquito marcado como no entregado.");
    } catch (error) {
      console.error("No se pudo actualizar la entrega del finiquito.", error);
      setMessage("No se pudo guardar la entrega del finiquito en la nube.");
    } finally {
      setSettlementSavingId("");
    }
  }

  async function handleSettlementFileChange(claim: InsuranceClaimRecord, file: File | undefined): Promise<void> {
    if (!file || !dataOwnerUserId || readOnly) return;
    if (file.size > MAX_SETTLEMENT_FILE_SIZE) {
      setMessage("El finiquito no puede superar 10 MB.");
      return;
    }
    setSettlementUploadingId(claim.id);
    setMessage("");
    let uploadedPath = "";
    try {
      const attachment = await uploadInsuranceSettlement(dataOwnerUserId, claim.id, file);
      uploadedPath = attachment.path;
      const updatedClaim: InsuranceClaimRecord = {
        ...claim,
        settlementAttachment: attachment,
        updatedAt: new Date().toISOString()
      };
      await saveInsuranceClaim(dataOwnerUserId, updatedClaim);
      setClaims((current) => current.map((item) => item.id === claim.id ? updatedClaim : item));
      if (claim.settlementAttachment?.path) {
        try {
          await removeInsuranceSettlement(claim.settlementAttachment.path);
        } catch (cleanupError) {
          console.warn("No se pudo eliminar el finiquito anterior.", cleanupError);
        }
      }
      setMessage("Finiquito adjuntado correctamente.");
    } catch (error) {
      if (uploadedPath) {
        try { await removeInsuranceSettlement(uploadedPath); } catch { /* Limpieza de mejor esfuerzo. */ }
      }
      console.error("No se pudo adjuntar el finiquito.", error);
      setMessage("No se pudo adjuntar el finiquito en la nube.");
    } finally {
      setSettlementUploadingId("");
    }
  }

  async function viewSettlement(path: string): Promise<void> {
    const previewWindow = window.open("", "_blank");
    try {
      const url = await createInsuranceSettlementViewUrl(path);
      if (previewWindow) previewWindow.location.href = url;
      else window.location.href = url;
    } catch (error) {
      previewWindow?.close();
      console.error("No se pudo abrir el finiquito.", error);
      setMessage("No se pudo abrir el finiquito adjunto.");
    }
  }

  async function handleDamagePhotosUpload(claim: InsuranceClaimRecord, files: FileList | null): Promise<void> {
    if (!dataOwnerUserId || readOnly || !files?.length) return;
    const availableSlots = Math.max(0, MAX_DAMAGE_PHOTOS - claim.damagePhotos.length);
    if (availableSlots === 0) {
      setMessage(`Este reclamo ya tiene el máximo de ${MAX_DAMAGE_PHOTOS} fotos de daños.`);
      return;
    }
    const selectedFiles = Array.from(files).slice(0, availableSlots);
    if (Array.from(files).length > availableSlots) {
      setMessage(`Solo se agregarán ${availableSlots} fotos para respetar el máximo de ${MAX_DAMAGE_PHOTOS}.`);
    }
    if (selectedFiles.some((file) => !file.type.startsWith("image/"))) {
      setMessage("Solo se permiten archivos de imagen para las fotos de daños.");
      return;
    }
    if (selectedFiles.some((file) => file.size > MAX_SETTLEMENT_FILE_SIZE)) {
      setMessage("Cada foto de daños debe pesar 10 MB o menos.");
      return;
    }
    setDamagePhotosUploadingId(claim.id);
    setMessage("");
    const uploaded: InsuranceDamagePhotoAttachment[] = [];
    try {
      for (const file of selectedFiles) {
        uploaded.push(await uploadInsuranceDamagePhoto(dataOwnerUserId, claim.id, file));
      }
      const updatedClaim: InsuranceClaimRecord = {
        ...claim,
        damagePhotos: [...claim.damagePhotos, ...uploaded],
        damagePhotoNames: Array.from(new Set([...claim.damagePhotoNames, ...uploaded.map((photo) => photo.name)])),
        updatedAt: new Date().toISOString()
      };
      await saveInsuranceClaim(dataOwnerUserId, updatedClaim);
      setClaims((current) => current.map((item) => item.id === claim.id ? updatedClaim : item));
      setMessage(`${uploaded.length} foto${uploaded.length === 1 ? "" : "s"} de daños guardada${uploaded.length === 1 ? "" : "s"}.`);
    } catch (error) {
      if (uploaded.length > 0) {
        try { await removeInsuranceDamagePhotos(uploaded.map((photo) => photo.path)); } catch { /* Limpieza de mejor esfuerzo. */ }
      }
      console.error("No se pudieron guardar las fotos de daños.", error);
      setMessage("No se pudieron guardar las fotos de daños en la nube.");
    } finally {
      setDamagePhotosUploadingId("");
    }
  }

  async function viewDamagePhoto(photo: InsuranceDamagePhotoAttachment): Promise<void> {
    const previewWindow = window.open("", "_blank");
    try {
      const url = await createInsuranceDamagePhotoViewUrl(photo.path, photo.storageBucket);
      if (previewWindow) previewWindow.location.href = url;
      else window.location.href = url;
    } catch (error) {
      previewWindow?.close();
      console.error("No se pudo abrir la foto de daños.", error);
      setMessage("No se pudo abrir la foto de daños adjunta.");
    }
  }

  async function saveFollowUpComment(claim: InsuranceClaimRecord): Promise<void> {
    if (!dataOwnerUserId || readOnly) return;
    const comment = (followUpComments[claim.id] ?? "").trim();
    const nextStep = (followUpNextSteps[claim.id] ?? "").trim();
    const nextActionDate = followUpDates[claim.id] ?? "";
    if (!comment || !nextStep || !nextActionDate) {
      setMessage("Completa la novedad, el próximo paso y la fecha de la próxima gestión.");
      return;
    }
    const now = new Date().toISOString();
    const updatedClaim: InsuranceClaimRecord = {
      ...claim,
      followUpComment: comment,
      followUpCommentUpdatedAt: now,
      followUps: [...claim.followUps, {
        id: `insurance-follow-up-${Date.now()}-${crypto.randomUUID()}`,
        comment,
        nextStep,
        nextActionDate,
        createdAt: now
      }],
      updatedAt: now
    };
    setFollowUpSavingId(claim.id);
    setMessage("");
    try {
      await saveInsuranceClaim(dataOwnerUserId, updatedClaim);
      setClaims((current) => current.map((item) => item.id === claim.id ? updatedClaim : item));
      setFollowUpComments((current) => ({ ...current, [claim.id]: "" }));
      setFollowUpNextSteps((current) => ({ ...current, [claim.id]: "" }));
      setFollowUpDates((current) => ({ ...current, [claim.id]: "" }));
      setMessage("Seguimiento del reclamo guardado correctamente.");
    } catch (error) {
      console.error("No se pudo guardar el comentario de seguimiento.", error);
      setMessage("No se pudo guardar el comentario de seguimiento en la nube.");
    } finally {
      setFollowUpSavingId("");
    }
  }

  function startEditingClaim(claim: InsuranceClaimRecord): void {
    setEditingClaimId(claim.id);
    setEditForm({
      incidentDate: claim.incidentDate,
      unit: claim.unit,
      driver: claim.driver,
      plate: claim.plate,
      insurer: claim.insurer,
      hasClaimNumber: claim.hasClaimNumber ? "yes" : "no",
      claimNumber: claim.claimNumber,
      amount: claim.amount,
      vehicleDamage: claim.vehicleDamage
    });
    setEditJustification("");
    setFinalizingClaimId(null);
    setMessage("");
  }

  function cancelClaimEdit(): void {
    setEditingClaimId(null);
    setEditForm(EMPTY_FORM);
    setEditJustification("");
  }

  async function saveClaimEdit(claim: InsuranceClaimRecord): Promise<void> {
    if (!dataOwnerUserId || readOnly) return;
    if (!editForm.incidentDate || !editForm.unit.trim() || !editForm.driver.trim() || !editForm.plate.trim() || !editForm.insurer) {
      setMessage("Completa fecha, unidad, nombre, placa y aseguradora antes de guardar la edición.");
      return;
    }
    if (!editJustification.trim()) {
      setMessage("Debes justificar la edición antes de guardarla.");
      return;
    }
    if (!editForm.hasClaimNumber) {
      setMessage("Indica si tienes el número de reclamo antes de guardar la edición.");
      return;
    }
    const now = new Date().toISOString();
    const hasClaimNumber = editForm.hasClaimNumber === "yes";
    const claimNumber = hasClaimNumber ? editForm.claimNumber.trim() : "";
    if (hasClaimNumber && !claimNumber) {
      setMessage("Escribe el número de reclamo antes de guardar la edición.");
      return;
    }
    const nextStatus: InsuranceClaimStatus = !claimNumber
      ? "Inactivo"
      : claim.status === "Inactivo"
        ? "Activo"
        : claim.status;
    const updatedClaim: InsuranceClaimRecord = {
      ...claim,
      ...editForm,
      unit: normalizeUnit(editForm.unit),
      driver: editForm.driver.trim(),
      plate: editForm.plate.trim().toUpperCase(),
      hasClaimNumber,
      claimNumber,
      status: nextStatus,
      closureOutcome: nextStatus === "Finalizado" ? claim.closureOutcome : null,
      closureJustification: nextStatus === "Finalizado" ? claim.closureJustification : "",
      finalizedAt: nextStatus === "Finalizado" ? claim.finalizedAt : null,
      editHistory: [...claim.editHistory, { editedAt: now, justification: editJustification.trim() }],
      updatedAt: now
    };
    setEditSavingId(claim.id);
    setMessage("");
    try {
      await saveInsuranceClaim(dataOwnerUserId, updatedClaim);
      setClaims((current) => current.map((item) => item.id === claim.id ? updatedClaim : item));
      cancelClaimEdit();
      setMessage(!claimNumber
        ? "Edición guardada. El reclamo quedó Inactivo porque falta el número de reclamo."
        : "Edición del reclamo guardada con su justificación.");
    } catch (error) {
      console.error("No se pudo guardar la edición del reclamo.", error);
      setMessage(error instanceof DuplicateInsuranceClaimNumberError ? error.message : "No se pudo guardar la edición del reclamo en la nube.");
    } finally {
      setEditSavingId("");
    }
  }

  return (
    <section className="insurance-workflow-page">
      {!embedded && <div className="panel insurance-workflow-header">
        <div>
          <span className="workflow-eyebrow">Seguros</span>
          <h2>Reclamos a seguros</h2>
        </div>
      </div>}

      {!hideCreateForm && <div className="panel workflow-tabs-panel">
        <button type="button" className={activeTab === "form" ? "active" : ""} onClick={() => setActiveTab("form")}>Formulario</button>
        <button type="button" className={activeTab === "list" ? "active" : ""} onClick={() => setActiveTab("list")}>Lista de reclamos</button>
      </div>}

      {!hideCreateForm && activeTab === "form" && (
        <form className="panel workflow-form-panel" onSubmit={(event) => { event.preventDefault(); void saveClaim(); }}>
          <div className="panel-head">
            <h2>Formulario de reclamo</h2>
            <button
              type="button"
              className="button primary"
              onClick={() => void saveClaim()}
              disabled={readOnly || saving || loadingCloud}
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
          {readOnly && <p className="hint workflow-message">Modo lectura: tu usuario no puede crear ni editar reclamos.</p>}
          {loadingCloud && <p className="hint workflow-message">Cargando reclamos...</p>}
          {loadError && <p className="hint workflow-message">{loadError}</p>}
          {fleetLoading && <p className="hint workflow-message">Cargando autos...</p>}
          {fleetLoadError && <p className="hint workflow-message">{fleetLoadError}</p>}
          {message && <p className="hint workflow-message" role="alert" aria-live="assertive">{message}</p>}

          <div className="workflow-form-grid">
            <div className={`workflow-claim-number-question${!form.hasClaimNumber ? " is-pending" : ""}`}>
              <div>
                <span className="workflow-question-step">Primer paso</span>
                <strong>¿Tienes el número de reclamo?</strong>
                <small>Selecciona una opción para continuar con el registro.</small>
              </div>
              <select
                name="hasClaimNumber"
                aria-label="¿Tienes el número de reclamo?"
                value={form.hasClaimNumber}
                onChange={(event) => {
                  const hasClaimNumber = event.target.value as ClaimForm["hasClaimNumber"];
                  patchForm({ hasClaimNumber, ...(hasClaimNumber !== "yes" ? { claimNumber: "" } : {}) });
                }}
                disabled={readOnly}
              >
                <option value="">Seleccionar Sí o No</option>
                <option value="yes">Sí, tengo el número</option>
                <option value="no">No, todavía no lo tengo</option>
              </select>
            </div>

            {form.hasClaimNumber === "yes" && (
              <label className={`workflow-claim-number-input${!form.claimNumber.trim() ? " workflow-required-field" : ""}`}>
                Número de reclamo
                <input
                  name="claimNumber"
                  placeholder="Escribe el número de reclamo"
                  value={form.claimNumber}
                  onChange={(event) => patchForm({ claimNumber: event.target.value })}
                  disabled={readOnly}
                  autoFocus
                />
              </label>
            )}

            <label>
              Fecha del incidente
              <input
                type="date"
                name="incidentDate"
                value={form.incidentDate}
                onChange={(event) => patchForm({ incidentDate: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label>
              Unidad
              <input
                name="unit"
                list="insurance-unit-options"
                placeholder="Ej. B52"
                value={form.unit}
                onChange={(event) => handleUnitChange(event.target.value)}
                disabled={readOnly}
              />
              <datalist id="insurance-unit-options">
                {unitOptions.map((unitId) => <option key={unitId} value={unitId} label={unitOptionLabels.get(unitId) ?? ""} />)}
              </datalist>
            </label>

            <label>
              Nombre completo
              <input
                name="driver"
                placeholder="Nombre completo"
                value={form.driver}
                onChange={(event) => {
                  setDriverEditedManually(true);
                  patchForm({ driver: event.target.value });
                }}
                disabled={readOnly}
              />
            </label>

            <label>
              Placa
              <input
                name="plate"
                placeholder="Placa del auto"
                value={form.plate}
                onChange={(event) => patchForm({ plate: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label>
              Aseguradora
              <select
                name="insurer"
                value={form.insurer}
                onChange={(event) => handleInsurerChange(event.target.value)}
                disabled={readOnly}
              >
                <option value="">Seleccionar aseguradora</option>
                {insurers.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}
                <option value="__new__">+ Nueva aseguradora</option>
              </select>
            </label>

            <label>
              Monto
              <input
                type="number"
                name="amount"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(event) => patchForm({ amount: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label className="workflow-form-notes">
              Daños del auto
              <textarea
                name="vehicleDamage"
                placeholder="Describe los daños del auto"
                value={form.vehicleDamage}
                onChange={(event) => patchForm({ vehicleDamage: event.target.value })}
                disabled={readOnly}
              />
            </label>

            <label className="workflow-form-notes workflow-form-damage-photos">
              Fotos de los daños
              <input
                type="file"
                name="damagePhotos"
                accept="image/*"
                multiple
                onChange={(event) => handleFormDamagePhotosChange(event.target.files)}
                disabled={readOnly || saving}
              />
              <span className="hint">{damagePhotoFiles.length} de {MAX_DAMAGE_PHOTOS} fotos seleccionadas. Máximo 10 MB por foto.</span>
              {damagePhotoFiles.length > 0 && (
                <span className="workflow-form-photo-names">{damagePhotoFiles.map((file) => file.name).join(", ")}</span>
              )}
            </label>

          </div>
        </form>
      )}

      {activeTab === "list" && (
        <section className={`panel workflow-claims-panel${focusedClaimId ? " workflow-claims-panel--focused" : ""}`}>
          {!focusedClaimId && <div className="panel-head">
            <h2>Lista de reclamos</h2>
            <span className="hint">
              {hasActiveClaimFilters ? `${filteredClaims.length} de ${claims.length}` : claims.length} reclamos
            </span>
          </div>}
          {loadingCloud && <p className="hint workflow-message">Cargando reclamos...</p>}
          {loadError && <p className="hint workflow-message">{loadError}</p>}
          {message && <p className="hint workflow-message">{message}</p>}
          {!focusedClaimId && <div className="workflow-claim-kpis" aria-label="Indicadores de reclamos a seguros">
            <div>
              <span>Monto total reclamado</span>
              <strong>{USD_FORMATTER.format(claimKpis.totalAmount)}</strong>
              <small>{filteredClaims.length} reclamos</small>
            </div>
            <div>
              <span>Monto en seguimiento</span>
              <strong>{USD_FORMATTER.format(claimKpis.followUpAmount)}</strong>
              <small>Pendiente de pago</small>
            </div>
            <div>
              <span>Monto pagado</span>
              <strong>{USD_FORMATTER.format(claimKpis.paidAmount)}</strong>
              <small>Reclamos pagados</small>
            </div>
            <div>
              <span>Monto declinado</span>
              <strong>{USD_FORMATTER.format(claimKpis.declinedAmount)}</strong>
              <small>Reclamos rechazados</small>
            </div>
            <div className={claimKpis.withoutClaimNumber > 0 ? "attention" : ""}>
              <span>Sin número de reclamo</span>
              <strong>{claimKpis.withoutClaimNumber}</strong>
              <small>Requieren completar</small>
            </div>
          </div>}
          {!focusedClaimId && <div className="workflow-claim-filters">
            <label className="workflow-claim-search">
              Buscar
              <input
                type="search"
                value={claimSearch}
                placeholder="Unidad, cliente, placa o número"
                onChange={(event) => setClaimSearch(event.target.value)}
              />
            </label>
            <label>
              Aseguradora
              <select value={insurerFilter} onChange={(event) => setInsurerFilter(event.target.value)}>
                <option value="all">Todas</option>
                {insurers.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}
              </select>
            </label>
            <label>
              Estado
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InsuranceClaimStatus | "all")}>
                <option value="all">Todos</option>
                <option value="Inactivo">Inactivo</option>
                <option value="Activo">Activo</option>
                <option value="Finalizado">Finalizado</option>
              </select>
            </label>
            <label>
              Finiquito
              <select value={settlementFilter} onChange={(event) => setSettlementFilter(event.target.value as SettlementFilter)}>
                <option value="all">Todos</option>
                <option value="delivered">Entregado</option>
                <option value="pending">Pendiente</option>
              </select>
            </label>
            <label>
              Número de reclamo
              <select value={claimNumberFilter} onChange={(event) => setClaimNumberFilter(event.target.value as ClaimNumberFilter)}>
                <option value="all">Todos</option>
                <option value="present">Con número</option>
                <option value="missing">Sin número</option>
              </select>
            </label>
            <button type="button" className="button workflow-clear-filters" onClick={clearClaimFilters} disabled={!hasActiveClaimFilters}>
              Limpiar filtros
            </button>
          </div>}
          <div className="workflow-claims-list">
            {claims.length === 0 && !loadingCloud && <p className="hint">Todavia no hay reclamos guardados.</p>}
            {claims.length > 0 && filteredClaims.length === 0 && (
              <p className="hint workflow-empty-filter">No hay reclamos que coincidan con los filtros aplicados.</p>
            )}
            {filteredClaims.map((claim) => {
              const expanded = expandedClaimId === claim.id;
              const activeClaimDetailTab = claimDetailTabs[claim.id] ?? "management";
              return (
              <article key={claim.id} className={`workflow-claim-card${expanded ? " expanded" : ""}`}>
                <div className="workflow-claim-summary">
                  <button
                    type="button"
                    className="workflow-claim-toggle"
                    aria-expanded={expanded}
                    onClick={() => setExpandedClaimId(expanded ? null : claim.id)}
                  >
                    <span className="workflow-claim-identity">
                      <strong>{claim.unit || "Sin unidad"} · {claim.driver || "Sin nombre"}</strong>
                      <small>{claim.plate || "Sin placa"}</small>
                    </span>
                    <span className="workflow-claim-reference">
                      <strong>{claim.insurer || "Sin aseguradora"}</strong>
                      <small className={!claim.claimNumber ? "missing" : ""}>
                        {claim.claimNumber ? `Reclamo N.º ${claim.claimNumber}` : "Número de reclamo: No"}
                      </small>
                    </span>
                    <span className="workflow-claim-summary-value">
                      <small>Incidente</small>
                      <strong>{claim.incidentDate || "Sin fecha"}</strong>
                    </span>
                    <span className="workflow-claim-summary-value">
                      <small>Monto</small>
                      <strong>{claim.amount || "-"}</strong>
                    </span>
                    <span className="workflow-claim-indicators">
                      <span className={claim.settlementDelivered ? "complete" : "pending"}>
                        {claim.settlementDelivered ? "Finiquito entregado" : "Finiquito pendiente"}
                      </span>
                      {claim.followUps.length > 0 && <span className="complete">Con seguimiento</span>}
                      {!claim.claimNumber && <span className="missing">Sin número</span>}
                      {claim.status === "Finalizado" && claim.closureOutcome && (
                        <span className={claim.closureOutcome === "Pagado" ? "complete" : "declined"}>{claim.closureOutcome}</span>
                      )}
                    </span>
                    <span className="workflow-claim-chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
                  </button>
                  <div className="workflow-claim-row-actions">
                    <select
                      className={`workflow-status-select status-${claim.status === "Inactivo" ? "inactive" : claim.status === "Activo" ? "active" : "finished"}`}
                      value={claim.status}
                      onChange={(event) => requestClaimStatusUpdate(claim, event.target.value as InsuranceClaimStatus)}
                      disabled={readOnly || editingClaimId === claim.id || statusSavingId === claim.id || settlementSavingId === claim.id || settlementUploadingId === claim.id || damagePhotosUploadingId === claim.id || followUpSavingId === claim.id || editSavingId === claim.id}
                    >
                      <option value="Inactivo">Inactivo</option>
                      <option value="Activo">Activo</option>
                      <option value="Finalizado">Finalizado</option>
                    </select>
                    <button
                      type="button"
                      className={`workflow-photos-shortcut${claim.damagePhotos.length > 0 ? " has-photos" : ""}`}
                      onClick={() => setExpandedClaimId(claim.id)}
                    >
                      {claim.damagePhotos.length > 0
                        ? `Ver fotos (${claim.damagePhotos.length})`
                        : "Agregar fotos (0/5)"}
                    </button>
                  </div>
                </div>
                {expanded && (
                <div className="workflow-claim-details">
                <div className="workflow-claim-detail-head">
                  <div>
                    {!claim.claimNumber ? (
                      <strong className="workflow-claim-number-warning">Indicó que no tiene número de reclamo. El caso permanecerá Inactivo.</strong>
                    ) : (
                      <strong>Número de reclamo: {claim.claimNumber}</strong>
                    )}
                    {claim.status === "Finalizado" && claim.closureOutcome && (
                      <small>Finalizado como {claim.closureOutcome}{claim.finalizedAt ? ` el ${new Date(claim.finalizedAt).toLocaleDateString("es-PA")}` : ""}</small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="button"
                    onClick={() => startEditingClaim(claim)}
                    disabled={readOnly || editingClaimId === claim.id || statusSavingId === claim.id || settlementSavingId === claim.id || settlementUploadingId === claim.id || damagePhotosUploadingId === claim.id || followUpSavingId === claim.id}
                  >
                    Editar reclamo
                  </button>
                </div>
                <div className="workflow-record-tabs" role="tablist" aria-label="Secciones del reclamo">
                  <button type="button" role="tab" id={`claim-management-tab-${claim.id}`} aria-selected={activeClaimDetailTab === "management"} aria-controls={`claim-management-panel-${claim.id}`} className={activeClaimDetailTab === "management" ? "active" : ""} onClick={() => setClaimDetailTabs((current) => ({ ...current, [claim.id]: "management" }))}>Gestión del reclamo</button>
                  <button type="button" role="tab" id={`claim-follow-up-tab-${claim.id}`} aria-selected={activeClaimDetailTab === "follow_up"} aria-controls={`claim-follow-up-panel-${claim.id}`} className={activeClaimDetailTab === "follow_up" ? "active" : ""} onClick={() => setClaimDetailTabs((current) => ({ ...current, [claim.id]: "follow_up" }))}>Seguimiento <span>{claim.followUps.length}</span></button>
                </div>
                {activeClaimDetailTab === "management" && <div className="workflow-record-tab-panel workflow-record-tab-panel--management" role="tabpanel" id={`claim-management-panel-${claim.id}`} aria-labelledby={`claim-management-tab-${claim.id}`}>
                {finalizingClaimId === claim.id && (
                  <div className="workflow-finalization-panel">
                    <div>
                      <strong>Finalizar reclamo</strong>
                      <span>Indica el resultado definitivo del reclamo.</span>
                    </div>
                    <label>
                      Resultado
                      <select value={closureOutcome} onChange={(event) => setClosureOutcome(event.target.value as InsuranceClaimClosureOutcome | "")}>
                        <option value="">Seleccionar</option>
                        <option value="Pagado">Pagado</option>
                        <option value="Declinado">Declinado</option>
                      </select>
                    </label>
                    {closureOutcome === "Declinado" && (
                      <label className="workflow-finalization-reason">
                        Justificación del rechazo
                        <textarea
                          value={closureJustification}
                          placeholder="Explica por qué la aseguradora declinó el reclamo"
                          onChange={(event) => setClosureJustification(event.target.value)}
                        />
                      </label>
                    )}
                    <div className="workflow-finalization-actions">
                      <button type="button" className="button" onClick={() => setFinalizingClaimId(null)}>Cancelar</button>
                      <button type="button" className="button primary" onClick={() => void finalizeClaim(claim)} disabled={!closureOutcome || (closureOutcome === "Declinado" && !closureJustification.trim()) || statusSavingId === claim.id}>
                        {statusSavingId === claim.id ? "Finalizando..." : "Confirmar finalización"}
                      </button>
                    </div>
                  </div>
                )}
                {editingClaimId === claim.id ? (
                  <div className="workflow-claim-edit-panel">
                    <div className="workflow-claim-edit-grid">
                      <label>Fecha del incidente<input type="date" value={editForm.incidentDate} onChange={(event) => setEditForm((current) => ({ ...current, incidentDate: event.target.value }))} /></label>
                      <label>Unidad<input value={editForm.unit} onChange={(event) => setEditForm((current) => ({ ...current, unit: event.target.value }))} /></label>
                      <label>Nombre completo<input value={editForm.driver} onChange={(event) => setEditForm((current) => ({ ...current, driver: event.target.value }))} /></label>
                      <label>Placa<input value={editForm.plate} onChange={(event) => setEditForm((current) => ({ ...current, plate: event.target.value }))} /></label>
                      <label>
                        Aseguradora
                        <select value={editForm.insurer} onChange={(event) => setEditForm((current) => ({ ...current, insurer: event.target.value }))}>
                          <option value="">Seleccionar</option>
                          {insurers.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}
                        </select>
                      </label>
                      <label className={!editForm.hasClaimNumber ? "workflow-required-field" : ""}>
                        ¿Tienes el número de reclamo?
                        <select
                          value={editForm.hasClaimNumber}
                          onChange={(event) => {
                            const hasClaimNumber = event.target.value as ClaimForm["hasClaimNumber"];
                            setEditForm((current) => ({
                              ...current,
                              hasClaimNumber,
                              ...(hasClaimNumber !== "yes" ? { claimNumber: "" } : {})
                            }));
                          }}
                        >
                          <option value="">Seleccionar</option>
                          <option value="yes">Sí</option>
                          <option value="no">No</option>
                        </select>
                      </label>
                      {editForm.hasClaimNumber === "yes" && (
                        <label className={!editForm.claimNumber.trim() ? "workflow-required-field" : ""}>
                          Número de reclamo
                          <input value={editForm.claimNumber} placeholder="Obligatorio para activar o finalizar" onChange={(event) => setEditForm((current) => ({ ...current, claimNumber: event.target.value }))} />
                        </label>
                      )}
                      <label>Monto<input type="number" min="0" step="0.01" value={editForm.amount} onChange={(event) => setEditForm((current) => ({ ...current, amount: event.target.value }))} /></label>
                      <label className="workflow-claim-edit-wide">Daños del auto<textarea value={editForm.vehicleDamage} onChange={(event) => setEditForm((current) => ({ ...current, vehicleDamage: event.target.value }))} /></label>
                      <label className="workflow-claim-edit-wide workflow-required-field">
                        Justificación de la edición
                        <textarea value={editJustification} placeholder="Explica por qué se modifican los datos del reclamo" onChange={(event) => setEditJustification(event.target.value)} />
                      </label>
                    </div>
                    <div className="workflow-claim-edit-actions">
                      <button type="button" className="button" onClick={cancelClaimEdit}>Cancelar</button>
                      <button type="button" className="button primary" onClick={() => void saveClaimEdit(claim)} disabled={!editJustification.trim() || editSavingId === claim.id}>
                        {editSavingId === claim.id ? "Guardando..." : "Guardar edición"}
                      </button>
                    </div>
                  </div>
                ) : (
                <dl className="workflow-claim-detail-grid">
                  <div><dt>¿Tiene número de reclamo?</dt><dd>{claim.hasClaimNumber ? "Sí" : "No"}</dd></div>
                  <div><dt>Número de reclamo</dt><dd>{claim.claimNumber || "No aplica"}</dd></div>
                  <div><dt>Placa</dt><dd>{claim.plate || "-"}</dd></div>
                  <div><dt>Fotos de daños</dt><dd>{claim.damagePhotos.length || claim.damagePhotoNames.length || "-"}</dd></div>
                  <div><dt>Fecha de creación</dt><dd>{claim.createdAt ? new Date(claim.createdAt).toLocaleDateString("es-PA") : "-"}</dd></div>
                  <div><dt>Documento FUD</dt><dd>{claim.fudAttachment ? <><span>{claim.fudAttachment.name}</span><button type="button" className="button small" onClick={() => void viewSettlement(claim.fudAttachment!.path)}>Ver FUD</button></> : "No adjunto"}</dd></div>
                  {claim.status === "Finalizado" && <div><dt>Resultado final</dt><dd>{claim.closureOutcome || "-"}</dd></div>}
                  {claim.closureOutcome === "Declinado" && <div className="workflow-claim-damage"><dt>Justificación del rechazo</dt><dd>{claim.closureJustification}</dd></div>}
                  <div className="workflow-claim-damage"><dt>Daños del auto</dt><dd>{claim.vehicleDamage || "Sin descripción"}</dd></div>
                </dl>
                )}
                {editingClaimId !== claim.id && claim.editHistory.length > 0 && (
                  <details className="workflow-edit-history">
                    <summary>Historial de ediciones justificadas ({claim.editHistory.length})</summary>
                    <ul>
                      {[...claim.editHistory].reverse().slice(0, 5).map((event) => (
                        <li key={`${event.editedAt}-${event.justification}`}>
                          <time>{new Date(event.editedAt).toLocaleString("es-PA")}</time>
                          <span>{event.justification}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="workflow-damage-photos">
                  <div className="workflow-damage-photos-head">
                    <div>
                      <strong>Fotos de los daños</strong>
                      <span>{claim.damagePhotos.length} de {MAX_DAMAGE_PHOTOS} fotos guardadas</span>
                    </div>
                    <label className="button">
                      {damagePhotosUploadingId === claim.id
                        ? "Subiendo..."
                        : claim.damagePhotos.length >= MAX_DAMAGE_PHOTOS
                          ? "Límite alcanzado"
                          : "Agregar fotos"}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(event) => {
                          void handleDamagePhotosUpload(claim, event.target.files);
                          event.target.value = "";
                        }}
                        disabled={readOnly || editingClaimId === claim.id || editSavingId === claim.id || statusSavingId === claim.id || settlementSavingId === claim.id || settlementUploadingId === claim.id || damagePhotosUploadingId === claim.id || followUpSavingId === claim.id || claim.damagePhotos.length >= MAX_DAMAGE_PHOTOS}
                      />
                    </label>
                  </div>
                  {claim.damagePhotos.length > 0 ? (
                    <div className="workflow-damage-photo-list">
                      {claim.damagePhotos.map((photo, index) => (
                        <div key={photo.path} className="workflow-damage-photo-row">
                          <div>
                            <strong>Foto {index + 1}</strong>
                            <small title={photo.name}>{photo.name}</small>
                          </div>
                          <button type="button" className="button" onClick={() => void viewDamagePhoto(photo)}>
                            Ver foto
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="hint">No hay fotos adjuntas. Puedes agregar hasta {MAX_DAMAGE_PHOTOS}.</p>
                  )}
                  {claim.damagePhotos.length >= MAX_DAMAGE_PHOTOS && <span className="workflow-photo-limit">Límite de {MAX_DAMAGE_PHOTOS} fotos alcanzado.</span>}
                </div>
                <div className="workflow-settlement">
                  <div className="workflow-settlement-head">
                    <strong>Finiquito</strong>
                    <span>{claim.settlementDelivered ? "Entregado" : "Pendiente"}</span>
                  </div>
                  <label className="workflow-settlement-date">
                    Fecha de entrega del finiquito
                    <input
                      type="date"
                      value={settlementDates[claim.id] ?? claim.settlementDeliveredDate}
                      onChange={(event) => {
                        const date = event.target.value;
                        setSettlementDates((current) => ({ ...current, [claim.id]: date }));
                        if (claim.settlementDelivered) void updateSettlementDelivery(claim, true, date);
                      }}
                      disabled={readOnly || editingClaimId === claim.id || editSavingId === claim.id || statusSavingId === claim.id || settlementSavingId === claim.id || settlementUploadingId === claim.id || damagePhotosUploadingId === claim.id || followUpSavingId === claim.id}
                    />
                  </label>
                  <label className="workflow-settlement-check">
                    <input
                      type="checkbox"
                      checked={claim.settlementDelivered}
                      onChange={(event) => void updateSettlementDelivery(
                        claim,
                        event.target.checked,
                        settlementDates[claim.id] ?? claim.settlementDeliveredDate
                      )}
                      disabled={readOnly || editingClaimId === claim.id || editSavingId === claim.id || statusSavingId === claim.id || settlementSavingId === claim.id || settlementUploadingId === claim.id || damagePhotosUploadingId === claim.id || followUpSavingId === claim.id}
                    />
                    Finiquito entregado
                  </label>
                  <label className="workflow-settlement-file">
                    Adjuntar finiquito
                    <input
                      type="file"
                      accept="application/pdf,image/*,.doc,.docx"
                      onChange={(event) => {
                        void handleSettlementFileChange(claim, event.target.files?.[0]);
                        event.target.value = "";
                      }}
                      disabled={readOnly || editingClaimId === claim.id || editSavingId === claim.id || statusSavingId === claim.id || settlementSavingId === claim.id || settlementUploadingId === claim.id || damagePhotosUploadingId === claim.id || followUpSavingId === claim.id}
                    />
                    <span className="hint">PDF, imagen o Word. Maximo 10 MB.</span>
                  </label>
                  <div className="workflow-settlement-view">
                    {settlementUploadingId === claim.id ? (
                      <span className="hint">Subiendo finiquito...</span>
                    ) : claim.settlementAttachment ? (
                      <>
                        <span title={claim.settlementAttachment.name}>{claim.settlementAttachment.name}</span>
                        <button type="button" className="button" onClick={() => void viewSettlement(claim.settlementAttachment!.path)}>
                          Ver finiquito
                        </button>
                      </>
                    ) : (
                      <span className="hint">Sin finiquito adjunto</span>
                    )}
                  </div>
                </div>
                </div>}
                {activeClaimDetailTab === "follow_up" && <section className="insurance-follow-up-panel workflow-record-tab-panel" role="tabpanel" id={`claim-follow-up-panel-${claim.id}`} aria-labelledby={`claim-follow-up-tab-${claim.id}`}>
                  <div className="judicial-follow-up-head"><div><strong>Timeline de seguimiento</strong><span>Registra cada gestión sin reemplazar las anteriores.</span></div><b>{claim.followUps.length} {claim.followUps.length === 1 ? "registro" : "registros"}</b></div>
                  {claim.status !== "Finalizado" && <div className="judicial-follow-up-form">
                    <label className="judicial-follow-up-comment">Novedad o gestión<textarea value={followUpComments[claim.id] ?? ""} placeholder="Ej. La aseguradora confirmó que el reclamo está en revisión" onChange={(event) => setFollowUpComments((current) => ({ ...current, [claim.id]: event.target.value }))} disabled={readOnly || followUpSavingId === claim.id} /></label>
                    <label>Próximo paso<input value={followUpNextSteps[claim.id] ?? ""} placeholder="Ej. Solicitar actualización al ajustador" onChange={(event) => setFollowUpNextSteps((current) => ({ ...current, [claim.id]: event.target.value }))} disabled={readOnly || followUpSavingId === claim.id} /></label>
                    <label>Próxima gestión<input type="date" min={localDateKey()} value={followUpDates[claim.id] ?? ""} onChange={(event) => setFollowUpDates((current) => ({ ...current, [claim.id]: event.target.value }))} disabled={readOnly || followUpSavingId === claim.id} /></label>
                    <button type="button" className="button primary" onClick={() => void saveFollowUpComment(claim)} disabled={readOnly || followUpSavingId === claim.id || !(followUpComments[claim.id] ?? "").trim() || !(followUpNextSteps[claim.id] ?? "").trim() || !followUpDates[claim.id]}>{followUpSavingId === claim.id ? "Guardando..." : "Guardar seguimiento"}</button>
                  </div>}
                  {claim.followUps.length > 0 ? <ol className="judicial-follow-up-history">{[...claim.followUps].reverse().map((entry) => <li key={entry.id}><div><time>{new Date(entry.createdAt).toLocaleString("es-PA")}</time>{entry.nextActionDate && <span>Próxima gestión: <strong>{entry.nextActionDate}</strong></span>}</div><p>{entry.comment}</p>{entry.nextStep && <small>Próximo paso: <strong>{entry.nextStep}</strong></small>}</li>)}</ol> : <p className="judicial-follow-up-empty">Todavía no hay seguimientos registrados en este reclamo.</p>}
                </section>}
                </div>
                )}
              </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
