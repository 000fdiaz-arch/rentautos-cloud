import { useEffect, useMemo, useState } from "react";
import {
  DuplicateInsuranceClaimNumberError,
  JudicialOutcomeRequiredForClaimError,
  createCollisionPhotoViewUrl,
  createInsuranceDamagePhotoViewUrl,
  loadCollisionCases,
  loadInsuranceClaims,
  loadInsuranceInsurers,
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
import type { Client, Payment } from "../types";
import { normalizeCourtName } from "../courtNames";
import { useControlUnitsRows } from "./controlUnits/useControlUnitsRows";
import IncidentPhotoGalleryModal from "./IncidentPhotoGalleryModal";
import { calculateCollisionCredit } from "./incidents/collisionBalanceRules";
import { availableJudicialCaseTabs, defaultJudicialCaseTab, type JudicialCaseTab } from "./incidents/judicialCaseNavigation";
import { buildJudicialCaseTimeline } from "./incidents/judicialCaseTimeline";

type Props = {
  clients: Client[];
  payments: Payment[];
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
function addCalendarDays(dateKey: string, days: number): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? new Date(`${dateKey}T12:00:00`) : new Date();
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}
function calendarDayOffset(value: string, today = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const target = new Date(`${value}T12:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.round((target.getTime() - current.getTime()) / 86_400_000);
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

export default function CollisionsPage({ clients, payments, dataOwnerUserId, readOnly = false, onClientsChange, embedded = false, syncInsuranceClaims = true, hideCreateForm = false, initialExpandedId = "", initialSearch = "", focusedCaseId = "" }: Props) {
  const { rows: fleetUnits, loading: fleetLoading, loadError: fleetLoadError } = useControlUnitsRows(hideCreateForm ? null : dataOwnerUserId);
  const [activeTab, setActiveTab] = useState<"form" | "agenda">(hideCreateForm ? "agenda" : "form");
  const [form, setForm] = useState<TrialForm>(EMPTY_FORM);
  const [cases, setCases] = useState<CollisionCaseRecord[]>([]);
  const [courts, setCourts] = useState<string[]>([]);
  const [insurers, setInsurers] = useState<string[]>([]);
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
  const [editingOutcomeEvidenceId, setEditingOutcomeEvidenceId] = useState<string | null>(null);
  const [resolutionEvidenceFiles, setResolutionEvidenceFiles] = useState<Record<string, File | null>>({});
  const [resolutionSearchDates, setResolutionSearchDates] = useState<Record<string, string>>({});
  const [editingResolutionId, setEditingResolutionId] = useState<string | null>(null);
  const [newTrialDates, setNewTrialDates] = useState<Record<string, string>>({});
  const [rescheduleReasons, setRescheduleReasons] = useState<Record<string, string>>({});
  const [expenseAmounts, setExpenseAmounts] = useState<Record<string, string>>({});
  const [expenseLabels, setExpenseLabels] = useState<Record<string, string>>({});
  const [expenseEvaluationDates, setExpenseEvaluationDates] = useState<Record<string, string>>({});
  const [expenseInvoiceFiles, setExpenseInvoiceFiles] = useState<Record<string, File | null>>({});
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [balanceEditJustification, setBalanceEditJustification] = useState("");
  const [returnedBeforeClosure, setReturnedBeforeClosure] = useState<Record<string, boolean>>({});
  const [claimDrafts, setClaimDrafts] = useState<Record<string, ClaimDraft>>({});
  const [claimPhotoFiles, setClaimPhotoFiles] = useState<Record<string, File[]>>({});
  const [judicialFollowUpDrafts, setJudicialFollowUpDrafts] = useState<Record<string, JudicialFollowUpDraft>>({});
  const [judicialFollowUpSavingId, setJudicialFollowUpSavingId] = useState("");
  const [judicialCaseTabs, setJudicialCaseTabs] = useState<Record<string, JudicialCaseTab>>({});
  const [attendanceDrafts, setAttendanceDrafts] = useState<Record<string, { clientWillAttend: "" | "yes" | "no"; legalAssistanceRequested: "" | "yes" | "no" }>>({});
  const [ticketStubDrafts, setTicketStubDrafts] = useState<Record<string, string>>({});
  const [vehicleInspectionDates, setVehicleInspectionDates] = useState<Record<string, string>>({});
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [caseEditForm, setCaseEditForm] = useState<TrialForm>(EMPTY_FORM);
  const [caseEditJustification, setCaseEditJustification] = useState("");
  const [caseEditSavingId, setCaseEditSavingId] = useState("");
  const [photoGallery, setPhotoGallery] = useState<{ photos: CollisionPhotoAttachment[]; index: number; title: string } | null>(null);

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
  const insurerOptions = useMemo(() => [...new Set([
    ...insurers,
    ...cases.map((item) => item.insuranceClaim?.insurer ?? "")
  ].map((insurer) => insurer.trim().toUpperCase()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" })), [cases, insurers]);

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
        setExpenseLabels(Object.fromEntries(nextCases.map((item) => [item.id, item.expenseInvoice?.description ?? ""] )));
        setExpenseAmounts(Object.fromEntries(nextCases.map((item) => [item.id, item.expenseInvoice ? String(item.expenseInvoice.amount) : ""])));
        setExpenseEvaluationDates(Object.fromEntries(nextCases.map((item) => [item.id, item.expenseInvoice?.evaluatedAt ?? localDateKey(new Date())])));
        setAttendanceDrafts(Object.fromEntries(nextCases.map((item) => [item.id, {
          clientWillAttend: item.clientWillAttend === true ? "yes" : item.clientWillAttend === false ? "no" : "",
          legalAssistanceRequested: item.legalAssistanceRequested === true ? "yes" : item.legalAssistanceRequested === false ? "no" : ""
        }])));
        setTicketStubDrafts(Object.fromEntries(nextCases.map((item) => [item.id, item.ticketStub])));
        setVehicleInspectionDates(Object.fromEntries(nextCases.map((item) => [item.id, item.vehicleInspectionDate ?? localDateKey(new Date())])));
        setResolutionSearchDates(Object.fromEntries(nextCases.map((item) => [item.id, item.judicialResolutionSearchDate ?? addCalendarDays((item.updatedAt || item.createdAt).slice(0, 10), 30)])));
      })
      .catch((error) => { if (!cancelled) { console.error("No se pudieron cargar los juicios.", error); setLoadError("No se pudieron cargar los juicios desde la nube."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId) { setInsurers([]); return; }
    let cancelled = false;
    loadInsuranceInsurers(dataOwnerUserId)
      .then((nextInsurers) => { if (!cancelled) setInsurers(nextInsurers); })
      .catch((error) => {
        if (cancelled) return;
        console.error("No se pudieron cargar las aseguradoras.", error);
        setMessage("No se pudo cargar el listado de aseguradoras desde la nube.");
      });
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
    setTicketStubDrafts((current) => ({ ...current, [item.id]: current[item.id] ?? item.ticketStub }));
    setVehicleInspectionDates((current) => ({ ...current, [item.id]: current[item.id] ?? item.vehicleInspectionDate ?? localDateKey(new Date()) }));
    setExpenseLabels((current) => ({ ...current, [item.id]: current[item.id] ?? item.expenseInvoice?.description ?? "" }));
    setExpenseAmounts((current) => ({ ...current, [item.id]: current[item.id] ?? (item.expenseInvoice ? String(item.expenseInvoice.amount) : "") }));
    setExpenseEvaluationDates((current) => ({ ...current, [item.id]: current[item.id] ?? item.expenseInvoice?.evaluatedAt ?? localDateKey(new Date()) }));
    setAttendanceDrafts((current) => ({ ...current, [item.id]: current[item.id] ?? {
      clientWillAttend: item.clientWillAttend === true ? "yes" : item.clientWillAttend === false ? "no" : "",
      legalAssistanceRequested: item.legalAssistanceRequested === true ? "yes" : item.legalAssistanceRequested === false ? "no" : ""
    } }));
    setClaimDrafts((current) => ({ ...current, [item.id]: current[item.id] ?? (item.insuranceClaim
      ? { insurer: item.insuranceClaim.insurer, claimNumber: item.insuranceClaim.claimNumber, amount: item.insuranceClaim.amount }
      : EMPTY_CLAIM) }));
  }

  async function addClaimInsurer(caseId: string): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId) return;
    const insurer = (window.prompt("Nombre de la nueva aseguradora") ?? "").trim().toUpperCase();
    if (!insurer) return;
    setBusyId(caseId); setMessage("");
    try {
      await saveInsuranceInsurer(dataOwnerUserId, insurer);
      setInsurers((current) => [...new Set([...current, insurer])]
        .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" })));
      setClaimDrafts((current) => ({
        ...current,
        [caseId]: { ...(current[caseId] ?? EMPTY_CLAIM), insurer }
      }));
    } catch (error) {
      console.error("No se pudo guardar la aseguradora.", error);
      setMessage("No se pudo guardar la aseguradora en la nube.");
    } finally {
      setBusyId("");
    }
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
      ticketStubHistory: [],
      editHistory: [],
      placeTime: form.placeTime.trim(),
      court: normalizeCourtName(form.court),
      collisionAndRun: form.collisionAndRun,
      status: "PENDIENTE",
      vehicleInspectionDate: null,
      vehicleInspectedAt: null,
      trialDateHistory: [],
      judicialFollowUps: [],
      clientWillAttend: null,
      legalAssistanceRequested: null,
      attendanceConfirmedAt: null,
      judicialOutcomeEvidence: null,
      judicialResolutionSearchDate: null,
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

  function startEditingCase(item: CollisionCaseRecord): void {
    setEditingCaseId(item.id);
    setCaseEditForm({
      incidentDate: item.incidentDate,
      unit: item.unit,
      driver: item.driver,
      plate: item.plate,
      trialDate: item.trialDate,
      vehicleDamage: item.vehicleDamage,
      ticketStub: item.ticketStub,
      placeTime: item.placeTime,
      court: item.court,
      collisionAndRun: item.collisionAndRun
    });
    setCaseEditJustification("");
    setMessage("");
  }

  function cancelCaseEdit(): void {
    setEditingCaseId(null);
    setCaseEditForm(EMPTY_FORM);
    setCaseEditJustification("");
  }

  async function saveCaseEdit(item: CollisionCaseRecord): Promise<void> {
    if (!dataOwnerUserId || readOnly || caseEditSavingId) return;
    if (!caseEditForm.incidentDate || !caseEditForm.unit.trim() || !caseEditForm.driver.trim() || !caseEditForm.plate.trim() || !caseEditForm.trialDate || !caseEditForm.vehicleDamage.trim() || !caseEditForm.ticketStub.trim() || !caseEditForm.placeTime.trim() || !caseEditForm.court.trim()) {
      setMessage("Completa todos los datos del siniestro antes de guardar la edición.");
      return;
    }
    if (!caseEditJustification.trim()) {
      setMessage("Debes indicar el motivo de la corrección antes de guardarla.");
      return;
    }

    const normalizedEdit: TrialForm = {
      ...caseEditForm,
      unit: normalizeUnit(caseEditForm.unit),
      driver: caseEditForm.driver.trim(),
      plate: caseEditForm.plate.trim().toUpperCase(),
      vehicleDamage: caseEditForm.vehicleDamage.trim(),
      ticketStub: caseEditForm.ticketStub.trim(),
      placeTime: caseEditForm.placeTime.trim(),
      court: normalizeCourtName(caseEditForm.court)
    };
    const fieldLabels: Array<[keyof TrialForm, string]> = [
      ["incidentDate", "Fecha del incidente"], ["unit", "Unidad"], ["driver", "Nombre completo"],
      ["plate", "Placa"], ["trialDate", "Fecha de juicio"], ["vehicleDamage", "Daños del auto"],
      ["ticketStub", "Número de colilla"], ["placeTime", "Lugar y hora"], ["court", "Juzgado"],
      ["collisionAndRun", "Colisión y fuga"]
    ];
    const changedFields = fieldLabels
      .filter(([field]) => normalizedEdit[field] !== item[field])
      .map(([, label]) => label);
    if (changedFields.length === 0) {
      setMessage("No hay cambios para guardar.");
      return;
    }

    const now = new Date().toISOString();
    const caseClient = clientsByUnit.get(normalizedEdit.unit);
    const updated: CollisionCaseRecord = {
      ...item,
      ...normalizedEdit,
      clientId: caseClient?.id ?? item.clientId ?? "",
      clientName: caseClient?.name ?? normalizedEdit.driver,
      editHistory: [...(item.editHistory ?? []), { editedAt: now, justification: caseEditJustification.trim(), changedFields }],
      updatedAt: now
    };

    setCaseEditSavingId(item.id);
    setMessage("");
    let previousLinkedClaim: InsuranceClaimRecord | null = null;
    try {
      const linkedClaimId = item.insuranceClaim?.insuranceClaimId;
      if (syncInsuranceClaims && linkedClaimId) {
        const linkedClaim = (await loadInsuranceClaims(dataOwnerUserId)).find((claim) => claim.id === linkedClaimId) ?? null;
        if (linkedClaim) {
          previousLinkedClaim = linkedClaim;
          await saveInsuranceClaim(dataOwnerUserId, {
            ...linkedClaim,
            incidentDate: updated.incidentDate,
            unit: updated.unit,
            driver: updated.driver,
            plate: updated.plate,
            vehicleDamage: updated.vehicleDamage,
            editHistory: [...linkedClaim.editHistory, {
              editedAt: now,
              justification: `Corrección sincronizada desde el expediente del siniestro: ${caseEditJustification.trim()}`
            }],
            updatedAt: now
          });
        }
      }
      await persistCase(updated, "Corrección del siniestro guardada correctamente.");
      setTicketStubDrafts((current) => ({ ...current, [item.id]: updated.ticketStub }));
      setCourts((current) => [...new Set([...current, updated.court])].sort((left, right) => left.localeCompare(right, "es", { numeric: true })));
      cancelCaseEdit();
    } catch (error) {
      if (previousLinkedClaim) {
        try { await saveInsuranceClaim(dataOwnerUserId, previousLinkedClaim); }
        catch (rollbackError) { console.error("No se pudo revertir la sincronización del reclamo.", rollbackError); }
      }
      console.error("No se pudo guardar la corrección del siniestro.", error);
      setMessage("No se pudo guardar la corrección del siniestro en la nube.");
    } finally {
      setCaseEditSavingId("");
    }
  }

  async function saveTicketStub(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId) return;
    const nextTicketStub = (ticketStubDrafts[item.id] ?? item.ticketStub).trim();
    if (!nextTicketStub) {
      setMessage("Indica el número de colilla.");
      return;
    }
    if (nextTicketStub === item.ticketStub) return;
    const now = new Date().toISOString();
    setBusyId(item.id);
    setMessage("");
    try {
      await persistCase({
        ...item,
        ticketStub: nextTicketStub,
        ticketStubHistory: [...(item.ticketStubHistory ?? []), {
          previousValue: item.ticketStub,
          newValue: nextTicketStub,
          changedAt: now
        }],
        updatedAt: now
      }, "Número de colilla actualizado correctamente.");
      setTicketStubDrafts((current) => ({ ...current, [item.id]: nextTicketStub }));
    } catch (error) {
      console.error("No se pudo actualizar el número de colilla.", error);
      setMessage("No se pudo actualizar el número de colilla.");
    } finally {
      setBusyId("");
    }
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
      await persistCase(updatedCase, "Nota judicial guardada correctamente.");
      setJudicialFollowUpDrafts((current) => ({ ...current, [item.id]: EMPTY_JUDICIAL_FOLLOW_UP }));
    } catch (error) {
      console.error("No se pudo guardar la nota judicial.", error);
      setMessage("No se pudo guardar la nota judicial.");
    } finally {
      setJudicialFollowUpSavingId("");
    }
  }

  async function confirmWorkshopInspection(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId || isFinalStatus(item.status) || item.vehicleInspectedAt) return;
    const inspectionDate = vehicleInspectionDates[item.id] ?? localDateKey(new Date());
    if (!inspectionDate || inspectionDate > localDateKey(new Date())) {
      setMessage("Indica una fecha válida, no futura, para la recepción y revisión del vehículo.");
      return;
    }
    const now = new Date().toISOString();
    setBusyId(item.id);
    setMessage("");
    try {
      await persistCase({
        ...item,
        vehicleInspectionDate: inspectionDate,
        vehicleInspectedAt: now,
        updatedAt: now
      }, "Vehículo recibido y revisado. Ya puedes registrar el saldo de colisión.");
      setJudicialCaseTabs((current) => ({ ...current, [item.id]: "balance" }));
    } catch (error) {
      console.error("No se pudo confirmar la revisión del vehículo.", error);
      setMessage("No se pudo confirmar la revisión del vehículo.");
    } finally {
      setBusyId("");
    }
  }

  function findCaseClientIndex(item: CollisionCaseRecord): number {
    const historicalClientIndex = item.clientId ? clients.findIndex((client) => client.id === item.clientId) : -1;
    const historicalClientName = normalizePersonName(item.clientName || item.driver);
    const namedClientIndex = historicalClientName
      ? clients.findIndex((client) => normalizePersonName(client.name) === historicalClientName)
      : -1;
    return historicalClientIndex >= 0
      ? historicalClientIndex
      : namedClientIndex >= 0
        ? namedClientIndex
        : clients.findIndex((client) => normalizeUnit(client.unitId) === normalizeUnit(item.unit));
  }

  async function saveAttendanceConfirmation(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId) return;
    const draft = attendanceDrafts[item.id];
    if (!draft?.clientWillAttend || !draft.legalAssistanceRequested) {
      setMessage("Responde si el cliente irá y si se pidió asistencia legal.");
      return;
    }
    setBusyId(item.id); setMessage("");
    try {
      await persistCase({
        ...item,
        clientWillAttend: draft.clientWillAttend === "yes",
        legalAssistanceRequested: draft.legalAssistanceRequested === "yes",
        attendanceConfirmedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, "Confirmación previa al juicio guardada.");
    } catch (error) {
      console.error("No se pudo guardar la confirmación previa al juicio.", error);
      setMessage("No se pudo guardar la confirmación previa al juicio.");
    } finally { setBusyId(""); }
  }

  async function saveCollisionBalance(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId || item.expenseInvoice) return;
    if (!item.vehicleInspectedAt) { setMessage("Confirma primero que el vehículo fue recibido y revisado en el taller."); return; }
    const amount = parseAmount(expenseAmounts[item.id] ?? "");
    const description = expenseLabels[item.id]?.trim() ?? "";
    const evaluatedAt = expenseEvaluationDates[item.id] ?? localDateKey(new Date());
    const clientIndex = findCaseClientIndex(item);
    if (amount <= 0) { setMessage("Indica el monto del saldo de colisión."); return; }
    if (!description) { setMessage("Describe brevemente el daño o la reparación."); return; }
    if (!evaluatedAt) { setMessage("Indica la fecha de evaluación del taller."); return; }
    if (clientIndex < 0) { setMessage("No se encontró el cliente asociado al siniestro."); return; }
    let uploadedInvoice: CollisionPhotoAttachment | null = null;
    setBusyId(item.id); setMessage("");
    try {
      const invoiceFile = expenseInvoiceFiles[item.id];
      if (invoiceFile) uploadedInvoice = await uploadCollisionPhoto(dataOwnerUserId, item.id, invoiceFile);
      const now = new Date().toISOString();
      const chargeId = `collision-expense-${item.id}`;
      const chargeLabel = `SALDO DE COLISIÓN - ${item.unit}`;
      const nextClients = clients.map((client, index) => index !== clientIndex ? client : ({
        ...client,
        otherCharges: [...client.otherCharges.filter((charge) => charge.id !== chargeId), { id: chargeId, label: chargeLabel, amount, createdAt: now }]
      }));
      const updatedCase: CollisionCaseRecord = {
        ...item,
        expenseInvoice: { chargeId, label: chargeLabel, description, amount, attachment: uploadedInvoice, evaluatedAt, creditedToRentAmount: 0, creditedToRentAt: null, editHistory: [], createdAt: now },
        updatedAt: now
      };
      await saveCollisionCase(dataOwnerUserId, updatedCase);
      try { await onClientsChange(nextClients); }
      catch (error) {
        try { await saveCollisionCase(dataOwnerUserId, item); } catch (rollbackError) { console.error("No se pudo revertir el saldo de colisión.", rollbackError); }
        throw error;
      }
      setCases((current) => current.map((candidate) => candidate.id === item.id ? updatedCase : candidate));
      setExpenseInvoiceFiles((current) => ({ ...current, [item.id]: null }));
      setMessage(`Saldo de colisión registrado por ${USD_FORMATTER.format(amount)}.`);
    } catch (error) {
      if (uploadedInvoice) { try { await removeCollisionPhotos([uploadedInvoice.path]); } catch { /* Limpieza de mejor esfuerzo. */ } }
      console.error("No se pudo registrar el saldo de colisión.", error);
      setMessage("No se pudo registrar el saldo de colisión.");
    } finally { setBusyId(""); }
  }

  function startEditingBalance(item: CollisionCaseRecord): void {
    if (!item.expenseInvoice) return;
    setEditingBalanceId(item.id);
    setExpenseAmounts((current) => ({ ...current, [item.id]: String(item.expenseInvoice!.amount) }));
    setExpenseLabels((current) => ({ ...current, [item.id]: item.expenseInvoice!.description || item.expenseInvoice!.label }));
    setExpenseEvaluationDates((current) => ({ ...current, [item.id]: item.expenseInvoice!.evaluatedAt || item.expenseInvoice!.createdAt.slice(0, 10) }));
    setExpenseInvoiceFiles((current) => ({ ...current, [item.id]: null }));
    setBalanceEditJustification("");
    setMessage("");
  }

  function cancelBalanceEdit(caseId: string): void {
    setEditingBalanceId(null);
    setExpenseInvoiceFiles((current) => ({ ...current, [caseId]: null }));
    setBalanceEditJustification("");
  }

  async function saveCollisionBalanceEdit(item: CollisionCaseRecord): Promise<void> {
    const invoice = item.expenseInvoice;
    if (readOnly || busyId || !dataOwnerUserId || !invoice) return;
    if (invoice.creditedToRentAt) {
      setMessage("Este saldo ya fue aplicado a la letra y no puede editarse desde el expediente.");
      return;
    }
    const amount = parseAmount(expenseAmounts[item.id] ?? "");
    const description = expenseLabels[item.id]?.trim() ?? "";
    const evaluatedAt = expenseEvaluationDates[item.id] ?? "";
    const replacementFile = expenseInvoiceFiles[item.id];
    if (amount <= 0) { setMessage("Indica un monto válido para el saldo de colisión."); return; }
    if (!description) { setMessage("Describe brevemente el daño o la reparación."); return; }
    if (!evaluatedAt) { setMessage("Indica la fecha de evaluación del taller."); return; }
    if (!balanceEditJustification.trim()) { setMessage("Indica el motivo de la corrección."); return; }

    const changedFields = [
      amount !== invoice.amount ? "Monto" : "",
      description !== (invoice.description || invoice.label) ? "Descripción" : "",
      evaluatedAt !== (invoice.evaluatedAt || invoice.createdAt.slice(0, 10)) ? "Fecha de evaluación" : "",
      replacementFile ? "Factura adjunta" : ""
    ].filter(Boolean);
    if (changedFields.length === 0) { setMessage("No hay cambios para guardar."); return; }

    const clientIndex = findCaseClientIndex(item);
    if (clientIndex < 0) { setMessage("No se encontró el cliente asociado al siniestro."); return; }
    const paidToCollision = Math.max(0, Math.round((payments
      .filter((payment) => payment.clientId === clients[clientIndex].id)
      .flatMap((payment) => payment.otherChargesApplied ?? [])
      .filter((charge) => charge.id === invoice.chargeId)
      .reduce((sum, charge) => sum + charge.amount, 0) + Number.EPSILON) * 100) / 100);
    if (amount < paidToCollision) {
      setMessage(`El monto no puede ser menor que ${USD_FORMATTER.format(paidToCollision)}, que ya fue pagado a este saldo.`);
      return;
    }

    let uploadedInvoice: CollisionPhotoAttachment | null = null;
    setBusyId(item.id);
    setMessage("");
    try {
      if (replacementFile) uploadedInvoice = await uploadCollisionPhoto(dataOwnerUserId, item.id, replacementFile);
      const now = new Date().toISOString();
      const pendingAmount = Math.max(0, Math.round(((amount - paidToCollision) + Number.EPSILON) * 100) / 100);
      const chargeLabel = `SALDO DE COLISIÓN - ${item.unit}`;
      const nextClients = clients.map((client, index) => {
        if (index !== clientIndex) return client;
        const otherCharges = client.otherCharges.filter((charge) => charge.id !== invoice.chargeId);
        if (pendingAmount > 0) otherCharges.push({ id: invoice.chargeId, label: chargeLabel, amount: pendingAmount, createdAt: invoice.createdAt });
        return { ...client, otherCharges };
      });
      const updatedCase: CollisionCaseRecord = {
        ...item,
        expenseInvoice: {
          ...invoice,
          label: chargeLabel,
          description,
          amount,
          evaluatedAt,
          attachment: uploadedInvoice ?? invoice.attachment ?? null,
          editHistory: [...(invoice.editHistory ?? []), {
            editedAt: now,
            justification: balanceEditJustification.trim(),
            changedFields,
            previousAmount: invoice.amount,
            newAmount: amount
          }]
        },
        updatedAt: now
      };
      await saveCollisionCase(dataOwnerUserId, updatedCase);
      try { await onClientsChange(nextClients); }
      catch (error) {
        try { await saveCollisionCase(dataOwnerUserId, item); } catch (rollbackError) { console.error("No se pudo revertir la edición del saldo.", rollbackError); }
        throw error;
      }
      if (uploadedInvoice && invoice.attachment?.path) {
        try { await removeCollisionPhotos([invoice.attachment.path]); }
        catch (cleanupError) { console.error("No se pudo eliminar la factura reemplazada.", cleanupError); }
      }
      setCases((current) => current.map((candidate) => candidate.id === item.id ? updatedCase : candidate));
      setExpenseInvoiceFiles((current) => ({ ...current, [item.id]: null }));
      setEditingBalanceId(null);
      setBalanceEditJustification("");
      setMessage("Saldo de colisión y cargo pendiente actualizados correctamente.");
    } catch (error) {
      if (uploadedInvoice) { try { await removeCollisionPhotos([uploadedInvoice.path]); } catch { /* Limpieza de mejor esfuerzo. */ } }
      console.error("No se pudo editar el saldo de colisión.", error);
      setMessage("No se pudo guardar la edición del saldo de colisión.");
    } finally { setBusyId(""); }
  }

  async function applyOutcome(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId) return;
    const today = localDateKey(new Date());
    if (!item.expenseInvoice) { setMessage("Registra primero el saldo de colisión."); return; }
    if (!item.trialDate || item.trialDate > today) { setMessage("El resultado solo puede registrarse a partir de la fecha del juicio."); return; }
    const outcome = outcomeDrafts[item.id];
    if (!outcome) { setMessage("Selecciona el resultado del juicio."); return; }
    const resolutionSearchDate = resolutionSearchDates[item.id] ?? addCalendarDays(today, 30);
    if (outcome === "ABSUELTO" && !/^\d{4}-\d{2}-\d{2}$/.test(resolutionSearchDate)) { setMessage("Indica la fecha para buscar la resolución judicial."); return; }
    const now = new Date().toISOString();
    let uploadedEvidence: CollisionPhotoAttachment | null = null;
    setBusyId(item.id); setMessage("");
    try {
      if (outcome === "CULPABLE" || outcome === "ABSUELTO") {
        const evidenceFile = outcomeEvidenceFiles[item.id];
        if (!evidenceFile) throw new Error("OUTCOME_EVIDENCE_REQUIRED");
        if (evidenceFile) uploadedEvidence = await uploadCollisionPhoto(dataOwnerUserId, item.id, evidenceFile);
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
          clientWillAttend: null,
          legalAssistanceRequested: null,
          attendanceConfirmedAt: null,
          judicialResolutionSearchDate: null,
          updatedAt: now
        }, "Nueva fecha de juicio guardada con su razón.");
        setAttendanceDrafts((current) => ({ ...current, [item.id]: { clientWillAttend: "", legalAssistanceRequested: "" } }));
      } else if (outcome === "ABSUELTO") {
        const clientIndex = findCaseClientIndex(item);
        const invoice = item.expenseInvoice;
        if (invoice && clientIndex < 0) throw new Error("CLIENT_NOT_FOUND");
        if (!invoice) {
          await persistCase({ ...item, status: "ABSUELTO", judicialOutcomeEvidence: uploadedEvidence, judicialResolutionEvidence: null, judicialResolutionSearchDate: resolutionSearchDate, updatedAt: now }, `Resultado ABSUELTO guardado. Buscar la resolución judicial el ${resolutionSearchDate}.`);
        } else {
          const currentClient = clients[clientIndex];
          const paidToCollision = Math.min(invoice.amount, Math.max(0, Math.round((payments
            .filter((payment) => payment.clientId === currentClient.id)
            .flatMap((payment) => payment.otherChargesApplied ?? [])
            .filter((charge) => charge.id === invoice.chargeId)
            .reduce((sum, charge) => sum + charge.amount, 0) + Number.EPSILON) * 100) / 100));
          const collisionCredit = calculateCollisionCredit({
            invoiceAmount: invoice.amount,
            paidToCollision,
            rentBalance: currentClient.balance,
            advanceBalance: currentClient.advanceBalance ?? 0,
            rentAmount: currentClient.rentAmount
          });
          const nextClients = clients.map((client, index) => index !== clientIndex ? client : ({
            ...client,
            balance: collisionCredit.balanceAfter,
            advanceBalance: collisionCredit.advanceBalanceAfter,
            installmentsPaid: client.installmentsPaid + collisionCredit.installmentsCovered,
            installmentsRemaining: Math.max(0, client.installmentsRemaining - collisionCredit.installmentsCovered),
            otherCharges: client.otherCharges.filter((charge) => charge.id !== invoice.chargeId)
          }));
          const updatedCase: CollisionCaseRecord = {
            ...item,
            status: "ABSUELTO",
            judicialOutcomeEvidence: uploadedEvidence,
            judicialResolutionEvidence: null,
            judicialResolutionSearchDate: resolutionSearchDate,
            expenseInvoice: { ...invoice, creditedToRentAmount: collisionCredit.creditedAmount, creditedToRentAt: now },
            updatedAt: now
          };
          await saveCollisionCase(dataOwnerUserId, updatedCase);
          try { await onClientsChange(nextClients); }
          catch (error) {
            try { await saveCollisionCase(dataOwnerUserId, item); } catch (rollbackError) { console.error("No se pudo revertir el crédito del saldo de colisión.", rollbackError); }
            throw error;
          }
          setCases((current) => current.map((candidate) => candidate.id === item.id ? updatedCase : candidate));
          setMessage(collisionCredit.creditedAmount > 0
            ? `Resultado ABSUELTO. ${USD_FORMATTER.format(collisionCredit.creditedAmount)} abonados a la colisión se aplicaron a la letra.`
            : "Resultado ABSUELTO. El saldo de colisión pendiente fue retirado.");
        }
      } else {
        const clientReturned = returnedBeforeClosure[item.id] === true;
        await persistCase({
          ...item,
          status: "CULPABLE",
          judicialOutcomeEvidence: uploadedEvidence,
          judicialResolutionSearchDate: null,
          clientReturnedBeforeClosure: clientReturned,
          clientReturnedBeforeClosureAt: clientReturned ? now : null,
          updatedAt: now
        }, clientReturned
          ? "Resultado CULPABLE guardado. El cliente dejó el carro antes del cierre."
          : "Resultado CULPABLE guardado. Los abonos permanecen aplicados al saldo de colisión.");
      }
      setOutcomeDrafts((current) => ({ ...current, [item.id]: "" }));
      setOutcomeEvidenceFiles((current) => ({ ...current, [item.id]: null }));
      setExpenseInvoiceFiles((current) => ({ ...current, [item.id]: null }));
    } catch (error) {
      if (error instanceof Error && error.message === "RESCHEDULE_REQUIRED") setMessage("Indica una fecha distinta y la razón obligatoria de la reprogramación.");
      else if (error instanceof Error && error.message === "OUTCOME_EVIDENCE_REQUIRED") setMessage("Adjunta la foto del documento que valida el resultado judicial.");
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

  function startEditingOutcomeEvidence(item: CollisionCaseRecord): void {
    setEditingOutcomeEvidenceId(item.id);
    setOutcomeEvidenceFiles((current) => ({ ...current, [item.id]: null }));
    setMessage("");
  }

  function cancelOutcomeEvidenceEdit(caseId: string): void {
    setEditingOutcomeEvidenceId(null);
    setOutcomeEvidenceFiles((current) => ({ ...current, [caseId]: null }));
    setMessage("");
  }

  async function saveOutcomeEvidence(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId || !isFinalStatus(item.status)) return;
    const file = outcomeEvidenceFiles[item.id];
    if (!file) { setMessage("Selecciona la foto o documento que valida el resultado judicial."); return; }
    let uploadedEvidence: CollisionPhotoAttachment | null = null;
    setBusyId(item.id); setMessage("");
    try {
      uploadedEvidence = await uploadCollisionPhoto(dataOwnerUserId, item.id, file);
      await persistCase(
        { ...item, judicialOutcomeEvidence: uploadedEvidence, updatedAt: new Date().toISOString() },
        item.judicialOutcomeEvidence ? "Documento del resultado reemplazado correctamente." : "Documento del resultado guardado correctamente."
      );
      if (item.judicialOutcomeEvidence?.path && item.judicialOutcomeEvidence.path !== uploadedEvidence.path) {
        try { await removeCollisionPhotos([item.judicialOutcomeEvidence.path]); }
        catch (cleanupError) { console.error("No se pudo eliminar el documento del resultado reemplazado.", cleanupError); }
      }
      setOutcomeEvidenceFiles((current) => ({ ...current, [item.id]: null }));
      setEditingOutcomeEvidenceId(null);
    } catch (error) {
      console.error("No se pudo guardar el documento del resultado.", error);
      setMessage("No se pudo guardar el documento del resultado judicial.");
      if (uploadedEvidence) {
        try { await removeCollisionPhotos([uploadedEvidence.path]); } catch { /* Limpieza de mejor esfuerzo. */ }
      }
    } finally { setBusyId(""); }
  }

  async function deleteOutcomeEvidence(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId || !item.judicialOutcomeEvidence) return;
    if (!window.confirm("¿Eliminar la foto o documento que valida el resultado judicial? El resultado del juicio no cambiará.")) return;
    const deletedEvidence = item.judicialOutcomeEvidence;
    setBusyId(item.id); setMessage("");
    try {
      await persistCase(
        { ...item, judicialOutcomeEvidence: null, updatedAt: new Date().toISOString() },
        "Documento del resultado eliminado. Puedes adjuntar el archivo correcto."
      );
      setOutcomeEvidenceFiles((current) => ({ ...current, [item.id]: null }));
      setEditingOutcomeEvidenceId(null);
      try { await removeCollisionPhotos([deletedEvidence.path]); }
      catch (cleanupError) { console.error("No se pudo eliminar el archivo anterior del resultado.", cleanupError); }
    } catch (error) {
      console.error("No se pudo eliminar el documento del resultado.", error);
      setMessage("No se pudo eliminar el documento del resultado judicial.");
    } finally { setBusyId(""); }
  }

  function selectExpenseInvoice(caseId: string, file: File | undefined): void {
    if (!file) {
      setExpenseInvoiceFiles((current) => ({ ...current, [caseId]: null }));
      return;
    }
    const accepted = file.type === "application/pdf" || file.type.startsWith("image/") || (!file.type && file.name.toLowerCase().endsWith(".pdf"));
    if (!accepted) {
      setExpenseInvoiceFiles((current) => ({ ...current, [caseId]: null }));
      setMessage("La factura debe ser un archivo PDF o una imagen.");
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      setExpenseInvoiceFiles((current) => ({ ...current, [caseId]: null }));
      setMessage("La factura debe pesar 10 MB o menos.");
      return;
    }
    setExpenseInvoiceFiles((current) => ({ ...current, [caseId]: file }));
    setMessage("");
  }

  function selectResolutionEvidence(caseId: string, file: File | undefined): void {
    if (!file) {
      setResolutionEvidenceFiles((current) => ({ ...current, [caseId]: null }));
      return;
    }
    if (!file.type.startsWith("image/") || file.size > MAX_PHOTO_SIZE) {
      setResolutionEvidenceFiles((current) => ({ ...current, [caseId]: null }));
      setMessage("La resolución debe ser una imagen de 10 MB o menos.");
      return;
    }
    setMessage("");
    setResolutionEvidenceFiles((current) => ({ ...current, [caseId]: file }));
  }

  async function saveJudicialResolution(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId || item.status !== "ABSUELTO") return;
    const file = resolutionEvidenceFiles[item.id];
    if (!file) { setMessage("Adjunta la resolución judicial para habilitar el reclamo al seguro."); return; }
    const searchDate = resolutionSearchDates[item.id] ?? item.judicialResolutionSearchDate ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(searchDate)) { setMessage("Indica la fecha programada para buscar la resolución judicial."); return; }
    let uploadedResolution: CollisionPhotoAttachment | null = null;
    setBusyId(item.id); setMessage("");
    try {
      uploadedResolution = await uploadCollisionPhoto(dataOwnerUserId, item.id, file);
      await persistCase(
        { ...item, judicialResolutionEvidence: uploadedResolution, judicialResolutionSearchDate: searchDate, updatedAt: new Date().toISOString() },
        item.judicialResolutionEvidence
          ? "Resolución judicial reemplazada correctamente."
          : "Resolución judicial guardada. Ya puedes iniciar el reclamo al seguro."
      );
      if (item.judicialResolutionEvidence?.path && item.judicialResolutionEvidence.path !== uploadedResolution.path) {
        try { await removeCollisionPhotos([item.judicialResolutionEvidence.path]); }
        catch (cleanupError) { console.error("No se pudo eliminar la resolución reemplazada.", cleanupError); }
      }
      setResolutionEvidenceFiles((current) => ({ ...current, [item.id]: null }));
      setEditingResolutionId(null);
    } catch (error) {
      console.error("No se pudo guardar la resolución judicial.", error);
      setMessage("No se pudo guardar la resolución judicial.");
      if (uploadedResolution) {
        try { await removeCollisionPhotos([uploadedResolution.path]); } catch { /* Limpieza de mejor esfuerzo. */ }
      }
    } finally { setBusyId(""); }
  }

  function startEditingResolution(item: CollisionCaseRecord): void {
    setEditingResolutionId(item.id);
    setResolutionEvidenceFiles((current) => ({ ...current, [item.id]: null }));
    setResolutionSearchDates((current) => ({
      ...current,
      [item.id]: current[item.id] ?? item.judicialResolutionSearchDate ?? addCalendarDays(localDateKey(new Date()), 30)
    }));
    setMessage("");
  }

  function cancelResolutionEdit(caseId: string): void {
    setEditingResolutionId(null);
    setResolutionEvidenceFiles((current) => ({ ...current, [caseId]: null }));
    setMessage("");
  }

  async function deleteJudicialResolution(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId || item.status !== "ABSUELTO" || !item.judicialResolutionEvidence) return;
    if (!window.confirm("¿Eliminar esta resolución judicial? El expediente volverá al paso Buscar resolución. Los datos del reclamo no se eliminarán.")) return;
    const deletedResolution = item.judicialResolutionEvidence;
    const searchDate = item.judicialResolutionSearchDate ?? addCalendarDays(localDateKey(new Date()), 30);
    setBusyId(item.id); setMessage("");
    try {
      await persistCase(
        { ...item, judicialResolutionEvidence: null, judicialResolutionSearchDate: searchDate, updatedAt: new Date().toISOString() },
        `Resolución eliminada. La búsqueda volvió a quedar programada para el ${searchDate}.`
      );
      setResolutionSearchDates((current) => ({ ...current, [item.id]: searchDate }));
      setResolutionEvidenceFiles((current) => ({ ...current, [item.id]: null }));
      setEditingResolutionId(null);
      try { await removeCollisionPhotos([deletedResolution.path]); }
      catch (cleanupError) { console.error("No se pudo eliminar el archivo anterior de la resolución.", cleanupError); }
    } catch (error) {
      console.error("No se pudo eliminar la resolución judicial.", error);
      setMessage("No se pudo eliminar la resolución judicial.");
    } finally { setBusyId(""); }
  }

  async function saveResolutionSearchDate(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId || item.status !== "ABSUELTO" || item.judicialResolutionEvidence) return;
    const searchDate = resolutionSearchDates[item.id] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(searchDate)) { setMessage("Indica una fecha válida para buscar la resolución judicial."); return; }
    setBusyId(item.id); setMessage("");
    try {
      await persistCase({ ...item, judicialResolutionSearchDate: searchDate, updatedAt: new Date().toISOString() }, `Fecha para buscar la resolución guardada: ${searchDate}.`);
    } catch (error) {
      console.error("No se pudo guardar la fecha para buscar la resolución.", error);
      setMessage("No se pudo guardar la fecha para buscar la resolución judicial.");
    } finally { setBusyId(""); }
  }

  function selectClaimPhotos(caseId: string, files: FileList | null, existingCount: number): void {
    const selected = Array.from(files ?? []).slice(0, Math.max(0, MAX_PHOTOS - existingCount));
    if (selected.some((file) => !file.type.startsWith("image/") || file.size > MAX_PHOTO_SIZE)) {
      setMessage("Las fotos deben ser imágenes de 10 MB o menos."); return;
    }
    setClaimPhotoFiles((current) => ({ ...current, [caseId]: selected }));
  }

  async function saveClaim(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId || item.status !== "ABSUELTO" || !item.judicialResolutionEvidence) return;
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

  const resolveGalleryPhotoUrl = async (photo: CollisionPhotoAttachment): Promise<string> => photo.storageBucket === "insurance-settlements"
    ? createInsuranceDamagePhotoViewUrl(photo.path, photo.storageBucket)
    : createCollisionPhotoViewUrl(photo.path);

  async function viewExpenseInvoice(attachment: CollisionPhotoAttachment): Promise<void> {
    if (attachment.mimeType.startsWith("image/")) {
      setPhotoGallery({ photos: [attachment], index: 0, title: "Factura del taller" });
      return;
    }
    const previewWindow = window.open("", "_blank");
    try {
      const url = await createCollisionPhotoViewUrl(attachment.path);
      if (previewWindow) previewWindow.location.href = url;
      else window.location.href = url;
    } catch (error) {
      previewWindow?.close();
      console.error("No se pudo abrir la factura adjunta.", error);
      setMessage("No se pudo abrir la factura adjunta.");
    }
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
            const availableCaseTabs = availableJudicialCaseTabs(item, today);
            const preferredCaseTab = judicialCaseTabs[item.id] ?? defaultJudicialCaseTab(item, today);
            const activeCaseTab = availableCaseTabs.includes(preferredCaseTab) ? preferredCaseTab : availableCaseTabs[0];
            const trialOffset = item.trialDate ? calendarDayOffset(item.trialDate) : null;
            const attendanceComplete = typeof item.clientWillAttend === "boolean" && typeof item.legalAssistanceRequested === "boolean";
            const attendanceDraft = attendanceDrafts[item.id] ?? { clientWillAttend: "", legalAssistanceRequested: "" };
            const timelineEvents = buildJudicialCaseTimeline(item);
            const caseTabOptions = ([
              ["summary", "Resumen", ""],
              ["attendance", "Asistencia", attendanceComplete ? "OK" : isFinalStatus(item.status) ? "Cerrado" : "Pendiente"],
              ["follow_up", "Notas", String(item.judicialFollowUps.length)],
              ["history", "Historial", String(timelineEvents.length)],
              ["workshop", "Taller", item.vehicleInspectedAt || item.expenseInvoice ? "OK" : "Pendiente"],
              ["balance", "Saldo", item.expenseInvoice ? "OK" : ""],
              ["outcome", "Resultado", item.status],
              ["insurance", "Seguro", item.insuranceClaim ? "Activo" : ""]
            ] as Array<[JudicialCaseTab, string, string]>).filter(([tab]) => availableCaseTabs.includes(tab));
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
                <label className="judicial-case-mobile-nav">Sección del expediente
                  <select value={activeCaseTab} onChange={(event) => setJudicialCaseTabs((current) => ({ ...current, [item.id]: event.target.value as JudicialCaseTab }))}>
                    {caseTabOptions.map(([tab, label, badge]) => <option key={tab} value={tab}>{label}{badge ? ` · ${badge}` : ""}</option>)}
                  </select>
                </label>
                <div className="judicial-case-tabs" role="tablist" aria-label="Secciones del expediente judicial">
                  {caseTabOptions.map(([tab, label, badge]) => (
                    <button type="button" role="tab" key={tab} id={`judicial-${tab}-tab-${item.id}`} aria-selected={activeCaseTab === tab} aria-controls={`judicial-${tab}-panel-${item.id}`} className={activeCaseTab === tab ? "active" : ""} onClick={() => setJudicialCaseTabs((current) => ({ ...current, [item.id]: tab }))}>{label}{badge ? <span>{badge}</span> : null}</button>
                  ))}
                </div>
                {activeCaseTab === "summary" && <div className="judicial-case-tab-panel judicial-case-tab-panel--summary" role="tabpanel" id={`judicial-summary-panel-${item.id}`} aria-labelledby={`judicial-summary-tab-${item.id}`}>
                  <div className="workflow-claim-detail-head">
                    <div><strong>Datos registrados del siniestro</strong><small>Corrige aquí la información ingresada por error.</small></div>
                    {editingCaseId !== item.id && <button type="button" className="button" onClick={() => startEditingCase(item)} disabled={readOnly || busyId === item.id || Boolean(caseEditSavingId)}>Editar siniestro</button>}
                  </div>
                  {editingCaseId === item.id ? <div className="workflow-claim-edit-panel">
                    <div className="workflow-claim-edit-grid">
                      <label>Fecha del incidente<input type="date" value={caseEditForm.incidentDate} onChange={(event) => setCaseEditForm((current) => ({ ...current, incidentDate: event.target.value }))} /></label>
                      <label>Unidad<input list="collision-edit-unit-options" value={caseEditForm.unit} onChange={(event) => setCaseEditForm((current) => ({ ...current, unit: event.target.value }))} /></label>
                      <label>Nombre completo<input value={caseEditForm.driver} onChange={(event) => setCaseEditForm((current) => ({ ...current, driver: event.target.value }))} /></label>
                      <label>Placa<input value={caseEditForm.plate} onChange={(event) => setCaseEditForm((current) => ({ ...current, plate: event.target.value }))} /></label>
                      <label>Fecha de juicio<input type="date" value={caseEditForm.trialDate} onChange={(event) => setCaseEditForm((current) => ({ ...current, trialDate: event.target.value }))} /></label>
                      <label>Número de colilla<input value={caseEditForm.ticketStub} onChange={(event) => setCaseEditForm((current) => ({ ...current, ticketStub: event.target.value }))} /></label>
                      <label>Lugar y hora<input value={caseEditForm.placeTime} onChange={(event) => setCaseEditForm((current) => ({ ...current, placeTime: event.target.value }))} /></label>
                      <label>Juzgado<input list="collision-edit-court-options" value={caseEditForm.court} onChange={(event) => setCaseEditForm((current) => ({ ...current, court: event.target.value }))} /></label>
                      <label className="collision-client-returned-option"><input type="checkbox" checked={caseEditForm.collisionAndRun} onChange={(event) => setCaseEditForm((current) => ({ ...current, collisionAndRun: event.target.checked }))} /><span><strong>Colisión y fuga</strong></span></label>
                      <label className="workflow-claim-edit-wide">Daños del auto<textarea value={caseEditForm.vehicleDamage} onChange={(event) => setCaseEditForm((current) => ({ ...current, vehicleDamage: event.target.value }))} /></label>
                      <label className="workflow-claim-edit-wide workflow-required-field">Motivo de la corrección<textarea value={caseEditJustification} placeholder="Explica qué información estaba errada y por qué se corrige" onChange={(event) => setCaseEditJustification(event.target.value)} /></label>
                    </div>
                    <datalist id="collision-edit-unit-options">{unitOptions.map((unitId) => <option key={unitId} value={unitId} label={unitOptionLabels.get(unitId) ?? ""} />)}</datalist>
                    <datalist id="collision-edit-court-options">{courts.map((court) => <option key={court} value={court} />)}</datalist>
                    <div className="workflow-claim-edit-actions">
                      <button type="button" className="button" onClick={cancelCaseEdit} disabled={caseEditSavingId === item.id}>Cancelar</button>
                      <button type="button" className="button primary" onClick={() => void saveCaseEdit(item)} disabled={!caseEditJustification.trim() || caseEditSavingId === item.id}>{caseEditSavingId === item.id ? "Guardando..." : "Guardar corrección"}</button>
                    </div>
                  </div> : <>
                  <dl className="workflow-claim-detail-grid">
                  <div><dt>Fecha del incidente</dt><dd>{item.incidentDate}</dd></div><div><dt>Fecha de juicio</dt><dd>{item.trialDate}</dd></div>
                  <div><dt>Número de colilla</dt><dd className="judicial-ticket-stub-editor"><div><input aria-label="Número de colilla" value={ticketStubDrafts[item.id] ?? item.ticketStub} onChange={(event) => setTicketStubDrafts((current) => ({ ...current, [item.id]: event.target.value }))} disabled={readOnly || busyId === item.id} /><button type="button" className="button small" onClick={() => void saveTicketStub(item)} disabled={readOnly || busyId === item.id || !(ticketStubDrafts[item.id] ?? item.ticketStub).trim() || (ticketStubDrafts[item.id] ?? item.ticketStub).trim() === item.ticketStub}>{busyId === item.id ? "Guardando..." : "Guardar"}</button></div>{item.ticketStubPhoto && <button type="button" className="button small" onClick={() => setPhotoGallery({ photos: [item.ticketStubPhoto!], index: 0, title: "Foto de la colilla" })}>Ver foto original</button>}</dd></div><div><dt>Juzgado</dt><dd>{item.court}</dd></div>
                  <div><dt>Colisión y fuga</dt><dd><span className={`collision-runaway-status ${item.collisionAndRun ? "collision-runaway-status--yes" : "collision-runaway-status--no"}`}>{item.collisionAndRun ? "Sí" : "No"}</span></dd></div>
                  <div><dt>Cliente del expediente</dt><dd>{item.clientName || item.driver || "-"}</dd></div>
                   <div className="workflow-claim-damage"><dt>Daños del auto</dt><dd>{item.vehicleDamage}</dd></div>
                   </dl>
                 {item.incidentPhotos?.length ? <div className="workflow-damage-photo-list workflow-damage-photo-list--compact"><div className="workflow-damage-photo-row"><div><strong>Fotos adjuntas al juicio</strong><small>{item.incidentPhotos.length} {item.incidentPhotos.length === 1 ? "foto disponible" : "fotos disponibles"}</small></div><button type="button" className="button" onClick={() => setPhotoGallery({ photos: item.incidentPhotos!, index: 0, title: "Fotos del juicio" })}>Ver galería</button></div></div> : null}
                  {(item.editHistory?.length ?? 0) > 0 && <details className="workflow-edit-history"><summary>Historial de correcciones ({item.editHistory!.length})</summary><ul>{[...item.editHistory!].reverse().map((event) => <li key={`${event.editedAt}-${event.justification}`}><time>{new Date(event.editedAt).toLocaleString("es-PA")}</time><span><strong>{event.changedFields.join(", ")}</strong>: {event.justification}</span></li>)}</ul></details>}
                  </>}
                </div>}
                {activeCaseTab === "attendance" && <div className="judicial-case-tab-panel" role="tabpanel" id={`judicial-attendance-panel-${item.id}`} aria-labelledby={`judicial-attendance-tab-${item.id}`}>
                 {!isFinalStatus(item.status) && <div className={`workflow-finalization-panel collision-attendance-panel${attendanceComplete ? " is-complete" : " is-pending"}`}>
                  <div><strong>Confirmación previa al juicio</strong><span>{attendanceComplete ? (item.attendanceConfirmedAt ? `Confirmado el ${new Date(item.attendanceConfirmedAt).toLocaleString("es-PA")}` : "Confirmación guardada") : trialOffset !== null && trialOffset <= 10 ? "La confirmación ya está pendiente y requiere atención." : "Debe quedar completada como mínimo 10 días antes del juicio."}</span></div>
                  <label>¿El cliente irá?<select value={attendanceDraft.clientWillAttend} onChange={(event) => setAttendanceDrafts((current) => ({ ...current, [item.id]: { ...attendanceDraft, clientWillAttend: event.target.value as "" | "yes" | "no" } }))} disabled={readOnly || busyId === item.id}><option value="">Seleccionar</option><option value="yes">Sí</option><option value="no">No</option></select></label>
                  <label>¿Se pidió asistencia legal?<select value={attendanceDraft.legalAssistanceRequested} onChange={(event) => setAttendanceDrafts((current) => ({ ...current, [item.id]: { ...attendanceDraft, legalAssistanceRequested: event.target.value as "" | "yes" | "no" } }))} disabled={readOnly || busyId === item.id}><option value="">Seleccionar</option><option value="yes">Sí</option><option value="no">No</option></select></label>
                  <div className="workflow-finalization-actions"><button type="button" className="button primary" onClick={() => void saveAttendanceConfirmation(item)} disabled={readOnly || busyId === item.id || !attendanceDraft.clientWillAttend || !attendanceDraft.legalAssistanceRequested}>{busyId === item.id ? "Guardando..." : attendanceComplete ? "Actualizar confirmación" : "Guardar confirmación"}</button></div>
                 </div>}
                 {isFinalStatus(item.status) && <p className="judicial-section-empty">La confirmación previa ya no se puede modificar porque el juicio está finalizado.</p>}
                </div>}
                {activeCaseTab === "workshop" && <div className="judicial-case-tab-panel" role="tabpanel" id={`judicial-workshop-panel-${item.id}`} aria-labelledby={`judicial-workshop-tab-${item.id}`}>
                 {!item.vehicleInspectedAt && !item.expenseInvoice && !isFinalStatus(item.status) && <div className="workflow-finalization-panel collision-workshop-panel">
                  <div><strong>Recepción y revisión del vehículo</strong><span>Confirma que el cliente llevó el carro al taller y que su estado fue verificado.</span></div>
                  <label>Fecha de recepción y revisión<input type="date" max={today} value={vehicleInspectionDates[item.id] ?? today} onChange={(event) => setVehicleInspectionDates((current) => ({ ...current, [item.id]: event.target.value }))} disabled={readOnly || busyId === item.id} /></label>
                  <div className="workflow-finalization-actions"><button type="button" className="button primary" onClick={() => void confirmWorkshopInspection(item)} disabled={readOnly || busyId === item.id || !vehicleInspectionDates[item.id]}>{busyId === item.id ? "Guardando..." : "Confirmar vehículo revisado"}</button></div>
                 </div>}
                 {item.vehicleInspectedAt && <div className="collision-workshop-complete"><strong>Vehículo recibido y revisado</strong><span>Fecha de revisión: {item.vehicleInspectionDate || item.vehicleInspectedAt.slice(0, 10)}</span><small>Confirmado el {new Date(item.vehicleInspectedAt).toLocaleString("es-PA")}. El saldo de colisión está habilitado.</small></div>}
                 {!item.vehicleInspectedAt && item.expenseInvoice && <div className="collision-workshop-complete"><strong>Revisión de taller completada</strong><span>Este expediente ya cuenta con un saldo de colisión registrado.</span><small>Se reconoce como un caso anterior a la confirmación obligatoria del taller.</small></div>}
                </div>}
                {activeCaseTab === "balance" && <div className="judicial-case-tab-panel" role="tabpanel" id={`judicial-balance-panel-${item.id}`} aria-labelledby={`judicial-balance-tab-${item.id}`}>
                 {!item.expenseInvoice && !isFinalStatus(item.status) && <div className="workflow-finalization-panel collision-balance-panel">
                  <div><strong>Saldo de colisión</strong><span>Registra el costo determinado después de la evaluación del taller.</span></div>
                  <label>Fecha de evaluación<input type="date" value={expenseEvaluationDates[item.id] ?? today} onChange={(event) => setExpenseEvaluationDates((current) => ({ ...current, [item.id]: event.target.value }))} disabled={readOnly || busyId === item.id} /></label>
                  <label className="workflow-required-field">Monto obligatorio<input type="number" min="0.01" step="0.01" placeholder="0.00" value={expenseAmounts[item.id] ?? ""} onChange={(event) => setExpenseAmounts((current) => ({ ...current, [item.id]: event.target.value }))} disabled={readOnly || busyId === item.id} /></label>
                  <label className="workflow-finalization-reason workflow-required-field">Descripción del daño o reparación (obligatoria)<textarea value={expenseLabels[item.id] ?? ""} placeholder="Ej. Reparación de guardafango y pintura" onChange={(event) => setExpenseLabels((current) => ({ ...current, [item.id]: event.target.value }))} disabled={readOnly || busyId === item.id} /></label>
                  <label className="collision-outcome-evidence">Factura del taller (opcional)<input type="file" accept="application/pdf,image/*,.pdf" onChange={(event) => selectExpenseInvoice(item.id, event.target.files?.[0])} disabled={readOnly || busyId === item.id} /><small>{expenseInvoiceFiles[item.id] ? `Seleccionada: ${expenseInvoiceFiles[item.id]!.name}` : "Adjunta PDF o imagen de hasta 10 MB"}</small></label>
                  <div className="workflow-finalization-actions"><button type="button" className="button primary" onClick={() => void saveCollisionBalance(item)} disabled={readOnly || busyId === item.id}>{busyId === item.id ? "Guardando..." : "Registrar saldo de colisión"}</button></div>
                 </div>}
                 {item.expenseInvoice && editingBalanceId !== item.id && <div className="collision-expense-invoice"><strong>Saldo de colisión registrado</strong><span>{item.expenseInvoice.description || item.expenseInvoice.label}</span><b>{USD_FORMATTER.format(item.expenseInvoice.amount)}</b><small>{item.expenseInvoice.creditedToRentAt ? `${USD_FORMATTER.format(item.expenseInvoice.creditedToRentAmount ?? 0)} transferidos a la letra al ganar el juicio.` : `Evaluado el ${item.expenseInvoice.evaluatedAt || item.expenseInvoice.createdAt.slice(0, 10)} · cobro activo en otros cargos.`}</small><div className="collision-expense-invoice-actions">{item.expenseInvoice.attachment && <button type="button" className="button" onClick={() => void viewExpenseInvoice(item.expenseInvoice!.attachment!)}>Ver factura adjunta</button>}<button type="button" className="button primary" onClick={() => startEditingBalance(item)} disabled={readOnly || busyId === item.id || Boolean(item.expenseInvoice.creditedToRentAt)} title={item.expenseInvoice.creditedToRentAt ? "El saldo ya fue aplicado a la letra" : "Editar saldo y factura"}>Editar saldo y factura</button></div></div>}
                 {item.expenseInvoice && editingBalanceId === item.id && <div className="workflow-finalization-panel collision-balance-panel collision-balance-edit-panel">
                  <div><strong>Editar saldo y factura de colisión</strong><span>La corrección actualizará también el cargo pendiente del cliente.</span></div>
                  <label>Fecha de evaluación<input type="date" value={expenseEvaluationDates[item.id] ?? ""} onChange={(event) => setExpenseEvaluationDates((current) => ({ ...current, [item.id]: event.target.value }))} disabled={busyId === item.id} /></label>
                  <label>Monto total<input type="number" min="0.01" step="0.01" value={expenseAmounts[item.id] ?? ""} onChange={(event) => setExpenseAmounts((current) => ({ ...current, [item.id]: event.target.value }))} disabled={busyId === item.id} /></label>
                  <label className="workflow-finalization-reason">Descripción del daño o reparación<textarea value={expenseLabels[item.id] ?? ""} onChange={(event) => setExpenseLabels((current) => ({ ...current, [item.id]: event.target.value }))} disabled={busyId === item.id} /></label>
                  <label className="collision-outcome-evidence">Reemplazar factura adjunta<input type="file" accept="application/pdf,image/*,.pdf" onChange={(event) => selectExpenseInvoice(item.id, event.target.files?.[0])} disabled={busyId === item.id} /><small>{expenseInvoiceFiles[item.id] ? `Nueva factura: ${expenseInvoiceFiles[item.id]!.name}` : item.expenseInvoice.attachment ? `Actual: ${item.expenseInvoice.attachment.name} · selecciona un archivo para reemplazarla` : "No hay factura actual · puedes adjuntar PDF o imagen de hasta 10 MB"}</small></label>
                  <label className="workflow-finalization-reason workflow-required-field">Motivo de la corrección<textarea value={balanceEditJustification} placeholder="Explica qué dato o factura estaba errado" onChange={(event) => setBalanceEditJustification(event.target.value)} disabled={busyId === item.id} /></label>
                  <div className="workflow-finalization-actions"><button type="button" className="button" onClick={() => cancelBalanceEdit(item.id)} disabled={busyId === item.id}>Cancelar</button><button type="button" className="button primary" onClick={() => void saveCollisionBalanceEdit(item)} disabled={busyId === item.id || !balanceEditJustification.trim()}>{busyId === item.id ? "Guardando..." : "Guardar corrección"}</button></div>
                 </div>}
                 {(item.expenseInvoice?.editHistory?.length ?? 0) > 0 && editingBalanceId !== item.id && <details className="workflow-edit-history"><summary>Historial de correcciones del saldo ({item.expenseInvoice!.editHistory!.length})</summary><ul>{[...item.expenseInvoice!.editHistory!].reverse().map((event) => <li key={`${event.editedAt}-${event.justification}`}><time>{new Date(event.editedAt).toLocaleString("es-PA")}</time><span><strong>{event.changedFields.join(", ")}</strong>{event.previousAmount !== event.newAmount ? ` · ${USD_FORMATTER.format(event.previousAmount)} → ${USD_FORMATTER.format(event.newAmount)}` : ""}: {event.justification}</span></li>)}</ul></details>}
                 {!item.expenseInvoice && isFinalStatus(item.status) && <p className="judicial-section-empty">No se registró saldo de colisión antes de finalizar el juicio.</p>}
                </div>}
                {activeCaseTab === "outcome" && <div className="judicial-case-tab-panel" role="tabpanel" id={`judicial-outcome-panel-${item.id}`} aria-labelledby={`judicial-outcome-tab-${item.id}`}>
                 {!isFinalStatus(item.status) && <div className="workflow-finalization-panel collision-outcome-panel">
                  <div><strong>Resultado del juicio</strong><span>Selecciona el resultado para continuar el flujo.</span></div>
                  <label>Resultado<select value={outcome} onChange={(event) => { const nextOutcome = event.target.value as typeof outcome; setOutcomeDrafts((current) => ({ ...current, [item.id]: nextOutcome })); if (nextOutcome === "ABSUELTO") setResolutionSearchDates((current) => ({ ...current, [item.id]: current[item.id] ?? addCalendarDays(today, 30) })); }} disabled={readOnly || busyId === item.id}><option value="">Seleccionar</option><option>ABSUELTO</option><option>CULPABLE</option><option>NUEVA FECHA</option></select></label>
                  {outcome === "ABSUELTO" && <label className="workflow-required-field">Fecha para buscar la resolución<input type="date" min={today} value={resolutionSearchDates[item.id] ?? addCalendarDays(today, 30)} onChange={(event) => setResolutionSearchDates((current) => ({ ...current, [item.id]: event.target.value }))} disabled={readOnly || busyId === item.id} /><small>Se propone automáticamente 30 días después de registrar el resultado.</small></label>}
                  {(outcome === "ABSUELTO" || outcome === "CULPABLE") && <label className="collision-outcome-evidence workflow-required-field">Foto o documento que valida el resultado<input type="file" accept="image/*" onChange={(event) => selectOutcomeEvidence(item.id, event.target.files?.[0])} disabled={readOnly || busyId === item.id} /><small>{outcomeEvidenceFile ? `Seleccionado: ${outcomeEvidenceFile.name}` : "Obligatorio · esta evidencia es distinta de la resolución judicial · imagen de hasta 10 MB"}</small></label>}
                  {outcome === "NUEVA FECHA" && <><label>Nueva fecha de juicio<input type="date" value={newTrialDates[item.id] ?? ""} onChange={(event) => setNewTrialDates((current) => ({ ...current, [item.id]: event.target.value }))} /></label><label className="workflow-finalization-reason">Razón de la nueva fecha<textarea value={rescheduleReasons[item.id] ?? ""} placeholder="La razón es obligatoria" onChange={(event) => setRescheduleReasons((current) => ({ ...current, [item.id]: event.target.value }))} /></label></>}
                  {outcome === "CULPABLE" && <label className="collision-client-returned-option"><input type="checkbox" checked={returnedBeforeClosure[item.id] === true} onChange={(event) => setReturnedBeforeClosure((current) => ({ ...current, [item.id]: event.target.checked }))} disabled={readOnly || busyId === item.id} /><span><strong>El cliente dejó el carro antes del cierre del caso</strong><small>El resultado se guardará en el expediente.</small></span></label>}
                  <div className="workflow-finalization-actions"><button type="button" className="button primary" onClick={() => void applyOutcome(item)} disabled={readOnly || busyId === item.id || !outcome || ((outcome === "ABSUELTO" || outcome === "CULPABLE") && !outcomeEvidenceFile)}>{busyId === item.id ? "Guardando..." : "Confirmar resultado"}</button></div>
                </div>}
                {isFinalStatus(item.status) && !item.judicialOutcomeEvidence && <div className="workflow-finalization-panel collision-outcome-panel"><div><strong>Foto o documento del resultado: {item.status}</strong><span>Adjunta la evidencia que confirma el resultado del juicio. No es la resolución judicial.</span></div><label className="collision-outcome-evidence workflow-required-field">Evidencia del resultado<input type="file" accept="image/*" onChange={(event) => selectOutcomeEvidence(item.id, event.target.files?.[0])} disabled={readOnly || busyId === item.id} /><small>{outcomeEvidenceFiles[item.id] ? `Seleccionada: ${outcomeEvidenceFiles[item.id]!.name}` : "Imagen de hasta 10 MB"}</small></label><div className="workflow-finalization-actions"><button type="button" className="button primary" onClick={() => void saveOutcomeEvidence(item)} disabled={readOnly || busyId === item.id || !outcomeEvidenceFiles[item.id]}>{busyId === item.id ? "Guardando..." : "Guardar evidencia del resultado"}</button></div></div>}
                {item.judicialOutcomeEvidence && editingOutcomeEvidenceId !== item.id && <div className="collision-outcome-document"><div><strong>Documento del resultado: {item.status}</strong><span>{item.judicialOutcomeEvidence.name}</span><small>Guardado el {new Date(item.judicialOutcomeEvidence.uploadedAt).toLocaleString("es-PA")} · no es la resolución judicial</small></div><div className="workflow-finalization-actions"><button type="button" className="button" onClick={() => setPhotoGallery({ photos: [item.judicialOutcomeEvidence!], index: 0, title: `Documento del resultado: ${item.status}` })}>Ver documento</button><button type="button" className="button primary" onClick={() => startEditingOutcomeEvidence(item)} disabled={readOnly || busyId === item.id}>Editar evidencia</button><button type="button" className="button danger" onClick={() => void deleteOutcomeEvidence(item)} disabled={readOnly || busyId === item.id}>Eliminar evidencia</button></div></div>}
                {item.judicialOutcomeEvidence && editingOutcomeEvidenceId === item.id && <div className="workflow-finalization-panel collision-outcome-panel"><div><strong>Editar evidencia del resultado</strong><span>Selecciona la foto o documento correcto para reemplazar el archivo actual.</span></div><label className="collision-outcome-evidence workflow-required-field">Reemplazar evidencia<input type="file" accept="image/*" onChange={(event) => selectOutcomeEvidence(item.id, event.target.files?.[0])} disabled={busyId === item.id} /><small>{outcomeEvidenceFiles[item.id] ? `Nueva evidencia: ${outcomeEvidenceFiles[item.id]!.name}` : `Actual: ${item.judicialOutcomeEvidence.name}`}</small></label><div className="workflow-finalization-actions"><button type="button" className="button" onClick={() => cancelOutcomeEvidenceEdit(item.id)} disabled={busyId === item.id}>Cancelar</button><button type="button" className="button primary" onClick={() => void saveOutcomeEvidence(item)} disabled={busyId === item.id || !outcomeEvidenceFiles[item.id]}>{busyId === item.id ? "Guardando..." : "Guardar reemplazo"}</button></div></div>}
                {item.status === "ABSUELTO" && !item.judicialResolutionEvidence && <div className="workflow-finalization-panel collision-outcome-panel"><div><strong>Buscar resolución judicial</strong><span>Este es el paso previo obligatorio para habilitar el reclamo al seguro.</span></div><label className="workflow-required-field">Fecha programada para buscarla<input type="date" value={resolutionSearchDates[item.id] ?? item.judicialResolutionSearchDate ?? ""} onChange={(event) => setResolutionSearchDates((current) => ({ ...current, [item.id]: event.target.value }))} disabled={readOnly || busyId === item.id} /><small>La fecha sugerida es 30 días después del resultado; puedes ajustarla.</small></label><label className="collision-outcome-evidence">Resolución judicial<input type="file" accept="image/*" onChange={(event) => selectResolutionEvidence(item.id, event.target.files?.[0])} disabled={readOnly || busyId === item.id} /><small>{resolutionEvidenceFiles[item.id] ? `Seleccionada: ${resolutionEvidenceFiles[item.id]!.name}` : "Adjunta la resolución · imagen de hasta 10 MB"}</small></label><div className="workflow-finalization-actions"><button type="button" className="button" onClick={() => void saveResolutionSearchDate(item)} disabled={readOnly || busyId === item.id || !resolutionSearchDates[item.id] || resolutionSearchDates[item.id] === item.judicialResolutionSearchDate}>{busyId === item.id ? "Guardando..." : "Guardar fecha"}</button><button type="button" className="button primary" onClick={() => void saveJudicialResolution(item)} disabled={readOnly || busyId === item.id || !resolutionEvidenceFiles[item.id]}>{busyId === item.id ? "Guardando..." : "Guardar resolución"}</button></div></div>}
                {item.judicialResolutionEvidence && editingResolutionId !== item.id && <div className="collision-outcome-document"><div><strong>Resolución judicial registrada</strong><span>{item.judicialResolutionEvidence.name}</span><small>El reclamo al seguro está habilitado.</small></div><div className="workflow-finalization-actions"><button type="button" className="button" onClick={() => setPhotoGallery({ photos: [item.judicialResolutionEvidence!], index: 0, title: "Resolución judicial" })}>Ver resolución</button><button type="button" className="button primary" onClick={() => startEditingResolution(item)} disabled={readOnly || busyId === item.id}>Editar resolución</button><button type="button" className="button danger" onClick={() => void deleteJudicialResolution(item)} disabled={readOnly || busyId === item.id}>Eliminar resolución</button></div></div>}
                {item.judicialResolutionEvidence && editingResolutionId === item.id && <div className="workflow-finalization-panel collision-outcome-panel"><div><strong>Editar resolución judicial</strong><span>Selecciona el archivo correcto para reemplazar la resolución actual.</span></div><label className="workflow-required-field">Fecha en que se buscó la resolución<input type="date" value={resolutionSearchDates[item.id] ?? item.judicialResolutionSearchDate ?? ""} onChange={(event) => setResolutionSearchDates((current) => ({ ...current, [item.id]: event.target.value }))} disabled={busyId === item.id} /></label><label className="collision-outcome-evidence">Reemplazar resolución<input type="file" accept="image/*" onChange={(event) => selectResolutionEvidence(item.id, event.target.files?.[0])} disabled={busyId === item.id} /><small>{resolutionEvidenceFiles[item.id] ? `Nueva resolución: ${resolutionEvidenceFiles[item.id]!.name}` : `Actual: ${item.judicialResolutionEvidence.name}`}</small></label><div className="workflow-finalization-actions"><button type="button" className="button" onClick={() => cancelResolutionEdit(item.id)} disabled={busyId === item.id}>Cancelar</button><button type="button" className="button primary" onClick={() => void saveJudicialResolution(item)} disabled={busyId === item.id || !resolutionEvidenceFiles[item.id]}>{busyId === item.id ? "Guardando..." : "Guardar reemplazo"}</button></div></div>}
                {item.trialDateHistory.length > 0 && <details className="workflow-edit-history" open><summary>Historial de fechas de juicio ({item.trialDateHistory.length})</summary><ul>{[...item.trialDateHistory].reverse().map((event) => <li key={`${event.changedAt}-${event.newDate}`}><time>{new Date(event.changedAt).toLocaleString("es-PA")}</time><span>{event.previousDate} → {event.newDate}: {event.reason}</span></li>)}</ul></details>}
                {item.status === "CULPABLE" && item.clientReturnedBeforeClosure && <div className="collision-client-returned"><strong>Cliente retirado antes del cierre</strong><span>{item.clientName || item.driver || "El cliente"} dejó el carro antes de finalizar el juicio.</span><small>No se generó una factura automática.</small></div>}
                </div>}
                {activeCaseTab === "insurance" && <div className="judicial-case-tab-panel" role="tabpanel" id={`judicial-insurance-panel-${item.id}`} aria-labelledby={`judicial-insurance-tab-${item.id}`}>
                {item.status !== "ABSUELTO" && <p className="judicial-section-empty">El reclamo al seguro se habilita después de registrar el resultado ABSUELTO y adjuntar la resolución judicial.</p>}
                {item.status === "ABSUELTO" && !item.judicialResolutionEvidence && <p className="judicial-section-empty">Adjunta primero la resolución judicial en la sección Resultado.</p>}
                {item.status === "ABSUELTO" && item.judicialResolutionEvidence && <div className="collision-claim-panel">
                  <div><strong>Formulario de reclamo</strong><span>{item.insuranceClaim ? (item.insuranceClaim.claimNumber ? "Reclamo activo: ya cuenta con número de reclamo." : "Reclamo inactivo: todavía no cuenta con número de reclamo.") : "Puedes guardarlo como inactivo aunque todavía no tengas información del reclamo."}</span></div>
                  <div className="workflow-form-grid">
                    <label>Aseguradora<select value={(claimDrafts[item.id] ?? EMPTY_CLAIM).insurer} onChange={(event) => event.target.value === "__new__" ? void addClaimInsurer(item.id) : setClaimDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_CLAIM), insurer: event.target.value } }))} disabled={readOnly || busyId === item.id}><option value="">Seleccionar aseguradora</option>{insurerOptions.map((insurer) => <option key={insurer} value={insurer}>{insurer}</option>)}<option value="__new__">+ Nueva aseguradora</option></select></label>
                    <label>Número de reclamo<input value={(claimDrafts[item.id] ?? EMPTY_CLAIM).claimNumber} onChange={(event) => setClaimDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_CLAIM), claimNumber: event.target.value } }))} disabled={readOnly || busyId === item.id} /></label>
                    <label>Monto<input type="number" min="0" step="0.01" value={(claimDrafts[item.id] ?? EMPTY_CLAIM).amount} onChange={(event) => setClaimDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_CLAIM), amount: event.target.value } }))} disabled={readOnly || busyId === item.id} /></label>
                    <label className="workflow-form-notes workflow-form-damage-photos">Fotos de los daños<input type="file" accept="image/*" multiple onChange={(event) => selectClaimPhotos(item.id, event.target.files, item.insuranceClaim?.photos.length ?? 0)} disabled={readOnly || busyId === item.id || (item.insuranceClaim?.photos.length ?? 0) >= MAX_PHOTOS} /><span className="hint">{(item.insuranceClaim?.photos.length ?? 0) + (claimPhotoFiles[item.id]?.length ?? 0)} de {MAX_PHOTOS} fotos</span></label>
                  </div>
                  {item.insuranceClaim?.photos.length ? <div className="workflow-damage-photo-list">{item.insuranceClaim.photos.map((photo, index) => <div key={photo.path} className="workflow-damage-photo-row"><div><strong>Foto {index + 1}</strong><small>{photo.name}</small></div><button type="button" className="button" onClick={() => setPhotoGallery({ photos: item.insuranceClaim!.photos, index, title: "Fotos de los daños" })}>Ver galería</button></div>)}</div> : null}
                  {message && <p className="hint workflow-message" role="status">{message}</p>}
                  <div className="workflow-form-actions"><button type="button" className="button primary" onClick={() => void saveClaim(item)} disabled={readOnly || busyId === item.id}>{busyId === item.id ? "Guardando..." : "Guardar reclamo"}</button></div>
                </div>}
                </div>}
                {activeCaseTab === "follow_up" && <section className="judicial-follow-up-panel judicial-case-tab-panel" role="tabpanel" id={`judicial-follow-up-panel-${item.id}`} aria-labelledby={`judicial-follow-up-tab-${item.id}`}>
                  <div className="judicial-follow-up-head"><div><strong>Notas del expediente</strong><span>Registra cada nota sin reemplazar las anteriores.</span></div><b>{item.judicialFollowUps.length} {item.judicialFollowUps.length === 1 ? "nota" : "notas"}</b></div>
                  {!isFinalStatus(item.status) && <div className="judicial-follow-up-form">
                    <label className="judicial-follow-up-comment">Nueva nota<textarea value={followUpDraft.comment} placeholder="Ej. Se llamó al juzgado y se confirmó la recepción de documentos" onChange={(event) => setJudicialFollowUpDrafts((current) => ({ ...current, [item.id]: { ...followUpDraft, comment: event.target.value } }))} disabled={readOnly || judicialFollowUpSavingId === item.id} /></label>
                    <label>Próximo paso<input value={followUpDraft.nextStep} placeholder="Ej. Entregar copia autenticada" onChange={(event) => setJudicialFollowUpDrafts((current) => ({ ...current, [item.id]: { ...followUpDraft, nextStep: event.target.value } }))} disabled={readOnly || judicialFollowUpSavingId === item.id} /></label>
                    <label>Próxima gestión<input type="date" min={today} value={followUpDraft.nextActionDate} onChange={(event) => setJudicialFollowUpDrafts((current) => ({ ...current, [item.id]: { ...followUpDraft, nextActionDate: event.target.value } }))} disabled={readOnly || judicialFollowUpSavingId === item.id} /></label>
                    <button type="button" className="button primary" onClick={() => void saveJudicialFollowUp(item)} disabled={readOnly || judicialFollowUpSavingId === item.id || !followUpDraft.comment.trim() || !followUpDraft.nextStep.trim() || !followUpDraft.nextActionDate}>{judicialFollowUpSavingId === item.id ? "Guardando..." : "Guardar nota"}</button>
                  </div>}
                </section>}
                {activeCaseTab === "history" && <section className="judicial-case-tab-panel judicial-history-panel" role="tabpanel" id={`judicial-history-panel-${item.id}`} aria-labelledby={`judicial-history-tab-${item.id}`}>
                  <div className="judicial-follow-up-head"><div><strong>Historial completo del expediente</strong><span>Todos los eventos judiciales ordenados del más reciente al más antiguo.</span></div><b>{timelineEvents.length} {timelineEvents.length === 1 ? "evento" : "eventos"}</b></div>
                  <ol className="judicial-case-timeline">{timelineEvents.map((event) => <li key={event.id} className={`tone-${event.tone}`}><span className="judicial-case-timeline-marker" aria-hidden="true" /><div><div className="judicial-case-timeline-head"><strong>{event.title}</strong><time>{new Date(event.occurredAt).toLocaleString("es-PA")}</time></div><p>{event.description}</p>{event.detail ? <small>{event.detail}</small> : null}</div></li>)}</ol>
                </section>}
              </div>}
            </article>;
          })}
        </div>
      </section>}
      {photoGallery && <IncidentPhotoGalleryModal photos={photoGallery.photos} initialIndex={photoGallery.index} title={photoGallery.title} resolveUrl={resolveGalleryPhotoUrl} onClose={() => setPhotoGallery(null)} />}
    </section>
  );
}
