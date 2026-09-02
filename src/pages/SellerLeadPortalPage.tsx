import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { loadPublicSellerLeadRequest, lookupPublicSellerLead, submitPublicSellerLeadRequest, submitSharedSellerLead } from "../cloud/sellerLeadRequestCloudData";
import type { PublicSellerLeadRequest } from "../types";
import { SELLER_PENDING_MESSAGE, sellerDecisionMessage, validSellerBirthDate, validSellerCedula } from "../sellerLeadPortalRules";

type Props = { token?: string; portalId?: string };

export default function SellerLeadPortalPage({ token, portalId }: Props) {
  const [request, setRequest] = useState<PublicSellerLeadRequest | null>(null);
  const [cedula, setCedula] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentDataUrl, setAttachmentDataUrl] = useState("");
  const [loading, setLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState("");
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

  function changeCedula(value: string): void {
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
    setError("");
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
      const next = await lookupPublicSellerLead(portalId, cedula.trim());
      if (current === operation.current) setRequest(next);
    } catch (cause) {
      if (current === operation.current) setError(cause instanceof Error ? cause.message : "No se pudo consultar. Intenta nuevamente.");
    } finally {
      if (current === operation.current) setLoading(false);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const current = ++fileOperation.current;
    const file = event.target.files?.[0];
    setAttachmentDataUrl("");
    setAttachmentName("");
    setReadingFile(false);
    if (!file) return;
    if (file.size === 0 || file.size > 4 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.type)) {
      setError("Adjunta un archivo PNG, JPEG, WebP o PDF de hasta 4 MB.");
      event.target.value = "";
      return;
    }
    setReadingFile(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("No se pudo leer el documento."));
        reader.readAsDataURL(file);
      });
      if (current !== fileOperation.current) return;
      setAttachmentName(file.name.slice(0, 240));
      setAttachmentDataUrl(dataUrl);
      setError("");
    } catch {
      if (current === fileOperation.current) setError("No se pudo leer el documento. Selecciónalo nuevamente.");
    } finally {
      if (current === fileOperation.current) setReadingFile(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving || readingFile) return;
    if (!validSellerCedula(cedula) || !validSellerBirthDate(birthDate)
      || !attachmentName || (!attachmentDataUrl && (portalId || !request?.attachmentName))) {
      setError("Completa la cédula, una fecha de nacimiento válida y el documento de la persona.");
      return;
    }
    setSaving(true);
    setError("");
    const input = { cedula: cedula.trim().toUpperCase(), birthDate, attachmentName, attachmentDataUrl };
    try {
      if (portalId) {
        setRequest(await submitSharedSellerLead(portalId, input));
      } else if (token) {
        await submitPublicSellerLeadRequest(token, input);
        setRequest(await loadPublicSellerLeadRequest(token));
      }
      setBirthDate("");
      setAttachmentName("");
      setAttachmentDataUrl("");
    } catch (cause) {
      setError(portalId && cause instanceof Error ? cause.message : "No pudimos enviar la información. Intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  const editable = request && ["not_found", "waiting_information", "incomplete"].includes(request.status);
  const locked = saving || readingFile;

  return (
    <main className="seller-lead-page">
      <section className="seller-lead-card">
        <div className="seller-lead-brand">RENTAUTOS</div>
        <h1>Consulta de personas</h1>
        {portalId && (
          <form className="seller-lead-search" onSubmit={(event) => void consult(event)}>
            <p>Vendedor: introduce la cédula de la persona para conocer el siguiente paso.</p>
            <label>Cédula de la persona
              <input autoComplete="off" maxLength={32} value={cedula} onChange={(event) => changeCedula(event.target.value)}
                placeholder="Ej. 8-888-888" disabled={locked} />
            </label>
            <button type="submit" className="button primary seller-lead-submit" disabled={locked || loading}>
              {loading ? "Consultando..." : "Consultar"}
            </button>
          </form>
        )}
        <div aria-live="polite">
          {loading && !portalId && <p className="hint">Cargando solicitud...</p>}
          {error && <p role="alert" className="error-banner">{error}</p>}
        </div>
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
              {!portalId && <label>Cédula de la persona<input value={cedula} maxLength={32} onChange={(event) => changeCedula(event.target.value)} disabled={locked} /></label>}
              <label>Fecha de nacimiento<input required type="date" min="1900-01-01" max={new Date().toISOString().slice(0, 10)}
                value={birthDate} onChange={(event) => setBirthDate(event.target.value)} disabled={locked} /></label>
              <label className="seller-lead-file">Foto de cédula o licencia
                <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => void handleFile(event)} disabled={locked} />
              </label>
            </div>
            <p className="hint">PNG, JPEG, WebP o PDF. Máximo 4 MB. Comparte estos documentos solo con autorización de la persona.</p>
            {attachmentName && <p className="hint">Documento: {attachmentName}</p>}
            <button type="submit" className="button primary seller-lead-submit" disabled={locked}>
              {readingFile ? "Leyendo documento..." : saving ? "Enviando..." : "Enviar a verificación"}
            </button>
          </form>
        )}
        {!loading && request?.status === "pending_review" && (
          <div role="status" className="seller-lead-state seller-lead-state--pending">
            <strong>En revisión</strong><p>{SELLER_PENDING_MESSAGE}</p>
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
        {portalId && <p className="hint seller-lead-privacy">Consulta pública sin iniciar sesión. Solo se muestra el estado del proceso y, cuando corresponde, el abono adicional.</p>}
      </section>
    </main>
  );
}
