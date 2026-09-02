import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  getSellerLeadPortalId,
  loadSellerLeadRequests,
  markSellerLeadRequestIncomplete,
  markSellerLeadRequestReviewed
} from "../cloudData";
import type { LeadDecision, LeadEvaluation, SellerLeadRequest, SellerLeadRequestStatus } from "../types";

type LeadForm = {
  cedula: string;
  birthDate: string;
  attachmentName: string;
  attachmentDataUrl: string;
  noCases: boolean;
  hasGpsTamperingReport: boolean;
  hasLegalCases: boolean;
  hasViolenceReports: boolean;
  hasDuiReports: boolean;
  hasPiracyReports: boolean;
  collisionReports: string;
  pendingDailyReports: string;
};

type LeadVerdict = {
  age: number | null;
  decision: LeadDecision;
  extraDeposit: number;
  blockers: string[];
  extraDepositReasons: string[];
};

type Props = {
  evaluations: LeadEvaluation[];
  onEvaluationsChange: (next: LeadEvaluation[]) => Promise<void>;
  onEvaluationLoad?: (evaluationId: string) => Promise<LeadEvaluation | null>;
  loading: boolean;
  cloudError: string;
  readOnly?: boolean;
  ownerUserId?: string;
};

type LeadFlowMode = "idle" | "creating" | "viewing";

const initialForm: LeadForm = {
  cedula: "",
  birthDate: "",
  attachmentName: "",
  attachmentDataUrl: "",
  noCases: false,
  hasGpsTamperingReport: false,
  hasLegalCases: false,
  hasViolenceReports: false,
  hasDuiReports: false,
  hasPiracyReports: false,
  collisionReports: "0",
  pendingDailyReports: "0"
};

const decisionLabel: Record<LeadDecision, string> = {
  aplica: "SI APLICA",
  aplica_con_abono: "APLICA CON ABONO EXTRA",
  no_aplica: "NO APLICA"
};

const requestStatusLabel: Record<SellerLeadRequestStatus, string> = {
  waiting_information: "Esperando informacion",
  pending_review: "Pendiente de revision",
  incomplete: "Informacion incompleta",
  reviewed: "Dictamen publicado"
};

function normalizeCedula(value: string): string {
  return value.trim().toUpperCase();
}

function calculateAge(birthDate: string, today = new Date()): number | null {
  if (!birthDate) return null;
  const [year, month, day] = birthDate.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) age -= 1;
  return age >= 0 ? age : null;
}

function parseCollisionReports(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function buildVerdict(form: LeadForm): LeadVerdict {
  const age = calculateAge(form.birthDate);
  const collisionReports = form.noCases ? 0 : parseCollisionReports(form.collisionReports);
  const pendingDailyReports = form.noCases ? 0 : parseCollisionReports(form.pendingDailyReports);
  const blockers: string[] = [];
  const extraDepositReasons: string[] = [];
  let extraDeposit = 0;

  if (age !== null && age < 22) blockers.push("Menor de 22 anos");
  if (!form.noCases) {
    if (form.hasGpsTamperingReport) blockers.push("Reporte de quitar/manipular GPS");
    if (form.hasLegalCases) blockers.push("Casos legales");
    if (form.hasViolenceReports) blockers.push("Reportes de violencia");
    if (form.hasDuiReports) blockers.push("Reporte de alcoholemia");
    if (form.hasPiracyReports) blockers.push("Reporte de pirateria");
    if (collisionReports >= 2) blockers.push("2 o mas reportes de colision/choque");
  }

  if (blockers.length === 0 && age !== null && age >= 22 && age < 27) {
    const amount = (27 - age) * 100;
    extraDeposit += amount;
    extraDepositReasons.push(`Edad ${age}: +$${amount} por estar debajo de 27`);
  }
  if (blockers.length === 0 && collisionReports === 1) {
    extraDeposit += 100;
    extraDepositReasons.push("1 reporte de colision/choque: +$100");
  }
  if (blockers.length === 0 && pendingDailyReports > 0) {
    const amount = pendingDailyReports * 50;
    extraDeposit += amount;
    extraDepositReasons.push(`${pendingDailyReports} diarios pendientes: +$${amount}`);
  }

  return {
    age,
    decision: blockers.length > 0 ? "no_aplica" : extraDeposit > 0 ? "aplica_con_abono" : "aplica",
    extraDeposit,
    blockers,
    extraDepositReasons
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-PA", { dateStyle: "short", timeStyle: "short" });
}

function buildFormFromEvaluation(evaluation: LeadEvaluation): LeadForm {
  return {
    cedula: evaluation.cedula,
    birthDate: evaluation.birthDate,
    attachmentName: evaluation.attachmentName ?? "",
    attachmentDataUrl: evaluation.attachmentDataUrl ?? "",
    noCases: evaluation.noCases,
    hasGpsTamperingReport: evaluation.hasGpsTamperingReport,
    hasLegalCases: evaluation.hasLegalCases,
    hasViolenceReports: evaluation.hasViolenceReports,
    hasDuiReports: evaluation.hasDuiReports,
    hasPiracyReports: evaluation.hasPiracyReports,
    collisionReports: String(evaluation.collisionReports),
    pendingDailyReports: String(evaluation.pendingDailyReports ?? 0)
  };
}

export default function LeadsPage({ evaluations, onEvaluationsChange, onEvaluationLoad, loading, cloudError, readOnly = false, ownerUserId }: Props) {
  const [form, setForm] = useState<LeadForm>(initialForm);
  const [queryCedula, setQueryCedula] = useState("");
  const [flowMode, setFlowMode] = useState<LeadFlowMode>("idle");
  const [includeDetails, setIncludeDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [sellerRequests, setSellerRequests] = useState<SellerLeadRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [publicPortalUrl, setPublicPortalUrl] = useState("");
  const [portalError, setPortalError] = useState("");
  const [activeSellerRequest, setActiveSellerRequest] = useState<SellerLeadRequest | null>(null);
  const verdictRef = useRef<HTMLDivElement | null>(null);
  const verdict = useMemo(() => buildVerdict(form), [form]);
  const normalizedQuery = normalizeCedula(queryCedula || form.cedula);
  const matchingEvaluation = useMemo(
    () => evaluations.find((evaluation) => normalizeCedula(evaluation.cedula) === normalizedQuery) ?? null,
    [evaluations, normalizedQuery]
  );
  const displayedEvaluations = useMemo(() => {
    const focusedCedula = normalizeCedula(form.cedula || queryCedula);
    if (!focusedCedula) return evaluations;
    return evaluations.filter((evaluation) => normalizeCedula(evaluation.cedula) === focusedCedula);
  }, [evaluations, form.cedula, queryCedula]);

  async function refreshSellerRequests(): Promise<void> {
    if (!ownerUserId) return;
    setRequestsLoading(true);
    try {
      setSellerRequests(await loadSellerLeadRequests(ownerUserId));
    } catch {
      setErrors(["No se pudieron cargar las solicitudes de vendedores."]);
    } finally {
      setRequestsLoading(false);
    }
  }

  useEffect(() => { void refreshSellerRequests(); }, [ownerUserId]);

  async function handleCreateSellerRequest(): Promise<void> {
    if (!ownerUserId || readOnly) return;
    setSaving(true);
    try {
      setPortalError("");
      const portalId = await getSellerLeadPortalId(ownerUserId);
      const url = `${window.location.origin}/consulta-vendedores/${portalId}`;
      setPublicPortalUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setMessage("Enlace público copiado. Comparte este mismo enlace con todos los vendedores.");
      } catch {
        setPortalError("El enlace está listo. Puedes copiarlo manualmente desde el campo de abajo.");
      }
    } catch {
      setPortalError("No se pudo obtener el enlace público. Verifica que la migración 66 esté aplicada.");
    } finally {
      setSaving(false);
    }
  }

  function openSellerRequest(request: SellerLeadRequest): void {
    if (request.status !== "pending_review") return;
    setActiveSellerRequest(request);
    setForm({
      ...initialForm,
      cedula: request.cedula,
      birthDate: request.birthDate,
      attachmentName: request.attachmentName ?? "",
      attachmentDataUrl: request.attachmentDataUrl ?? ""
    });
    setQueryCedula(request.cedula);
    setFlowMode("creating");
    setMessage("Informacion del vendedor cargada. Completa la revision interna.");
    setErrors([]);
  }

  async function handleRequestCorrection(request: SellerLeadRequest): Promise<void> {
    if (readOnly || saving) return;
    const note = window.prompt("Indica al vendedor que debe corregir:", request.correctionNote ?? "");
    if (!note?.trim()) return;
    setSaving(true);
    try {
      await markSellerLeadRequestIncomplete(request.id, note.trim());
      await refreshSellerRequests();
      if (activeSellerRequest?.id === request.id) handleNewEvaluation();
      setMessage("Se habilito el enlace para que el vendedor corrija la informacion.");
    } catch {
      setErrors(["No se pudo solicitar la correccion."]);
    } finally {
      setSaving(false);
    }
  }

  function updateReportFlag(field: keyof Pick<LeadForm, "hasGpsTamperingReport" | "hasLegalCases" | "hasViolenceReports" | "hasDuiReports" | "hasPiracyReports">, checked: boolean): void {
    setForm((current) => ({
      ...current,
      noCases: checked ? false : current.noCases,
      [field]: checked
    }));
  }

  async function handleNoCasesChange(checked: boolean): Promise<void> {
    if (readOnly) return;
    const nextForm = {
      ...form,
      noCases: checked,
      hasGpsTamperingReport: checked ? false : form.hasGpsTamperingReport,
      hasLegalCases: checked ? false : form.hasLegalCases,
      hasViolenceReports: checked ? false : form.hasViolenceReports,
      hasDuiReports: checked ? false : form.hasDuiReports,
      hasPiracyReports: checked ? false : form.hasPiracyReports,
      collisionReports: checked ? "0" : form.collisionReports,
      pendingDailyReports: checked ? "0" : form.pendingDailyReports
    };
    setForm(nextForm);
    if (!checked || activeSellerRequest) return;
    const nextVerdict = buildVerdict(nextForm);
    const nextErrors = validate(nextForm, nextVerdict);
    if (nextErrors.length > 0) {
      setErrors([]);
      setMessage("Sin casos seleccionado. Completa cedula, fecha y adjunto para cerrar el dictamen.");
      return;
    }
    await saveEvaluation(nextForm, nextVerdict, `Dictamen cerrado automaticamente: ${decisionLabel[nextVerdict.decision]}.`);
  }

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    if (readOnly) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el adjunto."));
      reader.readAsDataURL(file);
    });
    setForm((current) => ({ ...current, attachmentName: file.name, attachmentDataUrl: dataUrl }));
  }

  async function loadEvaluationForViewing(evaluation: LeadEvaluation): Promise<LeadEvaluation> {
    if (evaluation.attachmentDataUrl || !onEvaluationLoad) return evaluation;
    return await onEvaluationLoad(evaluation.id) ?? evaluation;
  }

  async function openEvaluation(evaluation: LeadEvaluation): Promise<void> {
    const fullEvaluation = await loadEvaluationForViewing(evaluation);
    setForm(buildFormFromEvaluation(fullEvaluation));
    setQueryCedula(fullEvaluation.cedula);
    setFlowMode("viewing");
    setActiveSellerRequest(null);
    setMessage("Esta registrado. Se cargo el dictamen anterior.");
    setErrors([]);
  }

  function handleConsultCedula(): void {
    setActiveSellerRequest(null);
    const cedula = normalizeCedula(queryCedula);
    if (!cedula) {
      setErrors(["Coloca una cedula para consultar."]);
      setMessage("");
      setFlowMode("idle");
      return;
    }
    const match = evaluations.find((evaluation) => normalizeCedula(evaluation.cedula) === cedula);
    if (!match) {
      setForm({ ...initialForm, cedula });
      setFlowMode("creating");
      setMessage("No esta registrado. Completa la informacion para crear el Lead.");
      setErrors([]);
      return;
    }
    void openEvaluation(match);
  }

  function buildDictamenText(targetForm: LeadForm, targetVerdict: LeadVerdict, withDetails = false): string {
    const lines = [
      `Cedula: ${normalizeCedula(targetForm.cedula)}`,
      `Resultado: ${decisionLabel[targetVerdict.decision]}`
    ];
    if (targetVerdict.extraDeposit > 0) {
      lines.push(`Abono extra: $${targetVerdict.extraDeposit}`);
    }
    if (withDetails) {
      if (targetVerdict.blockers.length > 0) {
        lines.push(`Detalle: ${targetVerdict.blockers.join(", ")}`);
      } else if (targetVerdict.extraDepositReasons.length > 0) {
        lines.push(`Detalle: ${targetVerdict.extraDepositReasons.join(", ")}`);
      } else {
        lines.push("Detalle: Sin causales de rechazo ni abono extra");
      }
    }
    return lines.join("\n");
  }

  async function handleCopyWhatsAppText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildDictamenText(form, verdict, includeDetails));
      setMessage("Texto del dictamen copiado al portapapeles.");
    } catch {
      setMessage("No se pudo copiar automaticamente. Puedes copiar el texto desde el dictamen.");
    }
  }

  async function handleCopyVerdictImage(): Promise<void> {
    if (!verdictRef.current) return;
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(verdictRef.current, {
      backgroundColor: "#ffffff",
      scale: 2,
      ignoreElements: (element) => element.classList.contains("lead-result-actions")
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob || !navigator.clipboard || typeof ClipboardItem === "undefined") {
      setMessage("No se pudo copiar el dictamen como imagen en este navegador.");
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMessage("Dictamen copiado como imagen al portapapeles.");
    } catch {
      setMessage("No se pudo copiar el dictamen como imagen en este navegador.");
    }
  }

  function validate(targetForm: LeadForm = form, targetVerdict: LeadVerdict = verdict): string[] {
    const nextErrors: string[] = [];
    if (!targetForm.cedula.trim()) nextErrors.push("La cedula es obligatoria.");
    if (!targetForm.birthDate) nextErrors.push("La fecha de nacimiento es obligatoria.");
    if (targetVerdict.age === null) nextErrors.push("La fecha de nacimiento no es valida.");
    if (!targetForm.attachmentName) nextErrors.push("Debes adjuntar foto de cedula o licencia.");
    const collisionReports = Number(targetForm.collisionReports);
    if (!targetForm.noCases && (!Number.isInteger(collisionReports) || collisionReports < 0)) {
      nextErrors.push("Los reportes de colision deben ser un entero mayor o igual a 0.");
    }
    const pendingDailyReports = Number(targetForm.pendingDailyReports);
    if (!targetForm.noCases && (!Number.isInteger(pendingDailyReports) || pendingDailyReports < 0)) {
      nextErrors.push("Los diarios pendientes deben ser un entero mayor o igual a 0.");
    }
    return nextErrors;
  }

  async function saveEvaluation(targetForm: LeadForm, targetVerdict: LeadVerdict, successMessage?: string): Promise<void> {
    if (readOnly) return;
    if (targetVerdict.age === null) return;
    const normalizedCedula = normalizeCedula(targetForm.cedula);
    const previous = evaluations.find((evaluation) => normalizeCedula(evaluation.cedula) === normalizedCedula);
    const now = new Date().toISOString();
    const nextEvaluation: LeadEvaluation = {
      id: previous?.id ?? crypto.randomUUID(),
      cedula: normalizedCedula,
      birthDate: targetForm.birthDate,
      age: targetVerdict.age,
      attachmentName: targetForm.attachmentName || undefined,
      attachmentDataUrl: targetForm.attachmentDataUrl || undefined,
      noCases: targetForm.noCases,
      hasGpsTamperingReport: targetForm.noCases ? false : targetForm.hasGpsTamperingReport,
      hasLegalCases: targetForm.noCases ? false : targetForm.hasLegalCases,
      hasViolenceReports: targetForm.noCases ? false : targetForm.hasViolenceReports,
      hasDuiReports: targetForm.noCases ? false : targetForm.hasDuiReports,
      hasPiracyReports: targetForm.noCases ? false : targetForm.hasPiracyReports,
      collisionReports: targetForm.noCases ? 0 : parseCollisionReports(targetForm.collisionReports),
      pendingDailyReports: targetForm.noCases ? 0 : parseCollisionReports(targetForm.pendingDailyReports),
      decision: targetVerdict.decision,
      extraDeposit: targetVerdict.extraDeposit,
      blockers: targetVerdict.blockers,
      extraDepositReasons: targetVerdict.extraDepositReasons,
      sellerRequestId: activeSellerRequest?.id ?? previous?.sellerRequestId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    };
    const next = [
      nextEvaluation,
      ...evaluations.filter((evaluation) => evaluation.id !== nextEvaluation.id)
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setSaving(true);
    try {
      await onEvaluationsChange(next);
      if (activeSellerRequest) {
        await markSellerLeadRequestReviewed(activeSellerRequest.id, nextEvaluation.id);
        await refreshSellerRequests();
      }
      setQueryCedula(normalizedCedula);
      setFlowMode("viewing");
      setMessage(successMessage ?? `Dictamen guardado: ${decisionLabel[nextEvaluation.decision]}.`);
      setErrors([]);
    } catch {
      setErrors(["No se pudo guardar el Lead en nube. Intenta nuevamente."]);
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (nextErrors.length > 0) return;
    void saveEvaluation(form, verdict);
  }

  function handleNewEvaluation(): void {
    setForm(initialForm);
    setQueryCedula("");
    setFlowMode("idle");
    setIncludeDetails(false);
    setMessage("");
    setErrors([]);
    setActiveSellerRequest(null);
  }

  async function handleDeleteEvaluation(evaluationId: string): Promise<void> {
    const target = evaluations.find((evaluation) => evaluation.id === evaluationId);
    const confirmed = window.confirm(`¿Borrar el dictamen${target ? ` de ${target.cedula}` : ""}?`);
    if (!confirmed) return;
    const next = evaluations.filter((evaluation) => evaluation.id !== evaluationId);
    setSaving(true);
    try {
      await onEvaluationsChange(next);
      if (matchingEvaluation?.id === evaluationId) {
        handleNewEvaluation();
      }
      setMessage("Dictamen borrado.");
    } catch {
      setErrors(["No se pudo borrar el dictamen en nube. Intenta nuevamente."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lead-page">
      <section className="hero">
        <h1>Leads</h1>
        <p>Consulta inicial para determinar si una persona aplica, no aplica o requiere abono extra.</p>
      </section>

      <section className="panel lead-query-panel">
        <div className="panel-head">
          <h2>Consulta por cedula</h2>
          <button type="button" className="button ghost small" onClick={handleNewEvaluation} disabled={readOnly || saving || loading}>
            Nuevo
          </button>
        </div>
        <div className="lead-query-row">
          <label>
            Cedula
            <input value={queryCedula} onChange={(event) => setQueryCedula(event.target.value)} placeholder="Ej. 8-888-888" disabled={saving || loading} />
          </label>
          <button type="button" className="button primary" onClick={handleConsultCedula} disabled={saving || loading || Boolean(cloudError)}>
            Consultar
          </button>
        </div>
        {matchingEvaluation && (
          <p className="hint">
            Ultimo dictamen guardado: <strong>{decisionLabel[matchingEvaluation.decision]}</strong> - {formatDateTime(matchingEvaluation.updatedAt)}
          </p>
        )}
        {errors.length > 0 && flowMode === "idle" && (
          <ul className="error-list">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}
        {message && flowMode !== "creating" && <p className="success-banner">{message}</p>}
        {loading && <p className="hint">Cargando Leads desde nube...</p>}
        {cloudError && <p className="error-banner">{cloudError}</p>}
      </section>

      <section className="panel lead-seller-requests">
        <div className="panel-head">
          <div>
            <h2>Zona de vendedores</h2>
            <p className="hint">Un solo enlace público para todos los vendedores: consulta por cédula y envío de personas nuevas a verificación.</p>
          </div>
          <div className="lead-row-actions">
            <button type="button" className="button ghost small" onClick={() => void refreshSellerRequests()} disabled={!ownerUserId || requestsLoading}>Actualizar</button>
            <button type="button" className="button primary small" onClick={() => void handleCreateSellerRequest()} disabled={!ownerUserId || readOnly || saving}>
              Copiar enlace público
            </button>
          </div>
        </div>
        {portalError && <p role="status" className="hint">{portalError}</p>}
        {publicPortalUrl && <label className="seller-shared-link">Enlace para todos los vendedores<input readOnly value={publicPortalUrl} onFocus={(event) => event.target.select()} /></label>}
        {requestsLoading && <p className="hint">Cargando solicitudes...</p>}
        <div className="lead-request-list">
          {sellerRequests.length === 0 && !requestsLoading && <p className="hint">Aun no hay solicitudes enviadas a vendedores.</p>}
          {sellerRequests.map((request) => (
            <article className="lead-request-item" key={request.id}>
              <div>
                <strong>{request.cedula || "Vendedor pendiente de completar"}</strong>
                <span>{requestStatusLabel[request.status]} · {formatDateTime(request.updatedAt)}</span>
              </div>
              <div className="lead-row-actions">
                {request.status === "pending_review" && <button type="button" className="button primary small" onClick={() => openSellerRequest(request)}>Revisar</button>}
                {request.status === "pending_review" && <button type="button" className="button ghost small" disabled={readOnly || saving} onClick={() => void handleRequestCorrection(request)}>Solicitar correccion</button>}
              </div>
            </article>
          ))}
        </div>
      </section>

      {flowMode !== "idle" && (
      <div className={`lead-workspace ${flowMode === "viewing" ? "lead-workspace--result-only" : ""}`}>
        {flowMode === "creating" && (
        <form className="panel lead-form-panel" onSubmit={handleSubmit}>
          <div className="panel-head">
            <h2>Revision</h2>
            <span className={`lead-decision-pill lead-decision-pill--${verdict.decision}`}>
              {decisionLabel[verdict.decision]}
            </span>
          </div>

          {activeSellerRequest && <p className="success-banner">Datos enviados por el vendedor. Los campos personales estan protegidos durante la revision.</p>}

          <div className="form-grid lead-form-grid">
            <label>
              Cedula
              <input value={form.cedula} onChange={(event) => setForm((current) => ({ ...current, cedula: event.target.value }))} disabled={Boolean(activeSellerRequest) || readOnly || saving || loading} />
            </label>
            <label>
              Fecha de nacimiento
              <input type="date" value={form.birthDate} onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))} disabled={Boolean(activeSellerRequest) || readOnly || saving || loading} />
            </label>
            <label>
              Foto de cedula o licencia
              <input type="file" accept="image/*,.pdf" onChange={(event) => void handleAttachmentChange(event)} disabled={Boolean(activeSellerRequest) || readOnly || saving || loading} />
            </label>
            <label>
              Reportes de colision/choque
              <input
                type="number"
                min="0"
                step="1"
                value={form.collisionReports}
                disabled={readOnly || form.noCases || saving || loading}
                onChange={(event) => setForm((current) => ({ ...current, noCases: false, collisionReports: event.target.value }))}
              />
            </label>
            <label>
              Diarios pendientes
              <input
                type="number"
                min="0"
                step="1"
                value={form.pendingDailyReports}
                disabled={readOnly || form.noCases || saving || loading}
                onChange={(event) => setForm((current) => ({ ...current, noCases: false, pendingDailyReports: event.target.value }))}
              />
            </label>
          </div>

          {form.attachmentName && <p className="hint">Adjunto: {form.attachmentName}</p>}

          <div className="lead-report-grid">
            <label className="lead-check lead-check--clean">
              <input type="checkbox" checked={form.noCases} disabled={readOnly || saving || loading} onChange={(event) => void handleNoCasesChange(event.target.checked)} />
              Sin casos
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasGpsTamperingReport} disabled={readOnly || form.noCases || saving || loading} onChange={(event) => updateReportFlag("hasGpsTamperingReport", event.target.checked)} />
              Quitar/manipular GPS
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasLegalCases} disabled={readOnly || form.noCases || saving || loading} onChange={(event) => updateReportFlag("hasLegalCases", event.target.checked)} />
              Casos legales
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasViolenceReports} disabled={readOnly || form.noCases || saving || loading} onChange={(event) => updateReportFlag("hasViolenceReports", event.target.checked)} />
              Reportes de violencia
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasDuiReports} disabled={readOnly || form.noCases || saving || loading} onChange={(event) => updateReportFlag("hasDuiReports", event.target.checked)} />
              Alcoholemia
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasPiracyReports} disabled={readOnly || form.noCases || saving || loading} onChange={(event) => updateReportFlag("hasPiracyReports", event.target.checked)} />
              Pirateria
            </label>
          </div>

          {errors.length > 0 && (
            <ul className="error-list">
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          )}
          {message && <p className="success-banner">{message}</p>}

          <div className="modal-actions">
            <button type="submit" className="button primary" disabled={readOnly || saving || loading || Boolean(cloudError)}>
              {saving ? "Guardando..." : activeSellerRequest ? "Guardar y publicar dictamen" : "Procesar y guardar dictamen"}
            </button>
          </div>
        </form>
        )}

        <aside className="panel lead-verdict-panel" ref={verdictRef}>
          <div className="panel-head">
            <h2>Dictamen</h2>
            {flowMode === "viewing" && (
              <div className="lead-result-actions">
                <label className="lead-detail-toggle">
                  <input type="checkbox" checked={includeDetails} onChange={(event) => setIncludeDetails(event.target.checked)} />
                  Incluir detalle
                </label>
                <button type="button" className="button ghost small" onClick={() => void handleCopyWhatsAppText()}>
                  Copiar texto
                </button>
                <button type="button" className="button ghost small" onClick={() => void handleCopyVerdictImage()}>
                  Copiar dictamen
                </button>
              </div>
            )}
          </div>
          <div className={`lead-verdict-card lead-verdict-card--${verdict.decision}`}>
            <span>Resultado</span>
            <strong>{decisionLabel[verdict.decision]}</strong>
            <p>Abono extra: ${verdict.extraDeposit}</p>
          </div>

          <div className="lead-dictamen-section">
            <h3>Requisitos</h3>
            <ul>
              <li>Edad minima 27: {verdict.age === null ? "Pendiente" : verdict.age >= 27 ? "Cumple" : verdict.age >= 22 ? "Aplica con abono" : "No cumple"}</li>
              <li>Licencia: debe validar en la entrega del documento</li>
              <li>Record policivo: debe validar en la revision</li>
              <li>Historial de transito: debe validar en la revision</li>
            </ul>
          </div>

          {includeDetails && (
            <div className="lead-dictamen-section">
              <h3>Detalle</h3>
              {verdict.blockers.length > 0 ? (
                <ul>
                  {verdict.blockers.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : verdict.extraDepositReasons.length > 0 ? (
                <ul>
                  {verdict.extraDepositReasons.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : (
                <p className="hint">Sin causales de rechazo ni abono extra.</p>
              )}
            </div>
          )}

          {form.attachmentName && (
            <div className="lead-dictamen-section">
              <h3>Documento adjunto</h3>
              {form.attachmentDataUrl.startsWith("data:image/") ? (
                <img className="lead-document-preview" src={form.attachmentDataUrl} alt={`Documento adjunto ${form.attachmentName}`} />
              ) : (
                <p className="lead-document-file">{form.attachmentName}</p>
              )}
            </div>
          )}
        </aside>
      </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Dictamenes recientes</h2>
        </div>
        <div className="table-scroll lead-table-scroll">
          <table className="lead-table">
            <thead>
              <tr>
                <th>Cedula</th>
                <th>Edad</th>
                <th>Resultado</th>
                <th>Abono</th>
                <th>Actualizado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {displayedEvaluations.length === 0 && (
                <tr>
                  <td colSpan={6}>Aun no hay dictamenes guardados.</td>
                </tr>
              )}
              {displayedEvaluations.map((evaluation) => (
                <tr key={evaluation.id}>
                  <td>{evaluation.cedula}</td>
                  <td>{evaluation.age}</td>
                  <td><span className={`lead-decision-pill lead-decision-pill--${evaluation.decision}`}>{decisionLabel[evaluation.decision]}</span></td>
                  <td>${evaluation.extraDeposit}</td>
                  <td>{formatDateTime(evaluation.updatedAt)}</td>
                  <td>
                    <div className="lead-row-actions">
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => void openEvaluation(evaluation)}
                    >
                      Abrir
                    </button>
                    <button
                      type="button"
                      className="button danger small"
                      disabled={readOnly || saving || loading}
                      onClick={() => void handleDeleteEvaluation(evaluation.id)}
                    >
                      Borrar
                    </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
