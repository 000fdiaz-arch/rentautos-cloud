import { useEffect, useState } from "react";
import {
  loadCloudReceivablesCollectorPinHashes,
  saveCloudReceivablesCollectorPinHashes
} from "../../cloudData";
import {
  RECEIVABLES_COLLECTORS,
  RECEIVABLES_COLLECTOR_PIN_LENGTH,
  hashReceivablesCollectorPin,
  type ReceivablesCollectorKey,
  type ReceivablesCollectorPinHashes
} from "../../receivablesCollectorAccess";
import "./ReceivablesCollectorPinsSettingsPanel.css";

type Props = {
  dataOwnerUserId?: string | null;
  canEdit: boolean;
};

const COLLECTOR_KEYS: ReceivablesCollectorKey[] = ["collector-1", "collector-2"];

export default function ReceivablesCollectorPinsSettingsPanel({ dataOwnerUserId, canEdit }: Props) {
  const [hashes, setHashes] = useState<ReceivablesCollectorPinHashes | null>(null);
  const [drafts, setDrafts] = useState<Record<ReceivablesCollectorKey, string>>({ "collector-1": "", "collector-2": "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!dataOwnerUserId) {
      setLoading(false);
      setError("No se encontró la cuenta propietaria para configurar los PIN.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setLoadFailed(false);
    void loadCloudReceivablesCollectorPinHashes(dataOwnerUserId)
      .then((next) => {
        if (!cancelled) setHashes(next);
      })
      .catch((loadError) => {
        console.error("No se pudieron cargar los PIN de cobradores.", loadError);
        if (!cancelled) {
          setLoadFailed(true);
          setError("No se pudo consultar la configuración. Confirma que esté aplicada la migración 129 de Cuentas por cobrar.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [dataOwnerUserId]);

  async function savePins(): Promise<void> {
    if (!dataOwnerUserId || !canEdit || saving || loadFailed) return;
    setError("");
    setMessage("");
    for (const key of COLLECTOR_KEYS) {
      const draft = drafts[key];
      if (!hashes?.[key] && draft.length !== RECEIVABLES_COLLECTOR_PIN_LENGTH) {
        setError(`Configura un PIN de ${RECEIVABLES_COLLECTOR_PIN_LENGTH} dígitos para ${RECEIVABLES_COLLECTORS[key].label}.`);
        return;
      }
      if (draft && draft.length !== RECEIVABLES_COLLECTOR_PIN_LENGTH) {
        setError(`El PIN de ${RECEIVABLES_COLLECTORS[key].label} debe tener ${RECEIVABLES_COLLECTOR_PIN_LENGTH} dígitos.`);
        return;
      }
    }

    setSaving(true);
    try {
      const next = { ...(hashes ?? {}) } as ReceivablesCollectorPinHashes;
      for (const key of COLLECTOR_KEYS) {
        if (drafts[key]) next[key] = await hashReceivablesCollectorPin(drafts[key]);
      }
      await saveCloudReceivablesCollectorPinHashes(dataOwnerUserId, next);
      setHashes(next);
      setDrafts({ "collector-1": "", "collector-2": "" });
      setMessage("PIN guardados. Se solicitarán al iniciar la próxima jornada de cobro.");
    } catch (saveError) {
      console.error("No se pudieron guardar los PIN de cobradores.", saveError);
      setError("No se pudieron guardar los PIN. Revisa la conexión e intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel collector-pin-settings">
      <div className="panel-head">
        <div>
          <h2>PIN de cobradores</h2>
          <p>Protege el acceso diario a cada cartera de Cuentas por cobrar 2.0.</p>
        </div>
      </div>
      {loading ? <p className="hint">Cargando configuración…</p> : null}
      {!loading ? (
        <div className="collector-pin-settings-grid">
          {COLLECTOR_KEYS.map((key) => (
            <label key={key}>
              <span>{RECEIVABLES_COLLECTORS[key].label}</span>
              <small>Cartera {RECEIVABLES_COLLECTORS[key].groups.join(", ")}</small>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={RECEIVABLES_COLLECTOR_PIN_LENGTH}
                value={drafts[key]}
                disabled={!canEdit || loadFailed}
                placeholder={hashes?.[key] ? "PIN configurado" : `${RECEIVABLES_COLLECTOR_PIN_LENGTH} dígitos`}
                onChange={(event) => {
                  setDrafts((current) => ({ ...current, [key]: event.target.value.replace(/\D/g, "") }));
                  setError("");
                  setMessage("");
                }}
              />
              <em>{hashes?.[key] ? "Configurado" : "Pendiente"}</em>
            </label>
          ))}
        </div>
      ) : null}
      {error ? <p className="collector-pin-settings-message is-error" role="alert">{error}</p> : null}
      {message ? <p className="collector-pin-settings-message is-success" role="status">{message}</p> : null}
      {!loading && canEdit ? (
        <button type="button" className="button primary" disabled={saving || loadFailed} onClick={() => void savePins()}>
          {saving ? "Guardando…" : "Guardar PIN"}
        </button>
      ) : null}
    </section>
  );
}
