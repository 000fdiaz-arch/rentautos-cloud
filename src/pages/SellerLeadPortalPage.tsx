import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { isSellerLeadPortalAvailable, loadPublicSellerLeadRequest, lookupPublicSellerLead, submitPublicSellerLeadRequest, submitSharedSellerLead } from "../cloud/sellerLeadRequestCloudData";
import type { PublicSellerLeadRequest } from "../types";
import { SELLER_PENDING_MESSAGE, sellerDecisionMessage, validSellerBirthDate, validSellerCedula, validSellerCedulaInput } from "../sellerLeadPortalRules";
import { prepareSellerLeadDocument } from "../sellerLeadDocument";
import { clearSellerConsultationDemoEvents, loadSellerConsultationDemoEvents, recordSellerConsultationDemo, type SellerConsultationDemoEvent } from "../sellerConsultationLocalDemo";

type Props = { token?: string; portalId?: string };
type PortalAvailability = "checking" | "available" | "unavailable" | "error";

export default function SellerLeadPortalPage({ token, portalId }: Props) {
  const localSellerDemo = import.meta.env.DEV && portalId === "demo-local";
  const sharedSellerPortal = Boolean(portalId);
  const [request, setRequest] = useState<PublicSellerLeadRequest | null>(null);
  const [cedula, setCedula] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentDataUrl, setAttachmentDataUrl] = useState("");
  const [attachmentOptimized, setAttachmentOptimized] = useState(false);
  const [loading, setLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [ocrMessage, setOcrMessage] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [requiresIdentityConfirmation, setRequiresIdentityConfirmation] = useState(false);
  const [confirmedIdentityKey, setConfirmedIdentityKey] = useState("");
  const [error, setError] = useState("");
  const [portalAvailability, setPortalAvailability] = useState<PortalAvailability>(portalId && !localSellerDemo ? "checking" : "available");
  const [sellerNameInput, setSellerNameInput] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [consultationNotice, setConsultationNotice] = useState("");
  const [demoHistory, setDemoHistory] = useState<SellerConsultationDemoEvent[]>([]);
  const operation = useRef(0);
  const fileOperation = useRef(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void loadPublicSellerLeadRequest(token).then((next) => {
      if (cancelled) return;
      setRequest(next);
      setCedula(next.cedula);
      setBirthDate(next.birthDate);
      setAttachmentName(next.attachmentName ?? "");
    }).catch(() => {
      if (!cancelled) setError("Este enlace no está disponible. Comunícate con Rentautos.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!portalId) return;
    const sessionKey = `rentautos:seller-consultation-session:${portalId}`;
    const savedSeller = sessionStorage.getItem(sessionKey) ?? "";
    setSellerName(savedSeller);
    setSellerNameInput(savedSeller);
    if (localSellerDemo) {
      setPortalAvailability("available");
      setDemoHistory(loadSellerConsultationDemoEvents());
      return;
    }
    let cancelled = false;
    setPortalAvailability("checking");
    setError("");
    void isSellerLeadPortalAvailable(portalId).then((available) => {
      if (!cancelled) setPortalAvailability(available ? "available" : "unavailable");
    }).catch(() => {
      if (!cancelled) {
        setPortalAvailability("error");
        setError("No se pudo validar este enlace. Revisa tu conexión y vuelve a cargar la página.");
      }
    });
    return () => { cancelled = true; };
  }, [localSellerDemo, portalId]);

  function changeCedula(value: string): void {
    if (!validSellerCedulaInput(value)) {
      setError("La cédula solo permite números y guiones (-).");
      return;
    }
    setError("");
    setCedula(value);
    if (!portalId) return;
    operation.current += 1;
    fileOperation.current += 1;
    setLoading(false);
    setReadingFile(false);
    setRequest(null);
    setBirthDate("");
    setAttachmentName("");
    setAttachmentDataUrl("");
    setAttachmentOptimized(false);
    setOcrMessage("");
    setOcrProgress(0);
    setRequiresIdentityConfirmation(false);
    setConfirmedIdentityKey("");
    setConsultationNotice("");
    setError("");
  }

  function beginSellerSession(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized = sellerNameInput.trim().replace(/\s+/g, " ");
    if (normalized.length < 3) {
      setError("Escribe el nombre del vendedor para continuar.");
      return;
    }
    if (portalId) sessionStorage.setItem(`rentautos:seller-consultation-session:${portalId}`, normalized);
    setSellerName(normalized);
    setSellerNameInput(normalized);
    setError("");
  }

  function changeSeller(): void {
    if (portalId) sessionStorage.removeItem(`rentautos:seller-consultation-session:${portalId}`);
    changeCedula("");
    setSellerName("");
    setSellerNameInput("");
  }

  async function consult(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    if (!portalId || saving) return;
    if (!validSellerCedula(cedula)) {
      setError("Introduce una cédula válida para consultar.");
      return;
    }
    const current = ++operation.current;
    setLoading(true);
    setError("");
    setRequest(null);
    try {
      if (localSellerDemo) {
        const recorded = recordSellerConsultationDemo(cedula, sellerName);
        setDemoHistory(loadSellerConsultationDemoEvents());
        setConsultationNotice(recorded.consultationCount > 1
          ? "Esta persona ya fue consultada. Registramos el seguimiento sin cambiar al vendedor original."
          : "");
        const next: PublicSellerLeadRequest = {
          status: recorded.consultationCount > 1 ? "pending_review" : "not_found",
          cedula: cedula.trim().toUpperCase(),
          birthDate: "",
          expiresAt: ""
        };
        if (current === operation.current) setRequest(next);
        return;
      }
      const next = await lookupPublicSellerLead(portalId, cedula.trim(), sellerName);
      if (current === operation.current) {
        setConsultationNotice(next.alreadyConsulted
          ? "Esta persona ya fue consultada. Registramos el seguimiento sin cambiar al vendedor original."
          : "");
        setRequest(next);
      }
    } catch (cause) {
      if (current === operation.current) setError(cause instanceof Error ? cause.message : "No se pudo consultar. Intenta nuevamente.");
    } finally {
      if (current === operation.current) setLoading(false);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const current = ++fileOperation.current;
    const file = event.target.files?.[0];
    let documentPrepared = false;
    setAttachmentDataUrl("");
    setAttachmentName("");
    setAttachmentOptimized(false);
    setOcrMessage("");
    setOcrProgress(0);
    setReadingFile(false);
    if (!file) return;
    setReadingFile(true);
    setRequiresIdentityConfirmation(true);
    setConfirmedIdentityKey("");
    try {
      const prepared = await prepareSellerLeadDocument(file);
      if (current !== fileOperation.current) return;
      setAttachmentName(prepared.name);
      setAttachmentDataUrl(prepared.dataUrl);
      setAttachmentOptimized(prepared.optimized);
      documentPrepared = true;
      const { analyzeLeadIdentityDocument } = await import("../leadIdentityDocumentOcr");
      const detected = await analyzeLeadIdentityDocument({ dataUrl: prepared.dataUrl, mime: prepared.dataUrl.slice(5, prepared.dataUrl.indexOf(";")), name: prepared.name }, ({ progress, message }) => {
        if (current === fileOperation.current) {
          setOcrProgress(progress);
          setOcrMessage(message);
        }
      });
      if (current !== fileOperation.current) return;
      if (detected.cedula) setCedula(detected.cedula);
      if (detected.birthDate) setBirthDate(detected.birthDate);
      setOcrProgress(1);
      setOcrMessage(detected.cedula && detected.birthDate
        ? "Cédula y fecha detectadas. Confírmalas con el documento."
        : detected.birthDate
          ? "Fecha detectada. Completa la cédula y confirma ambos datos."
          : "Lectura parcial. Completa los datos faltantes y confírmalos con el documento.");
      setError("");
    } catch (cause) {
      if (current === fileOperation.current && documentPrepared) {
        setOcrMessage("No se pudieron detectar todos los datos. Complétalos manualmente y confírmalos.");
      } else {
        event.target.value = "";
        if (current === fileOperation.current) setError(cause instanceof Error ? cause.message : "No se pudo leer el documento. Selecciónalo nuevamente.");
      }
    } finally {
      if (current === fileOperation.current) setReadingFile(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving || readingFile) return;
    const identityKey = `${cedula.trim().toUpperCase()}|${birthDate}`;
    if (requiresIdentityConfirmation && confirmedIdentityKey !== identityKey) {
      setError("Confirma que la cédula y la fecha coinciden con el documento.");
      return;
    }
    if (!validSellerCedula(cedula) || !validSellerBirthDate(birthDate)
      || !attachmentName || (!attachmentDataUrl && (portalId || !request?.attachmentName))) {
      setError("Completa la cédula, una fecha de nacimiento válida y el documento de la persona.");
      return;
    }
    setSaving(true);
    setError("");
    const input = { cedula: cedula.trim().toUpperCase(), birthDate, attachmentName, attachmentDataUrl };
    try {
      if (localSellerDemo) {
        setRequest({ status: "pending_review", cedula: input.cedula, birthDate: input.birthDate, attachmentName: input.attachmentName, expiresAt: "" });
      } else if (portalId) {
        setRequest(await submitSharedSellerLead(portalId, input));
      } else if (token) {
        await submitPublicSellerLeadRequest(token, input);
        setRequest(await loadPublicSellerLeadRequest(token));
      }
      setBirthDate("");
      setAttachmentName("");
      setAttachmentDataUrl("");
      setAttachmentOptimized(false);
      setOcrMessage("");
      setOcrProgress(0);
      setRequiresIdentityConfirmation(false);
      setConfirmedIdentityKey("");
    } catch (cause) {
      setError(portalId && cause instanceof Error ? cause.message : "No pudimos enviar la información. Intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  const editable = request && ["not_found", "waiting_information", "incomplete"].includes(request.status);
  const locked = saving || readingFile;
  const currentIdentityKey = `${cedula.trim().toUpperCase()}|${birthDate}`;
  const identityConfirmed = !requiresIdentityConfirmation || currentIdentityKey === confirmedIdentityKey;

  async function confirmIdentity(): Promise<void> {
    if (!validSellerCedula(cedula) || !validSellerBirthDate(birthDate)) {
      setError("Revisa y completa la cédula y la fecha antes de confirmar.");
      return;
    }
    setCedula(cedula.trim().toUpperCase());
    setConfirmedIdentityKey(`${cedula.trim().toUpperCase()}|${birthDate}`);
    setError("");
    if (portalId && !editable) await consult();
  }

  return (
    <main className="seller-lead-page">
      <section className="seller-lead-card">
        {!sharedSellerPortal && <div className="seller-lead-brand">RENTAUTOS</div>}
        {!sharedSellerPortal && <h1>Consulta de personas</h1>}
        {sharedSellerPortal && portalAvailability === "available" && sellerName && (
          <div className="seller-lead-operator">
            <span>Atendiendo como <strong>{sellerName}</strong></span>
            <button type="button" className="button ghost small" onClick={changeSeller}>Cambiar vendedor</button>
          </div>
        )}
        {sharedSellerPortal && portalAvailability === "available" && !sellerName && (
          <form className="seller-lead-search seller-lead-identification" onSubmit={beginSellerSession}>
            <span className="seller-lead-identification__step">Identificación del vendedor</span>
            <h2>¿Quién está atendiendo?</h2>
            <p>Ingresa tu nombre antes de comenzar. Las consultas realizadas desde esta pestaña quedarán registradas como atenciones tuyas.</p>
            <label className="seller-lead-identification__label">
              <span>Nombre del vendedor <small>Obligatorio</small></span>
              <input autoComplete="name" maxLength={80} value={sellerNameInput} onChange={(event) => setSellerNameInput(event.target.value)} placeholder="Escribe aquí tu nombre de vendedor" autoFocus />
            </label>
            <button type="submit" className="button primary seller-lead-submit">Iniciar consultas</button>
          </form>
        )}
        {portalId && portalAvailability === "available" && !editable && Boolean(sellerName) && (
          <form className="seller-lead-search" onSubmit={(event) => void consult(event)}>
            <p>Vendedor: escribe la cédula o sube una foto de la licencia. La app leerá los datos antes de consultar.</p>
            <label>Cédula de la persona
              <input autoComplete="off" inputMode="tel" pattern={"[0-9\\-]*"} title="Solo números y guiones (-)" maxLength={32} value={cedula} onChange={(event) => changeCedula(event.target.value)}
                placeholder="Ej. 8-888-888" disabled={locked} />
            </label>
            <label className="seller-lead-file">O consulta con una foto de la licencia
              <input type="file" accept="image/*,application/pdf,.heic,.heif" onChange={(event) => void handleFile(event)} disabled={locked || loading} />
            </label>
            {attachmentName && (
              <div className="seller-lead-search-identity">
                <label>Fecha de nacimiento<input type="date" min="1900-01-01" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} disabled={locked || loading} /></label>
                {ocrMessage && <div className="seller-lead-ocr-status" role="status"><span>{ocrMessage}</span>{readingFile && <progress max="1" value={ocrProgress} />}</div>}
                {requiresIdentityConfirmation && (
                  <div className={`lead-identity-review ${identityConfirmed ? "is-confirmed" : ""}`}>
                    <div><strong>{identityConfirmed ? "Datos confirmados" : "Revisión obligatoria"}</strong><span>Compara la cédula y la fecha con el documento.</span></div>
                    <button type="button" className="button primary" disabled={locked || loading || identityConfirmed} onClick={() => void confirmIdentity()}>{identityConfirmed ? "Confirmado" : "Confirmar y consultar"}</button>
                  </div>
                )}
              </div>
            )}
            <button type="submit" className="button primary seller-lead-submit" disabled={locked || loading || (requiresIdentityConfirmation && !identityConfirmed)}>
              {loading ? "Consultando..." : "Consultar"}
            </button>
          </form>
        )}
        <div aria-live="polite">
          {loading && !portalId && <p className="hint">Cargando solicitud...</p>}
          {portalAvailability === "checking" && <p className="hint">Validando enlace...</p>}
          {error && <p role="alert" className="error-banner">{error}</p>}
          {consultationNotice && <p className="seller-lead-consultation-notice">{consultationNotice}</p>}
        </div>
        {portalId && portalAvailability === "unavailable" && (
          <div className="seller-lead-state"><strong>Este enlace no está disponible</strong><p>Solicita a Rentautos un enlace actualizado para continuar.</p></div>
        )}
        {!loading && request?.status === "expired" && (
          <div className="seller-lead-state"><strong>Este enlace venció</strong><p>Solicita a Rentautos el enlace de consulta para continuar.</p></div>
        )}
        {!loading && editable && (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <p>{request?.status === "incomplete"
              ? "Falta completar la verificación de esta persona. Revisa sus datos y adjunta nuevamente un documento legible."
              : "Completa los datos de esta persona para enviarla a verificación."}</p>
            {!portalId && request?.status === "incomplete" && request.correctionNote && (
              <div className="warning-banner"><strong>Corrección solicitada:</strong> {request.correctionNote}</div>
            )}
            <div className="form-grid seller-lead-form-grid">
              <label className="seller-lead-file">Foto de cédula o licencia
                <input type="file" accept="image/*,application/pdf,.heic,.heif" aria-describedby="seller-lead-file-help" onChange={(event) => void handleFile(event)} disabled={locked} />
              </label>
              <label>Cédula de la persona<input value={cedula} inputMode="tel" pattern={"[0-9\\-]*"} title="Solo números y guiones (-)" maxLength={32} onChange={(event) => { if (validSellerCedulaInput(event.target.value)) { setCedula(event.target.value); setError(""); } }} disabled={locked} /></label>
              <label>Fecha de nacimiento<input required type="date" min="1900-01-01" max={new Date().toISOString().slice(0, 10)}
                value={birthDate} onChange={(event) => setBirthDate(event.target.value)} disabled={locked} /></label>
            </div>
            <p className="hint" id="seller-lead-file-help">Puedes tomar una foto o elegirla del teléfono, incluso HEIC/HEIF. Las fotos grandes se optimizan automáticamente; PDF máximo 4 MB. Comparte estos documentos solo con autorización de la persona.</p>
            {attachmentName && <p className="hint">Documento: {attachmentName}</p>}
            {attachmentOptimized && <p className="hint">La foto fue convertida y optimizada para poder enviarla.</p>}
            {ocrMessage && <div className="seller-lead-ocr-status" role="status"><span>{ocrMessage}</span>{readingFile && <progress max="1" value={ocrProgress} />}</div>}
            {requiresIdentityConfirmation && (
              <div className={`lead-identity-review ${identityConfirmed ? "is-confirmed" : ""}`}>
                <div><strong>{identityConfirmed ? "Datos confirmados" : "Revisión obligatoria"}</strong><span>Compara la cédula y la fecha con el documento.</span></div>
                <button type="button" className="button primary" disabled={locked || identityConfirmed} onClick={() => void confirmIdentity()}>{identityConfirmed ? "Confirmado" : "Confirmar datos"}</button>
              </div>
            )}
            {portalId && <button type="button" className="button ghost seller-lead-submit" disabled={locked} onClick={() => changeCedula(localSellerDemo ? "" : cedula)}>Consultar otra persona</button>}
            <button type="submit" className="button primary seller-lead-submit" disabled={locked || !identityConfirmed}>
              {readingFile ? "Leyendo documento..." : saving ? "Enviando..." : "Enviar a verificación"}
            </button>
          </form>
        )}
        {!loading && request?.status === "pending_review" && (
          <div role="status" className="seller-lead-state seller-lead-state--pending">
            <strong>En revisión</strong><p>{SELLER_PENDING_MESSAGE}</p>
            {localSellerDemo && <button type="button" className="button ghost seller-lead-submit" onClick={() => changeCedula("")}>Consultar otra persona</button>}
          </div>
        )}
        {!loading && request?.status === "reviewed" && request.decision && (
          <div role="status" className={`seller-lead-result ${request.decision === "no_aplica" ? "seller-lead-result--neutral" : ""}`}>
            <strong>{sellerDecisionMessage(request.decision)}</strong>
            {request.decision !== "no_aplica" && (request.extraDeposit ?? 0) > 0 && (
              <p>Se requiere un abono adicional de {new Intl.NumberFormat("es-PA", { style: "currency", currency: "USD" }).format(request.extraDeposit ?? 0)}.</p>
            )}
          </div>
        )}
        {localSellerDemo && (
          <section className="seller-lead-demo-history">
            <div className="seller-lead-demo-history__header">
              <div><strong>Historial de prueba</strong><span>Esto simula lo que verá administración.</span></div>
              <button type="button" className="button ghost small" onClick={() => { clearSellerConsultationDemoEvents(); setDemoHistory([]); setConsultationNotice(""); }}>Reiniciar</button>
            </div>
            {demoHistory.length === 0 ? <p className="hint">Aún no hay consultas en este navegador.</p> : (
              <div className="seller-lead-demo-history__list">
                {[...demoHistory].reverse().map((event) => (
                  <div key={event.id}>
                    <strong>{event.cedula}</strong>
                    <span>{event.sellerName} · {event.kind === "original" ? "Responsable original" : "Seguimiento"}</span>
                    <small>{new Date(event.consultedAt).toLocaleString("es-PA", { dateStyle: "short", timeStyle: "short" })}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {portalId && !localSellerDemo && <p className="hint seller-lead-privacy">Consulta pública sin iniciar sesión. Solo se muestra el estado del proceso y, cuando corresponde, el abono adicional.</p>}
      </section>
    </main>
  );
}
