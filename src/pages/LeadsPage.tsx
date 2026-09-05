import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  getSellerLeadPortalId,
  loadSellerLeadRequests,
  loadSellerLeadRequest,
  correctSellerLeadRequest,
  markSellerLeadRequestIncomplete,
  markSellerLeadRequestReviewed
} from "../cloudData";
import type { LeadDecision, LeadEvaluation, SellerLeadRequest, SellerLeadRequestStatus } from "../types";
import { sellerCedulaKey, validSellerCedula, validSellerCedulaInput, validSellerBirthDate } from "../sellerLeadPortalRules";
import LeadDocumentPreview from "../components/LeadDocumentPreview";

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
  onEvaluationSave?: (item: LeadEvaluation) => Promise<void>;
  onEvaluationDelete?: (id: string) => Promise<void>;
  onEvaluationLoad?: (evaluationId: string) => Promise<LeadEvaluation | null>;
  onEvaluationFind?: (cedula: string) => Promise<LeadEvaluation | null>;
  onLoadMore?: () => Promise<void>;
  onRefresh?: () => void;
  hasMore?: boolean;
  loading: boolean;
  cloudError: string;
  readOnly?: boolean;
  ownerUserId?: string;
};

type LeadFlowMode = "idle" | "creating" | "viewing" | "editing";

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

export default function LeadsPage({ evaluations, onEvaluationsChange, onEvaluationSave, onEvaluationDelete, onEvaluationLoad, onEvaluationFind, onLoadMore, onRefresh, hasMore = false, loading, cloudError, readOnly = false, ownerUserId }: Props) {
  const [form, setForm] = useState<LeadForm>(initialForm);
  const [queryCedula, setQueryCedula] = useState("");
  const [flowMode, setFlowMode] = useState<LeadFlowMode>("idle");
  const [activeListTab, setActiveListTab] = useState<"sellers" | "recent">("sellers");
  const [includeDetails, setIncludeDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consulting, setConsulting] = useState(false);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [openedEvaluationId, setOpenedEvaluationId] = useState<string | null>(null);
  const [editingEvaluation, setEditingEvaluation] = useState<LeadEvaluation | null>(null);
  const [sellerEditSnapshot, setSellerEditSnapshot] = useState<LeadForm | null>(null);
  const requestVersion = useRef(0);
  const sellerVersion = useRef(0);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [sellerRequests, setSellerRequests] = useState<SellerLeadRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState("");
  const [requestsHasMore, setRequestsHasMore] = useState(false);
  const [publicPortalUrl, setPublicPortalUrl] = useState("");
  const [portalError, setPortalError] = useState("");
  const [activeSellerRequest, setActiveSellerRequest] = useState<SellerLeadRequest | null>(null);
  const verdictRef = useRef<HTMLDivElement | null>(null);
  const verdict = useMemo(() => buildVerdict(form), [form]);
  const normalizedQuery = normalizeCedula(queryCedula || form.cedula);
  const matchingEvaluation = useMemo(
    () => evaluations.find((evaluation) => sellerCedulaKey(evaluation.cedula) === sellerCedulaKey(normalizedQuery)) ?? null,
    [evaluations, normalizedQuery]
  );
  const displayedEvaluations = useMemo(() => {
    const focusedCedula = normalizeCedula(form.cedula || queryCedula);
    if (!focusedCedula) return evaluations;
    return evaluations.filter((evaluation) => sellerCedulaKey(evaluation.cedula) === sellerCedulaKey(focusedCedula));
  }, [evaluations, form.cedula, queryCedula]);

  async function refreshSellerRequests(append = false): Promise<void> {
    if (!ownerUserId) return;
    const version = ++sellerVersion.current;
    setRequestsLoading(true);
    setRequestsError("");
    try {
      const rows = await loadSellerLeadRequests(ownerUserId, append ? sellerRequests.length : 0);
      if (version !== sellerVersion.current) return;
      setRequestsHasMore(rows.length > 20);
      setSellerRequests(current => append
        ? [...new Map([...current, ...rows.slice(0, 20)].map(row => [row.id, row])).values()]
        : rows.slice(0, 20));
    } catch {
      if (version === sellerVersion.current) setRequestsError("No se pudieron cargar las solicitudes de vendedores. Intenta actualizar nuevamente.");
    } finally {
      if (version === sellerVersion.current) setRequestsLoading(false);
    }
  }

  useEffect(() => {
    setSellerRequests([]);
    setRequestsHasMore(false);
    handleNewEvaluation();
    void refreshSellerRequests();
    return () => { sellerVersion.current++; requestVersion.current++; };
  }, [ownerUserId]);

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

  async function openSellerRequest(request: SellerLeadRequest): Promise<void> {
    if (request.status !== "pending_review" || !ownerUserId || consulting) return;
    const version = ++requestVersion.current;
    setConsulting(true);
    try {
    const full = await loadSellerLeadRequest(ownerUserId, request.id);
    if (version !== requestVersion.current) return;
    if (full.status !== "pending_review") {
      setErrors(["La solicitud ya cambió. Actualiza la lista de vendedores."]);
      return;
    }
    setActiveSellerRequest(full);
    setSellerEditSnapshot(null);
    setEditingEvaluation(null);
    setOpenedEvaluationId(null);
    setForm({
      ...initialForm,
      cedula: full.cedula,
      birthDate: full.birthDate,
      attachmentName: full.attachmentName ?? "",
      attachmentDataUrl: full.attachmentDataUrl ?? ""
    });
    setQueryCedula(full.cedula);
    setFlowMode("creating");
    setMessage("Informacion del vendedor cargada. Completa la revision interna.");
    setErrors([]);
    } catch {
      if (version === requestVersion.current) setErrors(["No se pudo abrir la solicitud. Intenta nuevamente."]);
    } finally {
      if (version === requestVersion.current) setConsulting(false);
    }
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
    if (!checked || activeSellerRequest || editingEvaluation) return;
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
    if (readOnly || saving || consulting) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const version = requestVersion.current;
    setDocumentLoading(true);
    try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el adjunto."));
      reader.readAsDataURL(file);
    });
    if (version === requestVersion.current) setForm((current) => ({ ...current, attachmentName: file.name, attachmentDataUrl: dataUrl }));
    } catch {
      if (version === requestVersion.current) setErrors(["No se pudo leer el documento. Intenta adjuntarlo nuevamente."]);
    } finally {
      if (version === requestVersion.current) setDocumentLoading(false);
    }
  }

  function openEvaluation(evaluation: LeadEvaluation): void {
    setEditingEvaluation(null);
    setSellerEditSnapshot(null);
    requestVersion.current++;
    setConsulting(false);
    setDocumentLoading(false);
    setOpenedEvaluationId(evaluation.id);
    setForm(buildFormFromEvaluation(evaluation));
    setQueryCedula(evaluation.cedula);
    setFlowMode("viewing");
    setActiveSellerRequest(null);
    setMessage("Esta registrado. Se cargo el dictamen anterior.");
    setErrors([]);
  }

  async function handleEditEvaluation(evaluationId: string): Promise<void> {
    if (readOnly || saving || consulting) return;
    const version = ++requestVersion.current;
    setConsulting(true);
    setErrors([]);
    try {
      const full = onEvaluationLoad ? await onEvaluationLoad(evaluationId) : evaluations.find(item => item.id === evaluationId);
      if (version !== requestVersion.current) return;
      if (!full || (full.attachmentName && !full.attachmentDataUrl)) throw new Error("Documento no disponible");
      setEditingEvaluation(full);
      setSellerEditSnapshot(null);
      setActiveSellerRequest(null);
      setOpenedEvaluationId(full.id);
      setForm(buildFormFromEvaluation(full));
      setQueryCedula(full.cedula);
      setFlowMode("editing");
      setMessage("Corrige los datos y pulsa Guardar cambios. El dictamen se recalculará con la información corregida.");
      document.querySelector(".lead-query-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      if (version === requestVersion.current) setErrors(["No se pudo cargar el Lead completo para editar. Intenta nuevamente."]);
    } finally {
      if (version === requestVersion.current) setConsulting(false);
    }
  }

  async function handleSaveSellerCorrection(): Promise<void> {
    if (readOnly || saving || documentLoading || !ownerUserId || !activeSellerRequest || !sellerEditSnapshot) return;
    const nextErrors = validate();
    if (nextErrors.length) { setErrors(nextErrors); return; }
    setSaving(true);
    setErrors([]);
    try {
      const cedula = normalizeCedula(form.cedula);
      if (sellerCedulaKey(cedula) !== sellerCedulaKey(activeSellerRequest.cedula)) {
        const existing = onEvaluationFind ? await onEvaluationFind(cedula) : evaluations.find(item => sellerCedulaKey(item.cedula) === sellerCedulaKey(cedula));
        if (existing) { setErrors(["Esa cédula ya tiene un dictamen. Abre ese Lead para corregirlo."]); return; }
      }
      const corrected = await correctSellerLeadRequest(ownerUserId, activeSellerRequest, {
        cedula, birthDate: form.birthDate, attachmentName: form.attachmentName, attachmentDataUrl: form.attachmentDataUrl
      });
      setActiveSellerRequest(corrected);
      setSellerEditSnapshot(null);
      setQueryCedula(cedula);
      await refreshSellerRequests();
      setMessage("Datos corregidos y guardados. La solicitud sigue pendiente de revisión.");
    } catch {
      setErrors(["No se pudieron guardar las correcciones. La solicitud puede haber cambiado; vuelve a abrirla antes de reintentar."]);
    } finally { setSaving(false); }
  }

  async function handleLoadDocument(): Promise<void> {
    if (!openedEvaluationId || !onEvaluationLoad || documentLoading) return;
    const version = requestVersion.current;
    setDocumentLoading(true);
    setErrors([]);
    try {
      const full = await onEvaluationLoad(openedEvaluationId);
      if (version !== requestVersion.current) return;
      if (!full?.attachmentDataUrl) throw new Error("Documento no disponible");
      setForm(current => ({ ...current, attachmentName: full.attachmentName ?? "", attachmentDataUrl: full.attachmentDataUrl ?? "" }));
    } catch {
      if (version === requestVersion.current) setErrors(["No se pudo cargar el documento. Intenta nuevamente."]);
    } finally {
      if (version === requestVersion.current) setDocumentLoading(false);
    }
  }

  async function handleConsultCedula(): Promise<void> {
    setActiveSellerRequest(null);
    const cedula = normalizeCedula(queryCedula);
    if (!validSellerCedula(queryCedula)) {
      setErrors(["Coloca una cédula válida: solo números y guiones (-)."]);
      setMessage("");
      setFlowMode("idle");
      return;
    }
    const version = ++requestVersion.current;
    setConsulting(true);
    setErrors([]);
    setMessage("");
    setFlowMode("idle");
    setForm(initialForm);
    setOpenedEvaluationId(null);
    try {
    const match = onEvaluationFind ? await onEvaluationFind(cedula)
      : evaluations.find((evaluation) => sellerCedulaKey(evaluation.cedula) === sellerCedulaKey(cedula));
    if (version !== requestVersion.current) return;
    if (!match) {
      setForm({ ...initialForm, cedula });
      setFlowMode("creating");
      setMessage("No esta registrado. Completa la informacion para crear el Lead.");
      setErrors([]);
      return;
    }
    openEvaluation(match);
    } catch {
      if (version === requestVersion.current) setErrors(["No se pudo consultar la cédula. Intenta nuevamente antes de crear un Lead."]);
    } finally {
      if (version === requestVersion.current) setConsulting(false);
    }
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
    if (!validSellerCedula(targetForm.cedula)) nextErrors.push("La cédula debe contener solo números y guiones (-).");
    if (!targetForm.birthDate) nextErrors.push("La fecha de nacimiento es obligatoria.");
    if (targetVerdict.age === null || !validSellerBirthDate(targetForm.birthDate)) nextErrors.push("La fecha de nacimiento no es valida.");
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
    if (readOnly || saving || documentLoading || sellerEditSnapshot) return;
    if (targetVerdict.age === null) return;
    setSaving(true);
    let evaluationSaved = false;
    try {
    const normalizedCedula = normalizeCedula(targetForm.cedula);
    const match = onEvaluationFind ? await onEvaluationFind(normalizedCedula)
      : evaluations.find((evaluation) => sellerCedulaKey(evaluation.cedula) === sellerCedulaKey(normalizedCedula));
    if (editingEvaluation && match && match.id !== editingEvaluation.id) {
      setErrors(["Esa cédula ya pertenece a otro Lead. No se guardaron los cambios."]);
      return;
    }
    const previous = editingEvaluation ?? match;
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
      if (onEvaluationSave) await onEvaluationSave(nextEvaluation);
      else await onEvaluationsChange(next);
      evaluationSaved = true;
      if (editingEvaluation) setEditingEvaluation(nextEvaluation);
      if (activeSellerRequest || (editingEvaluation && nextEvaluation.sellerRequestId)) {
        await markSellerLeadRequestReviewed(activeSellerRequest?.id ?? nextEvaluation.sellerRequestId!, nextEvaluation.id, {
          cedula: nextEvaluation.cedula, birthDate: nextEvaluation.birthDate,
          attachmentName: targetForm.attachmentName, attachmentDataUrl: targetForm.attachmentDataUrl
        });
        await refreshSellerRequests();
      }
      setEditingEvaluation(null);
      setActiveSellerRequest(null);
      setQueryCedula(normalizedCedula);
      setOpenedEvaluationId(nextEvaluation.id);
      setFlowMode("viewing");
      setMessage(successMessage ?? `Dictamen guardado: ${decisionLabel[nextEvaluation.decision]}.`);
      setErrors([]);
    } catch {
      setErrors([evaluationSaved ? "El dictamen se guardó, pero no se pudo actualizar la solicitud del vendedor. Guarda nuevamente para completar la actualización." : "No se pudo guardar el Lead en nube. Intenta nuevamente."]);
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
    requestVersion.current++;
    setConsulting(false);
    setDocumentLoading(false);
    setOpenedEvaluationId(null);
    setEditingEvaluation(null);
    setSellerEditSnapshot(null);
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
      if (onEvaluationDelete) await onEvaluationDelete(evaluationId);
      else await onEvaluationsChange(next);
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
          <button type="button" className="button ghost small" onClick={handleNewEvaluation} disabled={saving}>
            Nuevo
          </button>
        </div>
        <div className="lead-query-row">
          <label>
            Cedula
            <input value={queryCedula} inputMode="tel" pattern={"[0-9\\-]*"} maxLength={32} title="Solo números y guiones (-)" onChange={(event) => { if (validSellerCedulaInput(event.target.value)) { handleNewEvaluation(); setQueryCedula(event.target.value); } }} placeholder="Ej. 8-888-888" disabled={saving} />
          </label>
          <button type="button" className="button primary" onClick={() => void handleConsultCedula()} disabled={saving || consulting}>
            {consulting ? "Consultando..." : "Consultar"}
          </button>
        </div>
        {matchingEvaluation && (
          <p className="hint">
            Ultimo dictamen guardado: <strong>{decisionLabel[matchingEvaluation.decision]}</strong> - {formatDateTime(matchingEvaluation.updatedAt)}
          </p>
        )}
        {errors.length > 0 && flowMode !== "creating" && flowMode !== "editing" && (
          <ul className="error-list">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}
        {message && flowMode !== "creating" && flowMode !== "editing" && <p className="success-banner">{message}</p>}
        {loading && <p className="hint">Cargando Leads desde nube...</p>}
        {cloudError && <p className="error-banner">{cloudError}</p>}
      </section>

      {flowMode !== "idle" && (
      <div className={`lead-workspace ${flowMode === "viewing" ? "lead-workspace--result-only" : ""}`}>
        {(flowMode === "creating" || flowMode === "editing") && (
        <form className="panel lead-form-panel" onSubmit={handleSubmit}>
          <div className="panel-head">
            <h2>{flowMode === "editing" ? "Editar Lead" : "Revision"}</h2>
            <span className={`lead-decision-pill lead-decision-pill--${verdict.decision}`}>
              {decisionLabel[verdict.decision]}
            </span>
          </div>

          {activeSellerRequest && <div className="success-banner">
            <p>{sellerEditSnapshot ? "Corrige los datos del vendedor y guarda los cambios antes de publicar el dictamen." : "Datos enviados por el vendedor. Puedes corregirlos si tienen algún error."}</p>
            {!readOnly && !sellerEditSnapshot && <button type="button" className="button ghost small" disabled={saving || consulting} onClick={() => { setSellerEditSnapshot({ ...form }); setErrors([]); setMessage(""); }}>Editar datos</button>}
          </div>}

          <div className="form-grid lead-form-grid">
            <label>
              Cedula
              <input value={form.cedula} inputMode="tel" pattern={"[0-9\\-]*"} maxLength={32} title="Solo números y guiones (-)" onChange={(event) => { if (validSellerCedulaInput(event.target.value)) setForm((current) => ({ ...current, cedula: event.target.value })); }} disabled={(Boolean(activeSellerRequest) && !sellerEditSnapshot) || readOnly || saving || consulting} />
            </label>
            <label>
              Fecha de nacimiento
              <input type="date" value={form.birthDate} onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))} disabled={(Boolean(activeSellerRequest) && !sellerEditSnapshot) || readOnly || saving || consulting} />
            </label>
            <label>
              Foto de cedula o licencia
              <input type="file" accept="image/*,.pdf" onChange={(event) => void handleAttachmentChange(event)} disabled={(Boolean(activeSellerRequest) && !sellerEditSnapshot) || readOnly || saving || consulting} />
            </label>
            <label>
              Reportes de colision/choque
              <input
                type="number"
                min="0"
                step="1"
                value={form.collisionReports}
                disabled={readOnly || form.noCases || saving || consulting}
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
                disabled={readOnly || form.noCases || saving || consulting}
                onChange={(event) => setForm((current) => ({ ...current, noCases: false, pendingDailyReports: event.target.value }))}
              />
            </label>
          </div>

          {form.attachmentName && <p className="hint">Adjunto: {form.attachmentName}</p>}

          <div className="lead-report-grid">
            <label className="lead-check lead-check--clean">
              <input type="checkbox" checked={form.noCases} disabled={readOnly || saving || consulting || documentLoading} onChange={(event) => void handleNoCasesChange(event.target.checked)} />
              Sin casos
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasGpsTamperingReport} disabled={readOnly || form.noCases || saving || consulting} onChange={(event) => updateReportFlag("hasGpsTamperingReport", event.target.checked)} />
              Quitar/manipular GPS
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasLegalCases} disabled={readOnly || form.noCases || saving || consulting} onChange={(event) => updateReportFlag("hasLegalCases", event.target.checked)} />
              Casos legales
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasViolenceReports} disabled={readOnly || form.noCases || saving || consulting} onChange={(event) => updateReportFlag("hasViolenceReports", event.target.checked)} />
              Reportes de violencia
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasDuiReports} disabled={readOnly || form.noCases || saving || consulting} onChange={(event) => updateReportFlag("hasDuiReports", event.target.checked)} />
              Alcoholemia
            </label>
            <label className="lead-check">
              <input type="checkbox" checked={form.hasPiracyReports} disabled={readOnly || form.noCases || saving || consulting} onChange={(event) => updateReportFlag("hasPiracyReports", event.target.checked)} />
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
            {sellerEditSnapshot ? <button type="button" className="button primary" disabled={readOnly || saving || consulting || documentLoading} onClick={() => void handleSaveSellerCorrection()}>{saving ? "Guardando..." : "Guardar cambios"}</button> :
              <button type="submit" className="button primary" disabled={readOnly || saving || consulting || documentLoading}>
                {saving ? "Guardando..." : editingEvaluation ? "Guardar cambios" : activeSellerRequest ? "Guardar y publicar dictamen" : "Procesar y guardar dictamen"}
              </button>}
            {(editingEvaluation || sellerEditSnapshot) && <button type="button" className="button ghost" disabled={saving || consulting} onClick={() => {
              requestVersion.current++;
              setDocumentLoading(false);
              if (editingEvaluation) openEvaluation(editingEvaluation);
              else if (sellerEditSnapshot) { setForm(sellerEditSnapshot); setSellerEditSnapshot(null); setErrors([]); setMessage(""); }
            }}>Cancelar edición</button>}
          </div>
        </form>
        )}

        <aside className="panel lead-verdict-panel" ref={verdictRef}>
          <div className="panel-head">
            <h2>Dictamen</h2>
            {flowMode === "viewing" && (
              <div className="lead-result-actions">
                {!readOnly && openedEvaluationId && <button type="button" className="button primary small" disabled={saving || consulting || documentLoading} onClick={() => void handleEditEvaluation(openedEvaluationId)}>{consulting ? "Cargando..." : "Editar datos"}</button>}
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
              {!form.attachmentDataUrl && openedEvaluationId && onEvaluationLoad ? (
                <button type="button" className="button ghost small" disabled={documentLoading} onClick={() => void handleLoadDocument()}>{documentLoading ? "Cargando documento..." : "Ver documento"}</button>
              ) : form.attachmentDataUrl.startsWith("data:image/") ? (
                <LeadDocumentPreview key={form.attachmentDataUrl} src={form.attachmentDataUrl} name={form.attachmentName} />
              ) : (
                <p className="lead-document-file">{form.attachmentName}</p>
              )}
            </div>
          )}
        </aside>
      </div>
      )}

      <div className="lead-content-tabs" role="tablist" aria-label="Secciones de Leads">
        {([
          { id: "sellers", label: "Zona de vendedores" },
          { id: "recent", label: "Dictámenes recientes" }
        ] as const).map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`lead-tab-${tab.id}`}
            aria-controls={`lead-panel-${tab.id}`}
            aria-selected={activeListTab === tab.id}
            tabIndex={activeListTab === tab.id ? 0 : -1}
            onClick={() => setActiveListTab(tab.id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
              const nextTab = nextIndex === 0 ? "sellers" : "recent";
              setActiveListTab(nextTab);
              document.getElementById(`lead-tab-${nextTab}`)?.focus();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <section className="panel lead-seller-requests" role="tabpanel" id="lead-panel-sellers" aria-labelledby="lead-tab-sellers" hidden={activeListTab !== "sellers"}>
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
        {requestsError && <p role="alert" className="error-banner">{requestsError}</p>}
        <div className="lead-request-list">
          {sellerRequests.length === 0 && !requestsLoading && !requestsError && <p className="hint">Aun no hay solicitudes enviadas a vendedores.</p>}
          {sellerRequests.map((request) => (
            <article className="lead-request-item" key={request.id}>
              <div>
                <strong>{request.cedula || "Vendedor pendiente de completar"}</strong>
                <span>{requestStatusLabel[request.status]} · {formatDateTime(request.updatedAt)}</span>
              </div>
              <div className="lead-row-actions">
                {request.status === "pending_review" && <button type="button" className="button primary small" disabled={consulting || saving} onClick={() => void openSellerRequest(request)}>Revisar</button>}
                {request.status === "pending_review" && <button type="button" className="button ghost small" disabled={readOnly || saving} onClick={() => void handleRequestCorrection(request)}>Solicitar correccion</button>}
              </div>
            </article>
          ))}
        </div>
        {requestsHasMore && <button type="button" className="button ghost small" disabled={requestsLoading} onClick={() => void refreshSellerRequests(true)}>Ver más solicitudes</button>}
      </section>

      <section className="panel" role="tabpanel" id="lead-panel-recent" aria-labelledby="lead-tab-recent" hidden={activeListTab !== "recent"}>
        <div className="panel-head">
          <h2>Dictámenes recientes</h2>
          {onRefresh && <button type="button" className="button ghost small" onClick={onRefresh} disabled={loading || saving}>Actualizar dictámenes</button>}
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
                  <td colSpan={6}>{loading ? "Cargando dictámenes recientes..." : cloudError ? "No se pudo cargar la lista de dictámenes." : normalizedQuery ? "Sin dictámenes en esta lista para la cédula. Pulsa Consultar para buscar en todo el historial." : "Aun no hay dictamenes guardados."}</td>
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
                      disabled={saving || consulting}
                      onClick={() => void openEvaluation(evaluation)}
                    >
                      Abrir
                    </button>
                    {!readOnly && <button type="button" className="button primary small" disabled={saving || consulting || documentLoading} onClick={() => void handleEditEvaluation(evaluation.id)}>Editar datos</button>}
                    <button
                      type="button"
                      className="button danger small"
                      disabled={readOnly || saving || consulting || documentLoading}
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
        {hasMore && !normalizedQuery && <button type="button" className="button ghost small" disabled={loading || saving} onClick={() => void onLoadMore?.()}>{loading ? "Cargando..." : "Ver más dictámenes"}</button>}
      </section>
    </div>
  );
}
