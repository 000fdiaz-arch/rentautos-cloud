import { useState } from "react";

export function ReminderForm({ tomorrow, disabled, confirmed, onSave }: {
  tomorrow: boolean; disabled: boolean; confirmed: boolean;
  onSave: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <section className={`ar-deposit-promise cxc-reminder ${tomorrow ? "is-tomorrow" : "is-today"}`}>
    <div className="ar-deposit-promise-copy">
      <h3>{tomorrow ? "Paga mañana · Envía un recordatorio" : "Pago de hoy · Envía un recordatorio"}</h3>
    </div>
    <button type="button" className="ar-deposit-promise-save" disabled={disabled || saving || confirmed} onClick={async () => {
      setSaving(true); setError("");
      try { await onSave(); } catch { setError("No se pudo confirmar el guardado. Vuelve a intentarlo."); }
      finally { setSaving(false); }
    }}>{saving ? "Guardando…" : confirmed ? "Mensaje registrado ✓" : "Mensaje enviado y continuar"}</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
