import { useEffect, useMemo, useState } from "react";
import {
  DuplicateInsuranceClaimNumberError,
  JudicialOutcomeRequiredForClaimError,
  loadCollisionCases,
  loadInsuranceInsurers,
  removeCollisionPhotos,
  removeInsuranceDamagePhotos,
  removeInsuranceSettlement,
  saveCollisionCase,
  saveInsuranceClaim,
  saveInsuranceInsurer,
  uploadCollisionPhoto,
  uploadInsuranceDamagePhoto,
  uploadInsuranceSettlement,
  type CollisionPhotoAttachment,
  type CollisionCaseRecord,
  type InsuranceClaimRecord,
  type InsuranceDamagePhotoAttachment,
  type InsuranceSettlementAttachment
} from "../cloudData";
import type { Client } from "../types";
import { normalizeCourtName } from "../courtNames";
import { useControlUnitsRows } from "./controlUnits/useControlUnitsRows";
import {
  requiresInsuranceFud,
  shouldUploadInsuranceFud,
  type IncidentDocumentationAvailability
} from "./incidents/incidentIntakeRules";

export type IncidentDestination = "judicial" | "insurance";

type Props = {
  clients: Client[];
  dataOwnerUserId?: string | null;
  canViewJudicial: boolean;
  canEditJudicial: boolean;
  canViewInsurance: boolean;
  canEditInsurance: boolean;
  embedded?: boolean;
  onSaved: (destination: IncidentDestination) => void;
};

type IntakeForm = {
  incidentDate: string;
  unit: string;
  driver: string;
  plate: string;
  vehicleDamage: string;
  trialDate: string;
  ticketStub: string;
  placeTime: string;
  court: string;
  collisionAndRun: boolean;
  insurer: string;
  hasClaimNumber: "" | "yes" | "no";
  claimNumber: string;
  amount: string;
  documentationAvailable: IncidentDocumentationAvailability;
};

const EMPTY_FORM: IntakeForm = {
  incidentDate: "", unit: "", driver: "", plate: "", vehicleDamage: "",
  trialDate: "", ticketStub: "", placeTime: "", court: "", collisionAndRun: false,
  insurer: "", hasClaimNumber: "", claimNumber: "", amount: "", documentationAvailable: ""
};
const MAX_DAMAGE_PHOTOS = 5;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const MAX_FUD_SIZE = 10 * 1024 * 1024;

function normalizeUnit(value: string): string { return value.trim().toUpperCase(); }
function normalizeInsurer(value: string): string { return value.trim().toUpperCase(); }
function normalizePersonName(value: string): string { return value.trim().toLocaleUpperCase("es").replace(/\s+/g, " "); }

function incidentSaveErrorMessage(step: string, error: unknown): string {
  const detail = error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message.trim()
    : error instanceof Error
      ? error.message.trim()
      : "";
  return `No se pudo ${step}${detail ? `: ${detail}` : "."}`;
}

function courtsFromCases(cases: CollisionCaseRecord[]): string[] {
  return [...new Set(cases.map((item) => normalizeCourtName(item.court)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es", { numeric: true }));
}

export default function IncidentIntakeForm({ clients, dataOwnerUserId, canViewJudicial, canEditJudicial, canViewInsurance, canEditInsurance, embedded = false, onSaved }: Props) {
  const [destination, setDestination] = useState<IncidentDestination | "">("");
  const [form, setForm] = useState<IntakeForm>(EMPTY_FORM);
  const [driverEditedManually, setDriverEditedManually] = useState(false);
  const [insurers, setInsurers] = useState<string[]>([]);
  const [courts, setCourts] = useState<string[]>([]);
  const [damagePhotoFiles, setDamagePhotoFiles] = useState<File[]>([]);
  const [judicialPhotoFiles, setJudicialPhotoFiles] = useState<File[]>([]);
  const [ticketStubPhotoFile, setTicketStubPhotoFile] = useState<File | null>(null);
  const [fudFile, setFudFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { rows: fleetUnits, loading: fleetLoading, loadError: fleetLoadError } = useControlUnitsRows(dataOwnerUserId);

  const clientsByUnit = useMemo(() => {
    const result = new Map<string, Client>();
    clients.forEach((client) => {
      const unit = normalizeUnit(client.unitId);
      if (unit && (!result.has(unit) || client.status !== "archivado")) result.set(unit, client);
    });
    return result;
  }, [clients]);
  const fleetUnitsByUnit = useMemo(() => new Map(fleetUnits.map((unit) => [normalizeUnit(unit.unit_id), unit])), [fleetUnits]);
  const unitOptions = useMemo(() => [...new Set([
    ...fleetUnits.map((unit) => normalizeUnit(unit.unit_id)),
    ...clients.filter((client) => client.status !== "archivado").map((client) => normalizeUnit(client.unitId))
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right, "es", { numeric: true })), [clients, fleetUnits]);
  const unitOptionLabels = useMemo(() => new Map(unitOptions.map((unitId) => {
    const fleetUnit = fleetUnitsByUnit.get(unitId);
    const client = clientsByUnit.get(unitId);
    return [unitId, [fleetUnit?.client_name ?? client?.name, fleetUnit?.plate ? `Placa ${fleetUnit.plate}` : ""].filter(Boolean).join(" - ")];
  })), [clientsByUnit, fleetUnitsByUnit, unitOptions]);

  useEffect(() => {
    if (!dataOwnerUserId || !canViewInsurance) return;
    let cancelled = false;
    loadInsuranceInsurers(dataOwnerUserId)
      .then((items) => { if (!cancelled) setInsurers(items); })
      .catch((error) => { console.error("No se pudieron cargar las aseguradoras.", error); });
    return () => { cancelled = true; };
  }, [canViewInsurance, dataOwnerUserId]);

  useEffect(() => {
    if (!dataOwnerUserId || !canViewJudicial) return;
    let cancelled = false;
    loadCollisionCases(dataOwnerUserId)
      .then((items) => { if (!cancelled) setCourts(courtsFromCases(items)); })
      .catch((error) => { console.error("No se pudieron cargar los juzgados.", error); });
    return () => { cancelled = true; };
  }, [canViewJudicial, dataOwnerUserId]);

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

  const readOnly = destination === "judicial" ? !canEditJudicial : destination === "insurance" ? !canEditInsurance : true;
  function patchForm(patch: Partial<IntakeForm>): void { setForm((current) => ({ ...current, ...patch })); }
  function handleUnitChange(value: string): void {
    const unit = normalizeUnit(value);
    const fleetUnit = fleetUnitsByUnit.get(unit);
    const client = clientsByUnit.get(unit);
    setDriverEditedManually(false);
    patchForm({ unit, driver: fleetUnit?.client_name ?? client?.name ?? "", plate: fleetUnit?.plate ?? "" });
  }
  function selectDestination(next: IncidentDestination): void {
    setDestination((current) => current === next ? "" : next);
    setMessage("");
  }

  function handleDamagePhotosChange(files: FileList | null): void {
    const selected = Array.from(files ?? []);
    if (selected.some((file) => !file.type.startsWith("image/"))) { setDamagePhotoFiles([]); setMessage("Solo se permiten archivos de imagen para las fotos de daños."); return; }
    if (selected.some((file) => file.size > MAX_PHOTO_SIZE)) { setDamagePhotoFiles([]); setMessage("Cada foto de daños debe pesar 10 MB o menos."); return; }
    setDamagePhotoFiles(selected.slice(0, MAX_DAMAGE_PHOTOS));
    setMessage(selected.length > MAX_DAMAGE_PHOTOS ? `Solo se guardarán las primeras ${MAX_DAMAGE_PHOTOS} fotos.` : "");
  }

  function handleJudicialPhotosChange(files: FileList | null): void {
    const selected = Array.from(files ?? []);
    if (selected.some((file) => !file.type.startsWith("image/"))) {
      setJudicialPhotoFiles([]);
      setMessage("Solo se permiten archivos de imagen para las fotos del siniestro.");
      return;
    }
    if (selected.some((file) => file.size > MAX_PHOTO_SIZE)) {
      setJudicialPhotoFiles([]);
      setMessage("Cada foto del siniestro debe pesar 10 MB o menos.");
      return;
    }
    setJudicialPhotoFiles(selected);
    setMessage("");
  }

  function handleTicketStubPhotoChange(file: File | undefined): void {
    if (!file) {
      setTicketStubPhotoFile(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setTicketStubPhotoFile(null);
      setMessage("La foto de la colilla debe ser una imagen.");
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      setTicketStubPhotoFile(null);
      setMessage("La foto de la colilla debe pesar 10 MB o menos.");
      return;
    }
    setTicketStubPhotoFile(file);
    setMessage("");
  }

  function handleFudChange(file: File | undefined): void {
    if (!file) {
      setFudFile(null);
      return;
    }
    const isAccepted = file.type === "application/pdf" || file.type.startsWith("image/");
    if (!isAccepted) {
      setFudFile(null);
      setMessage("El FUD debe ser un archivo PDF o una imagen.");
      return;
    }
    if (file.size > MAX_FUD_SIZE) {
      setFudFile(null);
      setMessage("El FUD debe pesar 10 MB o menos.");
      return;
    }
    setFudFile(file);
    setMessage("");
  }

  async function addInsurer(): Promise<void> {
    if (!dataOwnerUserId || readOnly) return;
    const insurer = normalizeInsurer(window.prompt("Nombre de la nueva aseguradora") ?? "");
    if (!insurer) return;
    try {
      await saveInsuranceInsurer(dataOwnerUserId, insurer);
      setInsurers((current) => [...new Set([...current, insurer])].sort((a, b) => a.localeCompare(b, "es")));
      patchForm({ insurer });
    } catch (error) { console.error("No se pudo guardar la aseguradora.", error); setMessage("No se pudo guardar la aseguradora."); }
  }

  function addCourt(): void {
    if (readOnly) return;
    const court = normalizeCourtName(window.prompt("Nombre del nuevo juzgado") ?? "");
    if (!court) return;
    setCourts((current) => [...new Set([...current, court])].sort((a, b) => a.localeCompare(b, "es", { numeric: true })));
    patchForm({ court });
  }

  function validateCommonFields(): boolean {
    if (!form.incidentDate || !form.unit.trim() || !form.driver.trim() || !form.plate.trim() || !form.vehicleDamage.trim()) {
      setMessage("Completa fecha del incidente, unidad, chofer, placa y daños del auto.");
      return false;
    }
    return true;
  }

  async function saveIncident(): Promise<void> {
    if (!dataOwnerUserId || !destination || readOnly || saving || !validateCommonFields()) return;
    if (!form.documentationAvailable) { setMessage(`Indica si ya recibiste ${destination === "judicial" ? "la colilla" : "el FUD"}.`); return; }
    const documentationPending = form.documentationAvailable === "no";
    if (destination === "insurance" && requiresInsuranceFud(form.documentationAvailable) && !fudFile) { setMessage("Adjunta el documento FUD antes de guardar el reclamo al seguro."); return; }
    if (destination === "judicial" && !documentationPending && (!form.trialDate || !form.ticketStub.trim() || !form.placeTime.trim() || !form.court.trim())) { setMessage("Completa todos los datos judiciales."); return; }
    if (destination === "insurance" && (!form.insurer || !form.hasClaimNumber)) { setMessage("Completa aseguradora e indica si tienes el número de reclamo."); return; }
    if (destination === "insurance" && form.hasClaimNumber === "yes" && !form.claimNumber.trim()) { setMessage("Escribe el número de reclamo."); return; }

    setSaving(true); setMessage("");
    const now = new Date().toISOString();
    const common = { incidentDate: form.incidentDate, unit: normalizeUnit(form.unit), driver: form.driver.trim(), plate: form.plate.trim().toUpperCase(), vehicleDamage: form.vehicleDamage.trim() };
    const uploadedPhotos: InsuranceDamagePhotoAttachment[] = [];
    const uploadedJudicialPhotos: CollisionPhotoAttachment[] = [];
    let uploadedInsuranceFud: InsuranceSettlementAttachment | null = null;
    let saveStep = "guardar el siniestro en la nube";
    try {
      if (destination === "judicial") {
        const driverName = normalizePersonName(form.driver);
        const historicalClient = clients.find((client) => normalizePersonName(client.name) === driverName);
        const id = `collision-trial-${Date.now()}-${crypto.randomUUID()}`;
        for (const file of judicialPhotoFiles) {
          saveStep = `subir la foto del siniestro “${file.name}”`;
          uploadedJudicialPhotos.push(await uploadCollisionPhoto(dataOwnerUserId, id, file));
        }
        saveStep = ticketStubPhotoFile ? `subir la foto de la colilla “${ticketStubPhotoFile.name}”` : "guardar el expediente judicial";
        const ticketStubPhoto = ticketStubPhotoFile ? await uploadCollisionPhoto(dataOwnerUserId, id, ticketStubPhotoFile) : null;
        if (ticketStubPhoto) uploadedJudicialPhotos.push(ticketStubPhoto);
        const collisionCase: CollisionCaseRecord = {
          id, ...common,
          clientId: historicalClient?.id ?? "", clientName: form.driver.trim(),
          trialDate: form.trialDate, ticketStub: form.ticketStub.trim(), ticketStubPhoto, placeTime: form.placeTime.trim(), court: normalizeCourtName(form.court), collisionAndRun: form.collisionAndRun,
          documentationPending, documentationPendingSince: documentationPending ? now : null, documentationReceivedAt: documentationPending ? null : now,
          status: "PENDIENTE", trialDateHistory: [], editHistory: [], judicialFollowUps: [], clientWillAttend: null, legalAssistanceRequested: null, attendanceConfirmedAt: null, incidentPhotos: uploadedJudicialPhotos.filter((photo) => photo.path !== ticketStubPhoto?.path), judicialOutcomeEvidence: null, judicialResolutionEvidence: null, judicialResolutionSearchDate: null, insuranceClaim: null, expenseInvoice: null,
          clientReturnedBeforeClosure: false, clientReturnedBeforeClosureAt: null, createdAt: now, updatedAt: now
        };
        saveStep = "guardar el expediente judicial";
        await saveCollisionCase(dataOwnerUserId, collisionCase);
      } else {
        const id = `insurance-claim-${Date.now()}-${crypto.randomUUID()}`;
        if (shouldUploadInsuranceFud(form.documentationAvailable, Boolean(fudFile)) && fudFile) {
          saveStep = `subir el documento FUD “${fudFile.name}”`;
          uploadedInsuranceFud = await uploadInsuranceSettlement(dataOwnerUserId, id, fudFile);
        }
        for (const file of damagePhotoFiles) {
          saveStep = `subir la foto del siniestro “${file.name}”`;
          uploadedPhotos.push(await uploadInsuranceDamagePhoto(dataOwnerUserId, id, file));
        }
        const claimNumber = form.hasClaimNumber === "yes" ? form.claimNumber.trim() : "";
        const claim: InsuranceClaimRecord = {
          id, ...common, insurer: normalizeInsurer(form.insurer), hasClaimNumber: Boolean(claimNumber), claimNumber, amount: form.amount,
          status: !documentationPending && claimNumber ? "Activo" : "Inactivo", damagePhotoNames: uploadedPhotos.map((photo) => photo.name), damagePhotos: uploadedPhotos, fudAttachment: uploadedInsuranceFud,
          documentationPending, documentationPendingSince: documentationPending ? now : null, documentationReceivedAt: documentationPending ? null : now,
          settlementDelivered: false, settlementDeliveredDate: "", settlementMarkedAt: null, settlementAttachment: null,
          followUpComment: "", followUpCommentUpdatedAt: null, followUps: [], closureOutcome: null, closureJustification: "", finalizedAt: null, editHistory: [], createdAt: now, updatedAt: now
        };
        saveStep = "guardar la aseguradora";
        await saveInsuranceInsurer(dataOwnerUserId, claim.insurer);
        saveStep = "guardar el reclamo al seguro";
        await saveInsuranceClaim(dataOwnerUserId, claim);
      }
      const savedDestination = destination;
      setForm(EMPTY_FORM); setDamagePhotoFiles([]); setJudicialPhotoFiles([]); setTicketStubPhotoFile(null); setFudFile(null); setDriverEditedManually(false);
      setMessage(savedDestination === "judicial" ? "Siniestro enviado al proceso judicial." : "Siniestro enviado al reclamo de seguro.");
      onSaved(savedDestination);
    } catch (error) {
      if (uploadedPhotos.length) { try { await removeInsuranceDamagePhotos(uploadedPhotos.map((photo) => photo.path)); } catch { /* Limpieza de mejor esfuerzo. */ } }
      if (uploadedInsuranceFud) { try { await removeInsuranceSettlement(uploadedInsuranceFud.path); } catch { /* Limpieza de mejor esfuerzo. */ } }
      if (uploadedJudicialPhotos.length) { try { await removeCollisionPhotos(uploadedJudicialPhotos.map((photo) => photo.path)); } catch { /* Limpieza de mejor esfuerzo. */ } }
      console.error("No se pudo guardar el siniestro.", error);
      setMessage(error instanceof DuplicateInsuranceClaimNumberError || error instanceof JudicialOutcomeRequiredForClaimError ? error.message : incidentSaveErrorMessage(saveStep, error));
    } finally { setSaving(false); }
  }

  return (
    <form className={`panel workflow-form-panel incident-intake-form${embedded ? " incident-intake-form--embedded" : ""}`} onSubmit={(event) => { event.preventDefault(); void saveIncident(); }}>
      {!embedded && <div className="panel-head"><div><span className="workflow-eyebrow">Nueva colisión</span><h2>Registrar colisión</h2></div></div>}
      <fieldset className="incident-destination-fieldset">
        <legend>¿Qué proceso corresponde a esta colisión?</legend>
        <div className="incident-destination-options">
          {canViewJudicial && <button type="button" className={destination === "judicial" ? "active" : ""} aria-pressed={destination === "judicial"} onClick={() => selectDestination("judicial")}><span>Juicio</span></button>}
          {canViewInsurance && <button type="button" className={destination === "insurance" ? "active" : ""} aria-pressed={destination === "insurance"} onClick={() => selectDestination("insurance")}><span>Reclamo al seguro</span></button>}
        </div>
      </fieldset>
      {readOnly && destination && <p className="hint workflow-message">Modo lectura: no tienes permiso para registrar datos en este flujo.</p>}
      {fleetLoading && <p className="hint workflow-message">Cargando autos...</p>}{fleetLoadError && <p className="hint workflow-message">{fleetLoadError}</p>}
      {destination && <section className={`incident-form-section incident-form-section--${destination}`}>
        <div className="incident-form-section-title"><strong>{destination === "judicial" ? "Formulario de juicio" : "Formulario de reclamo al seguro"}</strong><small>Completa los datos del incidente y de la gestión seleccionada.</small></div>
        <div className="workflow-form-grid">
          <label>Fecha del incidente<input type="date" value={form.incidentDate} onChange={(event) => patchForm({ incidentDate: event.target.value })} disabled={readOnly} /></label>
          <label>Unidad<input list="incident-unit-options" placeholder="Ej. B52" value={form.unit} onChange={(event) => handleUnitChange(event.target.value)} disabled={readOnly} /><datalist id="incident-unit-options">{unitOptions.map((unitId) => <option key={unitId} value={unitId} label={unitOptionLabels.get(unitId) ?? ""} />)}</datalist></label>
          <label>Conductor al momento del incidente<input value={form.driver} placeholder="Nombre completo" onChange={(event) => { setDriverEditedManually(true); patchForm({ driver: event.target.value }); }} disabled={readOnly} /></label>
          <label>Placa<input value={form.plate} placeholder="Placa del auto" onChange={(event) => patchForm({ plate: event.target.value })} disabled={readOnly} /></label>
          <label className="workflow-form-notes">Daños del auto<textarea value={form.vehicleDamage} placeholder="Describe los daños del auto" onChange={(event) => patchForm({ vehicleDamage: event.target.value })} disabled={readOnly} /></label>
          <div className={`workflow-claim-number-question${!form.documentationAvailable ? " is-pending" : ""}`}><div><strong>¿Ya recibiste {destination === "judicial" ? "la colilla" : "el FUD"}?</strong><small>Si todavía no lo tienes, guardaremos el caso y activaremos las alertas de seguimiento.</small></div><select value={form.documentationAvailable} onChange={(event) => patchForm({ documentationAvailable: event.target.value as IntakeForm["documentationAvailable"] })} disabled={readOnly}><option value="">Seleccionar Sí o No</option><option value="yes">Sí, ya lo recibí</option><option value="no">No, está pendiente</option></select></div>
          {destination === "judicial" ? <>
            {form.documentationAvailable === "yes" && <><label>Fecha de juicio<input type="date" value={form.trialDate} onChange={(event) => patchForm({ trialDate: event.target.value })} disabled={readOnly} /></label>
            <label>Colilla<input value={form.ticketStub} placeholder="Número o referencia" onChange={(event) => patchForm({ ticketStub: event.target.value })} disabled={readOnly} /></label>
            <label>Foto de la colilla<input type="file" accept="image/*" onChange={(event) => handleTicketStubPhotoChange(event.target.files?.[0])} disabled={readOnly || saving} /><span className="hint">{ticketStubPhotoFile ? `Seleccionada: ${ticketStubPhotoFile.name}` : "Adjunta una foto de la colilla."} Máximo 10 MB.</span></label>
            <label>Hora<input type="time" value={form.placeTime} onChange={(event) => patchForm({ placeTime: event.target.value })} disabled={readOnly} /></label>
            <label>Juzgado<select value={form.court} onChange={(event) => event.target.value === "__new__" ? addCourt() : patchForm({ court: event.target.value })} disabled={readOnly}><option value="">Seleccionar juzgado</option>{courts.map((court) => <option key={court}>{court}</option>)}<option value="__new__">+ Nuevo juzgado</option></select></label></>}
            <label className="collision-runaway-option"><input type="checkbox" checked={form.collisionAndRun} onChange={(event) => patchForm({ collisionAndRun: event.target.checked })} disabled={readOnly} /><span><strong>Colisión y fuga</strong><small>El conductor abandonó el lugar.</small></span></label>
            <label className="workflow-form-notes workflow-form-damage-photos">Fotos del siniestro<input type="file" accept="image/*" multiple onChange={(event) => handleJudicialPhotosChange(event.target.files)} disabled={readOnly || saving} /><span className="hint">{judicialPhotoFiles.length ? `${judicialPhotoFiles.length} ${judicialPhotoFiles.length === 1 ? "foto seleccionada" : "fotos seleccionadas"}.` : "Puedes adjuntar todas las fotos necesarias."} Máximo 10 MB por foto.</span></label>
          </> : <>
            {form.documentationAvailable === "yes" && <label className="workflow-form-notes">Documento FUD<input type="file" accept="application/pdf,image/*,.pdf" onChange={(event) => handleFudChange(event.target.files?.[0])} disabled={readOnly || saving} required /><span className="hint">{fudFile ? `Seleccionado: ${fudFile.name}` : "Adjunta el FUD en PDF o imagen."} Máximo 10 MB.</span></label>}
            <div className={`workflow-claim-number-question${!form.hasClaimNumber ? " is-pending" : ""}`}><div><strong>¿Tienes el número de reclamo?</strong><small>Define si el reclamo inicia activo o pendiente.</small></div><select value={form.hasClaimNumber} onChange={(event) => { const hasClaimNumber = event.target.value as IntakeForm["hasClaimNumber"]; patchForm({ hasClaimNumber, ...(hasClaimNumber !== "yes" ? { claimNumber: "" } : {}) }); }} disabled={readOnly}><option value="">Seleccionar Sí o No</option><option value="yes">Sí, tengo el número</option><option value="no">No, todavía no lo tengo</option></select></div>
            {form.hasClaimNumber === "yes" && <label className="workflow-claim-number-input">Número de reclamo<input value={form.claimNumber} placeholder="Escribe el número" onChange={(event) => patchForm({ claimNumber: event.target.value })} disabled={readOnly} /></label>}
            <label>Aseguradora<select value={form.insurer} onChange={(event) => event.target.value === "__new__" ? void addInsurer() : patchForm({ insurer: event.target.value })} disabled={readOnly}><option value="">Seleccionar aseguradora</option>{insurers.map((insurer) => <option key={insurer}>{insurer}</option>)}<option value="__new__">+ Nueva aseguradora</option></select></label>
            <label>Monto<input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(event) => patchForm({ amount: event.target.value })} disabled={readOnly} /></label>
            <label className="workflow-form-notes workflow-form-damage-photos">Fotos de los daños<input type="file" accept="image/*" multiple onChange={(event) => handleDamagePhotosChange(event.target.files)} disabled={readOnly || saving} /><span className="hint">{damagePhotoFiles.length} de {MAX_DAMAGE_PHOTOS} fotos seleccionadas. Máximo 10 MB por foto.</span></label>
          </>}
        </div>
      </section>}
      {destination && <div className="incident-form-submit">{message && <p className="hint workflow-message" role="alert">{message}</p>}<div className="workflow-form-actions"><button type="submit" className="button primary" disabled={readOnly || saving}>{saving ? "Guardando..." : "Guardar siniestro"}</button></div></div>}
    </form>
  );
}
