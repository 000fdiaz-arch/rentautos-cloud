import { useEffect, useMemo, useState } from "react";
import {
  DuplicateInsuranceClaimNumberError,
  JudicialOutcomeRequiredForClaimError,
  createCollisionPhotoViewUrl,
  createInsuranceDamagePhotoViewUrl,
  loadCollisionCases,
  loadInsuranceClaims,
  removeCollisionPhotos,
  removeInsuranceDamagePhotos,
  saveCollisionCase,
  saveInsuranceClaim,
  saveInsuranceInsurer,
  uploadCollisionPhoto,
  uploadInsuranceDamagePhoto,
  type CollisionCaseRecord,
  type CollisionInsuranceClaim,
  type CollisionPhotoAttachment,
  type CollisionTrialStatus,
  type InsuranceClaimRecord
} from "../cloudData";
import type { Client } from "../types";
import { normalizeCourtName } from "../courtNames";
import { useControlUnitsRows } from "./controlUnits/useControlUnitsRows";

type Props = {
  clients: Client[];
  dataOwnerUserId?: string | null;
  readOnly?: boolean;
  onClientsChange: (next: Client[]) => void | Promise<void>;
  embedded?: boolean;
  syncInsuranceClaims?: boolean;
  hideCreateForm?: boolean;
  initialExpandedId?: string;
  initialSearch?: string;
  focusedCaseId?: string;
};
type DateFilter = "all" | "upcoming" | "today" | "last_week" | "overdue";
type TrialForm = {
  incidentDate: string;
  unit: string;
  driver: string;
  plate: string;
  trialDate: string;
  vehicleDamage: string;
  ticketStub: string;
  placeTime: string;
  court: string;
  collisionAndRun: boolean;
};
type ClaimDraft = { insurer: string; claimNumber: string; amount: string };
type JudicialFollowUpDraft = { comment: string; nextStep: string; nextActionDate: string };
type JudicialCaseTab = "management" | "follow_up";

const EMPTY_FORM: TrialForm = {
  incidentDate: "",
  unit: "",
  driver: "",
  plate: "",
  trialDate: "",
  vehicleDamage: "",
  ticketStub: "",
  placeTime: "",
  court: "",
  collisionAndRun: false
};
const EMPTY_CLAIM: ClaimDraft = { insurer: "", claimNumber: "", amount: "" };
const EMPTY_JUDICIAL_FOLLOW_UP: JudicialFollowUpDraft = { comment: "", nextStep: "", nextActionDate: "" };
const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const USD_FORMATTER = new Intl.NumberFormat("es-PA", { style: "currency", currency: "USD" });
const CURRENT_DATE_FORMATTER = new Intl.DateTimeFormat("es-PA", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

function normalizeUnit(value: string): string { return value.trim().toUpperCase(); }
function normalizePersonName(value: string): string { return value.trim().toLocaleUpperCase("es").replace(/\s+/g, " "); }
function courtsFromCases(cases: CollisionCaseRecord[]): string[] {
  return [...new Set(cases.map((item) => normalizeCourtName(item.court)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es", { numeric: true }));
}
function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function previousWeekRange(today = new Date()): { start: string; end: string } {
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const thisMonday = new Date(current);
  thisMonday.setDate(current.getDate() - ((current.getDay() + 6) % 7));
  const previousMonday = new Date(thisMonday);
  previousMonday.setDate(thisMonday.getDate() - 7);
  const previousSunday = new Date(thisMonday);
  previousSunday.setDate(thisMonday.getDate() - 1);
  return { start: localDateKey(previousMonday), end: localDateKey(previousSunday) };
}
function parseAmount(value: string): number {
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function isFinalStatus(status: CollisionTrialStatus): boolean { return status === "ABSUELTO" || status === "CULPABLE"; }

export default function CollisionsPage({ clients, dataOwnerUserId, readOnly = false, onClientsChange, embedded = false, syncInsuranceClaims = true, hideCreateForm = false, initialExpandedId = "", initialSearch = "", focusedCaseId = "" }: Props) {
  const { rows: fleetUnits, loading: fleetLoading, loadError: fleetLoadError } = useControlUnitsRows(hideCreateForm ? null : dataOwnerUserId);
  const [activeTab, setActiveTab] = useState<"form" | "agenda">(hideCreateForm ? "agenda" : "form");
  const [form, setForm] = useState<TrialForm>(EMPTY_FORM);
  const [cases, setCases] = useState<CollisionCaseRecord[]>([]);
  const [courts, setCourts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<CollisionTrialStatus | "all">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId || null);
  const [driverEditedManually, setDriverEditedManually] = useState(false);
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, "" | "ABSUELTO" | "CULPABLE" | "NUEVA FECHA">>({});
  const [outcomeEvidenceFiles, setOutcomeEvidenceFiles] = useState<Record<string, File | null>>({});
  const [newTrialDates, setNewTrialDates] = useState<Record<string, string>>({});
  const [rescheduleReasons, setRescheduleReasons] = useState<Record<string, string>>({});
  const [expenseAmounts, setExpenseAmounts] = useState<Record<string, string>>({});
  const [expenseLabels, setExpenseLabels] = useState<Record<string, string>>({});
  const [returnedBeforeClosure, setReturnedBeforeClosure] = useState<Record<string, boolean>>({});
  const [claimDrafts, setClaimDrafts] = useState<Record<string, ClaimDraft>>({});
  const [claimPhotoFiles, setClaimPhotoFiles] = useState<Record<string, File[]>>({});
  const [judicialFollowUpDrafts, setJudicialFollowUpDrafts] = useState<Record<string, JudicialFollowUpDraft>>({});
  const [judicialFollowUpSavingId, setJudicialFollowUpSavingId] = useState("");
  const [judicialCaseTabs, setJudicialCaseTabs] = useState<Record<string, JudicialCaseTab>>({});

  const fleetUnitsByUnit = useMemo(() => new Map(fleetUnits.map((row) => [normalizeUnit(row.unit_id), row])), [fleetUnits]);
  const clientsByUnit = useMemo(() => {
    const result = new Map<string, Client>();
    clients.forEach((client) => {
      const unit = normalizeUnit(client.unitId);
      if (unit && (!result.has(unit) || client.status !== "archivado")) result.set(unit, client);
    });
    return result;
  }, [clients]);
  const unitOptions = useMemo(() => [...new Set([
    ...fleetUnits.map((row) => normalizeUnit(row.unit_id)),
    ...clients.map((client) => normalizeUnit(client.unitId))
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "es", { numeric: true })), [clients, fleetUnits]);
  const unitOptionLabels = useMemo(() => new Map(unitOptions.map((unitId) => {
    const fleetUnit = fleetUnitsByUnit.get(unitId);
    const client = clientsByUnit.get(unitId);
    return [unitId, [fleetUnit?.client_name ?? client?.name, fleetUnit?.plate ? `Placa ${fleetUnit.plate}` : ""].filter(Boolean).join(" - ")];
  })), [clientsByUnit, fleetUnitsByUnit, unitOptions]);
  const filteredCases = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    const today = localDateKey(new Date());
    const lastWeek = previousWeekRange();
    return cases.filter((item) => {
      if (focusedCaseId) return item.id === focusedCaseId;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (dateFilter === "upcoming" && (!item.trialDate || item.trialDate <= today || isFinalStatus(item.status))) return false;
      if (dateFilter === "today" && (item.trialDate !== today || isFinalStatus(item.status))) return false;
      if (dateFilter === "last_week" && (!item.trialDate || item.trialDate < lastWeek.start || item.trialDate > lastWeek.end || isFinalStatus(item.status))) return false;
      if (dateFilter === "overdue" && (!item.trialDate || item.trialDate >= today || isFinalStatus(item.status))) return false;
      if (!needle) return true;
      return [item.unit, item.driver, item.plate, item.ticketStub, item.placeTime, item.court, item.vehicleDamage,
        ...item.judicialFollowUps.flatMap((entry) => [entry.comment, entry.nextStep])]
        .some((value) => value.toLocaleLowerCase("es").includes(needle));
    });
  }, [cases, dateFilter, focusedCaseId, search, statusFilter]);
  const focusedCase = useMemo(() => focusedCaseId ? cases.find((item) => item.id === focusedCaseId) ?? null : null, [cases, focusedCaseId]);
  const requiredOutcomeCount = useMemo(() => {
    const today = localDateKey(new Date());
    return cases.filter((item) => item.trialDate && item.trialDate <= today && !isFinalStatus(item.status)).length;
  }, [cases]);

  useEffect(() => {
    if (!dataOwnerUserId) { setLoading(false); setLoadError("No se encontró owner de datos para cargar los juicios."); return; }
    let cancelled = false;
    setLoading(true); setLoadError("");
    loadCollisionCases(dataOwnerUserId)
      .then((nextCases) => {
        if (cancelled) return;
        setCases(nextCases);
        setCourts(courtsFromCases(nextCases));
        setClaimDrafts(Object.fromEntries(nextCases.map((item) => [item.id, item.insuranceClaim
          ? { insurer: item.insuranceClaim.insurer, claimNumber: item.insuranceClaim.claimNumber, amount: item.insuranceClaim.amount }
          : EMPTY_CLAIM])));
        setExpenseLabels(Object.fromEntries(nextCases.map((item) => [item.id, `GASTOS DE JUICIO - ${item.unit}`])));
      })
      .catch((error) => { if (!cancelled) { console.error("No se pudieron cargar los juicios.", error); setLoadError("No se pudieron cargar los juicios desde la nube."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dataOwnerUserId]);

  useEffect(() => {
    const unitId = normalizeUnit(form.unit);
    if (!unitId) return;
    const fleetUnit = fleetUnitsByUnit.get(unitId);
    const client = clientsByUnit.get(unitId);
    const driver = fleetUnit?.client_name ?? client?.name ?? "";
    const plate = fleetUnit?.plate ?? "";
    if ((driverEditedManually || form.driver === driver) && form.plate === plate) return;
    setForm((current) => ({ ...current, driver: driverEditedManually ? current.driver : driver, plate }));
  }, [clientsByUnit, driverEditedManually, fleetUnitsByUnit, form.driver, form.plate, form.unit]);

  function patchForm(patch: Partial<TrialForm>): void { setForm((current) => ({ ...current, ...patch })); }
  function handleUnitChange(value: string): void {
    const unit = normalizeUnit(value);
    const fleetUnit = fleetUnitsByUnit.get(unit);
    const client = clientsByUnit.get(unit);
    setDriverEditedManually(false);
    patchForm({ unit, driver: fleetUnit?.client_name ?? client?.name ?? "", plate: fleetUnit?.plate ?? "" });
  }
  function addCourt(): void {
    if (readOnly) return;
    const court = normalizeCourtName(window.prompt("Nombre del nuevo juzgado") ?? "");
    if (!court) return;
    setCourts((current) => [...new Set([...current, court])].sort((a, b) => a.localeCompare(b, "es", { numeric: true })));
    patchForm({ court });
  }
  function initializeCaseDrafts(item: CollisionCaseRecord): void {
    setExpenseLabels((current) => ({ ...current, [item.id]: current[item.id] ?? `GASTOS DE JUICIO - ${item.unit}` }));
    setClaimDrafts((current) => ({ ...current, [item.id]: current[item.id] ?? (item.insuranceClaim
      ? { insurer: item.insuranceClaim.insurer, claimNumber: item.insuranceClaim.claimNumber, amount: item.insuranceClaim.amount }
      : EMPTY_CLAIM) }));
  }

  async function saveTrial(): Promise<void> {
    if (readOnly || saving || !dataOwnerUserId) return;
    if (!form.incidentDate || !form.unit.trim() || !form.driver.trim() || !form.plate.trim() || !form.trialDate || !form.vehicleDamage.trim() || !form.ticketStub.trim() || !form.placeTime.trim() || !form.court.trim()) {
      setMessage("Completa todos los campos del formulario de juicio."); return;
    }
    const now = new Date().toISOString();
    const caseClient = clientsByUnit.get(normalizeUnit(form.unit));
    const item: CollisionCaseRecord = {
      id: `collision-trial-${Date.now()}-${crypto.randomUUID()}`,
      incidentDate: form.incidentDate,
      unit: normalizeUnit(form.unit),
      driver: form.driver.trim(),
      clientId: caseClient?.id ?? "",
      clientName: caseClient?.name ?? form.driver.trim(),
      plate: form.plate.trim().toUpperCase(),
      trialDate: form.trialDate,
      vehicleDamage: form.vehicleDamage.trim(),
      ticketStub: form.ticketStub.trim(),
      placeTime: form.placeTime.trim(),
      court: normalizeCourtName(form.court),
      collisionAndRun: form.collisionAndRun,
      status: "PENDIENTE",
      trialDateHistory: [],
      judicialFollowUps: [],
      judicialOutcomeEvidence: null,
      insuranceClaim: null,
      expenseInvoice: null,
      clientReturnedBeforeClosure: false,
      clientReturnedBeforeClosureAt: null,
      createdAt: now,
      updatedAt: now
    };
    setSaving(true); setMessage("");
    try {
      await saveCollisionCase(dataOwnerUserId, item);
      setCases((current) => [item, ...current]);
      initializeCaseDrafts(item);
      setForm(EMPTY_FORM); setDriverEditedManually(false); setActiveTab("agenda"); setExpandedId(item.id);
      setMessage("Juicio registrado correctamente.");
    } catch (error) { console.error("No se pudo guardar el juicio.", error); setMessage("No se pudo guardar el juicio en la nube."); }
    finally { setSaving(false); }
  }

  async function persistCase(updated: CollisionCaseRecord, success: string): Promise<void> {
    if (!dataOwnerUserId) return;
    await saveCollisionCase(dataOwnerUserId, updated);
    setCases((current) => current.map((item) => item.id === updated.id ? updated : item));
    setMessage(success);
  }

  async function saveJudicialFollowUp(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || judicialFollowUpSavingId || !dataOwnerUserId || isFinalStatus(item.status)) return;
    const draft = judicialFollowUpDrafts[item.id] ?? EMPTY_JUDICIAL_FOLLOW_UP;
    const comment = draft.comment.trim();
    const nextStep = draft.nextStep.trim();
    if (!comment || !nextStep || !draft.nextActionDate) {
      setMessage("Completa la novedad, el próximo paso y la fecha de la próxima gestión.");
      return;
    }
    const now = new Date().toISOString();
    const updatedCase: CollisionCaseRecord = {
      ...item,
      judicialFollowUps: [...item.judicialFollowUps, {
        id: `judicial-follow-up-${Date.now()}-${crypto.randomUUID()}`,
        comment,
        nextStep,
        nextActionDate: draft.nextActionDate,
        createdAt: now
      }],
      updatedAt: now
    };
    setJudicialFollowUpSavingId(item.id);
    setMessage("");
    try {
      await persistCase(updatedCase, "Seguimiento judicial guardado correctamente.");
      setJudicialFollowUpDrafts((current) => ({ ...current, [item.id]: EMPTY_JUDICIAL_FOLLOW_UP }));
    } catch (error) {
      console.error("No se pudo guardar el seguimiento judicial.", error);
      setMessage("No se pudo guardar el seguimiento judicial.");
    } finally {
      setJudicialFollowUpSavingId("");
    }
  }

  async function applyOutcome(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId) return;
    const outcome = outcomeDrafts[item.id];
    if (!outcome) { setMessage("Selecciona el resultado del juicio."); return; }
    const now = new Date().toISOString();
    let uploadedEvidence: CollisionPhotoAttachment | null = null;
    setBusyId(item.id); setMessage("");
    try {
      if (outcome !== "NUEVA FECHA") {
        const evidenceFile = outcomeEvidenceFiles[item.id];
        if (!evidenceFile) throw new Error("OUTCOME_EVIDENCE_REQUIRED");
        uploadedEvidence = await uploadCollisionPhoto(dataOwnerUserId, item.id, evidenceFile);
      }
      if (outcome === "NUEVA FECHA") {
        const nextDate = newTrialDates[item.id] ?? "";
        const reason = rescheduleReasons[item.id]?.trim() ?? "";
        if (!nextDate || nextDate === item.trialDate || !reason) throw new Error("RESCHEDULE_REQUIRED");
        await persistCase({
          ...item,
          trialDate: nextDate,
          status: "NUEVA FECHA",
          trialDateHistory: [...item.trialDateHistory, { previousDate: item.trialDate, newDate: nextDate, reason, changedAt: now }],
          updatedAt: now
        }, "Nueva fecha de juicio guardada con su razón.");
      } else if (outcome === "ABSUELTO") {
        await persistCase({ ...item, status: "ABSUELTO", judicialOutcomeEvidence: uploadedEvidence, updatedAt: now }, "Resultado ABSUELTO y documento guardados. Se habilitó el formulario de reclamo.");
      } else {
        const clientReturned = returnedBeforeClosure[item.id] === true;
        if (clientReturned) {
          await persistCase({
            ...item,
            status: "CULPABLE",
            judicialOutcomeEvidence: uploadedEvidence,
            expenseInvoice: null,
            clientReturnedBeforeClosure: true,
            clientReturnedBeforeClosureAt: now,
            updatedAt: now
          }, "Resultado guardado. El cliente dejó el carro antes del cierre; no se generó una factura automática.");
          setOutcomeDrafts((current) => ({ ...current, [item.id]: "" }));
          setOutcomeEvidenceFiles((current) => ({ ...current, [item.id]: null }));
          return;
        }
        const amount = parseAmount(expenseAmounts[item.id] ?? "");
        const label = expenseLabels[item.id]?.trim() || `GASTOS DE JUICIO - ${item.unit}`;
        const historicalClientIndex = item.clientId ? clients.findIndex((client) => client.id === item.clientId) : -1;
        const historicalClientName = normalizePersonName(item.clientName || item.driver);
        const namedClientIndex = historicalClientName
          ? clients.findIndex((client) => normalizePersonName(client.name) === historicalClientName)
          : -1;
        const clientIndex = historicalClientIndex >= 0
          ? historicalClientIndex
          : namedClientIndex >= 0
            ? namedClientIndex
            : clients.findIndex((client) => normalizeUnit(client.unitId) === normalizeUnit(item.unit));
        if (amount <= 0) throw new Error("EXPENSE_AMOUNT_REQUIRED");
        if (clientIndex < 0) throw new Error("CLIENT_NOT_FOUND");
        const chargeId = `collision-expense-${item.id}`;
        const currentClient = clients[clientIndex];
        const nextClients = clients.map((client, index) => index !== clientIndex ? client : {
          ...client,
          otherCharges: [...client.otherCharges.filter((charge) => charge.id !== chargeId), { id: chargeId, label, amount }]
        });
        const updatedCase: CollisionCaseRecord = {
          ...item,
          status: "CULPABLE",
          judicialOutcomeEvidence: uploadedEvidence,
          expenseInvoice: { chargeId, label, amount, createdAt: now },
          clientReturnedBeforeClosure: false,
          clientReturnedBeforeClosureAt: null,
          updatedAt: now
        };
        await saveCollisionCase(dataOwnerUserId, updatedCase);
        try {
          await onClientsChange(nextClients);
        } catch (error) {
          try { await saveCollisionCase(dataOwnerUserId, item); } catch (rollbackError) { console.error("No se pudo revertir el resultado del juicio.", rollbackError); }
          throw error;
        }
        setCases((current) => current.map((candidate) => candidate.id === item.id ? updatedCase : candidate));
        setMessage(`Resultado guardado. Se generó una factura de gastos por ${USD_FORMATTER.format(amount)}.`);
      }
      setOutcomeDrafts((current) => ({ ...current, [item.id]: "" }));
      setOutcomeEvidenceFiles((current) => ({ ...current, [item.id]: null }));
    } catch (error) {
      if (error instanceof Error && error.message === "RESCHEDULE_REQUIRED") setMessage("Indica una fecha distinta y la razón obligatoria de la reprogramación.");
      else if (error instanceof Error && error.message === "OUTCOME_EVIDENCE_REQUIRED") setMessage("Adjunta la foto del documento que valida el resultado judicial.");
      else if (error instanceof Error && error.message === "EXPENSE_AMOUNT_REQUIRED") setMessage("Indica el monto de los gastos para generar la factura.");
      else if (error instanceof Error && error.message === "CLIENT_NOT_FOUND") setMessage("No se encontró un cliente asociado a esta unidad para generar la factura.");
      else { console.error("No se pudo guardar el resultado del juicio.", error); setMessage("No se pudo guardar el resultado del juicio."); }
      if (uploadedEvidence) {
        try { await removeCollisionPhotos([uploadedEvidence.path]); } catch (cleanupError) { console.error("No se pudo limpiar el documento judicial subido.", cleanupError); }
      }
    } finally { setBusyId(""); }
  }

  function selectOutcomeEvidence(caseId: string, file: File | undefined): void {
    if (!file) {
      setOutcomeEvidenceFiles((current) => ({ ...current, [caseId]: null }));
      return;
    }
    if (!file.type.startsWith("image/") || file.size > MAX_PHOTO_SIZE) {
      setOutcomeEvidenceFiles((current) => ({ ...current, [caseId]: null }));
      setMessage("El documento debe ser una imagen de 10 MB o menos.");
      return;
    }
    setMessage("");
    setOutcomeEvidenceFiles((current) => ({ ...current, [caseId]: file }));
  }

  function selectClaimPhotos(caseId: string, files: FileList | null, existingCount: number): void {
    const selected = Array.from(files ?? []).slice(0, Math.max(0, MAX_PHOTOS - existingCount));
    if (selected.some((file) => !file.type.startsWith("image/") || file.size > MAX_PHOTO_SIZE)) {
      setMessage("Las fotos deben ser imágenes de 10 MB o menos."); return;
    }
    setClaimPhotoFiles((current) => ({ ...current, [caseId]: selected }));
  }

  async function saveClaim(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId || item.status !== "ABSUELTO") return;
    const draft = claimDrafts[item.id] ?? EMPTY_CLAIM;
    const existingPhotos = item.insuranceClaim?.photos ?? [];
    const uploaded: CollisionPhotoAttachment[] = [];
    setBusyId(item.id); setMessage("");
    try {
      for (const file of claimPhotoFiles[item.id] ?? []) {
        uploaded.push(syncInsuranceClaims
          ? await uploadInsuranceDamagePhoto(dataOwnerUserId, item.id, file)
          : await uploadCollisionPhoto(dataOwnerUserId, item.id, file));
      }
      const now = new Date().toISOString();
      const insurer = draft.insurer.trim().toUpperCase();
      const claimNumber = draft.claimNumber.trim();
      const hasClaimNumber = Boolean(claimNumber);
      let insuranceClaimId = item.insuranceClaim?.insuranceClaimId;
      const insuranceClaim: CollisionInsuranceClaim = {
        insuranceClaimId,
        insurer,
        claimNumber,
        amount: draft.amount,
        photos: [...existingPhotos, ...uploaded],
        updatedAt: now
      };
      if (syncInsuranceClaims) {
        const allClaims = await loadInsuranceClaims(dataOwnerUserId);
        const linkedClaim = allClaims.find((claim) => claim.id === item.insuranceClaim?.insuranceClaimId)
          ?? allClaims.find((claim) => (
            claim.claimNumber.trim().toLocaleLowerCase("es") === claimNumber.toLocaleLowerCase("es")
            && normalizeUnit(claim.unit) === normalizeUnit(item.unit)
            && claim.incidentDate === item.incidentDate
          ));
        insuranceClaimId = linkedClaim?.id ?? `collision-insurance-${item.id}`;
        insuranceClaim.insuranceClaimId = insuranceClaimId;
        const linkedPhotos = existingPhotos.filter((photo) => photo.storageBucket === "insurance-settlements");
        const damagePhotos = Array.from(
          new Map([...(linkedClaim?.damagePhotos ?? []), ...linkedPhotos, ...uploaded].map((photo) => [photo.path, photo])).values()
        );
        const canonicalClaim: InsuranceClaimRecord = {
          ...(linkedClaim ?? {
            id: insuranceClaimId,
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
            createdAt: now
          }),
          id: insuranceClaimId,
          incidentDate: item.incidentDate,
          unit: normalizeUnit(item.unit),
          driver: item.driver,
          plate: item.plate,
          insurer,
          hasClaimNumber,
          claimNumber,
          amount: draft.amount,
          vehicleDamage: item.vehicleDamage,
          status: linkedClaim?.status === "Finalizado" ? "Finalizado" : hasClaimNumber ? "Activo" : "Inactivo",
          damagePhotos,
          damagePhotoNames: damagePhotos.map((photo) => photo.name),
          updatedAt: now
        };
        await saveInsuranceInsurer(dataOwnerUserId, insurer);
        await saveInsuranceClaim(dataOwnerUserId, canonicalClaim);
      }
      await persistCase(
        { ...item, insuranceClaim, updatedAt: now },
        hasClaimNumber
          ? "Reclamo guardado como activo y vinculado con Reclamos a seguros."
          : "Reclamo guardado como inactivo. Podrás completar sus datos cuando estén disponibles."
      );
      setClaimDrafts((current) => ({ ...current, [item.id]: { insurer: insuranceClaim.insurer, claimNumber: insuranceClaim.claimNumber, amount: insuranceClaim.amount } }));
      setClaimPhotoFiles((current) => ({ ...current, [item.id]: [] }));
    } catch (error) {
      console.error("No se pudo guardar el reclamo.", error);
      if (uploaded.length) {
        try {
          const insurancePaths = uploaded.filter((photo) => photo.storageBucket === "insurance-settlements").map((photo) => photo.path);
          const collisionPaths = uploaded.filter((photo) => photo.storageBucket !== "insurance-settlements").map((photo) => photo.path);
          if (insurancePaths.length) await removeInsuranceDamagePhotos(insurancePaths);
          if (collisionPaths.length) await removeCollisionPhotos(collisionPaths);
        } catch { /* mejor esfuerzo */ }
      }
      setMessage(error instanceof DuplicateInsuranceClaimNumberError || error instanceof JudicialOutcomeRequiredForClaimError ? error.message : "No se pudo guardar el formulario de reclamo.");
    } finally { setBusyId(""); }
  }

  async function viewPhoto(photo: CollisionPhotoAttachment): Promise<void> {
    try {
      const url = photo.storageBucket === "insurance-settlements"
        ? await createInsuranceDamagePhotoViewUrl(photo.path, photo.storageBucket)
        : await createCollisionPhotoViewUrl(photo.path);
      window.open(url, "_blank", "noopener,noreferrer");
    }
    catch (error) { console.error("No se pudo abrir la foto.", error); setMessage("No se pudo abrir la foto."); }
  }

  return (
    <section className="insurance-workflow-page">
      {!embedded && <div className="panel insurance-workflow-header"><div><span className="workflow-eyebrow">Gestión judicial vehicular</span><h2>Juicio por Colisiones y Choques</h2></div></div>}
      {!hideCreateForm && <div className="panel workflow-tabs-panel">
        <button type="button" className={activeTab === "form" ? "active" : ""} onClick={() => setActiveTab("form")}>Formulario de juicio</button>
        <button type="button" className={activeTab === "agenda" ? "active" : ""} onClick={() => setActiveTab("agenda")}>Agenda de juicios</button>
      </div>}

      {!hideCreateForm && activeTab === "form" && <form className="panel workflow-form-panel" onSubmit={(event) => { event.preventDefault(); void saveTrial(); }}>
        <div className="panel-head"><h2>Formulario de juicio</h2><button type="submit" className="button primary" disabled={readOnly || saving || loading}>{saving ? "Guardando..." : "Guardar"}</button></div>
        {readOnly && <p className="hint workflow-message">Modo lectura: tu usuario no puede crear ni editar juicios.</p>}
        {loading && <p className="hint workflow-message">Cargando juicios...</p>}{loadError && <p className="hint workflow-message">{loadError}</p>}
        {fleetLoading && <p className="hint workflow-message">Cargando autos...</p>}{fleetLoadError && <p className="hint workflow-message">{fleetLoadError}</p>}
        {message && <p className="hint workflow-message" role="alert">{message}</p>}
        <div className="workflow-form-grid">
          <label>Fecha del incidente<input type="date" value={form.incidentDate} onChange={(event) => patchForm({ incidentDate: event.target.value })} disabled={readOnly} /></label>
          <label>Unidad<input list="collision-unit-options" placeholder="Ej. B52" value={form.unit} onChange={(event) => handleUnitChange(event.target.value)} disabled={readOnly} /><datalist id="collision-unit-options">{unitOptions.map((unitId) => <option key={unitId} value={unitId} label={unitOptionLabels.get(unitId) ?? ""} />)}</datalist></label>
          <label>Chofer<input value={form.driver} placeholder="Nombre completo" onChange={(event) => { setDriverEditedManually(true); patchForm({ driver: event.target.value }); }} disabled={readOnly} /></label>
          <label>Placa<input value={form.plate} placeholder="Placa del auto" onChange={(event) => patchForm({ plate: event.target.value })} disabled={readOnly} /></label>
          <label>Fecha de juicio<input type="date" value={form.trialDate} onChange={(event) => patchForm({ trialDate: event.target.value })} disabled={readOnly} /></label>
          <label>Colilla<input value={form.ticketStub} placeholder="Número o referencia de colilla" onChange={(event) => patchForm({ ticketStub: event.target.value })} disabled={readOnly} /></label>
          <label>Hora<input type="time" value={form.placeTime} onChange={(event) => patchForm({ placeTime: event.target.value })} disabled={readOnly} /></label>
          <label>Juzgado<select value={form.court} onChange={(event) => event.target.value === "__new__" ? addCourt() : patchForm({ court: event.target.value })} disabled={readOnly}><option value="">Seleccionar juzgado</option>{courts.map((court) => <option key={court}>{court}</option>)}<option value="__new__">+ Nuevo juzgado</option></select></label>
          <label className="workflow-form-notes">Daños del auto<textarea value={form.vehicleDamage} placeholder="Describe los daños del auto" onChange={(event) => patchForm({ vehicleDamage: event.target.value })} disabled={readOnly} /></label>
          <label className={`collision-runaway-option ${form.collisionAndRun ? "collision-runaway-option--yes" : "collision-runaway-option--no"}`}><input type="checkbox" checked={form.collisionAndRun} onChange={(event) => patchForm({ collisionAndRun: event.target.checked })} disabled={readOnly} /><span><strong>Colisión y fuga: {form.collisionAndRun ? "Sí" : "No"}</strong><small>{form.collisionAndRun ? "El conductor abandonó el lugar." : "El conductor permaneció en el lugar."}</small></span></label>
        </div>
      </form>}

      {activeTab === "agenda" && <section className={`panel workflow-claims-panel${focusedCaseId ? " workflow-claims-panel--focused judicial-focused-case" : ""}`}>
        {!focusedCaseId && <div className="panel-head"><h2>Agenda de juicios</h2><span className="hint">{filteredCases.length} de {cases.length} juicios</span></div>}
        {loading && <p className="hint workflow-message">Cargando juicios...</p>}{loadError && <p className="hint workflow-message">{loadError}</p>}{message && <p className="hint workflow-message">{message}</p>}
        {!focusedCaseId && requiredOutcomeCount > 0 && <p className="collision-required-outcome" role="alert">Hay {requiredOutcomeCount} {requiredOutcomeCount === 1 ? "juicio que requiere" : "juicios que requieren"} registrar el resultado: ABSUELTO, CULPABLE o NUEVA FECHA.</p>}
        {!focusedCaseId && <div className="workflow-claim-kpis workflow-claim-kpis--single" aria-label="Fecha de la agenda"><div><span>Fecha</span><strong>{CURRENT_DATE_FORMATTER.format(new Date())}</strong><small>Agenda del día</small></div></div>}
        {!focusedCaseId && <div className="workflow-claim-filters">
          <label className="workflow-claim-search">Buscar<input type="search" value={search} placeholder="Unidad, chofer, placa, colilla o juzgado" onChange={(event) => setSearch(event.target.value)} /></label>
          <label>Fecha de juicio<select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)}><option value="all">Todas las fechas</option><option value="upcoming">Próximos casos</option><option value="today">Hoy</option><option value="last_week">Semana pasada</option><option value="overdue">Vencidos</option></select></label>
          <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CollisionTrialStatus | "all")}><option value="all">Todos</option><option>PENDIENTE</option><option>NUEVA FECHA</option><option>ABSUELTO</option><option>CULPABLE</option></select></label>
          <button type="button" className="button workflow-clear-filters" onClick={() => { setSearch(""); setDateFilter("all"); setStatusFilter("all"); }}>Limpiar filtros</button>
        </div>}
        {focusedCase && <div className="judicial-focused-context">
          <span><small>Unidad / placa</small><strong>{focusedCase.unit || "Sin unidad"} · {focusedCase.plate || "Sin placa"}</strong></span>
          <span><small>Cliente</small><strong>{focusedCase.clientName || focusedCase.driver || "Sin cliente"}</strong></span>
          <span><small>Fecha de juicio</small><strong>{focusedCase.trialDate || "Sin fecha"}</strong></span>
          <span className={`judicial-focused-status status-${focusedCase.status === "ABSUELTO" ? "absolved" : focusedCase.status === "CULPABLE" ? "guilty" : "pending"}`}><small>Estado</small><strong>{focusedCase.status}</strong></span>
        </div>}
        <div className="workflow-claims-list">
          {!loading && !cases.length && <p className="hint">Todavía no hay juicios guardados.</p>}
          {cases.length > 0 && !filteredCases.length && <p className="hint workflow-empty-filter">{focusedCaseId ? "No se encontró el juicio seleccionado." : "No hay juicios que coincidan con los filtros."}</p>}
          {filteredCases.map((item) => {
            const expanded = Boolean(focusedCaseId) || expandedId === item.id;
            const today = localDateKey(new Date());
            const requiresOutcome = Boolean(item.trialDate && item.trialDate <= today && !isFinalStatus(item.status));
            const outcome = outcomeDrafts[item.id] ?? "";
            const outcomeEvidenceFile = outcomeEvidenceFiles[item.id] ?? null;
            const followUpDraft = judicialFollowUpDrafts[item.id] ?? EMPTY_JUDICIAL_FOLLOW_UP;
            const activeCaseTab = judicialCaseTabs[item.id] ?? "management";
            return <article key={item.id} className={`workflow-claim-card${expanded ? " expanded" : ""}`}>
              {!focusedCaseId && <div className="workflow-claim-summary">
                <button type="button" className="workflow-claim-toggle" aria-expanded={expanded} onClick={() => { setExpandedId(expanded ? null : item.id); initializeCaseDrafts(item); }}>
                  <span className="workflow-claim-identity"><strong>{item.unit || "Sin unidad"} · {item.driver || "Sin chofer"}</strong><small>{item.plate || "Sin placa"}</small></span>
                  <span className="workflow-claim-reference"><strong>{item.court || "Sin juzgado"}</strong><small>Colilla: {item.ticketStub || "-"}</small></span>
                  <span className="workflow-claim-summary-value"><small>Fecha de juicio</small><strong>{item.trialDate || "Sin fecha"}</strong></span>
                  <span className="workflow-claim-summary-value"><small>Hora</small><strong>{item.placeTime || "-"}</strong></span>
                  <span className="workflow-claim-indicators"><span className={item.status === "ABSUELTO" ? "complete" : item.status === "CULPABLE" || requiresOutcome ? "missing" : "pending"}>{item.status}</span>{requiresOutcome && <span className="missing">Resultado requerido</span>}<span className={item.collisionAndRun ? "collision-runaway-yes" : "collision-runaway-no"}>Fuga: {item.collisionAndRun ? "Sí" : "No"}</span></span>
                  <span className="workflow-claim-chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
                </button>
              </div>}
              {expanded && <div className="workflow-claim-details">
                {requiresOutcome && <p className="collision-required-outcome" role="alert">La fecha del juicio llegó o está vencida. Debes registrar el resultado.</p>}
                <div className="judicial-case-tabs" role="tablist" aria-label="Secciones del expediente judicial">
                  <button type="button" role="tab" id={`judicial-management-tab-${item.id}`} aria-selected={activeCaseTab === "management"} aria-controls={`judicial-management-panel-${item.id}`} className={activeCaseTab === "management" ? "active" : ""} onClick={() => setJudicialCaseTabs((current) => ({ ...current, [item.id]: "management" }))}>Gestión del juicio</button>
                  <button type="button" role="tab" id={`judicial-follow-up-tab-${item.id}`} aria-selected={activeCaseTab === "follow_up"} aria-controls={`judicial-follow-up-panel-${item.id}`} className={activeCaseTab === "follow_up" ? "active" : ""} onClick={() => setJudicialCaseTabs((current) => ({ ...current, [item.id]: "follow_up" }))}>Seguimiento <span>{item.judicialFollowUps.length}</span></button>
                </div>
                {activeCaseTab === "management" && <div className="judicial-case-tab-panel judicial-case-tab-panel--management" role="tabpanel" id={`judicial-management-panel-${item.id}`} aria-labelledby={`judicial-management-tab-${item.id}`}>
                  <dl className="workflow-claim-detail-grid">
                  <div><dt>Fecha del incidente</dt><dd>{item.incidentDate}</dd></div><div><dt>Fecha de juicio</dt><dd>{item.trialDate}</dd></div>
                  <div><dt>Colilla</dt><dd>{item.ticketStub}</dd></div><div><dt>Juzgado</dt><dd>{item.court}</dd></div>
                  <div><dt>Colisión y fuga</dt><dd><span className={`collision-runaway-status ${item.collisionAndRun ? "collision-runaway-status--yes" : "collision-runaway-status--no"}`}>{item.collisionAndRun ? "Sí" : "No"}</span></dd></div>
                  <div><dt>Cliente del expediente</dt><dd>{item.clientName || item.driver || "-"}</dd></div>
                  <div className="workflow-claim-damage"><dt>Daños del auto</dt><dd>{item.vehicleDamage}</dd></div>
                  </dl>
                {!isFinalStatus(item.status) && <div className="workflow-finalization-panel collision-outcome-panel">
                  <div><strong>Resultado del juicio</strong><span>Selecciona el resultado para continuar el flujo.</span></div>
                  <label>Resultado<select value={outcome} onChange={(event) => setOutcomeDrafts((current) => ({ ...current, [item.id]: event.target.value as typeof outcome }))} disabled={readOnly || busyId === item.id}><option value="">Seleccionar</option><option>ABSUELTO</option><option>CULPABLE</option><option>NUEVA FECHA</option></select></label>
                  {(outcome === "ABSUELTO" || outcome === "CULPABLE") && <label className="collision-outcome-evidence">Documento que valida el resultado<input type="file" accept="image/*" onChange={(event) => selectOutcomeEvidence(item.id, event.target.files?.[0])} disabled={readOnly || busyId === item.id} /><small>{outcomeEvidenceFile ? `Seleccionado: ${outcomeEvidenceFile.name}` : "Obligatorio · imagen de hasta 10 MB"}</small></label>}
                  {outcome === "NUEVA FECHA" && <><label>Nueva fecha de juicio<input type="date" value={newTrialDates[item.id] ?? ""} onChange={(event) => setNewTrialDates((current) => ({ ...current, [item.id]: event.target.value }))} /></label><label className="workflow-finalization-reason">Razón de la nueva fecha<textarea value={rescheduleReasons[item.id] ?? ""} placeholder="La razón es obligatoria" onChange={(event) => setRescheduleReasons((current) => ({ ...current, [item.id]: event.target.value }))} /></label></>}
                  {outcome === "CULPABLE" && <label className="collision-client-returned-option"><input type="checkbox" checked={returnedBeforeClosure[item.id] === true} onChange={(event) => setReturnedBeforeClosure((current) => ({ ...current, [item.id]: event.target.checked }))} disabled={readOnly || busyId === item.id} /><span><strong>El cliente dejó el carro antes del cierre del caso</strong><small>Se cerrará el juicio sin generar una factura automática.</small></span></label>}
                  {outcome === "CULPABLE" && returnedBeforeClosure[item.id] !== true && <><label>Concepto de gastos<input value={expenseLabels[item.id] ?? `GASTOS DE JUICIO - ${item.unit}`} onChange={(event) => setExpenseLabels((current) => ({ ...current, [item.id]: event.target.value }))} /></label><label>Monto de gastos<input type="number" min="0.01" step="0.01" placeholder="0.00" value={expenseAmounts[item.id] ?? ""} onChange={(event) => setExpenseAmounts((current) => ({ ...current, [item.id]: event.target.value }))} /></label></>}
                  <div className="workflow-finalization-actions"><button type="button" className="button primary" onClick={() => void applyOutcome(item)} disabled={readOnly || busyId === item.id || !outcome || (outcome !== "NUEVA FECHA" && !outcomeEvidenceFile)}>{busyId === item.id ? "Guardando..." : "Confirmar resultado"}</button></div>
                </div>}
                {item.judicialOutcomeEvidence && <div className="collision-outcome-document"><div><strong>Documento del resultado: {item.status}</strong><span>{item.judicialOutcomeEvidence.name}</span><small>Guardado el {new Date(item.judicialOutcomeEvidence.uploadedAt).toLocaleString("es-PA")}</small></div><button type="button" className="button" onClick={() => void viewPhoto(item.judicialOutcomeEvidence!)}>Ver documento</button></div>}
                {item.trialDateHistory.length > 0 && <details className="workflow-edit-history" open><summary>Historial de fechas de juicio ({item.trialDateHistory.length})</summary><ul>{[...item.trialDateHistory].reverse().map((event) => <li key={`${event.changedAt}-${event.newDate}`}><time>{new Date(event.changedAt).toLocaleString("es-PA")}</time><span>{event.previousDate} → {event.newDate}: {event.reason}</span></li>)}</ul></details>}
                {item.status === "ABSUELTO" && <div className="collision-claim-panel">
                  <div><strong>Formulario de reclamo</strong><span>{item.insuranceClaim ? (item.insuranceClaim.claimNumber ? "Reclamo activo: ya cuenta con número de reclamo." : "Reclamo inactivo: todavía no cuenta con número de reclamo.") : "Puedes guardarlo como inactivo aunque todavía no tengas información del reclamo."}</span></div>
                  <div className="workflow-form-grid">
                    <label>Aseguradora<input value={(claimDrafts[item.id] ?? EMPTY_CLAIM).insurer} onChange={(event) => setClaimDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_CLAIM), insurer: event.target.value } }))} disabled={readOnly || busyId === item.id} /></label>
                    <label>Número de reclamo<input value={(claimDrafts[item.id] ?? EMPTY_CLAIM).claimNumber} onChange={(event) => setClaimDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_CLAIM), claimNumber: event.target.value } }))} disabled={readOnly || busyId === item.id} /></label>
                    <label>Monto<input type="number" min="0" step="0.01" value={(claimDrafts[item.id] ?? EMPTY_CLAIM).amount} onChange={(event) => setClaimDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_CLAIM), amount: event.target.value } }))} disabled={readOnly || busyId === item.id} /></label>
                    <label className="workflow-form-notes workflow-form-damage-photos">Fotos de los daños<input type="file" accept="image/*" multiple onChange={(event) => selectClaimPhotos(item.id, event.target.files, item.insuranceClaim?.photos.length ?? 0)} disabled={readOnly || busyId === item.id || (item.insuranceClaim?.photos.length ?? 0) >= MAX_PHOTOS} /><span className="hint">{(item.insuranceClaim?.photos.length ?? 0) + (claimPhotoFiles[item.id]?.length ?? 0)} de {MAX_PHOTOS} fotos</span></label>
                  </div>
                  {item.insuranceClaim?.photos.length ? <div className="workflow-damage-photo-list">{item.insuranceClaim.photos.map((photo, index) => <div key={photo.path} className="workflow-damage-photo-row"><div><strong>Foto {index + 1}</strong><small>{photo.name}</small></div><button type="button" className="button" onClick={() => void viewPhoto(photo)}>Ver foto</button></div>)}</div> : null}
                  {message && <p className="hint workflow-message" role="status">{message}</p>}
                  <div className="workflow-form-actions"><button type="button" className="button primary" onClick={() => void saveClaim(item)} disabled={readOnly || busyId === item.id}>{busyId === item.id ? "Guardando..." : "Guardar reclamo"}</button></div>
                </div>}
                {item.status === "CULPABLE" && item.expenseInvoice && <div className="collision-expense-invoice"><strong>Factura de gastos generada</strong><span>{item.expenseInvoice.label}</span><b>{USD_FORMATTER.format(item.expenseInvoice.amount)}</b><small>Agregada a otros cargos del cliente.</small></div>}
                {item.status === "CULPABLE" && item.clientReturnedBeforeClosure && <div className="collision-client-returned"><strong>Cliente retirado antes del cierre</strong><span>{item.clientName || item.driver || "El cliente"} dejó el carro antes de finalizar el juicio.</span><small>No se generó una factura automática.</small></div>}
                </div>}
                {activeCaseTab === "follow_up" && <section className="judicial-follow-up-panel judicial-case-tab-panel" role="tabpanel" id={`judicial-follow-up-panel-${item.id}`} aria-labelledby={`judicial-follow-up-tab-${item.id}`}>
                  <div className="judicial-follow-up-head"><div><strong>Timeline de seguimiento</strong><span>Registra cada gestión sin reemplazar las anteriores.</span></div><b>{item.judicialFollowUps.length} {item.judicialFollowUps.length === 1 ? "registro" : "registros"}</b></div>
                  {!isFinalStatus(item.status) && <div className="judicial-follow-up-form">
                    <label className="judicial-follow-up-comment">Novedad o gestión<textarea value={followUpDraft.comment} placeholder="Ej. Se llamó al juzgado y se confirmó la recepción de documentos" onChange={(event) => setJudicialFollowUpDrafts((current) => ({ ...current, [item.id]: { ...followUpDraft, comment: event.target.value } }))} disabled={readOnly || judicialFollowUpSavingId === item.id} /></label>
                    <label>Próximo paso<input value={followUpDraft.nextStep} placeholder="Ej. Entregar copia autenticada" onChange={(event) => setJudicialFollowUpDrafts((current) => ({ ...current, [item.id]: { ...followUpDraft, nextStep: event.target.value } }))} disabled={readOnly || judicialFollowUpSavingId === item.id} /></label>
                    <label>Próxima gestión<input type="date" min={today} value={followUpDraft.nextActionDate} onChange={(event) => setJudicialFollowUpDrafts((current) => ({ ...current, [item.id]: { ...followUpDraft, nextActionDate: event.target.value } }))} disabled={readOnly || judicialFollowUpSavingId === item.id} /></label>
                    <button type="button" className="button primary" onClick={() => void saveJudicialFollowUp(item)} disabled={readOnly || judicialFollowUpSavingId === item.id || !followUpDraft.comment.trim() || !followUpDraft.nextStep.trim() || !followUpDraft.nextActionDate}>{judicialFollowUpSavingId === item.id ? "Guardando..." : "Guardar seguimiento"}</button>
                  </div>}
                  {item.judicialFollowUps.length > 0 ? <ol className="judicial-follow-up-history">{[...item.judicialFollowUps].reverse().map((entry) => <li key={entry.id}><div><time>{new Date(entry.createdAt).toLocaleString("es-PA")}</time><span>Próxima gestión: <strong>{entry.nextActionDate}</strong></span></div><p>{entry.comment}</p><small>Próximo paso: <strong>{entry.nextStep}</strong></small></li>)}</ol> : <p className="judicial-follow-up-empty">Todavía no hay seguimientos registrados en este juicio.</p>}
                </section>}
              </div>}
            </article>;
          })}
        </div>
      </section>}
    </section>
  );
}
