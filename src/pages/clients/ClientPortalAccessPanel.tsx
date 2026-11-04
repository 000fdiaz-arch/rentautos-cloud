import { useEffect, useState } from "react";
import {
  configureClientPortalAccess,
  disableClientPortalAccess,
  loadClientPortalAccessStatus,
  type ClientPortalAccessStatus
} from "../../cloud/clientPortalCloudData";

type Props = {
  ownerUserId?: string | null;
  clientId: string;
  cedula: string;
  unitId: string;
};

function generatePin(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

export function ClientPortalAccessPanel({ ownerUserId, clientId, cedula, unitId }: Props) {
  const [status, setStatus] = useState<ClientPortalAccessStatus | null>(null);
  const [pin, setPin] = useState("");
  const [revealedPin, setRevealedPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const portalUrl = `${window.location.origin}/portal-cliente`;

  useEffect(() => {
    if (!ownerUserId || !clientId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void loadClientPortalAccessStatus(ownerUserId, clientId, cedula).then((next) => {
      if (!cancelled) setStatus(next);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo consultar el acceso al portal.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ownerUserId, clientId, cedula]);

  function makePin(): void {
    const next = generatePin();
    setPin(next);
    setRevealedPin("");
    setMessage("");
    setError("");
  }

  async function savePin(): Promise<void> {
    if (!ownerUserId) {
      setError("No se pudo identificar el propietario de los datos.");
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError("El PIN debe tener exactamente 6 dígitos.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const next = await configureClientPortalAccess(ownerUserId, clientId, pin, cedula);
      setStatus(next);
      setRevealedPin(pin);
      setPin("");
      setMessage("Acceso configurado. Entrega este PIN al cliente por un canal seguro; solo se mostrará ahora.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo configurar el acceso.");
    } finally {
      setSaving(false);
    }
  }

  async function disableAccess(): Promise<void> {
    if (!ownerUserId || !window.confirm("¿Desactivar el acceso de este cliente al portal?")) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await disableClientPortalAccess(ownerUserId, clientId, cedula);
      setStatus((current) => ({
        configured: current?.configured ?? true,
        active: false,
        pinChangedAt: current?.pinChangedAt ?? null,
        updatedAt: new Date().toISOString()
      }));
      setRevealedPin("");
      setMessage("El acceso del cliente quedó desactivado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo desactivar el acceso.");
    } finally {
      setSaving(false);
    }
  }

  async function copy(value: string, success: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(success);
    } catch {
      setError("No se pudo copiar automáticamente.");
    }
  }

  return (
    <section className="client-portal-access-panel" style={{ gridColumn: "1 / -1" }}>
      <div className="client-portal-access-head">
        <div>
          <h3>Portal del cliente</h3>
          <p className="hint">El cliente ingresará solo con su cédula y este PIN único. Dentro del portal podrá consultar todas sus unidades, incluida {unitId || "—"}.</p>
        </div>
        <span className={`badge-sim ${status?.active ? "" : "amount-muted"}`}>
          {loading ? "Consultando…" : status?.active ? "Acceso activo" : "Sin acceso"}
        </span>
      </div>

      {!cedula.trim() && <p className="warning-banner">Guarda una cédula válida antes de habilitar el portal.</p>}
      <div className="client-portal-link-row">
        <input value={portalUrl} readOnly aria-label="Enlace del portal del cliente" />
        <button type="button" className="button ghost small" onClick={() => void copy(portalUrl, "Enlace del portal copiado.")}>Copiar enlace</button>
      </div>
      <div className="client-portal-pin-row">
        <label>Nuevo PIN
          <input type="text" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="6 dígitos" />
        </label>
        <button type="button" className="button ghost" onClick={makePin}>Generar PIN único</button>
        <button type="button" className="button primary" disabled={saving || !cedula.trim()} onClick={() => void savePin()}>
          {saving ? "Guardando…" : status?.configured ? "Restablecer acceso" : "Activar acceso"}
        </button>
      </div>

      {revealedPin && (
        <div className="client-portal-pin-result" role="status">
          <span>PIN para entregar al cliente</span><strong>{revealedPin}</strong>
          <button type="button" className="button ghost small" onClick={() => void copy(revealedPin, "PIN copiado.")}>Copiar PIN</button>
        </div>
      )}
      {status?.pinChangedAt && <p className="hint">PIN configurado: {new Date(status.pinChangedAt).toLocaleString("es-PA")}</p>}
      {status?.active && <button type="button" className="button danger small" disabled={saving} onClick={() => void disableAccess()}>Desactivar acceso</button>}
      {message && <p className="success-banner" role="status">{message}</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
    </section>
  );
}
