import { useEffect, useState } from "react";
import { loadCloudReceivablesCollectorPinHashes } from "../../cloudDataV2";
import {
  RECEIVABLES_COLLECTORS,
  RECEIVABLES_COLLECTOR_PIN_LENGTH,
  saveReceivablesCollectorSession,
  verifyReceivablesCollectorPin,
  type ReceivablesCollectorKey,
  type ReceivablesCollectorPinHashes,
  type ReceivablesCollectorSession
} from "../../receivablesV2CollectorAccess";
import "./receivablesCollectorAccess.css";

type Props = {
  dataOwnerUserId?: string | null;
  dateKey: string;
  onSessionStarted: (session: ReceivablesCollectorSession) => void;
};

const COLLECTOR_KEYS: ReceivablesCollectorKey[] = ["collector-1", "collector-2"];

export default function ReceivablesCollectorAccess({ dataOwnerUserId, dateKey, onSessionStarted }: Props) {
  const [pinHashes, setPinHashes] = useState<ReceivablesCollectorPinHashes | null>(null);
  const [selectedCollector, setSelectedCollector] = useState<ReceivablesCollectorKey | "">("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!dataOwnerUserId) {
      setLoading(false);
      setError("No se encontró la cuenta propietaria para cargar el acceso.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void loadCloudReceivablesCollectorPinHashes(dataOwnerUserId)
      .then((hashes) => {
        if (!cancelled) setPinHashes(hashes);
      })
      .catch((loadError) => {
        console.error("No se pudo cargar el acceso de cobradores.", loadError);
        if (!cancelled) setError("No se pudo cargar el acceso. Confirma que esté aplicada la migración 129 de Cuentas por cobrar.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [dataOwnerUserId]);

  async function enterCollector(): Promise<void> {
    if (!selectedCollector || !pinHashes || verifying) return;
    if (pin.length !== RECEIVABLES_COLLECTOR_PIN_LENGTH) {
      setError(`Ingresa el PIN de ${RECEIVABLES_COLLECTOR_PIN_LENGTH} dígitos.`);
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const valid = await verifyReceivablesCollectorPin(pin, pinHashes[selectedCollector]);
      if (!valid) {
        setError("El PIN no corresponde al cobrador seleccionado.");
        return;
      }
      const session = { dateKey, collector: selectedCollector } satisfies ReceivablesCollectorSession;
      saveReceivablesCollectorSession(dataOwnerUserId, session);
      onSessionStarted(session);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <main className="receivables-access-page">
      <section className="receivables-access-card" aria-labelledby="receivables-access-title">
        <span className="receivables-access-eyebrow">Inicio de jornada</span>
        <h1 id="receivables-access-title">Cuentas por cobrar 2.0</h1>
        <p>Selecciona tu cartera e ingresa el PIN. El acceso permanecerá abierto hasta medianoche.</p>
        {loading ? <p className="hint">Cargando acceso…</p> : null}
        {!loading && pinHashes ? (
          <div className="receivables-access-form">
            <label>
              Cobrador
              <select value={selectedCollector} onChange={(event) => { setSelectedCollector(event.target.value as ReceivablesCollectorKey | ""); setPin(""); setError(""); }}>
                <option value="">Selecciona…</option>
                {COLLECTOR_KEYS.map((key) => <option key={key} value={key}>{RECEIVABLES_COLLECTORS[key].label} · {RECEIVABLES_COLLECTORS[key].groups.join(", ")}</option>)}
              </select>
            </label>
            <label>
              PIN de ingreso
              <input
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={RECEIVABLES_COLLECTOR_PIN_LENGTH}
                value={pin}
                disabled={!selectedCollector}
                placeholder={"•".repeat(RECEIVABLES_COLLECTOR_PIN_LENGTH)}
                onChange={(event) => { setPin(event.target.value.replace(/\D/g, "")); setError(""); }}
                onKeyDown={(event) => { if (event.key === "Enter") void enterCollector(); }}
              />
            </label>
            <button type="button" className="button primary" disabled={!selectedCollector || pin.length !== RECEIVABLES_COLLECTOR_PIN_LENGTH || verifying} onClick={() => void enterCollector()}>
              {verifying ? "Verificando…" : "Entrar a mi cartera"}
            </button>
          </div>
        ) : null}
        {!loading && !pinHashes && !error ? <p className="receivables-access-alert">Los PIN aún no están configurados. Solicita a un administrador configurarlos.</p> : null}
        {error ? <p className="receivables-access-alert" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
