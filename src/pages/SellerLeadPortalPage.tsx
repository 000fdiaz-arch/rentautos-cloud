import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { loadPublicSellerLeadRequest, submitPublicSellerLeadRequest } from "../cloudData";
import type { PublicSellerLeadRequest } from "../types";

type Props = { token: string };

const decisionLabels = {
  aplica: "SI APLICA",
  aplica_con_abono: "APLICA CON ABONO EXTRA",
  no_aplica: "NO APLICA"
} as const;

export default function SellerLeadPortalPage({ token }: Props) {
  const [request, setRequest] = useState<PublicSellerLeadRequest | null>(null);
  const [cedula, setCedula] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentDataUrl, setAttachmentDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const next = await loadPublicSellerLeadRequest(token);
      setRequest(next);
      setCedula(next.cedula);
      setBirthDate(next.birthDate);
      setAttachmentName(next.attachmentName ?? "");
    } catch {
      setError("Este enlace no existe o ya no esta disponible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [token]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError("El documento no puede pesar mas de 4 MB.");
      event.target.value = "";
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el documento."));
      reader.readAsDataURL(file);
    });
    setAttachmentName(file.name);
    setAttachmentDataUrl(dataUrl);
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!cedula.trim() || !birthDate || !attachmentName || (!attachmentDataUrl && !request?.attachmentName)) {
      setError("Completa la cedula, la fecha de nacimiento y adjunta el documento.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await submitPublicSellerLeadRequest(token, { cedula: cedula.trim().toUpperCase(), birthDate, attachmentName, attachmentDataUrl });
      await refresh();
    } catch {
      setError("No pudimos enviar la informacion. Revisa el enlace e intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  const editable = request?.status === "waiting_information" || request?.status === "incomplete";

  return (
    <main className="seller-lead-page">
      <section className="seller-lead-card">
        <div className="seller-lead-brand">RENTAUTOS</div>
        <h1>Consulta de vendedor</h1>
        {loading && <p className="hint">Cargando solicitud...</p>}
        {error && <p className="error-banner">{error}</p>}

        {!loading && request?.status === "expired" && (
          <div className="seller-lead-state">
            <strong>Este enlace vencio</strong>
            <p>Solicita a Rentautos un nuevo enlace para continuar.</p>
          </div>
        )}

        {!loading && editable && (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <p>Completa tus datos para que podamos revisar si aplicas.</p>
            {request?.status === "incomplete" && (
              <div className="warning-banner"><strong>Necesitamos una correccion:</strong> {request.correctionNote}</div>
            )}
            <div className="form-grid seller-lead-form-grid">
              <label>Cedula<input value={cedula} onChange={(event) => setCedula(event.target.value)} placeholder="Ej. 8-888-888" disabled={saving} /></label>
              <label>Fecha de nacimiento<input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} disabled={saving} /></label>
              <label className="seller-lead-file">Foto de cedula o licencia<input type="file" accept="image/*,.pdf" onChange={(event) => void handleFile(event)} disabled={saving} /></label>
            </div>
            {attachmentName && <p className="hint">Documento seleccionado: {attachmentName}</p>}
            <button type="submit" className="button primary seller-lead-submit" disabled={saving}>{saving ? "Enviando..." : "Enviar informacion"}</button>
          </form>
        )}

        {!loading && request?.status === "pending_review" && (
          <div className="seller-lead-state seller-lead-state--pending">
            <strong>Informacion recibida</strong>
            <p>Tu solicitud esta pendiente de revision. Puedes volver a este mismo enlace para consultar el resultado.</p>
          </div>
        )}

        {!loading && request?.status === "reviewed" && request.decision && (
          <div className="seller-lead-result">
            <span>Resultado</span>
            <strong>{decisionLabels[request.decision]}</strong>
            <p>Abono extra: ${request.extraDeposit ?? 0}</p>
            <small>Para los siguientes pasos, comunicate con Rentautos.</small>
          </div>
        )}
      </section>
    </main>
  );
}
