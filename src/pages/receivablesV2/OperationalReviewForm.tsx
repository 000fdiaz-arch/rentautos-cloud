import { useState } from "react";
import "./operationalReview.css";
import { useWorkdayValue } from "./workdayProgress";
import { FLEET_STATUS_OPTIONS } from "../controlUnits/controlUnitsRules";
import { clientOperationalStatusLabel } from "./receivablesPageRules";

export function OperationalReviewForm({ draftKey, unit, status, confirmed, disabled, loadError, onSave, onPendingChange }: {
  draftKey: string;
  loadError?: string;
  unit: string; status: string; confirmed: boolean; disabled: boolean;
  onSave: (status: string) => Promise<void>; onPendingChange: (pending: boolean) => void;
}) {
  const [answer, setAnswer] = useWorkdayValue(draftKey + ":answer", "");
  const [nextStatus, setNextStatus] = useWorkdayValue(draftKey + ":next-status", "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const complete = confirmed && !answer;
  return <section className={`ar-deposit-promise ar-operational-review ${complete ? "is-answered" : "is-required"}`}>
    <div className="ar-deposit-promise-copy">
      <small className="ar-deposit-promise-kicker">VALIDACIÓN DEL ESTADO</small>
      <h3>¿La unidad {unit} sigue en {clientOperationalStatusLabel(status)}?</h3>
      <p>Confirma su situación real. Si cambió, selecciona y guarda el estado correcto.</p>
    </div>
    <div className="ar-deposit-promise-form">
      <label className="ar-deposit-promise-field">Confirmación
        <select value={answer} disabled={disabled || saving} onChange={event => {
          setAnswer(event.target.value); setError(""); onPendingChange(!!event.target.value);
        }}>
          <option value="">{complete ? "Estado validado y guardado ✓" : "Selecciona una respuesta"}</option>
          <option value="same">Sí, sigue en ese estado</option>
          <option value="changed">No, el estado cambió</option>
        </select>
      </label>
      {answer === "changed" && <label className="ar-deposit-promise-field">Estado real del auto
        <select value={nextStatus} disabled={disabled || saving} onChange={event => setNextStatus(event.target.value)}>
          <option value="">Selecciona el estado real</option>
          {FLEET_STATUS_OPTIONS.filter(option => option.value !== status).map(option =>
            <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {nextStatus === "libre" || nextStatus === "archivado" ? <small>Como en Autos, este cambio archivará al cliente asociado a la unidad.</small> : null}
      </label>}
      <button type="button" className="ar-deposit-promise-save" disabled={disabled || saving || !answer || (answer === "changed" && !nextStatus)} onClick={async () => {
        setSaving(true); setError(""); onPendingChange(true);
        try {
          await onSave(answer === "same" ? status : nextStatus);
          setAnswer(""); setNextStatus(""); onPendingChange(false);
        } catch (cause) {
          setError((cause as {message?: string})?.message || "No se pudo guardar. Intenta de nuevo.");
        } finally { setSaving(false); }
      }}>{saving ? "Guardando en la base de datos…" : complete ? "Estado validado ✓" : answer === "changed" ? "Actualizar estado y guardar" : "Guardar validación"}</button>
      {error || loadError ? <p role="alert">{error || loadError}</p> : <small>{complete ? "Validación guardada. Puedes continuar." : "Guarda la validación para continuar."}</small>}
    </div>
  </section>;
}
