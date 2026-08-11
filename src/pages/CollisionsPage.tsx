import { useEffect, useMemo, useState } from "react";
import {
  DuplicateInsuranceClaimNumberError,
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
const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const USD_FORMATTER = new Intl.NumberFormat("es-PA", { style: "currency", currency: "USD" });
const CURRENT_DATE_FORMATTER = new Intl.DateTimeFormat("es-PA", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

function normalizeUnit(value: string): string { return value.trim().toUpperCase(); }
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
function isFinalStatus(status: CollisionTrialStatus): boolean { return status === "Ganó" || status === "Perdió"; }

export default function CollisionsPage({ clients, dataOwnerUserId, readOnly = false, onClientsChange, embedded = false, syncInsuranceClaims = true, hideCreateForm = false, initialExpandedId = "", initialSearch = "" }: Props) {
  const { rows: fleetUnits, loading: fleetLoading, loadError: fleetLoadError } = useControlUnitsRows(hideCreateForm ? null : dataOwnerUserId);
  const [activeTab, setActiveTab] = useState<"form" | "agenda">(hideCreateForm ? "agenda" : "form");
  const [form, setForm] = useState<TrialForm>(EMPTY_FORM);
  const [cases, setCases] = useState<CollisionCaseRecord[]>([]);
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
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, "" | "Ganó" | "Perdió" | "Nueva fecha">>({});
  const [newTrialDates, setNewTrialDates] = useState<Record<string, string>>({});
  const [rescheduleReasons, setRescheduleReasons] = useState<Record<string, string>>({});
  const [expenseAmounts, setExpenseAmounts] = useState<Record<string, string>>({});
  const [expenseLabels, setExpenseLabels] = useState<Record<string, string>>({});
  const [claimDrafts, setClaimDrafts] = useState<Record<string, ClaimDraft>>({});
  const [claimPhotoFiles, setClaimPhotoFiles] = useState<Record<string, File[]>>({});

  const fleetUnitsByUnit = useMemo(() => new Map(fleetUnits.map((row) => [normalizeUnit(row.unit_id), row])), [fleetUnits]);
  const clientsByUnit = useMemo(() => new Map(clients.map((client) => [normalizeUnit(client.unitId), client])), [clients]);
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
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (dateFilter === "upcoming" && (!item.trialDate || item.trialDate <= today || isFinalStatus(item.status))) return false;
      if (dateFilter === "today" && (item.trialDate !== today || isFinalStatus(item.status))) return false;
      if (dateFilter === "last_week" && (!item.trialDate || item.trialDate < lastWeek.start || item.trialDate > lastWeek.end || isFinalStatus(item.status))) return false;
      if (dateFilter === "overdue" && (!item.trialDate || item.trialDate >= today || isFinalStatus(item.status))) return false;
      if (!needle) return true;
      return [item.unit, item.driver, item.plate, item.ticketStub, item.placeTime, item.court, item.vehicleDamage]
        .some((value) => value.toLocaleLowerCase("es").includes(needle));
    });
  }, [cases, dateFilter, search, statusFilter]);
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
    const item: CollisionCaseRecord = {
      id: `collision-trial-${Date.now()}-${crypto.randomUUID()}`,
      incidentDate: form.incidentDate,
      unit: normalizeUnit(form.unit),
      driver: form.driver.trim(),
      plate: form.plate.trim().toUpperCase(),
      trialDate: form.trialDate,
      vehicleDamage: form.vehicleDamage.trim(),
      ticketStub: form.ticketStub.trim(),
      placeTime: form.placeTime.trim(),
      court: form.court.trim(),
      collisionAndRun: form.collisionAndRun,
      status: "Pendiente",
      trialDateHistory: [],
      insuranceClaim: null,
      expenseInvoice: null,
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

  async function applyOutcome(item: CollisionCaseRecord): Promise<void> {
    if (readOnly || busyId || !dataOwnerUserId) return;
    const outcome = outcomeDrafts[item.id];
    if (!outcome) { setMessage("Selecciona el resultado del juicio."); return; }
    const now = new Date().toISOString();
    setBusyId(item.id); setMessage("");
    try {
      if (outcome === "Nueva fecha") {
        const nextDate = newTrialDates[item.id] ?? "";
        const reason = rescheduleReasons[item.id]?.trim() ?? "";
        if (!nextDate || nextDate === item.trialDate || !reason) throw new Error("RESCHEDULE_REQUIRED");
        await persistCase({
          ...item,
          trialDate: nextDate,
          status: "Nueva fecha",
          trialDateHistory: [...item.trialDateHistory, { previousDate: item.trialDate, newDate: nextDate, reason, changedAt: now }],
          updatedAt: now
        }, "Nueva fecha de juicio guardada con su razón.");
      } else if (outcome === "Ganó") {
        await persistCase({ ...item, status: "Ganó", updatedAt: now }, "Resultado guardado. Se habilitó el formulario de reclamo.");
      } else {
        const amount = parseAmount(expenseAmounts[item.id] ?? "");
        const label = expenseLabels[item.id]?.trim() || `GASTOS DE JUICIO - ${item.unit}`;
        const clientIndex = clients.findIndex((client) => normalizeUnit(client.unitId) === normalizeUnit(item.unit));
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
          status: "Perdió",
          expenseInvoice: { chargeId, label, amount, createdAt: now },
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
    } catch (error) {
      if (error instanceof Error && error.message === "RESCHEDULE_REQUIRED") setMessage("Indica una fecha distinta y la razón obligatoria de la reprogramación.");
      else if (error instanceof Error && error.message === "EXPENSE_AMOUNT_REQUIRED") setMessage("Indica el monto de los gastos para generar la factura.");
      else if (error instanceof Error && error.message === "CLIENT_NOT_FOUND") setMessage("No se encontró un cliente asociado a esta unidad para generar la factura.");
      else { console.error("No se pudo guardar el resultado del juicio.", error); setMessage("No se pudo guardar el resultado del juicio."); }
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
    if (readOnly || busyId || !dataOwnerUserId || item.status !== "Ganó") return;
    const draft = claimDrafts[item.id] ?? EMPTY_CLAIM;
    if (!draft.insurer.trim() || !draft.claimNumber.trim() || !draft.amount.trim()) { setMessage("Completa aseguradora, número de reclamo y monto."); return; }
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
          hasClaimNumber: true,
          claimNumber,
          amount: draft.amount,
          vehicleDamage: item.vehicleDamage,
          status: linkedClaim?.status === "Finalizado" ? "Finalizado" : "Activo",
          damagePhotos,
          damagePhotoNames: damagePhotos.map((photo) => photo.name),
          updatedAt: now
        };
        await saveInsuranceInsurer(dataOwnerUserId, insurer);
        await saveInsuranceClaim(dataOwnerUserId, canonicalClaim);
      }
      await persistCase(
        { ...item, insuranceClaim, updatedAt: now },
        syncInsuranceClaims ? "Reclamo guardado y vinculado con Reclamos a seguros." : "Formulario de reclamo guardado."
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
      setMessage(error instanceof DuplicateInsuranceClaimNumberError ? error.message : "No se pudo guardar el formulario de reclamo.");
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
          <label>Lugar / Hora<input value={form.placeTime} placeholder="Lugar y hora del juicio" onChange={(event) => patchForm({ placeTime: event.target.value })} disabled={readOnly} /></label>
          <label>Juzgado<input value={form.court} placeholder="Nombre o número del juzgado" onChange={(event) => patchForm({ court: event.target.value })} disabled={readOnly} /></label>
          <label className="workflow-form-notes">Daños del auto<textarea value={form.vehicleDamage} placeholder="Describe los daños del auto" onChange={(event) => patchForm({ vehicleDamage: event.target.value })} disabled={readOnly} /></label>
          <label className="collision-runaway-option"><input type="checkbox" checked={form.collisionAndRun} onChange={(event) => patchForm({ collisionAndRun: event.target.checked })} disabled={readOnly} /><span><strong>Colisión y fuga</strong><small>Marca esta opción cuando la otra persona abandonó el lugar.</small></span></label>
        </div>
      </form>}

      {activeTab === "agenda" && <section className="panel workflow-claims-panel">
        <div className="panel-head"><h2>Agenda de juicios</h2><span className="hint">{filteredCases.length} de {cases.length} juicios</span></div>
        {loading && <p className="hint workflow-message">Cargando juicios...</p>}{loadError && <p className="hint workflow-message">{loadError}</p>}{message && <p className="hint workflow-message">{message}</p>}
        {requiredOutcomeCount > 0 && <p className="collision-required-outcome" role="alert">Hay {requiredOutcomeCount} {requiredOutcomeCount === 1 ? "juicio que requiere" : "juicios que requieren"} registrar el resultado: Ganó, Perdió o Nueva fecha.</p>}
        <div className="workflow-claim-kpis workflow-claim-kpis--single" aria-label="Fecha de la agenda"><div><span>Fecha</span><strong>{CURRENT_DATE_FORMATTER.format(new Date())}</strong><small>Agenda del día</small></div></div>
        <div className="workflow-claim-filters">
          <label className="workflow-claim-search">Buscar<input type="search" value={search} placeholder="Unidad, chofer, placa, colilla o juzgado" onChange={(event) => setSearch(event.target.value)} /></label>
          <label>Fecha de juicio<select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)}><option value="all">Todas las fechas</option><option value="upcoming">Próximos casos</option><option value="today">Hoy</option><option value="last_week">Semana pasada</option><option value="overdue">Vencidos</option></select></label>
          <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CollisionTrialStatus | "all")}><option value="all">Todos</option><option>Pendiente</option><option>Nueva fecha</option><option>Ganó</option><option>Perdió</option></select></label>
          <button type="button" className="button workflow-clear-filters" onClick={() => { setSearch(""); setDateFilter("all"); setStatusFilter("all"); }}>Limpiar filtros</button>
        </div>
        <div className="workflow-claims-list">
          {!loading && !cases.length && <p className="hint">Todavía no hay juicios guardados.</p>}
          {cases.length > 0 && !filteredCases.length && <p className="hint workflow-empty-filter">No hay juicios que coincidan con los filtros.</p>}
          {filteredCases.map((item) => {
            const expanded = expandedId === item.id;
            const today = localDateKey(new Date());
            const requiresOutcome = Boolean(item.trialDate && item.trialDate <= today && !isFinalStatus(item.status));
            const outcome = outcomeDrafts[item.id] ?? "";
            return <article key={item.id} className={`workflow-claim-card${expanded ? " expanded" : ""}`}>
              <div className="workflow-claim-summary">
                <button type="button" className="workflow-claim-toggle" aria-expanded={expanded} onClick={() => { setExpandedId(expanded ? null : item.id); initializeCaseDrafts(item); }}>
                  <span className="workflow-claim-identity"><strong>{item.unit || "Sin unidad"} · {item.driver || "Sin chofer"}</strong><small>{item.plate || "Sin placa"}</small></span>
                  <span className="workflow-claim-reference"><strong>{item.court || "Sin juzgado"}</strong><small>Colilla: {item.ticketStub || "-"}</small></span>
                  <span className="workflow-claim-summary-value"><small>Fecha de juicio</small><strong>{item.trialDate || "Sin fecha"}</strong></span>
                  <span className="workflow-claim-summary-value"><small>Lugar / Hora</small><strong>{item.placeTime || "-"}</strong></span>
                  <span className="workflow-claim-indicators"><span className={item.status === "Ganó" ? "complete" : item.status === "Perdió" || requiresOutcome ? "missing" : "pending"}>{item.status}</span>{requiresOutcome && <span className="missing">Resultado requerido</span>}{item.collisionAndRun && <span className="declined">Colisión y fuga</span>}</span>
                  <span className="workflow-claim-chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
                </button>
              </div>
              {expanded && <div className="workflow-claim-details">
                {requiresOutcome && <p className="collision-required-outcome" role="alert">La fecha del juicio llegó o está vencida. Debes registrar el resultado.</p>}
                <dl className="workflow-claim-detail-grid">
                  <div><dt>Fecha del incidente</dt><dd>{item.incidentDate}</dd></div><div><dt>Fecha de juicio</dt><dd>{item.trialDate}</dd></div>
                  <div><dt>Colilla</dt><dd>{item.ticketStub}</dd></div><div><dt>Juzgado</dt><dd>{item.court}</dd></div>
                  <div><dt>Colisión y fuga</dt><dd>{item.collisionAndRun ? "Sí" : "No"}</dd></div>
                  <div className="workflow-claim-damage"><dt>Daños del auto</dt><dd>{item.vehicleDamage}</dd></div>
                </dl>
                {!isFinalStatus(item.status) && <div className="workflow-finalization-panel collision-outcome-panel">
                  <div><strong>Resultado del juicio</strong><span>Selecciona el resultado para continuar el flujo.</span></div>
                  <label>Estado<select value={outcome} onChange={(event) => setOutcomeDrafts((current) => ({ ...current, [item.id]: event.target.value as typeof outcome }))} disabled={readOnly || busyId === item.id}><option value="">Seleccionar</option><option>Ganó</option><option>Perdió</option><option>Nueva fecha</option></select></label>
                  {outcome === "Nueva fecha" && <><label>Nueva fecha de juicio<input type="date" value={newTrialDates[item.id] ?? ""} onChange={(event) => setNewTrialDates((current) => ({ ...current, [item.id]: event.target.value }))} /></label><label className="workflow-finalization-reason">Razón de la nueva fecha<textarea value={rescheduleReasons[item.id] ?? ""} placeholder="La razón es obligatoria" onChange={(event) => setRescheduleReasons((current) => ({ ...current, [item.id]: event.target.value }))} /></label></>}
                  {outcome === "Perdió" && <><label>Concepto de gastos<input value={expenseLabels[item.id] ?? `GASTOS DE JUICIO - ${item.unit}`} onChange={(event) => setExpenseLabels((current) => ({ ...current, [item.id]: event.target.value }))} /></label><label>Monto de gastos<input type="number" min="0.01" step="0.01" placeholder="0.00" value={expenseAmounts[item.id] ?? ""} onChange={(event) => setExpenseAmounts((current) => ({ ...current, [item.id]: event.target.value }))} /></label></>}
                  <div className="workflow-finalization-actions"><button type="button" className="button primary" onClick={() => void applyOutcome(item)} disabled={readOnly || busyId === item.id || !outcome}>{busyId === item.id ? "Guardando..." : "Confirmar resultado"}</button></div>
                </div>}
                {item.trialDateHistory.length > 0 && <details className="workflow-edit-history" open><summary>Historial de fechas de juicio ({item.trialDateHistory.length})</summary><ul>{[...item.trialDateHistory].reverse().map((event) => <li key={`${event.changedAt}-${event.newDate}`}><time>{new Date(event.changedAt).toLocaleString("es-PA")}</time><span>{event.previousDate} → {event.newDate}: {event.reason}</span></li>)}</ul></details>}
                {item.status === "Ganó" && <div className="collision-claim-panel">
                  <div><strong>Formulario de reclamo</strong><span>Habilitado porque el cliente ganó el juicio.</span></div>
                  <div className="workflow-form-grid">
                    <label>Aseguradora<input value={(claimDrafts[item.id] ?? EMPTY_CLAIM).insurer} onChange={(event) => setClaimDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_CLAIM), insurer: event.target.value } }))} disabled={readOnly || busyId === item.id} /></label>
                    <label>Número de reclamo<input value={(claimDrafts[item.id] ?? EMPTY_CLAIM).claimNumber} onChange={(event) => setClaimDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_CLAIM), claimNumber: event.target.value } }))} disabled={readOnly || busyId === item.id} /></label>
                    <label>Monto<input type="number" min="0" step="0.01" value={(claimDrafts[item.id] ?? EMPTY_CLAIM).amount} onChange={(event) => setClaimDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? EMPTY_CLAIM), amount: event.target.value } }))} disabled={readOnly || busyId === item.id} /></label>
                    <label className="workflow-form-notes workflow-form-damage-photos">Fotos de los daños<input type="file" accept="image/*" multiple onChange={(event) => selectClaimPhotos(item.id, event.target.files, item.insuranceClaim?.photos.length ?? 0)} disabled={readOnly || busyId === item.id || (item.insuranceClaim?.photos.length ?? 0) >= MAX_PHOTOS} /><span className="hint">{(item.insuranceClaim?.photos.length ?? 0) + (claimPhotoFiles[item.id]?.length ?? 0)} de {MAX_PHOTOS} fotos</span></label>
                  </div>
                  {item.insuranceClaim?.photos.length ? <div className="workflow-damage-photo-list">{item.insuranceClaim.photos.map((photo, index) => <div key={photo.path} className="workflow-damage-photo-row"><div><strong>Foto {index + 1}</strong><small>{photo.name}</small></div><button type="button" className="button" onClick={() => void viewPhoto(photo)}>Ver foto</button></div>)}</div> : null}
                  <div className="workflow-form-actions"><button type="button" className="button primary" onClick={() => void saveClaim(item)} disabled={readOnly || busyId === item.id}>{busyId === item.id ? "Guardando..." : "Guardar reclamo"}</button></div>
                </div>}
                {item.status === "Perdió" && item.expenseInvoice && <div className="collision-expense-invoice"><strong>Factura de gastos generada</strong><span>{item.expenseInvoice.label}</span><b>{USD_FORMATTER.format(item.expenseInvoice.amount)}</b><small>Agregada a otros cargos del cliente.</small></div>}
              </div>}
            </article>;
          })}
        </div>
      </section>}
    </section>
  );
}
